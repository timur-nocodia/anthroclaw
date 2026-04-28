/**
 * LCM Plugin entry point — register() wires everything together.
 *
 * Per-agent state is created lazily via getOrCreateForAgent(). At registration
 * time a 'default' bootstrap state is created so the 6 MCP tools can be
 * registered. All tool closures delegate to currentState() which reads
 * getCurrentAgentId() at call time.
 *
 * v0.1.0 limitation: tools share the 'default' agent's store/dag/lifecycle
 * instances. T24 will plumb agentId through PluginContext so each tool
 * invocation resolves its own per-agent state.
 */

import type { PluginContext, PluginInstance, ContextEngine } from './types-shim.js';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  resolveConfig,
  toEngineConfig,
  type LCMConfig,
} from './config.js';
import { bootstrap } from './db/bootstrap.js';
import { MessageStore } from './store.js';
import { SummaryDAG } from './dag.js';
import { LifecycleManager } from './lifecycle.js';
import { LCMEngine, type ResolvedLCMConfig as EngineConfig } from './engine.js';
import { createMirrorHook } from './hooks/mirror.js';
import { createGrepTool } from './tools/grep.js';
import { createDescribeTool } from './tools/describe.js';
import { createExpandTool } from './tools/expand.js';
import { createExpandQueryTool } from './tools/expand-query.js';
import { createStatusTool } from './tools/status.js';
import { createDoctorTool } from './tools/doctor.js';

interface PerAgentState {
  db: Database.Database;
  store: MessageStore;
  dag: SummaryDAG;
  lifecycle: LifecycleManager;
  engine: LCMEngine;
  config: LCMConfig;
  engineConfig: EngineConfig;
}

