/**
 * POST /api/agents/[agentId]/mcp/[name]/tools
 *
 * Re-discovers the full list of tools an attached MCP server currently
 * exposes, using the credential already stored under `mcp:<name>`.
 *
 * Used by the "Edit allowed tools" dialog on `<McpServerCard />` so the
 * operator can pick which tools to expose without re-running the full
 * Add MCP server wizard (which is also the only way to recover from an
 * expired pending row).
 *
 * Returns the same shape the wizard returns on attach:
 *   { tools: Array<{ name: string; description?: string }> }
 *
 * Errors map to a single envelope `{ error, message? }`:
 *   - `not_attached`        — no credential under `mcp:<name>`
 *   - `discovery_failed`    — initialize / tools/list rejected (server
 *                             reachable but token bad, or transport
 *                             negotiation failed). Caller should suggest
 *                             Re-auth.
 *
 * Admin auth required (same as the GET status sibling).
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getCredentialStore } from '@/lib/credential-store-instance';
import { discoverMcpTools } from '@backend/integrations/mcp-onboarding/mcp-fetch.js';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ agentId: string; name: string }> },
) {
  return withAuth(async () => {
    const { agentId, name } = await params;
    const store = getCredentialStore();
    const service = `mcp:${name}`;

    let cred;
    try {
      cred = await store.get({ agentId, service }, `ui_discover_tools:${name}`);
    } catch {
      return NextResponse.json({ error: 'not_attached' }, { status: 404 });
    }

    let mcpUrl: string | undefined;
    let token: string | undefined;
    let scheme: string | undefined;
    if (cred.kind === 'mcp_apikey') {
      mcpUrl = cred.mcpUrl;
      token = cred.token;
      scheme = cred.scheme ?? 'Bearer';
    } else if (cred.kind === 'mcp_oauth') {
      mcpUrl = cred.mcpUrl;
      token = cred.accessToken;
      scheme = 'Bearer';
    }
    if (!mcpUrl || !token) {
      return NextResponse.json({ error: 'not_attached' }, { status: 404 });
    }

    try {
      const tools = await discoverMcpTools({ mcpUrl, token, scheme });
      return NextResponse.json({ tools });
    } catch (err) {
      return NextResponse.json(
        { error: 'discovery_failed', message: (err as Error).message },
        { status: 502 },
      );
    }
  });
}
