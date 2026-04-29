/**
 * GET /api/agents/[agentId]/lcm/grep?q=...&session=...&source=...&sort=...&limit=...
 *
 * Plan 3 Task B2 — full-text search across stored messages and DAG summary
 * nodes for an agent. Bridge endpoint for the UI; replicates the merge logic
 * of the lcm_grep MCP tool but bypasses the per-tool turn rate limit and the
 * MCP plumbing (this is a read-only HTTP query for operator browsing).
 *
 * Returns 200 with empty hits when the agent exists but has no LCM data
 * (file missing or schema not bootstrapped). Returns 404 only for unknown
 * agents and 400 for an empty / missing `q`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getAgentConfig, ValidationError } from '@/lib/agents';
import { openLcmReadOnly } from '@/lib/lcm';

type GrepSort = 'relevance' | 'recency' | 'hybrid';

type MessageHit = {
  kind: 'message';
  store_id: number;
  session_id: string;
  source: string;
  role: string;
  ts: number;
  snippet: string;
  rank: number;
};

type NodeHit = {
  kind: 'node';
  node_id: string;
  session_id: string;
  depth: number;
  snippet: string;
  rank: number;
};

type GrepHit = MessageHit | NodeHit;

type GrepResponse = {
  agentId: string;
  query: string;
  hits: GrepHit[];
  totalReturned: number;
  truncated: boolean;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VALID_SORTS: ReadonlySet<GrepSort> = new Set(['relevance', 'recency', 'hybrid']);

function parseSort(raw: string | null): GrepSort {
  if (raw && (VALID_SORTS as ReadonlySet<string>).has(raw)) return raw as GrepSort;
  return 'hybrid';
}

function parseLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, n), MAX_LIMIT);
}

function emptyResponse(agentId: string, q: string): GrepResponse {
  return { agentId, query: q, hits: [], totalReturned: 0, truncated: false };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    // Throws NotFoundError → 404 if the agent doesn't exist.
    getAgentConfig(agentId);

    const url = new URL(req.url);
    const qRaw = url.searchParams.get('q');
    const q = qRaw?.trim() ?? '';
    if (!q) {
      throw new ValidationError('invalid_query', 'q is required and must be non-empty');
    }

    const session = url.searchParams.get('session') || undefined;
    const source = url.searchParams.get('source') || undefined;
    const sort = parseSort(url.searchParams.get('sort'));
    const limit = parseLimit(url.searchParams.get('limit'));

    const handle = openLcmReadOnly(agentId);
    if (!handle) {
      return NextResponse.json(emptyResponse(agentId, q));
    }

    try {
      // Fetch one extra so we can detect truncation deterministically. Each
      // search runs with limit+1 individually; the merged result is then
      // trimmed to `limit` and the truncation flag set if anything exceeded.
      let messageHits: MessageHit[];
      let nodeHits: NodeHit[];

      try {
        const msgResults = handle.store.search(q, {
          sessionId: session ?? null,
          source,
          sort,
          limit: limit + 1,
        });
        messageHits = msgResults.map((r) => ({
          kind: 'message' as const,
          store_id: r.store_id,
          session_id: r.session_id,
          source: r.source,
          role: r.role,
          ts: r.ts,
          snippet: r.snippet,
          rank: r.rank,
        }));

        const nodeResults = handle.dag.search(q, {
          sessionId: session ?? null,
          source,
          limit: limit + 1,
        });
        // NodeSearchResult has no session_id — look it up via dag.get(node_id).
        // The lookup is cheap (indexed primary key) and only runs for matched
        // nodes, capped at limit+1.
        nodeHits = nodeResults.map((r) => {
          const node = handle.dag.get(r.node_id);
          return {
            kind: 'node' as const,
            node_id: r.node_id,
            session_id: node?.session_id ?? '',
            depth: r.depth,
            snippet: r.snippet,
            rank: r.rank,
          };
        });
      } catch {
        // FTS5 schema missing or other unexpected DB error: surface as empty
        // state so the UI renders a friendly placeholder instead of 500.
        return NextResponse.json(emptyResponse(agentId, q));
      }

      const merged: GrepHit[] = [...messageHits, ...nodeHits];

      // Sort: rank ASC (FTS5 BM25 convention — lower = more relevant).
      // For 'recency' we honour ts DESC across the merged set; the per-search
      // sort already handled it for messages, but when both kinds are present
      // we need a deterministic merge ordering.
      if (sort === 'recency') {
        merged.sort((a, b) => {
          const tsA = a.kind === 'message' ? a.ts : 0;
          const tsB = b.kind === 'message' ? b.ts : 0;
          return tsB - tsA;
        });
      } else {
        merged.sort((a, b) => a.rank - b.rank);
      }

      const truncated = merged.length > limit;
      const trimmed = merged.slice(0, limit);

      const response: GrepResponse = {
        agentId,
        query: q,
        hits: trimmed,
        totalReturned: trimmed.length,
        truncated,
      };

      return NextResponse.json(response);
    } finally {
      handle.db.close();
    }
  });
}
