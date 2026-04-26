import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

function optionalNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const url = new URL(req.url);
    const gw = await getGateway();

    const interrupts = gw.listAgentInterrupts({
      agentId,
      runId: url.searchParams.get('runId') ?? undefined,
      targetId: url.searchParams.get('targetId') ?? undefined,
      limit: optionalNumber(url.searchParams.get('limit')) ?? 25,
      offset: optionalNumber(url.searchParams.get('offset')) ?? 0,
    });

    return NextResponse.json({ interrupts });
  });
}
