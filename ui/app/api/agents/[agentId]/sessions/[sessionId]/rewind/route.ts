import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string; sessionId: string }> },
) {
  return withAuth(async () => {
    const { agentId, sessionId } = await params;
    const body = await req.json().catch(() => ({}));
    const gw = await getGateway();

    const result = await gw.rewindAgentSessionFiles(agentId, decodeURIComponent(sessionId), {
      userMessageId: typeof body.userMessageId === 'string' ? body.userMessageId : undefined,
      dryRun: body.dryRun !== false,
      confirm: body.confirm === true,
    });

    return NextResponse.json(result);
  });
}
