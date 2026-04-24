import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getAlertRules, updateAlertRules } from '@/lib/fleet-alerts';

export async function GET() {
  return withAuth(async () => {
    return NextResponse.json(getAlertRules());
  });
}

export async function PUT(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json();
    const rules = updateAlertRules(body);
    return NextResponse.json(rules);
  });
}
