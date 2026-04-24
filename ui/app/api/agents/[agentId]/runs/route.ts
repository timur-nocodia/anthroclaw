import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

const RUN_STATUSES = new Set(['running', 'succeeded', 'failed', 'interrupted']);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const statusParam = url.searchParams.get('status') ?? undefined;
    const status = statusParam && RUN_STATUSES.has(statusParam)
      ? statusParam as 'running' | 'succeeded' | 'failed' | 'interrupted'
      : undefined;
    const gw = await getGateway();

    const runs = gw.listAgentRuns({
      agentId,
      status,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });

    return NextResponse.json({ runs });
  });
}
