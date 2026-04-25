import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string; runId: string }> },
) {
  return withAuth(async () => {
    const { agentId, runId } = await params;
    const gw = await getGateway();
    const result = await gw.interruptAgentRun(agentId, decodeURIComponent(runId), 'web');
    return NextResponse.json(result, { status: result.interrupted ? 200 : 409 });
  });
}
