import { NextResponse } from 'next/server';
import { getGateway } from '@/lib/gateway';
import { withAuth } from '@/lib/route-handler';
import { getRuntimeStatus, type RuntimeGatewayStatusInput } from '@/lib/runtime-control-plane';

export async function GET() {
  return withAuth(async () => {
    let gatewayStatus: RuntimeGatewayStatusInput | undefined;
    let gatewayError: unknown;

    try {
      const gw = await getGateway();
      gatewayStatus = gw.getStatus() as RuntimeGatewayStatusInput;
    } catch (err) {
      gatewayError = err;
    }

    return NextResponse.json(getRuntimeStatus(gatewayStatus, gatewayError));
  });
}
