import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { restartGateway } from '@/lib/gateway';
import { getClaudeAuthManager } from '@/lib/claude-auth-instance';

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json().catch(() => ({}));
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const code = typeof body.code === 'string' ? body.code : '';
    const shouldRestart = body.restartGateway !== false;

    if (!sessionId || !code) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'sessionId and code are required.' },
        { status: 400 },
      );
    }

    try {
      const result = await getClaudeAuthManager().completeLogin(sessionId, code);
      if (!result.ok) {
        return NextResponse.json({ ...result, restarted: false }, { status: 409 });
      }

      let restarted = false;
      let restartError: string | null = null;
      if (shouldRestart) {
        try {
          await restartGateway();
          restarted = true;
        } catch (err) {
          restartError = err instanceof Error ? err.message : 'gateway_restart_failed';
        }
      }

      return NextResponse.json({ ...result, restarted, restartError });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'claude_auth_complete_failed';
      const status = message === 'auth_session_not_found' ? 404 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  });
}
