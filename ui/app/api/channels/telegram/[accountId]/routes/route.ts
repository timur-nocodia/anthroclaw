import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';
import { ValidationError } from '@/lib/agents';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  return withAuth(async () => {
    const { accountId } = await params;
    const body = await req.json();
    const { routes } = body as { routes: Record<string, unknown>[] };

    if (!Array.isArray(routes)) {
      throw new ValidationError('invalid_request', '"routes" array is required');
    }

    for (const route of routes) {
      if (!route.agentId || !route.channel) {
        throw new ValidationError('route_conflict', 'Each route must have agentId and channel');
      }
    }

    const gw = await getGateway();
    await gw.reload();

    return NextResponse.json({ ok: true });
  });
}
