/**
 * lcm_grep MCP tool — full-text search over stored messages and DAG summary nodes.
 *
 * Registered as 'grep'; the plugin framework auto-namespaces it to 'lcm_grep'.
 */

import { z } from 'zod';
import type { MessageStore } from '../store.js';
import type { SummaryDAG } from '../dag.js';
import type { PluginMcpTool } from '../types-shim.js';

// ─── Public constants ─────────────────────────────────────────────────────────

export const GREP_RATE_LIMIT_PER_TURN = 10;

// ─── Deps interface ───────────────────────────────────────────────────────────

export interface GrepDeps {
  store: MessageStore;
  dag: SummaryDAG;
  /** Resolver injected by register(): returns the current session_key for this turn. */
  sessionResolver: () => string;
  /** Optional logger; defaults to no-op. */
  logger?: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void };
}

// ─── Input schema ─────────────────────────────────────────────────────────────

export const INPUT_SCHEMA = z.object({
  query: z.string().min(1, 'query is required'),
  scope: z.enum(['messages', 'summaries', 'both']).default('both'),
  source: z.enum(['telegram', 'whatsapp', 'cli', 'unknown', 'all']).default('all'),
  sort: z.enum(['relevance', 'recency', 'hybrid']).default('hybrid'),
  limit: z.number().int().min(1).max(100).default(20),
});

// ─── Result types ─────────────────────────────────────────────────────────────

interface MessageResult {
  kind: 'message';
  store_id: number;
  snippet: string;
  rank: number;
  ts: number;
}

interface SummaryResult {
  kind: 'summary';
  node_id: string;
  depth: number;
  snippet: string;
  rank: number;
  ts: number;
}

type GrepResult = MessageResult | SummaryResult;

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createGrepTool(deps: GrepDeps): PluginMcpTool {
  let callCount = 0;

  const handler = async (raw: unknown): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    callCount++;
    if (callCount > GREP_RATE_LIMIT_PER_TURN) {
      deps.logger?.warn({ count: callCount }, 'lcm_grep rate limit exceeded');
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: 'rate limit: lcm_grep allows max 10 calls per turn' }),
          },
        ],
      };
    }

    try {
      const input = INPUT_SCHEMA.parse(raw);
      const sessionKey = deps.sessionResolver();

      const { query, scope, source, sort, limit } = input;
      const sourceOpt = source !== 'all' ? source : undefined;

      const results: GrepResult[] = [];

      // Fetch messages
      if (scope === 'messages' || scope === 'both') {
        const msgResults = deps.store.search(query, {
          sessionId: sessionKey,
          source: sourceOpt,
          sort,
          limit,
        });
        for (const r of msgResults) {
          results.push({
            kind: 'message',
            store_id: r.store_id,
            snippet: r.snippet,
            rank: r.rank,
            ts: r.ts,
          });
        }
      }

      // Fetch summaries
      if (scope === 'summaries' || scope === 'both') {
        const nodeResults = deps.dag.search(query, {
          sessionId: sessionKey,
          source: sourceOpt,
          limit,
        });
        for (const r of nodeResults) {
          results.push({
            kind: 'summary',
            node_id: r.node_id,
            depth: r.depth,
            snippet: r.snippet,
            rank: r.rank,
            ts: r.ts,
          });
        }
      }

      // For 'both' scope, merge and re-sort across combined results, then truncate to limit
      if (scope === 'both') {
        if (sort === 'recency') {
          results.sort((a, b) => b.ts - a.ts);
        } else {
          // 'relevance' and 'hybrid': sort by rank ASC (lower = more relevant per FTS5 convention)
          results.sort((a, b) => a.rank - b.rank);
        }
        results.splice(limit);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ results }) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
      };
    }
  };

  return {
    name: 'grep',
    description:
      "Search across stored conversation messages and DAG summary nodes via FTS5 + LIKE fallback. " +
      "Use scope to limit to 'messages' or 'summaries'; 'both' (default) returns merged results. " +
      "source filter: 'all' (default), or specific channel ('telegram', 'whatsapp', 'cli', 'unknown'). " +
      "sort: 'hybrid' (default), 'relevance', or 'recency'. limit ≤ 100.",
    inputSchema: INPUT_SCHEMA,
    handler,
  };
}
