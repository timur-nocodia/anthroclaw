import { NextRequest } from 'next/server';
import { requireAuth, handleAuthError } from '@/lib/require-auth';
import { createSSEStream } from '@/lib/sse';
import { resolve, join } from 'node:path';

const DATA_DIR = resolve(process.cwd(), '..', 'data');

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
  } catch (err) {
    return handleAuthError(err);
  }

  let body: { accountId?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const accountId = body.accountId ?? 'new';
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
