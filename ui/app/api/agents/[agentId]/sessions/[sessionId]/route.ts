import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string; sessionId: string }> },
) {
  return withAuth(async () => {
    const { agentId, sessionId } = await params;
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const includeSystemMessages = url.searchParams.get('includeSystemMessages') === 'true';
    const gw = await getGateway();

    const session = await gw.getAgentSessionDetails(agentId, decodeURIComponent(sessionId), {
      limit: Number.isFinite(limit) ? limit : 100,
      offset: Number.isFinite(offset) ? offset : 0,
      includeSystemMessages,
    });

    return NextResponse.json(session);
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string; sessionId: string }> },
) {
  return withAuth(async () => {
    const { agentId, sessionId } = await params;
    const gw = await getGateway();
    await gw.deleteAgentSession(agentId, decodeURIComponent(sessionId));
    return NextResponse.json({ ok: true });
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string; sessionId: string }> },
) {
  return withAuth(async () => {
    const { agentId, sessionId } = await params;
    const body = await req.json().catch(() => ({}));
    const labels = Array.isArray(body.labels)
      ? body.labels.filter((label: unknown): label is string => typeof label === 'string')
      : [];
    const gw = await getGateway();
    const result = await gw.setAgentSessionLabels(agentId, decodeURIComponent(sessionId), labels);
    return NextResponse.json(result);
  });
}
