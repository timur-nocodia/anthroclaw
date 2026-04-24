import { NextRequest, NextResponse } from 'next/server';
import { getGateway } from '@/lib/gateway';
import { withAuth } from '@/lib/route-handler';

const DELIVERY_STATUSES = new Set([
  'delivered',
  'not_found',
  'disabled',
  'unauthorized',
  'bad_payload',
  'channel_unavailable',
  'delivery_failed',
]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  return withAuth(async () => {
    const { name } = await params;
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const deliveredParam = url.searchParams.get('delivered');
    const gw = await getGateway();

    return NextResponse.json({
      deliveries: gw.listDirectWebhookDeliveries({
        webhook: name,
        status: parseDeliveryStatus(url.searchParams.get('status')),
        delivered: deliveredParam === null ? undefined : deliveredParam === 'true',
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
      }),
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const gw = await getGateway();
  const result = await gw.deliverDirectWebhook(name, await req.text(), req.headers);

  const status = result.status === 'delivered'
    ? 200
    : result.status === 'not_found'
      ? 404
      : result.status === 'unauthorized'
        ? 401
        : result.status === 'bad_payload'
          ? 400
          : 409;

  return NextResponse.json(result, { status });
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
