/**
 * GET /api/system/accounts
 *
 * Returns the set of configured channel accounts so the binding wizard
 * can populate its "which account should this binding use?" dropdown
 * regardless of whether the agent currently has any routes. Without
 * this, a freshly-created agent (no routes yet) showed an empty list
 * and the operator could never bind it to a channel — circular
 * dependency: routes need an account, accounts were derived from
 * existing routes.
 *
 * Pulls from the **global config** (Gateway's in-memory snapshot of
 * `config.yml` merged with the runtime overlay), so it reflects what's
 * actually wired regardless of which agents exist. Secrets never
 * leave — only `{ accountId, hasToken, status? }` shape.
 *
 * Admin auth required (the account *list* is sensitive info — exposing
 * it lets an unauthed user enumerate channels).
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function GET() {
  return withAuth(async () => {
    const gw = await getGateway();
    const cfg = gw.getGlobalConfig();
    const telegram: Record<string, { username?: string }> = {};
    const whatsapp: Record<string, { username?: string }> = {};

    if (cfg?.telegram?.accounts) {
      for (const id of Object.keys(cfg.telegram.accounts)) {
        telegram[id] = {};
      }
    }
    if (cfg?.whatsapp?.accounts) {
      for (const id of Object.keys(cfg.whatsapp.accounts)) {
        whatsapp[id] = {};
      }
    }

    return NextResponse.json({ telegram, whatsapp });
  });
}
