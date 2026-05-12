/**
 * POST /api/mcp/connect/start — admin-initiated onboarding start.
 *
 * Probes the URL, persists a pending row, returns either an apikey paste URL
 * (for `apikey`/`none`) or an authorize URL (for `oauth`, Phase 4). Admin
 * auth is REQUIRED — chat-initiated flows go through a different code path
 * (Phase 5's agent tool, which calls `startConnection` directly without HTTP).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, handleAuthError } from '@/lib/require-auth';
import { getOnboarding } from '@/lib/mcp-onboarding-instance';

const Body = z.object({
  url: z.string().url(),
  agentId: z.string().min(1),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
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

  const res = await getOnboarding().startConnection({
    url: parsed.data.url,
    requester: {
      kind: 'admin',
      userId: user.email,
      agentId: parsed.data.agentId,
    },
  });
  return NextResponse.json(res);
}
