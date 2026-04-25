import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

const SOURCES = new Set(['prefetch', 'memory_search']);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const url = new URL(req.url);
    const limit = optionalNumber(url.searchParams.get('limit')) ?? 50;
    const offset = optionalNumber(url.searchParams.get('offset')) ?? 0;
    const gw = await getGateway();

    const events = gw.listMemoryInfluenceEvents({
      agentId,
      sessionKey: url.searchParams.get('sessionKey') ?? undefined,
      runId: url.searchParams.get('runId') ?? undefined,
      sdkSessionId: url.searchParams.get('sdkSessionId') ?? undefined,
      source: parseSource(url.searchParams.get('source')),
      limit,
      offset,
    });

    return NextResponse.json({ events });
  });
}

function optionalNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSource(value: string | null): 'prefetch' | 'memory_search' | undefined {
  if (value && SOURCES.has(value)) {
    return value as 'prefetch' | 'memory_search';
  }
  return undefined;
}
