/**
 * POST /api/mcp/connect/apikey — attach an API key to a pending connection.
 *
 * Intentionally UNAUTHENTICATED at the cookie/JWT level: chat-initiated
 * flows generate a one-shot URL containing a 32-byte random `pendingId` that
 * arrives at the agent's operator via Telegram/WhatsApp DM and gets opened
 * in any browser (not necessarily the admin's). The security boundary is
 * the unguessable `pendingId` plus the 10-minute TTL on the pending row and
 * the `status='pending'` precondition (so a completed flow can't be replayed).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOnboarding } from '@/lib/mcp-onboarding-instance';

const Body = z.object({
  pendingId: z.string().min(1),
  token: z.string().min(1),
});

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const res = await getOnboarding().attachApiKey(parsed.data);
  return NextResponse.json(res);
}
