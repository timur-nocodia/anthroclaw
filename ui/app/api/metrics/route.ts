import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { metrics } from '@backend/metrics/collector.js';

export async function GET() {
  return withAuth(async () => {
    return NextResponse.json(metrics.snapshot());
  });
}
