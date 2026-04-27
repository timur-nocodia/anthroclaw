import { NextRequest } from 'next/server';
import { requireAuth, handleAuthError } from '@/lib/require-auth';
import { createSSEStream } from '@/lib/sse';
import { resolve, join } from 'node:path';
import { getGateway } from '@/lib/gateway';

const DATA_DIR = resolve(process.cwd(), '..', 'data');

async function resolveAccountId(body: { accountId?: string; agentId?: string }): Promise<string> {
  // Explicit accountId always wins.
  if (body.accountId) return body.accountId;

  // Otherwise derive from the selected agent's whatsapp route, so the QR pair
  // writes auth into the same dir the gateway will read on connect.
  if (body.agentId) {
    try {
      const gw = await getGateway();
      const agent = gw.getAgent(body.agentId);
      const waRoute = agent?.config.routes.find((r) => r.channel === 'whatsapp');
      if (waRoute?.account) return waRoute.account;
    } catch {
      // fall through to default
    }
  }

  return 'new';
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
  } catch (err) {
    return handleAuthError(err);
  }

  let body: { accountId?: string; agentId?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const accountId = await resolveAccountId(body);
  const authDir = join(DATA_DIR, 'whatsapp', accountId);

  return createSSEStream(async (send, close) => {
    try {
      const { pairWhatsApp } = await import('@backend/web/pair-whatsapp.js');

      for await (const event of pairWhatsApp(authDir)) {
        send(event);

        if (event.type === 'paired' || event.type === 'error') {
          close();
          return;
        }
      }

      close();
    } catch (err) {
      send({
        type: 'error',
        message: err instanceof Error ? err.message : 'Pairing failed',
      });
      close();
    }
  });
}
