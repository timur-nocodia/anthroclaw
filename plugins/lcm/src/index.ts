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
import { CarryoverStore } from './carryover.js';
import { createMirrorHook } from './hooks/mirror.js';
import { buildCarryoverSnippet, formatCarryoverBlock, formatToolPromptBlock } from './carryover-format.js';
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
  carryover: CarryoverStore;
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
    // Defensive guard (T24 review I1): a misconfigured caller bypassing the
    // type system must not be allowed to create `undefined.sqlite` or
    // `.sqlite` files in dbDir. agentId is required and must be a non-empty
    // string at runtime.
    if (!agentId || typeof agentId !== 'string') {
      throw new TypeError(
        `lcm: getOrCreateForAgent requires a non-empty string agentId; got ${typeof agentId}: ${String(agentId)}`,
      );
    }
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
      const carryover = new CarryoverStore(db);
      const engine = new LCMEngine({
        store,
        dag,
        lifecycle,
        runSubagent: ctx.runSubagent.bind(ctx),
        config: engineConfig,
        logger: ctx.logger as never,
      });
      state = { db, store, dag, lifecycle, carryover, engine, config, engineConfig };
      perAgent.set(agentId, state);
      ctx.logger.info({ agentId }, 'lcm: per-agent state initialized');
    }
    return state;
  }

  /**
   * Bridge from PerAgentState to AgentState (the tool-facing shape).
   *
   * Sessions are NOT synthesised here. Each tool decides its own session
   * scoping policy: most tools default to "across all sessions in the
   * agent's DB", and may narrow via tool input args or `ctx.sessionKey`
   * (when the gateway plumbs it). See agent-state.ts for the rationale.
   * (T24 review C1 fix.)
   */
  function resolveAgent(agentId: string): AgentState {
    const state = getOrCreateForAgent(agentId);
    return {
      db: state.db,
      store: state.store,
      dag: state.dag,
      lifecycle: state.lifecycle,
      config: state.config,
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
        // Type-cast: the engine's EngineMessage shape and the gateway's
        // SDK-message shape are bridge-compatible at the role+content level
        // for our purposes — we only prepend system entries.
        const messages = (out.messages as unknown[]).slice() as Array<{
          role: string;
          content: string;
          [k: string]: unknown;
        }>;

        // Block 1 (always): tool-usage prompt so the model knows the LCM
        // tools exist and when to use them — without per-agent CLAUDE.md edits.
        const prepended: Array<{ role: string; content: string }> = [
          { role: 'system', content: formatToolPromptBlock() },
        ];

        // Block 2 (one-time per new session): pending carry-over snippet.
        // Consume only when sessionKey differs from the source session
        // (avoids "ghost" injection when assembling for the just-reset session).
        // After consume we `clear()` the row, so no second-call gate is needed.
        try {
          const pending = state.carryover.get();
          if (pending && pending.source_session_id !== i.sessionKey) {
            prepended.push({
              role: 'system',
              content: formatCarryoverBlock(pending.snippet, pending.source_session_id),
            });
            state.carryover.clear();
            ctx.logger.info(
              {
                agentId: i.agentId,
                sourceSession: pending.source_session_id,
                targetSession: i.sessionKey,
                snippetLen: pending.snippet.length,
              },
              'lcm: carry-over snippet injected into new session',
            );
          }
        } catch (err) {
          ctx.logger.warn(
            { err: String(err), agentId: i.agentId },
            'lcm carry-over read failed; assembly continues without it',
          );
        }

        // Insert after a leading system message if one exists, else prepend.
        const insertAt = messages[0]?.role === 'system' ? 1 : 0;
        messages.splice(insertAt, 0, ...prepended);

        return { messages: messages as never };
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

  // ── Carry-over hook ────────────────────────────────────────────────────────
  //
  // When a session is reset (`/newsession`, `/compact`, policy rotation, or
  // auto_compress threshold), capture a top-N-depth slice of the OLD session's
  // DAG into the per-agent SQLite. The next `assemble()` for a *different*
  // sessionKey on the same agent prepends it as a `<previous_session_memory>`
  // system block, then deletes the row. Gated on
  // `lifecycle.carry_over_on_session_reset`.

  ctx.registerHook('on_session_reset', (payload) => {
    const p = payload as { agentId?: string; sessionKey?: string };
    if (!p.agentId || !p.sessionKey) return;
    const state = getOrCreateForAgent(p.agentId);
    if (!state.config.enabled) return;
    if (!state.config.lifecycle.carry_over_on_session_reset) return;
    try {
      const snippet = buildCarryoverSnippet(
        state.dag,
        p.sessionKey,
        state.config.lifecycle.carry_over_retain_depth,
      );
      if (!snippet) return;
      state.carryover.upsert({
        sourceSessionId: p.sessionKey,
        snippet,
        createdAt: Date.now(),
      });
      ctx.logger.info(
        { agentId: p.agentId, sourceSession: p.sessionKey, snippetLen: snippet.length },
        'lcm: carry-over snippet captured on session reset',
      );
    } catch (err) {
      ctx.logger.warn(
        { err: String(err), agentId: p.agentId },
        'lcm carry-over capture failed; session reset proceeds without it',
      );
    }
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
    /**
     * Drop the cached PerAgentState for `agentId` so the next tool/hook
     * invocation re-reads agent.yml via ctx.getAgentConfig(agentId) and
     * rebuilds engine/store/dag/lifecycle with fresh config.
     *
     * Without this, UI config edits (PUT /agents/:id/plugins/lcm/config)
     * would update agent.yml but the running engine would keep the stale
     * config that was captured at first cache miss.
     */
    onAgentConfigChanged(agentId: string) {
      const state = perAgent.get(agentId);
      if (!state) return;
      try {
        state.db.close();
      } catch {
        // Closing a healthy SQLite handle should never throw, but if a
        // broken handle does, swallow it — we only care about getting the
        // entry out of the cache so the next call rebuilds cleanly.
      }
      perAgent.delete(agentId);
      ctx.logger.info(
        { agentId },
        'lcm: per-agent state invalidated due to config change',
      );
    },
  };
}
