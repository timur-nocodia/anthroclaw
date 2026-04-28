/**
 * lcm_expand MCP tool — drill into a node's underlying messages or child nodes (one level only).
 *
 * Registered as 'expand'; the plugin framework auto-namespaces it to 'lcm_expand'.
 *
 * Three modes:
 *   1. node_id, source_type='messages' — returns paginated list of raw StoredMessage projections.
 *   2. node_id, source_type='nodes' — returns direct child SummaryNode projections (NOT recursive).
 *   3. externalized_ref — fetches an externalized blob and returns its full content.
 *
 * Truncation (modes 1+2): items are added one by one until cumulative estimateTokens of
 * serialised item content exceeds max_tokens. The item that pushes over the limit is NOT
 * included; remaining items are dropped; truncated=true.
 *
 * Externalized mode: no truncation — the ref is a known stored blob; full content returned.
 */

import { z } from 'zod';
import type { PluginMcpTool } from '../types-shim.js';
import type { AgentState } from '../agent-state.js';
import { estimateTokens } from '../tokens.js';

// ─── Public constants ─────────────────────────────────────────────────────────

export const EXPAND_RATE_LIMIT_PER_TURN = 10;

// ─── Deps interface ───────────────────────────────────────────────────────────

export interface ExpandDeps {
  /** Resolves per-agent state for the calling agentId. */
  resolveAgent: (agentId: string) => AgentState;
  /** Optional: resolves externalized file content by ref. */
  externalizedReader?: (ref: string) => Promise<{ content: string; size: number } | null>;
  logger?: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void };
}

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = z
  .object({
    node_id: z.string().optional(),
    max_tokens: z.number().int().positive().max(50_000).default(4_000),
    externalized_ref: z.string().optional(),
  })
  .refine((d) => Boolean(d.node_id) !== Boolean(d.externalized_ref), {
    message: 'pass exactly one of node_id or externalized_ref',
  });

// ─── Item projection types ────────────────────────────────────────────────────

interface MessageItem {
  store_id: number;
  role: string;
  content: string;
  ts: number;
  source: string;
  tool_call_id?: string;
  tool_name?: string;
  tool_calls_json?: string;
}

interface NodeItem {
  node_id: string;
  depth: number;
  summary: string;
  token_count: number;
  source_type: 'messages' | 'nodes';
  earliest_at: number;
  latest_at: number;
  expand_hint: string | null;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createExpandTool(deps: ExpandDeps): PluginMcpTool {
  let callCount = 0;

  const handler = async (
    raw: unknown,
    ctx: { agentId: string; sessionKey?: string },
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    callCount++;
    if (callCount > EXPAND_RATE_LIMIT_PER_TURN) {
      deps.logger?.warn({ count: callCount }, 'lcm_expand rate limit exceeded');
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: 'rate limit: lcm_expand allows max 10 calls per turn' }),
          },
        ],
      };
    }

    try {
      const input = INPUT_SCHEMA.parse(raw);
      const state = deps.resolveAgent(ctx.agentId);

      // ── Mode 3: externalized_ref ─────────────────────────────────────────
      if (input.externalized_ref !== undefined) {
        const ref = input.externalized_ref;
        if (!deps.externalizedReader) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: 'externalized_ref not supported in this build' }),
              },
            ],
          };
        }
        const result = await deps.externalizedReader(ref);
        if (result === null) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `ref not found: ${ref}` }),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                type: 'externalized',
                externalized_ref: ref,
                content: result.content,
                size: result.size,
              }),
            },
          ],
        };
      }

      // ── Mode 1 & 2: node_id ──────────────────────────────────────────────
      const nodeId = input.node_id!;
      const maxTokens = input.max_tokens;

      const node = state.dag.get(nodeId);
      if (!node) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `node not found: ${nodeId}` }),
            },
          ],
        };
      }

      if (node.source_type === 'messages') {
        // Mode 1: expand to raw messages
        const storeIds = state.dag.getSourceMessageIds(nodeId);
        const messages = state.store.getMany(storeIds);

        const items: MessageItem[] = [];
        let cumulativeTokens = 0;
        let truncated = false;

        for (const msg of messages) {
          const item: MessageItem = {
            store_id: msg.store_id,
            role: msg.role,
            content: msg.content,
            ts: msg.ts,
            source: msg.source,
            ...(msg.tool_call_id !== undefined ? { tool_call_id: msg.tool_call_id } : {}),
            ...(msg.tool_name !== undefined ? { tool_name: msg.tool_name } : {}),
            ...(msg.tool_calls_json !== undefined ? { tool_calls_json: msg.tool_calls_json } : {}),
          };

          const itemTokens = estimateTokens(JSON.stringify(item));
          if (cumulativeTokens + itemTokens > maxTokens) {
            truncated = true;
            break;
          }
          cumulativeTokens += itemTokens;
          items.push(item);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                type: 'messages',
                node_id: nodeId,
                depth: node.depth,
                items,
                truncated,
              }),
            },
          ],
        };
      } else {
        // Mode 2: expand to direct child nodes (source_type === 'nodes')
        const children = state.dag.getChildren(nodeId);

        const items: NodeItem[] = [];
        let cumulativeTokens = 0;
        let truncated = false;

        for (const child of children) {
          const item: NodeItem = {
            node_id: child.node_id,
            depth: child.depth,
            summary: child.summary,
            token_count: child.token_count,
            source_type: child.source_type,
            earliest_at: child.earliest_at,
            latest_at: child.latest_at,
            expand_hint: child.expand_hint ?? null,
          };

          const itemTokens = estimateTokens(JSON.stringify(item));
          if (cumulativeTokens + itemTokens > maxTokens) {
            truncated = true;
            break;
          }
          cumulativeTokens += itemTokens;
          items.push(item);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                type: 'nodes',
                node_id: nodeId,
                depth: node.depth,
                items,
                truncated,
              }),
            },
          ],
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
      };
    }
  };

  return {
    name: 'expand',
    description:
      'Drill into a DAG node to see its underlying messages or direct child nodes (one level, not recursive). ' +
      'node_id + source_type="messages": returns raw StoredMessage projections. ' +
      'node_id + source_type="nodes": returns direct child SummaryNode projections. ' +
      'externalized_ref: fetches an externalized blob and returns full content. ' +
      'Pass exactly one of node_id or externalized_ref. ' +
      'max_tokens (default 4000, max 50000): caps the response by serialised item size.',
    inputSchema: INPUT_SCHEMA,
    handler,
  };
}
