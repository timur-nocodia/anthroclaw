import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function GET() {
  return withAuth(async () => {
    const gw = await getGateway();
    return NextResponse.json({
      generatedAt: Date.now(),
      servers: gw.listMcpServerPreflight(),
    });
  });
}
