import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getRuntimeModelRegistry } from '@/lib/runtime-control-plane';

export async function GET() {
  return withAuth(async () => {
    return NextResponse.json(getRuntimeModelRegistry());
  });
}
