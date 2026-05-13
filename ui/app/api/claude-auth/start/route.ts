import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getClaudeAuthManager } from '@/lib/claude-auth-instance';

export async function POST() {
  return withAuth(async () => {
    try {
      return NextResponse.json(await getClaudeAuthManager().startLogin());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'claude_auth_start_failed';
      return NextResponse.json({ error: 'claude_auth_start_failed', message }, { status: 500 });
    }
  });
}
