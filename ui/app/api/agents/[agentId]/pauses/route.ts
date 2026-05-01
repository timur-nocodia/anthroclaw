/**
 * GET    /api/agents/[agentId]/pauses           — list active pauses
 * POST   /api/agents/[agentId]/pauses           — create a manual pause
 *
 * Backed by the live Gateway's peerPauseStore. All handlers are guarded
 * by withAuth().
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

interface PostBody {
  peer_key?: unknown;
  channel?: unknown;
  account_id?: unknown;
  peer_id?: unknown;
  ttl_minutes?: unknown;
  reason?: unknown;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const gw = await getGateway();
    if (!gw.peerPauseStore) {
      return NextResponse.json({ pauses: [] });
    }
    return NextResponse.json({
      agentId,
      pauses: gw.peerPauseStore.list(agentId),
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const body = (await req.json()) as PostBody;
    const gw = await getGateway();
    if (!gw.peerPauseStore) {
      return NextResponse.json(
        { error: 'pause_store_unavailable' },
        { status: 503 },
      );
    }

    const peerKey = derivePeerKey(body);
    if (!peerKey) {
      return NextResponse.json(
        { error: 'invalid_peer', message: 'Provide either peer_key or { channel, peer_id }' },
        { status: 400 },
      );
    }

    const ttlMinutes = parseTtl(body.ttl_minutes);
    const reason = ttlMinutes === null ? 'manual_indefinite' : 'manual';
    const entry = gw.peerPauseStore.pause(agentId, peerKey, {
      ttlMinutes: ttlMinutes ?? undefined,
      reason,
      source: 'ui:operator',
    });
    return NextResponse.json({ ok: true, pause: entry });
  });
}

function derivePeerKey(body: PostBody): string | null {
  if (typeof body.peer_key === 'string' && body.peer_key.length > 0) {
    return body.peer_key;
  }
  if (
    typeof body.channel === 'string' &&
    typeof body.peer_id === 'string' &&
    body.peer_id.length > 0
  ) {
    const accountId = typeof body.account_id === 'string' ? body.account_id : '_';
    return `${body.channel}:${accountId}:${body.peer_id}`;
  }
  return null;
}

function parseTtl(raw: unknown): number | null {
  if (raw === null) return null; // explicit indefinite
  if (typeof raw !== 'number') return null;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw);
}
