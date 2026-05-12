/**
 * GET /api/mcp/oauth/callback — landing endpoint for the OAuth provider's
 * redirect back. Handles three outcomes:
 *
 *  - `?error=<reason>` → cancel the pending row and redirect to
 *    `/mcp/cancelled?reason=<reason>`.
 *  - `?code=<code>&state=<state>` happy path → call `completeOAuth`,
 *    redirect to either `/mcp/done` (chat-initiated) or
 *    `/fleet/_local/agents/<agentId>?mcpWizard=tools&pendingId=<id>`
 *    (admin-initiated, so the wizard re-opens at step 3).
 *  - missing state → 400 (someone hit this URL by hand).
 *
 * No admin auth required; the `state` parameter is the unguessable
 * capability token (same generation as `pendingId`).
 */

import { NextResponse } from 'next/server';
import { getOnboarding } from '@/lib/mcp-onboarding-instance';

function originOf(req: Request): string {
  // NextResponse.redirect expects an absolute URL; deriving from the request
  // means we work the same whether deployed behind a proxy or running on
  // localhost in dev/tests.
  return new URL(req.url).origin;
}

export async function GET(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const state = u.searchParams.get('state');
  const code = u.searchParams.get('code');
  const error = u.searchParams.get('error');
  const origin = originOf(req);

  if (!state) {
    return new NextResponse('Missing state', { status: 400 });
  }

  if (error) {
    await getOnboarding().cancelByState(state, error);
    return NextResponse.redirect(
      `${origin}/mcp/cancelled?reason=${encodeURIComponent(error)}`,
      { status: 302 },
    );
  }

  if (!code) {
    return new NextResponse('Missing code', { status: 400 });
  }

  const result = await getOnboarding().completeOAuth({ state, code });
  if (result.status === 'gone') {
    return new NextResponse('Expired or replayed OAuth flow', { status: 410 });
  }
  if (result.status === 'failed') {
    return NextResponse.redirect(
      `${origin}/mcp/failed?reason=${encodeURIComponent(result.reason)}`,
      { status: 302 },
    );
  }

  // result.status === 'completed'
  if (result.row.requestedBy.startsWith('agent:')) {
    return NextResponse.redirect(`${origin}/mcp/done`, { status: 302 });
  }
  return NextResponse.redirect(
    `${origin}/fleet/_local/agents/${encodeURIComponent(result.row.agentId)}?mcpWizard=tools&pendingId=${encodeURIComponent(result.pendingId)}`,
    { status: 302 },
  );
}
