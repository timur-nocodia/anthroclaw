import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { acknowledgeAlert } from '@/lib/fleet-alerts';

export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ alertId: string }> },
) {
  return withAuth(async () => {
    const { alertId } = await params;
    const ok = acknowledgeAlert(alertId);
    if (!ok) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  });
}
