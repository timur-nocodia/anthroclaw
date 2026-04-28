import { NextRequest } from 'next/server';
import { requireAuth, handleAuthError } from '@/lib/require-auth';
import { createSSEStream } from '@/lib/sse';
import { resolve, sep } from 'node:path';
import { rmSync } from 'node:fs';
import { getGateway } from '@/lib/gateway';

const WHATSAPP_AUTH_ROOT = resolve(process.cwd(), '..', 'data', 'whatsapp');

/**
 * Refuse account IDs that would resolve outside the whatsapp auth dir.
 * Without this check `accountId: "../../agents/foo"` + `reset:true` would
 * `rmSync` arbitrary directories under cwd.
 */
function safeAuthDir(accountId: string): string {
  const candidate = resolve(WHATSAPP_AUTH_ROOT, accountId);
  if (
    candidate !== WHATSAPP_AUTH_ROOT &&
    !candidate.startsWith(WHATSAPP_AUTH_ROOT + sep)
  ) {
    throw new Error(`Invalid accountId: ${accountId}`);
  }
  if (candidate === WHATSAPP_AUTH_ROOT) {
    throw new Error('accountId cannot be empty');
  }
  return candidate;
}

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

  let body: { accountId?: string; agentId?: string; reset?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const accountId = await resolveAccountId(body);
  let authDir: string;
  try {
    authDir = safeAuthDir(accountId);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'invalid_account_id', message: (err as Error).message }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  // When the previous attempt was rejected by WhatsApp (loggedOut), the auth
  // dir holds dead credentials that will keep failing. The "Clear credentials
  // & retry" button on the pair page sends `reset: true` to wipe them.
  // rmSync with force:true is a no-op if the dir doesn't exist.
  if (body.reset) {
    try {
      rmSync(authDir, { recursive: true, force: true });
    } catch {
      // Best effort — let pairWhatsApp recreate the dir.
    }
  }

  return createSSEStream(async (send, close) => {
    try {
      // Echo the resolved accountId up front so the UI can target it
      // (e.g. for subsequent reset requests when accountId was derived).
      send({ type: 'status', accountId, message: `pairing ${accountId}` });

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
