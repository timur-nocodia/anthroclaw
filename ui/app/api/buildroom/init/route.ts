import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { initializeBuildroom } from '@/lib/buildroom';

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json().catch(() => ({})) as {
      roomId?: unknown;
      operatorId?: unknown;
    };

    const result = await initializeBuildroom({
      roomId: typeof body.roomId === 'string' ? body.roomId : undefined,
      operatorId: typeof body.operatorId === 'string' ? body.operatorId : undefined,
    });
    return NextResponse.json(result.body, { status: result.status });
  });
}
