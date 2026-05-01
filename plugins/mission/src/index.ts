import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveConfig, type MissionConfig } from './config.js';
import { bootstrap } from './db/bootstrap.js';
import { formatMissionState } from './format.js';
import { MissionStore } from './store.js';
import { createMissionTools } from './tools/index.js';
import type { ContextEngine, PluginContext, PluginInstance } from './types-shim.js';

interface PerAgentState {
  db: Database.Database;
  store: MissionStore;
  config: MissionConfig;
}

function pluginConfig(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return undefined;
  return (raw as { plugins?: { mission?: unknown } }).plugins?.mission;
}

export async function register(ctx: PluginContext): Promise<PluginInstance> {
  ctx.logger.info({ version: ctx.pluginVersion }, 'mission plugin loading');

  const dbDir = join(ctx.dataDir, 'mission-state-db');
  mkdirSync(dbDir, { recursive: true });

  const perAgent = new Map<string, PerAgentState>();

  function getOrCreateForAgent(agentId: string): PerAgentState {
    if (!agentId || typeof agentId !== 'string') {
      throw new TypeError(`mission: expected non-empty agentId, got ${String(agentId)}`);
    }

    let state = perAgent.get(agentId);
    if (!state) {
      const globalConfig = ctx.getGlobalConfig() as
        | { plugins?: { mission?: { defaults?: unknown } } }
        | undefined;
      const config = resolveConfig(
        globalConfig?.plugins?.mission?.defaults ?? {},
        pluginConfig(ctx.getAgentConfig(agentId)),
      );

      const db = new Database(join(dbDir, `${agentId}.sqlite`));
      bootstrap(db);
      state = { db, store: new MissionStore(db), config };
      perAgent.set(agentId, state);
      ctx.logger.info({ agentId }, 'mission: per-agent state initialized');
    }

    return state;
  }

  const engine: ContextEngine = {
    async assemble(input) {
      const state = getOrCreateForAgent(input.agentId);
      if (!state.config.enabled || !state.config.auto_inject) return null;

      const snapshot = state.store.getActiveMission(input.agentId);
      if (!snapshot || snapshot.mission.status !== 'active') return null;

      const messages = input.messages.slice() as Array<{
        role: string;
        content: string;
        [k: string]: unknown;
      }>;
      const block = { role: 'system', content: formatMissionState(snapshot, state.config) };
      const insertAt = messages[0]?.role === 'system' ? 1 : 0;
      messages.splice(insertAt, 0, block);
      return { messages: messages as unknown[] };
    },
  };

  ctx.registerContextEngine(engine);

  for (const tool of createMissionTools({
    getStore(agentId) {
      return getOrCreateForAgent(agentId).store;
    },
    getConfig(agentId) {
      return getOrCreateForAgent(agentId).config;
    },
  })) {
    ctx.registerMcpTool(tool);
  }

  ctx.registerHook('on_session_reset', (payload) => {
    const agentId = typeof payload.agentId === 'string' ? payload.agentId : '';
    if (!agentId) return;
    const state = getOrCreateForAgent(agentId);
    if (!state.config.enabled) return;
    const snapshot = state.store.getActiveMission(agentId);
    if (!snapshot) return;
    state.store.wrapSession(
      snapshot.mission.id,
      typeof payload.sessionKey === 'string' ? payload.sessionKey : null,
      `Session reset${typeof payload.reason === 'string' ? ` (${payload.reason})` : ''}. Mission remains active.`,
      snapshot.nextActions,
      { source: 'on_session_reset', reason: payload.reason ?? null },
    );
  });

  ctx.logger.info({}, 'mission plugin loaded — engine + tools registered');

  return {
    shutdown: async () => {
      ctx.logger.info({ agents: perAgent.size }, 'mission plugin shutting down');
      for (const [agentId, state] of perAgent) {
        try {
          state.db.close();
        } catch (err) {
          ctx.logger.warn({ agentId, err: String(err) }, 'mission db close failed');
        }
      }
      perAgent.clear();
    },
    onAgentConfigChanged(agentId: string): void {
      const state = perAgent.get(agentId);
      if (!state) return;
      try {
        state.db.close();
      } catch (err) {
        ctx.logger.warn({ agentId, err: String(err) }, 'mission db close failed during config refresh');
      }
      perAgent.delete(agentId);
    },
  };
}
