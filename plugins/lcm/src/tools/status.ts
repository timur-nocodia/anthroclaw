/**
 * lcm_status MCP tool — concise health snapshot for the current LCM session.
 *
 * Registered as 'status'; the plugin framework auto-namespaces it to 'lcm_status'.
 *
 * Returns:
 *   - store: { messages, tokens }
 *   - dag: { d0: N, d1: M, ... } (keys as strings dN)
 *   - lifecycle: subset of LifecycleState fields
 *   - compression_count: 0 (T9-deferred)
 *   - last_compressed_at: null (T9-deferred)
 */

import { z } from 'zod';
import type { PluginMcpTool } from '../types-shim.js';
import type { AgentState } from '../agent-state.js';

// ─── Public constants ─────────────────────────────────────────────────────────

export const STATUS_RATE_LIMIT_PER_TURN = 10;

// ─── Deps interface ───────────────────────────────────────────────────────────

export interface StatusDeps {
  /** Resolves per-agent state for the calling agentId. */
  resolveAgent: (agentId: string) => AgentState;
  logger?: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void };
}

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = z.object({
  /**
   * Optional: narrow the snapshot to one session. When omitted, the snapshot
   * is aggregated across the agent's whole DB. (T24 review.)
   */
  session_id: z.string().min(1).optional(),
});

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createStatusTool(deps: StatusDeps): PluginMcpTool {
  let callCount = 0;

  const handler = async (
    raw: unknown,
    ctx: { agentId: string; sessionKey?: string },
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    callCount++;
    if (callCount > STATUS_RATE_LIMIT_PER_TURN) {
      deps.logger?.warn({ count: callCount }, 'lcm_status rate limit exceeded');
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: 'rate limit: lcm_status allows max 10 calls per turn' }),
          },
        ],
      };
    }

    try {
      const input = INPUT_SCHEMA.parse(raw);
      const state = deps.resolveAgent(ctx.agentId);
      const agentId = ctx.agentId;

      // Session scoping (T24 review):
      //   1. explicit `session_id` input arg
      //   2. else `ctx.sessionKey` from McpToolContext (when gateway plumbs it)
      //   3. else null → aggregate across the agent's whole DB.
      const sessionId = input.session_id ?? ctx.sessionKey ?? null;

      // store stats
      let storeMessages: number;
      let storeTokens: number;
      let depthCounts: Record<number, number>;

      if (sessionId) {
        storeMessages = state.store.countInSession(sessionId);
        storeTokens = state.store.totalTokensInSession(sessionId);
        depthCounts = state.dag.countByDepth(sessionId);
      } else {
        storeMessages = state.store.totalMessages();
        storeTokens = state.store.totalTokensAcrossSessions();
        depthCounts = state.dag.countByDepthAcrossSessions();
      }

      // dag stats — keys formatted as "d0", "d1", etc.
      const dagOut: Record<string, number> = {};
      for (const [depth, count] of Object.entries(depthCounts)) {
        dagOut[`d${depth}`] = count;
      }

      // lifecycle state
      const lcState = state.lifecycle.get(agentId);
      const lifecycle = lcState
        ? {
            current_session_id: lcState.current_session_id,
            last_finalized_session_id: lcState.last_finalized_session_id,
            current_frontier_store_id: lcState.current_frontier_store_id,
            debt_kind: lcState.debt_kind,
            debt_size_estimate: lcState.debt_size_estimate,
            updated_at: lcState.updated_at,
          }
        : {
            current_session_id: null,
            last_finalized_session_id: null,
            current_frontier_store_id: null,
            debt_kind: null,
            debt_size_estimate: null,
            updated_at: null,
          };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              session_key: sessionId,
              session_count: sessionId ? 1 : state.dag.listSessionIds().length,
              store: {
                messages: storeMessages,
                tokens: storeTokens,
              },
              dag: dagOut,
              lifecycle,
              // T9-deferred: compression tracking not yet implemented
              compression_count: 0,
              last_compressed_at: null,
            }),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
      };
    }
  };

  return {
    name: 'status',
    description:
      "Returns a concise health snapshot for the LCM plugin. By default aggregates " +
      "across all sessions in the agent's DB (pass session_id to narrow). " +
      "Includes store message count and token total, DAG node counts by depth (d0, d1, ...), " +
      "lifecycle state (current_session_id, frontier, debt), session_count, and compression stats " +
      "(T9-deferred: always 0/null).",
    inputSchema: INPUT_SCHEMA,
    handler,
  };
}
