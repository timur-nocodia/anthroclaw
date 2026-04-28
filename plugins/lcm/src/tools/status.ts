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

const INPUT_SCHEMA = z.object({});

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
      INPUT_SCHEMA.parse(raw);
      const state = deps.resolveAgent(ctx.agentId);
      const sessionKey = state.sessionKey;
      const agentId = ctx.agentId;

      // store stats
      const messages = state.store.listSession(sessionKey);
      const tokens = state.store.totalTokensInSession(sessionKey);

      // dag stats — keys formatted as "d0", "d1", etc.
      const depthCounts = state.dag.countByDepth(sessionKey);
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
              session_key: sessionKey,
              store: {
                messages: messages.length,
                tokens,
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
      'Returns a concise health snapshot for the current LCM session. ' +
      'Includes store message count and token total, DAG node counts by depth (d0, d1, ...), ' +
      'lifecycle state (current_session_id, frontier, debt), and compression stats (T9-deferred: always 0/null).',
    inputSchema: INPUT_SCHEMA,
    handler,
  };
}
