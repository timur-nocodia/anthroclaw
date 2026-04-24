import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

function optionalNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const url = new URL(req.url);
    const gw = await getGateway();
    const bundle = gw.exportDiagnostics({
      includeLogs: url.searchParams.get('includeLogs') !== 'false',
      logLimit: optionalNumber(url.searchParams.get('logLimit')),
      runLimit: optionalNumber(url.searchParams.get('runLimit')),
      routeDecisionLimit: optionalNumber(url.searchParams.get('routeDecisionLimit')),
      diagnosticEventLimit: optionalNumber(url.searchParams.get('diagnosticEventLimit')),
    });

    return NextResponse.json(bundle, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  });
}
