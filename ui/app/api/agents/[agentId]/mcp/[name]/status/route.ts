/**
 * GET /api/agents/[agentId]/mcp/[name]/status
 *
 * Returns the live status of a single external MCP server configured on an
 * agent. The `<McpServersSection />` component fetches this per server on
 * mount to populate `<McpServerCard status=... />` — most importantly the
 * `reauth_required` state that the static agent.yml view cannot infer.
 *
 * Status semantics:
 *   - `disabled`         — no credential record (server was added but never
 *                          completed onboarding, or credential was deleted)
 *   - `reauth_required`  — credential exists and has `metadata.needs_reauth = '1'`
 *                          flipped by either the Phase 6 pre-flight refresh
 *                          revocation trap or the runtime 401 handler
 *   - `connected`        — credential exists and is healthy. `tokenExpiresAt`
 *                          is included (epoch ms) when known so the UI can
 *                          render the dot tooltip with an expiry hint.
 *
 * Admin auth required (the credential store is sensitive — listing whether
 * a credential exists is itself information leakage to a non-admin caller).
 *
 * Note on key matching: external MCP entries are stored in `agent.yml` under
 * a slug key (`external_mcp_servers.<key>`). The credential service id is
 * `mcp:<key>`. Phase 5's `deriveServerId` produces the same slug that the
 * onboarding facade writes back into the YAML, so `<key>` == the stored
 * `serverId`. We use the route param `name` directly — it's expected to be
 * that slug (the caller in `<McpServersSection />` iterates the YAML map,
 * so the key is canonical).
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getCredentialStore } from '@/lib/credential-store-instance';

export type McpStatus = 'connected' | 'reauth_required' | 'disabled';

export interface McpStatusResponse {
  status: McpStatus;
  tokenExpiresAt?: number;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ agentId: string; name: string }> },
) {
  return withAuth(async () => {
    const { agentId, name } = await params;
    const store = getCredentialStore();
    const service = `mcp:${name}`;

    let cred;
    try {
      cred = await store.get(
        { agentId, service },
        `ui_status_check:${name}`,
      );
    } catch {
      // Missing credential, decryption failure, or master-key-not-set —
      // surface as `disabled` rather than 500 so the UI shows a sensible
      // status without leaking which failure mode occurred.
      const body: McpStatusResponse = { status: 'disabled' };
      return NextResponse.json(body);
    }

    if (cred.metadata?.needs_reauth === '1') {
      const body: McpStatusResponse = { status: 'reauth_required' };
      return NextResponse.json(body);
    }

    const expiresAt
      = cred.kind === 'mcp_oauth' || cred.kind === 'oauth' || cred.kind === undefined
        ? cred.expiresAt
        : undefined;

    const body: McpStatusResponse = {
      status: 'connected',
      ...(typeof expiresAt === 'number' ? { tokenExpiresAt: expiresAt } : {}),
    };
    return NextResponse.json(body);
  });
}
