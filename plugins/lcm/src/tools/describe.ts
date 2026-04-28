/**
 * lcm_describe MCP tool — read-only introspection of the LCM store and DAG.
 *
 * Registered as 'describe'; the plugin framework auto-namespaces it to 'lcm_describe'.
 *
 * Three modes:
 *   1. No args — overview: session stats, depth distribution, total counts, timestamps.
 *   2. node_id — full metadata for a single DAG node, including projected children.
 *   3. externalized_ref — preview of an externalized tool-result (T18 feature; optional reader).
 */

import { z } from 'zod';
import type { MessageStore } from '../store.js';
import type { SummaryDAG } from '../dag.js';
import type { PluginMcpTool } from '../types-shim.js';

// ─── Public constants ─────────────────────────────────────────────────────────

export const DESCRIBE_RATE_LIMIT_PER_TURN = 10;

// ─── Deps interface ───────────────────────────────────────────────────────────

export interface DescribeDeps {
  store: MessageStore;
  dag: SummaryDAG;
  /** Resolves current session_key for this turn. */
  sessionResolver: () => string;
  /** Optional: resolves externalized file content by ref. T18 will provide; for T12 optional. */
  externalizedReader?: (ref: string) => Promise<{ content: string; size: number } | null>;
  logger?: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void };
}

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = z
  .object({
    node_id: z.string().optional(),
    externalized_ref: z.string().optional(),
  })
  .refine((d) => !(d.node_id && d.externalized_ref), {
    message: 'pass at most one of node_id or externalized_ref',
  });

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createDescribeTool(deps: DescribeDeps): PluginMcpTool {
  let callCount = 0;

  const handler = async (
    raw: unknown,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    callCount++;
    if (callCount > DESCRIBE_RATE_LIMIT_PER_TURN) {
      deps.logger?.warn({ count: callCount }, 'lcm_describe rate limit exceeded');
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: 'rate limit: lcm_describe allows max 10 calls per turn' }),
          },
        ],
      };
    }

    try {
      const input = INPUT_SCHEMA.parse(raw);
      const sessionKey = deps.sessionResolver();

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
                externalized_ref: ref,
                preview: result.content.slice(0, 1000),
                size: result.size,
              }),
            },
          ],
        };
      }

      // ── Mode 2: node_id ───────────────────────────────────────────────────
      if (input.node_id !== undefined) {
        const node = deps.dag.get(input.node_id);
        if (!node) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `node not found: ${input.node_id}` }),
              },
            ],
          };
        }

        let children: Array<
          | { node_id: string; depth: number }
          | { store_id: number; role: string; snippet: string }
        >;

        if (node.source_type === 'nodes') {
          // Children are DAG nodes
          const childNodes = deps.dag.getChildren(node.node_id);
          children = childNodes.map((n) => ({ node_id: n.node_id, depth: n.depth }));
        } else {
          // source_type === 'messages': children are store messages
          const msgIds = deps.dag.getSourceMessageIds(node.node_id);
          const messages = deps.store.getMany(msgIds);
          children = messages.map((m) => ({
            store_id: m.store_id,
            role: m.role,
            snippet: m.content.slice(0, 80),
          }));
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                node_id: node.node_id,
                depth: node.depth,
                summary: node.summary,
                token_count: node.token_count,
                source_token_count: node.source_token_count,
                source_count: node.source_ids.length,
                source_type: node.source_type,
                expand_hint: node.expand_hint ?? null,
                earliest_at: node.earliest_at,
                latest_at: node.latest_at,
                children,
              }),
            },
          ],
        };
      }

      // ── Mode 1: overview (no args) ────────────────────────────────────────
      const messages = deps.store.listSession(sessionKey);
      const depthCounts = deps.dag.countByDepth(sessionKey);

      // Compute depth_distribution with string keys
      const depthDistribution: Record<string, number> = {};
      let totalNodes = 0;
      for (const [depth, count] of Object.entries(depthCounts)) {
        depthDistribution[depth] = count;
        totalNodes += count;
      }

      const oldest_at =
        messages.length > 0 ? Math.min(...messages.map((m) => m.ts)) : null;
      const newest_at =
        messages.length > 0 ? Math.max(...messages.map((m) => m.ts)) : null;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              session_key: sessionKey,
              depth_distribution: depthDistribution,
              total_messages: messages.length,
              total_nodes: totalNodes,
              oldest_at,
              newest_at,
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
    name: 'describe',
    description:
      'Introspect the LCM message store and DAG for the current session. ' +
      'No args: returns overview with depth_distribution, total_messages, total_nodes, oldest/newest timestamps. ' +
      'node_id: returns full metadata for one DAG node including children (projected as {store_id, role, snippet} for messages or {node_id, depth} for nodes). ' +
      'externalized_ref: preview an externalized tool-result (T18 feature). ' +
      'Pass at most one of node_id or externalized_ref.',
    inputSchema: INPUT_SCHEMA,
    handler,
  };
}
