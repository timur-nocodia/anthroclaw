import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ agentId: string; runId: string }> },
) {
  return withAuth(async () => {
    const { agentId, runId } = await params;
    const gw = await getGateway();
    const run = gw.getAgentSubagentRun(agentId, decodeURIComponent(runId));

    if (!run) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json(run);
  });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ agentId: string; runId: string }> },
) {
  return withAuth(async () => {
    const { agentId, runId } = await params;
    const gw = await getGateway();
    const decodedRunId = decodeURIComponent(runId);
    const run = gw.getAgentSubagentRun(agentId, decodedRunId);

    if (!run) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const result = await gw.interruptAgentSubagentRun(agentId, decodedRunId);
    return NextResponse.json(result, { status: result.interrupted ? 200 : 409 });
  });
}
