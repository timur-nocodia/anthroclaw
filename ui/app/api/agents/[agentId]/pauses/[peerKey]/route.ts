/**
 * DELETE /api/agents/[agentId]/pauses/[peerKey] — unpause a peer.
 *
 * `peerKey` is URL-encoded; Next.js decodes it for us via `params`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string; peerKey: string }> },
) {
  return withAuth(async () => {
    const { agentId, peerKey } = await params;
    const gw = await getGateway();
    if (!gw.peerPauseStore) {
      return NextResponse.json(
        { error: 'pause_store_unavailable' },
        { status: 503 },
      );
    }
    const removed = gw.peerPauseStore.unpause(agentId, peerKey, 'ui:unpause');
    return NextResponse.json({ ok: true, was_paused: !!removed, peer_key: peerKey });
  });
}
