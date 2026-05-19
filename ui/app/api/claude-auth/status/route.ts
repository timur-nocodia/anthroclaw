import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getClaudeAuthManager } from '@/lib/claude-auth-instance';
import { withLegacyClaudeRuntimeMeta } from '@/lib/legacy-runtime-response';

export async function GET() {
  return withAuth(async () => {
    return NextResponse.json(withLegacyClaudeRuntimeMeta(await getClaudeAuthManager().getStatus()));
  });
}
