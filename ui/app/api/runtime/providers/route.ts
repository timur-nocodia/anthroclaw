import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getRuntimeProviders } from '@/lib/runtime-setup';

export async function GET() {
  return withAuth(async () => {
    return NextResponse.json(await getRuntimeProviders());
  });
}
