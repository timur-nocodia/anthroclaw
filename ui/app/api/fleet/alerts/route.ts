import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getAlerts } from '@/lib/fleet-alerts';

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const status = req.nextUrl.searchParams.get('status') as 'open' | 'acknowledged' | 'all' | null;
    const alerts = getAlerts(status ? { status } : undefined);
    return NextResponse.json(alerts);
  });
}
