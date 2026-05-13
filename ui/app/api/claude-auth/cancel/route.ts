import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getClaudeAuthManager } from '@/lib/claude-auth-instance';

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json().catch(() => ({}));
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
    return NextResponse.json(getClaudeAuthManager().cancelLogin(sessionId));
  });
}
