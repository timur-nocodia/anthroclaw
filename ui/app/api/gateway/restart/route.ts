import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { restartGateway } from '@/lib/gateway';

export async function POST() {
  return withAuth(async () => {
    await restartGateway();
    return NextResponse.json({ ok: true, restartedAt: new Date().toISOString() });
  });
}
