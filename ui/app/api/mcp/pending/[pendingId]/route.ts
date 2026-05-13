/**
 * GET /api/mcp/pending/[pendingId] — read a pending row's discovered
 * tools + serverId.
 *
 * Used by the wizard when it resumes from the OAuth callback's
 * redirect (`?mcpWizard=tools&pendingId=…`). The credential is already
 * saved at this point; the wizard needs `tools` so the operator can
 * pick which to allow before the final `POST /api/mcp/connect/finalize`
 * call writes the choice into `agent.yml`.
 *
 * The `pendingId` itself is an unguessable 32-byte capability token,
 * so the route is intentionally unauthenticated at the cookie/JWT
 * level — matching `POST /api/mcp/connect/apikey` for the same reason.
 *
 * Response shape:
 *   { status, agentId, serverId?, tools: [{ name, description? }] }
 *
 * Returns 404 if the pendingId is unknown.
 */

import { NextResponse } from 'next/server';
import { getOnboarding } from '@/lib/mcp-onboarding-instance';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pendingId: string }> },
) {
  const { pendingId } = await params;
  const res = getOnboarding().getPendingTools(pendingId);
  if (!res) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(res);
}
