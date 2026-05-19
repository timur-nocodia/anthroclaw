import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { restartGateway } from '@/lib/gateway';
import { withLegacyClaudeRuntimeMeta } from '@/lib/legacy-runtime-response';

export async function POST() {
  return withAuth(async () => {
    await restartGateway();
    return NextResponse.json(withLegacyClaudeRuntimeMeta({ restarted: true, restartedAt: new Date().toISOString() }));
  });
}
