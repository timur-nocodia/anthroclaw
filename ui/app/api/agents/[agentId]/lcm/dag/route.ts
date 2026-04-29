/**
 * GET /api/agents/[agentId]/lcm/dag?session=...&depth=...
 *
 * Plan 3 Task B1 — list DAG summary nodes for an agent (read-only access
 * to the LCM SQLite). Optionally filtered by session_id and/or depth.
 *
 * Returns 200 with empty arrays when the agent exists but has no LCM data.
 * Returns 404 when the agent does not exist (NotFoundError raised by
 * `getAgentConfig`).
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getAgentConfig } from '@/lib/agents';
import { openLcmReadOnly } from '@/lib/lcm';

const SUMMARY_PREVIEW_CHARS = 200;

type DagNodeSummary = {
  node_id: string;
  session_id: string;
  depth: number;
  summary: string;
  token_count: number;
  source_token_count: number;
  earliest_at: number;
  latest_at: number;
  expand_hint?: string;
  child_count: number;
};

type DagListResponse = {
  agentId: string;
  session: string | null;
  depth: number | null;
  totalSessions: number;
  totalNodes: number;
  countsByDepth: Record<number, number>;
  nodes: DagNodeSummary[];
};

function emptyResponse(agentId: string, session: string | null, depth: number | null): DagListResponse {
  return {
    agentId,
    session,
    depth,
    totalSessions: 0,
    totalNodes: 0,
    countsByDepth: {},
    nodes: [],
  };
}

function previewSummary(s: string): string {
  // Use Array.from to slice on code points, not UTF-16 code units.
  // Avoids splitting astral-plane characters (emoji, CJK extension) at the
  // boundary into a lone surrogate.
  const codePoints = Array.from(s);
  if (codePoints.length <= SUMMARY_PREVIEW_CHARS) return s;
  return codePoints.slice(0, SUMMARY_PREVIEW_CHARS).join('') + '…';
}

function parseDepth(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
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
    const session = url.searchParams.get('session');
    const depth = parseDepth(url.searchParams.get('depth'));

    const handle = openLcmReadOnly(agentId);
    if (!handle) {
      return NextResponse.json(emptyResponse(agentId, session, depth));
    }

    try {
      // The DAG/store classes prepare statements eagerly in their
      // constructors. If the schema is malformed for any reason, surface as
      // empty state instead of 500 — the "no LCM data yet" UX is identical.
      let nodes;
      let countsByDepth: Record<number, number>;
      let totalSessions: number;
      try {
        nodes = handle.dag.listAllNodes({
          sessionId: session ?? undefined,
          depth: depth ?? undefined,
        });
        countsByDepth = handle.dag.countByDepthAcrossSessions();
        totalSessions = handle.dag.listSessionIds().length;
      } catch {
        return NextResponse.json(emptyResponse(agentId, session, depth));
      }

      const summaries: DagNodeSummary[] = nodes.map((n) => ({
        node_id: n.node_id,
        session_id: n.session_id,
        depth: n.depth,
        summary: previewSummary(n.summary),
        token_count: n.token_count,
        source_token_count: n.source_token_count,
        earliest_at: n.earliest_at,
        latest_at: n.latest_at,
        expand_hint: n.expand_hint,
        child_count: n.source_ids.length,
      }));

      const response: DagListResponse = {
        agentId,
        session,
        depth,
        totalSessions,
        totalNodes: summaries.length,
        countsByDepth,
        nodes: summaries,
      };

      return NextResponse.json(response);
    } finally {
      handle.db.close();
    }
  });
}
