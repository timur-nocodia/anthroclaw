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
    const sessionId = url.searchParams.get('sessionId') ?? undefined;
    const statusParam = url.searchParams.get('status');
    const status = statusParam === 'running' || statusParam === 'completed'
      ? statusParam
      : undefined;
    const gw = await getGateway();

    const runs = gw.listAgentSubagentRuns(agentId, {
      sessionId: sessionId ? decodeURIComponent(sessionId) : undefined,
      status,
      limit: Number.isFinite(limit) ? limit : 25,
      offset: Number.isFinite(offset) ? offset : 0,
    });

    return NextResponse.json({ runs });
  });
}
