/**
 * MCP onboarding facade — surface used by the Gateway, agent tools, and the
 * UI to drive the "add an MCP server" lifecycle (probe → start → attach key
 * or OAuth → finalize).
 *
 * Phase 3 ships the apikey path (admin and chat-initiated). Phase 4 fills in
 * `completeOAuth` and the OAuth client. The facade itself is split into a
 * small dependency-injection seam so the routes (`ui/lib/mcp-onboarding-
 * instance.ts`) and tests can supply their own pending store / credential
 * store / write helpers.
 */

import { randomBytes } from 'node:crypto';
import type { CredentialStore } from '../../agent/credentials/index.js';
import { probe } from './probe.js';
import { deriveServerId } from './server-id.js';
import type { PendingConnection, PendingStore } from './pending-store.js';
import type { Requester } from './types.js';

export interface ExternalMcpEntryForWrite {
  type: 'http' | 'sse' | 'stdio';
  url?: string;
  command?: string;
  display_name?: string;
  credential_ref?: string;
  headers?: Record<string, string>;
  allowed_tools?: string[];
}

export interface WriteAgentYmlArgs {
  agentId: string;
  key: string;
  entry: ExternalMcpEntryForWrite;
}

export interface OnboardingDeps {
  pending: PendingStore;
  credentials: CredentialStore;
  uiBaseUrl: string;
  /**
   * Persist the resolved external MCP server entry into the agent's
   * `agent.yml`. Implementation lives in `src/config/write-agent-yml.ts`
   * (Task 14). Required by `finalize`; unused for `startConnection` /
   * `attachApiKey` so tests that only exercise those can omit it.
   */
  writeAgentYml?: (args: WriteAgentYmlArgs) => void | Promise<void>;
  now?: () => number;
  randomToken?: () => string;
}

export interface ConnectionStartResult {
  status: 'authorize' | 'awaiting_apikey' | 'connected' | 'rejected';
  pendingId?: string;
  authUrl?: string;
  apikeyUrl?: string;
  serverName?: string;
  reason?: string;
}

export interface AttachApiKeyResult {
  status: 'connected' | 'invalid_token';
  tools?: Array<{ name: string; description?: string }>;
  serverId?: string;
  pendingId?: string;
}

