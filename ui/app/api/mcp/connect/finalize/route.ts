/**
 * POST /api/mcp/connect/finalize — persist the chosen tool subset to the
 * agent's `agent.yml`. Admin auth required for the UI wizard path. Phase 5
 * will route the chat-initiated finalize through an agent tool that calls
 * `onboarding.finalize` directly, bypassing this HTTP boundary.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, handleAuthError } from '@/lib/require-auth';
import { getOnboarding } from '@/lib/mcp-onboarding-instance';

const Body = z.object({
  pendingId: z.string().min(1),
  allowed_tools: z.array(z.string()),
});

export async function POST(req: Request) {
  try {
    await requireAuth();
  } catch (err) {
    return handleAuthError(err);
  }

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

  try {
    const res = await getOnboarding().finalize(parsed.data);
    return NextResponse.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'finalize_failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