export async function register(ctx: PluginContext): Promise<PluginInstance> {
  ctx.logger.info({ version: ctx.pluginVersion }, 'LCM plugin loading');

  // Ensure the lcm-db directory exists before any DB is opened.
  const dbDir = join(ctx.dataDir, 'lcm-db');
  mkdirSync(dbDir, { recursive: true });

  const perAgent = new Map<string, PerAgentState>();

  // currentAgentId is updated by setCurrentAgent() which is called from:
  //   - the on_after_query mirror hook (payload.agentId)
  //   - the ContextEngine compress/assemble methods (input.agentId)
  // T24 will wire this properly via PluginContext extensions.
  let currentAgentId: string | null = null;

  function getOrCreateForAgent(agentId: string): PerAgentState {
    let state = perAgent.get(agentId);
    if (!state) {
      const agentConfig = ctx.getAgentConfig(agentId) as
        | { plugins?: { lcm?: unknown } }
        | undefined;
      const globalConfig = ctx.getGlobalConfig() as
        | { plugins?: { lcm?: { defaults?: unknown } } }
        | undefined;
      const config = resolveConfig(
        globalConfig?.plugins?.lcm?.defaults ?? {},
        agentConfig?.plugins?.lcm ?? {},
      );
      const engineConfig = toEngineConfig(config);

      const db = new Database(join(dbDir, `${agentId}.sqlite`));
      bootstrap(db);
      const store = new MessageStore(db);
      const dag = new SummaryDAG(db);
      const lifecycle = new LifecycleManager(db);
      const engine = new LCMEngine({
        store,
        dag,
        lifecycle,
        runSubagent: ctx.runSubagent.bind(ctx),
        config: engineConfig,
        logger: ctx.logger as never,
      });
      state = { db, store, dag, lifecycle, engine, config, engineConfig };
      perAgent.set(agentId, state);
      ctx.logger.info({ agentId }, 'lcm: per-agent state initialized');
    }
    return state;
  }

  const setCurrentAgent = (id: string): void => {
    currentAgentId = id;
  };
  const getCurrentAgentId = (): string => currentAgentId ?? 'default';

  // Snapshot per-agent deps at call time (reads getCurrentAgentId()).
  // NOTE v0.1.0: this returns the 'default' state when no agent has been set
  // (i.e., before any hook/compress/assemble fires). T24 fixes this.
  function currentState(): PerAgentState {
    return getOrCreateForAgent(getCurrentAgentId());
  }

  // ── ContextEngine ──────────────────────────────────────────────────────────

  const engineFacade: ContextEngine = {
    async compress(input: never) {
      const i = input as {
        agentId: string;
        sessionKey: string;
        messages: unknown[];
        currentTokens: number;
      };
      setCurrentAgent(i.agentId);
      const state = getOrCreateForAgent(i.agentId);
      if (!state.config.enabled) return null;
      try {
        const out = await state.engine.compress(i as never);
        return out.compressionApplied ? { messages: out.messages as never } : null;
      } catch (err) {
        ctx.logger.warn(
          { err: String(err), agentId: i.agentId },
          'lcm compress failed; falling back',
        );
        return null;
      }
    },

    async assemble(input: never) {
      const i = input as {
        agentId: string;
        sessionKey: string;
        messages: unknown[];
      };
      setCurrentAgent(i.agentId);
      const state = getOrCreateForAgent(i.agentId);
      if (!state.config.enabled) return null;
      try {
        const out = await state.engine.assemble(i as never);
        return { messages: out.messages as never };
      } catch (err) {
        ctx.logger.warn(
          { err: String(err), agentId: i.agentId },
          'lcm assemble failed; pass-through',
        );
        return null;
      }
    },
  };
  ctx.registerContextEngine(engineFacade);

  // ── Mirror hook ────────────────────────────────────────────────────────────

  ctx.registerHook('on_after_query', (payload) => {
    const agentId = (payload as { agentId?: string }).agentId;
    if (!agentId) return;
    setCurrentAgent(agentId);
    const state = getOrCreateForAgent(agentId);
    if (!state.config.enabled) return;
    const hook = createMirrorHook({
      engine: state.engine,
      config: state.config as never,
      logger: ctx.logger as never,
    });
    hook(payload);
  });

  // ── Bootstrap 'default' agent state so tools can be registered ────────────
  //
  // v0.1.0: all 6 tools are registered once, bound to 'default' agent's
  // store/dag/lifecycle. The session/agent resolver closures call
  // getCurrentAgentId() at invocation time so they pick up whichever agent
  // was set most recently. T24 will refactor to true per-agent tool dispatch.
  const _bs = getOrCreateForAgent('default');

  // ── MCP Tools ──────────────────────────────────────────────────────────────

  ctx.registerMcpTool(
    createGrepTool({
      store: _bs.store,
      dag: _bs.dag,
      sessionResolver: () => `${getCurrentAgentId()}:default`,
      logger: ctx.logger as never,
    }),
  );

  ctx.registerMcpTool(
    createDescribeTool({
      store: _bs.store,
      dag: _bs.dag,
      sessionResolver: () => `${getCurrentAgentId()}:default`,
      logger: ctx.logger as never,
    }),
  );

  ctx.registerMcpTool(
    createExpandTool({
      store: _bs.store,
      dag: _bs.dag,
      logger: ctx.logger as never,
    }),
  );

  ctx.registerMcpTool(
    createExpandQueryTool({
      store: _bs.store,
      dag: _bs.dag,
      sessionResolver: () => `${getCurrentAgentId()}:default`,
      runSubagent: ctx.runSubagent.bind(ctx),
      logger: ctx.logger as never,
    }),
  );

  ctx.registerMcpTool(
    createStatusTool({
      store: _bs.store,
      dag: _bs.dag,
      lifecycle: _bs.lifecycle,
      sessionResolver: () => `${getCurrentAgentId()}:default`,
      agentResolver: () => getCurrentAgentId(),
      logger: ctx.logger as never,
    }),
  );

  ctx.registerMcpTool(
    createDoctorTool({
      db: _bs.db,
      store: _bs.store,
      dag: _bs.dag,
      lifecycle: _bs.lifecycle,
      config: _bs.config,
      backupDir: join(ctx.dataDir, 'lcm-backups'),
      sessionResolver: () => `${getCurrentAgentId()}:default`,
      agentResolver: () => getCurrentAgentId(),
      logger: ctx.logger as never,
    }),
  );

  ctx.logger.info({}, 'LCM plugin loaded — engine + 6 tools registered');

  return {
    shutdown: async () => {
      ctx.logger.info({ agents: perAgent.size }, 'LCM plugin shutting down');
      for (const state of perAgent.values()) {
        try {
          state.db.close();
        } catch (err) {
          ctx.logger.warn({ err: String(err) }, 'lcm db close error');
        }
      }
      perAgent.clear();
    },
  };
}
