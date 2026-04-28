/**
 * lcm_expand_query MCP tool — RAG-style grounded Q&A via subagent.
 *
 * Registered as 'expand_query'; the plugin framework auto-namespaces it
 * to 'lcm_expand_query'.
 *
 * Two modes:
 *   1. query   — searches the DAG (FTS5) to find relevant nodes, expands their
 *                source text, builds a grounded context window, asks a subagent.
 *   2. node_ids — skips search; directly uses provided node IDs.
 *
 * Context capping: nodes sorted newest-first; accumulate until
 * max_context_tokens budget is exhausted (oldest dropped first).
 *
 * Rate limit: 5 calls/turn (tighter than other tools — every call spawns a
 * subagent LLM call).
 */

import { z } from 'zod';
import type { MessageStore } from '../store.js';
import type { SummaryDAG, SummaryNode } from '../dag.js';
import type { PluginMcpTool } from '../types-shim.js';
import { estimateTokens } from '../tokens.js';

// ─── Public constants ─────────────────────────────────────────────────────────

export const EXPAND_QUERY_RATE_LIMIT_PER_TURN = 5;

// ─── Deps interface ───────────────────────────────────────────────────────────

export interface ExpandQueryDeps {
  store: MessageStore;
  dag: SummaryDAG;
  /** Resolves current sessionKey for DAG search. */
  sessionResolver: () => string;
  /** Subagent runner (caller-supplied; usually plugin context's runSubagent). */
  runSubagent: (opts: { prompt: string; systemPrompt?: string; timeoutMs?: number }) => Promise<string>;
  /** Default subagent timeout (ms). */
  expansionTimeoutMs?: number;     // default 120_000
  logger?: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void };
}

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = z
  .object({
    prompt: z.string().min(1, 'prompt is required'),
    query: z.string().optional(),
    node_ids: z.array(z.string()).optional(),
    max_context_tokens: z.number().int().positive().max(32_000).default(8_000),
  })
  .refine((d) => Boolean(d.query) !== Boolean(d.node_ids?.length), {
    message: 'pass exactly one of query or node_ids',
  });

// ─── Helper ───────────────────────────────────────────────────────────────────

function jsonError(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }] };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createExpandQueryTool(deps: ExpandQueryDeps): PluginMcpTool {
  const timeout = deps.expansionTimeoutMs ?? 120_000;
  let callCount = 0;

  const handler = async (raw: unknown): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    callCount++;
    if (callCount > EXPAND_QUERY_RATE_LIMIT_PER_TURN) {
      deps.logger?.warn({ count: callCount }, 'lcm_expand_query rate limit exceeded');
      return jsonError('rate limit: lcm_expand_query allows max 5 calls per turn');
    }

    try {
      const input = INPUT_SCHEMA.parse(raw);
      const sessionKey = deps.sessionResolver();

      // 1. Resolve target nodes
      let nodes: SummaryNode[];
      if (input.query) {
        const results = deps.dag.search(input.query, { sessionId: sessionKey, limit: 10 });
        const ids = results.map((r) => r.node_id);
        nodes = ids.map((id) => deps.dag.get(id)).filter((n): n is SummaryNode => n !== null);
      } else {
        nodes = (input.node_ids ?? [])
          .map((id) => deps.dag.get(id))
          .filter((n): n is SummaryNode => n !== null);
      }

      if (nodes.length === 0) {
        return jsonError(
          input.query
            ? 'no matching nodes for query'
            : 'no nodes found for given node_ids',
        );
      }

      // 2. Expand each node to source text
      const sourceBlocks: Array<{ node_id: string; text: string; tokens: number }> = [];
      for (const node of nodes) {
        let text: string;
        if (node.source_type === 'messages') {
          const ids = node.source_ids.map(Number);
          const msgs = deps.store.getMany(ids);
          text = msgs.map((m) => `${m.role}: ${m.content}`).join('\n');
        } else {
          // For 'nodes' type — use the summary itself (don't recurse for T15)
          text = node.summary;
        }
        sourceBlocks.push({ node_id: node.node_id, text, tokens: estimateTokens(text) });
      }

      // 3. Cap by max_context_tokens — sort newest-first, accumulate until budget exhausted
      const orderedBlocks = [...sourceBlocks].sort((a, b) => {
        const nodeA = nodes.find((n) => n.node_id === a.node_id)!;
        const nodeB = nodes.find((n) => n.node_id === b.node_id)!;
        return nodeB.latest_at - nodeA.latest_at;
      });

      const kept: typeof sourceBlocks = [];
      let totalTokens = 0;
      for (const blk of orderedBlocks) {
        if (totalTokens + blk.tokens > input.max_context_tokens) continue;
        kept.push(blk);
        totalTokens += blk.tokens;
      }

      if (kept.length === 0) {
        return jsonError('no source blocks fit within max_context_tokens');
      }

      // 4. Call subagent with grounded context
      const contextStr = kept
        .map((b, i) => `[Source ${i + 1}: node ${b.node_id}]\n${b.text}`)
        .join('\n\n---\n\n');
      const systemPrompt =
        `You are answering a user's question grounded ONLY in the context below. ` +
        `If the answer is not in the context, say so. Do not speculate.\n\n` +
        `=== CONTEXT ===\n${contextStr}\n=== END CONTEXT ===`;

      const answer = await deps.runSubagent({
        prompt: input.prompt,
        systemPrompt,
        timeoutMs: timeout,
      });

      if (!answer || answer.trim().length === 0) {
        throw new Error('subagent returned empty answer');
      }

      // 5. Build sources list and return
      const sources = kept.map((b) => ({
        node_id: b.node_id,
        snippet: nodes.find((n) => n.node_id === b.node_id)!.summary.slice(0, 200),
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ answer, sources }) }],
      };
    } catch (err) {
      deps.logger?.warn?.({ err: String(err) }, 'lcm_expand_query failed');
      return jsonError(String(err instanceof Error ? err.message : err));
    }
  };

  return {
    name: 'expand_query',
    description:
      'RAG-style: fetch source text for relevant DAG nodes (via query-search or explicit node_ids), ' +
      'build a grounded context window (capped at max_context_tokens), then ask a subagent the prompt ' +
      'with that context. Returns {answer, sources}. Use this when you need to answer a question ' +
      'about earlier conversation that has been compacted away.',
    inputSchema: INPUT_SCHEMA,
    handler,
  };
}
