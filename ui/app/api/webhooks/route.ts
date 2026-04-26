import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

const DELIVERY_STATUSES = new Set([
  'delivered',
  'not_found',
  'disabled',
  'unauthorized',
  'bad_payload',
  'channel_unavailable',
  'delivery_failed',
]);

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const deliveredParam = url.searchParams.get('delivered');
    const gw = await getGateway();

    return NextResponse.json({
      deliveries: gw.listDirectWebhookDeliveries({
        webhook: url.searchParams.get('webhook') ?? undefined,
        status: parseDeliveryStatus(url.searchParams.get('status')),
        delivered: deliveredParam === null ? undefined : deliveredParam === 'true',
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
      }),
    });
  });
}

function parseDeliveryStatus(value: string | null):
  | 'delivered'
  | 'not_found'
  | 'disabled'
  | 'unauthorized'
  | 'bad_payload'
  | 'channel_unavailable'
  | 'delivery_failed'
  | undefined {
  return value && DELIVERY_STATUSES.has(value) ? value as ReturnType<typeof parseDeliveryStatus> : undefined;
}
