/**
 * GET /api/mcp/oauth/start/[pendingId] — chat-friendly one-shot redirect to
 * the provider authorization URL.
 *
 * Reads the pending row, rebuilds the provider URL (with PKCE challenge
 * re-derived from the stored verifier), and 302s to it. Returns 410 if the
 * pending row is unknown / expired / already consumed.
 *
 * No admin auth is required: the `pendingId` itself is the unguessable
 * capability token (32 random bytes base64url), and visiting this URL just
 * forwards the user to the provider's own consent UI.
 */

import { NextResponse } from 'next/server';
import { getOnboarding } from '@/lib/mcp-onboarding-instance';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ pendingId: string }> },
): Promise<Response> {
  const { pendingId } = await ctx.params;
  const url = await getOnboarding().getAuthUrlForPending(pendingId);
  if (!url) {
    return new NextResponse('Expired or unknown OAuth flow', { status: 410 });
  }
  return NextResponse.redirect(url, { status: 302 });
}
