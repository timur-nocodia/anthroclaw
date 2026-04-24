import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const gw = await getGateway();

    return NextResponse.json({
      events: gw.listIntegrationAuditEvents({
        agentId: url.searchParams.get('agentId') ?? undefined,
        sessionKey: url.searchParams.get('sessionKey') ?? undefined,
        provider: url.searchParams.get('provider') ?? undefined,
        capabilityId: url.searchParams.get('capabilityId') ?? undefined,
        toolName: url.searchParams.get('toolName') ?? undefined,
        status: parseStatus(url.searchParams.get('status')),
        limit: Number.isFinite(limit) ? limit : 100,
        offset: Number.isFinite(offset) ? offset : 0,
      }),
    });
  });
}

function parseStatus(value: string | null): 'started' | 'completed' | 'failed' | undefined {
  if (value === 'started' || value === 'completed' || value === 'failed') return value;
  return undefined;
}
