import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const gw = await getGateway();
    return NextResponse.json({ activeRuns: gw.listActiveAgentRuns(agentId) });
  });
}
