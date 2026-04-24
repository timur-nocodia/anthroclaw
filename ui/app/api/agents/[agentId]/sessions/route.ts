import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? 25);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const gw = await getGateway();

    const sessions = await gw.listAgentSessions(agentId, {
      limit: Number.isFinite(limit) ? limit : 25,
      offset: Number.isFinite(offset) ? offset : 0,
    });

    return NextResponse.json({ sessions });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const body = await req.json().catch(() => ({}));

    if (body.action !== 'fork' || typeof body.sessionId !== 'string') {
      return NextResponse.json(
        { error: 'invalid_request', message: 'Expected { action: "fork", sessionId }' },
        { status: 400 },
      );
    }

    const gw = await getGateway();
    const forked = await gw.forkAgentSession(agentId, body.sessionId, {
      upToMessageId: typeof body.upToMessageId === 'string' ? body.upToMessageId : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
    });

    return NextResponse.json(forked);
  });
}
