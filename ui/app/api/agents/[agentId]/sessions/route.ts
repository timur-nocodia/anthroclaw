import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

const RUN_STATUSES = new Set(['running', 'succeeded', 'failed', 'interrupted']);
const RUN_SOURCES = new Set(['web', 'channel', 'cron']);
const ACTIVE_FILTERS = new Set(['active', 'inactive', 'all']);

function optionalBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

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
    const limit = optionalNumber(url.searchParams.get('limit')) ?? 25;
    const offset = optionalNumber(url.searchParams.get('offset')) ?? 0;
    const status = url.searchParams.get('status');
    const source = url.searchParams.get('source');
    const active = url.searchParams.get('active');
    const gw = await getGateway();

    const sessions = await gw.listAgentSessions(agentId, {
      limit,
      offset,
      search: url.searchParams.get('search') ?? undefined,
      source: source && RUN_SOURCES.has(source) ? source as 'web' | 'channel' | 'cron' : undefined,
      channel: url.searchParams.get('channel') ?? undefined,
      status: status && RUN_STATUSES.has(status) ? status as 'running' | 'succeeded' | 'failed' | 'interrupted' : undefined,
      active: active && ACTIVE_FILTERS.has(active) ? active as 'active' | 'inactive' | 'all' : undefined,
      label: url.searchParams.get('label') ?? undefined,
      hasRouteDecision: optionalBoolean(url.searchParams.get('hasRouteDecision')),
      hasErrors: optionalBoolean(url.searchParams.get('hasErrors')),
      modifiedAfter: optionalNumber(url.searchParams.get('modifiedAfter')),
      modifiedBefore: optionalNumber(url.searchParams.get('modifiedBefore')),
    });

    return NextResponse.json({ sessions });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const body = await req.json().catch(() => ({}));

    if (body.action !== 'fork' || typeof body.sessionId !== 'string') {
      return NextResponse.json(
        { error: 'invalid_request', message: 'Expected { action: "fork", sessionId }' },
        { status: 400 },
      );
    }

    const gw = await getGateway();
    const forked = await gw.forkAgentSession(agentId, body.sessionId, {
      upToMessageId: typeof body.upToMessageId === 'string' ? body.upToMessageId : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
    });

    return NextResponse.json(forked);
  });
}