export interface FinalizeResult {
  status: 'connected';
  server: string;
  tools: Array<{ name: string; description?: string }>;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

export function createOnboarding(deps: OnboardingDeps) {
  const now = deps.now ?? (() => Date.now());
  const tok = deps.randomToken ?? (() => randomBytes(32).toString('base64url'));

  async function startConnection(opts: {
    url: string;
    requester: Requester;
  }): Promise<ConnectionStartResult> {
    if (
      opts.requester.kind === 'agent'
      && opts.requester.chatType
      && opts.requester.chatType !== 'private'
    ) {
      return { status: 'rejected', reason: 'mcp_onboarding_requires_dm' };
    }

    const probed = await probe(opts.url);
    if (probed.authMode === 'manual') {
      return { status: 'rejected', reason: probed.reason };
    }

    // Phase 3 doesn't yet maintain a cross-agent.yml "taken" set; Task 14's
    // writeAgentYmlEntry rejects collisions at write time. A future pass
    // should resolve here so the UI can preview the final id.
    const takenIds = new Set<string>();
    const serverId = deriveServerId(opts.url, takenIds);
    const pendingId = `pnd_${tok()}`;
    const state = `st_${tok()}`;
    const requestedBy
      = opts.requester.kind === 'admin'
        ? `admin:${opts.requester.userId ?? 'unknown'}`
        : `agent:${opts.requester.agentSessionKey ?? opts.requester.agentId}`;
    const row: PendingConnection = {
      id: pendingId,
      state,
      agentId: opts.requester.agentId,
      agentSessionKey: opts.requester.agentSessionKey ?? null,
      mcpUrl: opts.url,
      authMode: probed.authMode === 'oauth' ? 'oauth' : 'apikey',
      codeVerifier: null,
      clientId: null,
      clientSecret: null,
      oauthMetadata:
        probed.authMode === 'oauth' ? JSON.stringify(probed.oauth) : null,
      toolsMetadata: null,
      requestedBy,
      status: 'pending',
      failureReason: null,
      createdAt: now(),
      expiresAt: now() + PENDING_TTL_MS,
    };
    deps.pending.insert(row);

    if (probed.authMode === 'apikey' || probed.authMode === 'none') {
      return {
        status: 'awaiting_apikey',
        pendingId,
        apikeyUrl: `${deps.uiBaseUrl}/mcp/connect/${pendingId}/apikey`,
        serverName: probed.server?.name ?? serverId,
      };
    }

    // oauth — Phase 4 fills in the actual dance behind /api/mcp/oauth/start.
    return {
      status: 'authorize',
      pendingId,
      authUrl: `${deps.uiBaseUrl}/api/mcp/oauth/start/${pendingId}`,
      serverName: probed.server?.name ?? serverId,
    };
  }

  async function attachApiKey(opts: {
    pendingId: string;
    token: string;
  }): Promise<AttachApiKeyResult> {
    const row = deps.pending.byId(opts.pendingId);
    if (!row || row.status !== 'pending') return { status: 'invalid_token' };
    if (now() > row.expiresAt) {
      deps.pending.markFailed(row.id, 'expired');
      return { status: 'invalid_token' };
    }

    const initRes = await fetch(row.mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'anthroclaw', version: '0.1' },
        },
      }),
    });
    if (!initRes.ok) return { status: 'invalid_token' };

    const toolsRes = await fetch(row.mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });
    const toolsBody = (await toolsRes.json()) as {
      result?: { tools?: Array<{ name: string; description?: string }> };
    };
    const tools = toolsBody.result?.tools ?? [];

    const takenIds = new Set<string>();
    const serverId = deriveServerId(row.mcpUrl, takenIds);

    await deps.credentials.set(
      { agentId: row.agentId, service: `mcp:${serverId}` },
      {
        kind: 'mcp_apikey',
        service: `mcp:${serverId}`,
        account: serverId,
        scopes: [],
        mcpUrl: row.mcpUrl,
        token: opts.token,
        scheme: 'Bearer',
        createdAt: now(),
      },
    );

    deps.pending.markCompleted(row.id, JSON.stringify({ tools, serverId }));
    return { status: 'connected', tools, serverId, pendingId: row.id };
  }

  async function finalize(opts: {
    pendingId: string;
    allowed_tools: string[];
  }): Promise<FinalizeResult> {
    const row = deps.pending.byId(opts.pendingId);
    if (!row || row.status !== 'completed') {
      throw new Error('pending_not_ready');
    }
    if (now() > row.expiresAt) {
      throw new Error('pending_expired');
    }
    const parsed = JSON.parse(row.toolsMetadata ?? '{}') as {
      serverId?: string;
      tools?: Array<{ name: string; description?: string }>;
    };
    const serverId = parsed.serverId;
    const tools = parsed.tools ?? [];
    if (!serverId) throw new Error('pending_missing_server_id');

    const allowed = opts.allowed_tools.includes('*')
      ? tools.map((t) => t.name)
      : opts.allowed_tools;

    if (!deps.writeAgentYml) {
      throw new Error('write_agent_yml_dependency_missing');
    }
    await deps.writeAgentYml({
      agentId: row.agentId,
      key: serverId,
      entry: {
        type: 'http',
        url: row.mcpUrl,
        display_name: serverId,
        credential_ref: `mcp:${serverId}`,
        allowed_tools: allowed,
      },
    });

    return { status: 'connected', server: serverId, tools };
  }

  return {
    startConnection,
    attachApiKey,
    finalize,
    _debug: {
      getCredential: async (agentId: string, service: string) => {
        try {
          return await deps.credentials.get(
            { agentId, service },
            'test_debug',
          );
        } catch {
          return null;
        }
      },
    },
  };
}
