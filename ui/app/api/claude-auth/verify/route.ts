import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getClaudeAuthManager } from '@/lib/claude-auth-instance';

export async function POST() {
  return withAuth(async () => {
    const result = await getClaudeAuthManager().verifyQuery();
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  });
}
