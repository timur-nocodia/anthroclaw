/**
 * LCM Plugin entry point — register() wires everything together.
 *
 * Per-agent state is created lazily via getOrCreateForAgent(). MCP tool
 * factories take a `resolveAgent` callback; each handler invocation reads
 * `ctx.agentId` from McpToolContext (provided by the gateway via
 * Agent.refreshPluginTools) and resolves its own per-agent state. The
 * v0.1.0 'default' bootstrap (T19 limitation) was removed in T24.
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
import type { AgentState } from './agent-state.js';

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

  /**
   * Bridge from PerAgentState to AgentState (the tool-facing shape).
   * Adds a stable sessionKey derived from agentId. Tools that need a
   * richer key may use ctx.sessionKey from McpToolContext in future.
   */
  function resolveAgent(agentId: string): AgentState {
    const state = getOrCreateForAgent(agentId);
    return {
      db: state.db,
      store: state.store,
      dag: state.dag,
      lifecycle: state.lifecycle,
      config: state.config,
      sessionKey: `${agentId}:default`,
    };
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
    const state = getOrCreateForAgent(agentId);
    if (!state.config.enabled) return;
    const hook = createMirrorHook({
      engine: state.engine,
      config: state.config as never,
      logger: ctx.logger as never,
    });
    hook(payload);
  });

  // ── MCP Tools ──────────────────────────────────────────────────────────────
  // All 6 tools are registered with `resolveAgent` — each handler invocation
  // reads ctx.agentId from McpToolContext and resolves the right per-agent
  // state at call time.

  ctx.registerMcpTool(
    createGrepTool({ resolveAgent, logger: ctx.logger as never }),
  );

  ctx.registerMcpTool(
    createDescribeTool({ resolveAgent, logger: ctx.logger as never }),
  );

  ctx.registerMcpTool(
    createExpandTool({ resolveAgent, logger: ctx.logger as never }),
  );

  ctx.registerMcpTool(
    createExpandQueryTool({
      resolveAgent,
      runSubagent: ctx.runSubagent.bind(ctx),
      logger: ctx.logger as never,
    }),
  );

  ctx.registerMcpTool(
    createStatusTool({ resolveAgent, logger: ctx.logger as never }),
  );

  ctx.registerMcpTool(
    createDoctorTool({
      resolveAgent,
      backupDir: join(ctx.dataDir, 'lcm-backups'),
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
