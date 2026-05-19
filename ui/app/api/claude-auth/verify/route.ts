import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getClaudeAuthManager } from '@/lib/claude-auth-instance';
import { withLegacyClaudeRuntimeMeta } from '@/lib/legacy-runtime-response';

export async function POST() {
  return withAuth(async () => {
    const result = await getClaudeAuthManager().verifyQuery();
    return NextResponse.json(withLegacyClaudeRuntimeMeta(result), { status: result.ok ? 200 : 409 });
  });
}
