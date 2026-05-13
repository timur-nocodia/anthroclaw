import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getBuildroomConfig, updateBuildroomConfig } from '@/lib/buildroom';

export async function GET() {
  return withAuth(async () => {
    const result = getBuildroomConfig();
    return NextResponse.json(result.body, { status: result.status });
  });
}

export async function PATCH(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json().catch(() => ({}));
    const result = updateBuildroomConfig(body);
    return NextResponse.json(result.body, { status: result.status });
  });
}
