/**
 * GET /api/agents/[agentId]/lcm/nodes/[nodeId]
 *
 * Plan 3 Task B1 — full DAG node detail for the UI drill-down view. Returns
 * the node's full summary plus its immediate children (raw messages for
 * source_type='messages', child node previews for source_type='nodes').
 *
 * 404 when the agent doesn't exist, the LCM DB doesn't exist, or the
 * `nodeId` is unknown in the DAG.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getAgentConfig, NotFoundError } from '@/lib/agents';
import { openLcmReadOnly } from '@/lib/lcm';

const CHILD_PREVIEW_CHARS = 200;

type DagNodeDetail = {
  node_id: string;
  session_id: string;
  depth: number;
  summary: string;
  token_count: number;
  source_token_count: number;
  source_type: 'messages' | 'nodes';
  /**
   * For `source_type: 'messages'`: array of raw message store_ids.
   * For `source_type: 'nodes'`: ALWAYS EMPTY — child node IDs are surfaced
   * via the `children` array (with full node info) instead. Use `children`
   * for both shapes to traverse the DAG uniformly.
   */
  source_ids: number[];
  earliest_at: number;
  latest_at: number;
  expand_hint?: string;
  children: Array<
    | { kind: 'message'; store_id: number; role: string; content: string; ts: number; source: string }
    | { kind: 'node'; node_id: string; depth: number; summary_preview: string; child_count: number }
  >;
};

function previewSummary(s: string): string {
  // Use Array.from to slice on code points, not UTF-16 code units.
  // Avoids splitting astral-plane characters (emoji, CJK extension) at the
  // boundary into a lone surrogate.
  const codePoints = Array.from(s);
  if (codePoints.length <= CHILD_PREVIEW_CHARS) return s;
  return codePoints.slice(0, CHILD_PREVIEW_CHARS).join('') + '…';
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string; nodeId: string }> },
) {
  return withAuth(async () => {
    const { agentId, nodeId } = await params;
    // Throws NotFoundError → 404 if the agent doesn't exist.
    getAgentConfig(agentId);

    const handle = openLcmReadOnly(agentId);
    if (!handle) {
      // Agent exists but has no LCM data → unknown node.
      throw new NotFoundError(`${agentId}/lcm/nodes/${nodeId}`);
    }

    try {
      const node = handle.dag.get(nodeId);
      if (!node) {
        throw new NotFoundError(`${agentId}/lcm/nodes/${nodeId}`);
      }

      const children: DagNodeDetail['children'] = [];
      if (node.source_type === 'messages') {
        const storeIds = node.source_ids.map((v) => Number(v));
        const messages = handle.store.getMany(storeIds);
        for (const m of messages) {
          children.push({
            kind: 'message',
            store_id: m.store_id,
            role: m.role,
            content: m.content,
            ts: m.ts,
            source: m.source,
          });
        }
      } else {
        // source_type === 'nodes'
        const childNodes = handle.dag.getChildren(nodeId);
        for (const c of childNodes) {
          children.push({
            kind: 'node',
            node_id: c.node_id,
            depth: c.depth,
            summary_preview: previewSummary(c.summary),
            child_count: c.source_ids.length,
          });
        }
      }

      // For the response, normalise `source_ids` to numbers for the
      // messages case and preserve the originals as-is otherwise. The
      // type signature uses `number[]` because the spec says so; for
      // 'nodes' source_type the array is empty in this projection — the
      // child node_ids are surfaced through the `children` array, which
      // is the canonical drill-down handle.
      const sourceIdsOut: number[] =
        node.source_type === 'messages'
          ? node.source_ids.map((v) => Number(v))
          : [];

      const detail: DagNodeDetail = {
        node_id: node.node_id,
        session_id: node.session_id,
        depth: node.depth,
        summary: node.summary,
        token_count: node.token_count,
        source_token_count: node.source_token_count,
        source_type: node.source_type,
        source_ids: sourceIdsOut,
        earliest_at: node.earliest_at,
        latest_at: node.latest_at,
        expand_hint: node.expand_hint,
        children,
      };

      return NextResponse.json(detail);
    } finally {
      handle.db.close();
    }
  });
}
