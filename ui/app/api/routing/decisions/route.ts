import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function GET(req: Request) {
  return withAuth(async () => {
    const url = new URL(req.url);
    const gw = await getGateway();
    return NextResponse.json(gw.listRouteDecisions({
      id: url.searchParams.get('id') ?? undefined,
      agentId: url.searchParams.get('agentId') ?? undefined,
      sessionKey: url.searchParams.get('sessionKey') ?? undefined,
      outcome: url.searchParams.get('outcome') ?? undefined,
      limit: Number(url.searchParams.get('limit') ?? 100),
      offset: Number(url.searchParams.get('offset') ?? 0),
    }));
  });
}
