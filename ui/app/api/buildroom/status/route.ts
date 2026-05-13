import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getBuildroomStatus } from '@/lib/buildroom';

export async function GET() {
  return withAuth(async () => {
    const result = await getBuildroomStatus();
    return NextResponse.json(result.body, { status: result.status });
  });
}
