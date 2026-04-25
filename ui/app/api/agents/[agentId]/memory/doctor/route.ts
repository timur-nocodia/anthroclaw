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
    const gw = await getGateway();

    return NextResponse.json(gw.runAgentMemoryDoctor(agentId, {
      staleAfterDays: optionalNumber(url.searchParams.get('staleAfterDays')),
      maxFileChars: optionalNumber(url.searchParams.get('maxFileChars')),
      maxChunksPerFile: optionalNumber(url.searchParams.get('maxChunksPerFile')),
      limit: optionalNumber(url.searchParams.get('limit')),
    }));
  });
}

function optionalNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
