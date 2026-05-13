import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getClaudeAuthManager } from '@/lib/claude-auth-instance';

export async function GET() {
  return withAuth(async () => {
    return NextResponse.json(await getClaudeAuthManager().getStatus());
  });
}
