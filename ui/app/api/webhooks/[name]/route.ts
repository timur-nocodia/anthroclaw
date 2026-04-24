import { NextRequest, NextResponse } from 'next/server';
import { getGateway } from '@/lib/gateway';

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
