/**
 * GET /api/agents/[agentId]/pause-events — pause activity timeline.
 *
 * v1: the gateway does not yet persist a pause-event history (only the
 * current state via peer-pauses.json). We return the current pauses
 * as a one-row-per-pause synthetic timeline so the UI has something
 * to render. A future task will add a proper event log.
 *
 * TODO(stage 4): replace with real event-log read once pause history
 * persistence lands.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const gw = await getGateway();
    if (!gw.peerPauseStore) {
      return NextResponse.json({ events: [] });
    }
    const pauses = gw.peerPauseStore.list(agentId);
    const events = pauses.map((p) => ({
      kind: 'pause_started' as const,
      agentId: p.agentId,
      peerKey: p.peerKey,
      at: p.pausedAt,
      expiresAt: p.expiresAt,
      reason: p.reason,
      source: p.source,
      extendedCount: p.extendedCount,
    }));
    return NextResponse.json({
      agentId,
      events,
      note: 'v1 timeline is derived from current pauses only; full event log is pending.',
    });
  });
}
