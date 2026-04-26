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
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const gw = await getGateway();

    const view = gw.listAgentFileOwnership(agentId, {
      sessionKey: url.searchParams.get('sessionKey') ?? undefined,
      runId: url.searchParams.get('runId') ?? undefined,
      subagentId: url.searchParams.get('subagentId') ?? undefined,
      path: url.searchParams.get('path') ?? undefined,
      action: parseAction(url.searchParams.get('action')),
      eventType: parseEventType(url.searchParams.get('eventType')),
      limit: Number.isFinite(limit) ? limit : 100,
      offset: Number.isFinite(offset) ? offset : 0,
    });

    return NextResponse.json(view);
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const body = await req.json().catch(() => ({})) as { claimId?: unknown; action?: unknown };
    const claimId = typeof body.claimId === 'string' ? body.claimId : '';
    const action = body.action === 'override' ? 'override' : body.action === 'release' ? 'release' : undefined;

    if (!claimId || !action) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }

    const gw = await getGateway();
    const result = gw.mutateFileOwnershipClaim(agentId, claimId, action);
    return NextResponse.json(result, { status: result.released ? 200 : 404 });
  });
}

function parseAction(value: string | null): 'allow' | 'deny' | undefined {
  return value === 'allow' || value === 'deny' ? value : undefined;
}

function parseEventType(value: string | null): 'conflict' | 'denied_write' | 'override' | 'released' | undefined {
  if (value === 'conflict' || value === 'denied_write' || value === 'override' || value === 'released') {
    return value;
  }
  return undefined;
}
