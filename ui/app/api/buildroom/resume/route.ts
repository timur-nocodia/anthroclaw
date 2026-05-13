import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { resumeBuildroom } from '@/lib/buildroom';

export async function POST() {
  return withAuth(async () => {
    const result = await resumeBuildroom();
    return NextResponse.json(result.body, { status: result.status });
  });
}
