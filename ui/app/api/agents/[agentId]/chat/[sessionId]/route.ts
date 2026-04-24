import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string; sessionId: string }> },
) {
  return withAuth(async () => {
    const { agentId, sessionId } = await params;
    const gw = await getGateway();
    await gw.deleteAgentSession(agentId, sessionId);

    return NextResponse.json({ ok: true });
  });
}
