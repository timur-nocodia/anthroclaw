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

import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { CredentialStore } from '../../agent/credentials/index.js';
import {
  buildAuthorizationUrl,
  exchangeCode,
  generatePkce,
  maybeWarnInsecureUrl,
  registerClient,
} from './oauth-client.js';
import { probe } from './probe.js';
import { discoverMcpTools, mcpFetch } from './mcp-fetch.js';
import { deriveServerId } from './server-id.js';
import type { PendingConnection, PendingStore } from './pending-store.js';
import type { DiscoveredOAuth, Requester } from './types.js';

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
  /**
   * Resolve the set of `external_mcp_servers` keys already in use for the
   * agent so `deriveServerId` can pick a non-colliding name. Without this,
   * two concurrent flows for the same hostname would derive the same id and
   * silently overwrite each other's credential under `mcp:<id>` (last-write-
   * wins, no audit). Wired in `ui/lib/mcp-onboarding-instance.ts`.
   */
  listTakenServerIds: (agentId: string) => Promise<Set<string>>;
  /**
   * Optional fallback `client_id` for OAuth flows where the discovered
   * authorization server does NOT advertise a DCR (RFC 7591) registration
   * endpoint. If neither DCR is available nor a static client id is
   * configured, `startConnection` will reject with
   * `dcr_required_but_not_supported`.
   */
  staticClientId?: string;
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
  /** Populated when `status === 'connected'` from the no-auth probe path. */
  tools?: Array<{ name: string; description?: string }>;
  serverId?: string;
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

/**
 * Payload shape emitted by the facade for `connected` / `failed` /
 * `cancelled` / `timeout` events. The Gateway subscriber translates these
 * into synthetic `[system] mcp_*` inbound messages addressed to the
 * agent session that initiated the connection (chat-driven flows only —
 * admin-initiated rows have `agentSessionKey: null` and produce no event
 * dispatch).
 */
export interface OnboardingEvent {
  pendingId: string;
  agentId: string;
  agentSessionKey: string | null;
  serverId: string;
  tools?: Array<{ name: string; description?: string }>;
  reason?: string;
}

export function createOnboarding(deps: OnboardingDeps) {
  const now = deps.now ?? (() => Date.now());
  const tok = deps.randomToken ?? (() => randomBytes(32).toString('base64url'));
  const events = new EventEmitter();

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

    // Resolve the existing taken set from the agent's yml so concurrent
    // flows for the same hostname don't both pick the same id and silently
    // overwrite each other's credential.
    const takenIds = await deps.listTakenServerIds(opts.requester.agentId);
    const serverId = deriveServerId(opts.url, takenIds);
    const pendingId = `pnd_${tok()}`;
    const state = `st_${tok()}`;
    const requestedBy
      = opts.requester.kind === 'admin'
        ? `admin:${opts.requester.userId ?? 'unknown'}`
        : `agent:${opts.requester.agentSessionKey ?? opts.requester.agentId}`;

    // OAuth branch: register the client (DCR) and generate PKCE before we
    // insert the pending row so all the secrets we'll need at callback time
    // are captured atomically.
    let clientId: string | null = null;
    let clientSecret: string | null = null;
    let codeVerifier: string | null = null;
    if (probed.authMode === 'oauth') {
      if (probed.oauth.registrationEndpoint) {
        try {
          const reg = await registerClient({
            registrationEndpoint: probed.oauth.registrationEndpoint,
            redirectUri: `${deps.uiBaseUrl}/api/mcp/oauth/callback`,
            clientName: 'AnthroClaw',
            scopes: probed.oauth.scopesSupported,
          });
          clientId = reg.clientId;
          clientSecret = reg.clientSecret ?? null;
        } catch (err) {
          return {
            status: 'rejected',
            reason: (err as Error).message,
          };
        }
      } else if (deps.staticClientId) {
        clientId = deps.staticClientId;
      } else {
        return {
          status: 'rejected',
          reason: 'dcr_required_but_not_supported',
        };
      }
      const pkce = generatePkce();
      codeVerifier = pkce.verifier;
    }

    const row: PendingConnection = {
      id: pendingId,
      state,
      agentId: opts.requester.agentId,
      agentSessionKey: opts.requester.agentSessionKey ?? null,
      mcpUrl: opts.url,
      authMode: probed.authMode,
      codeVerifier,
      clientId,
      clientSecret,
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

    if (probed.authMode === 'apikey') {
      return {
        status: 'awaiting_apikey',
        pendingId,
        apikeyUrl: `${deps.uiBaseUrl}/mcp/connect/${pendingId}/apikey`,
        serverName: probed.server?.name ?? serverId,
      };
    }

    if (probed.authMode === 'none') {
      // Open server, no credential needed. Discover tools immediately so the
      // wizard can skip step 2 entirely and go straight to tool selection.
      try {
        const tools = await listToolsNoAuth(opts.url);
        deps.pending.markCompleted(
          pendingId,
          JSON.stringify({ tools, serverId }),
        );
        return {
          status: 'connected',
          pendingId,
          serverName: probed.server?.name ?? serverId,
          tools,
          serverId,
        };
      } catch (err) {
        deps.pending.markFailed(pendingId, (err as Error).message);
        return {
          status: 'rejected',
          reason: `tools_list_failed: ${(err as Error).message}`,
        };
      }
    }

    // OAuth: return the wizard-facing one-shot URL. The route at that path
    // (Phase 4 Task 20) calls back into `getAuthUrlForPending` which
    // rebuilds the provider authorization URL from the stored row.
    return {
      status: 'authorize',
      pendingId,
      authUrl: `${deps.uiBaseUrl}/api/mcp/oauth/start/${pendingId}`,
      serverName: probed.server?.name ?? serverId,
    };
  }

  /**
   * Rebuild the provider authorization URL for a pending OAuth row. Returns
   * null if the row doesn't exist, isn't in `pending` status, or has
   * expired. Called by the `/api/mcp/oauth/start/[pendingId]` route to
   * decide whether to redirect the user.
   *
   * The PKCE challenge is re-derived from the stored verifier (same
   * deterministic SHA-256 base64url that `generatePkce` performs) so the
   * row only needs to carry the verifier.
   */
  async function getAuthUrlForPending(pendingId: string): Promise<string | null> {
    const row = deps.pending.byId(pendingId);
    if (!row) return null;
    if (row.status !== 'pending') return null;
    if (now() > row.expiresAt) return null;
    if (!row.oauthMetadata || !row.clientId || !row.codeVerifier) return null;
    let meta: DiscoveredOAuth;
    try {
      meta = JSON.parse(row.oauthMetadata) as DiscoveredOAuth;
    } catch (err) {
      // Surface this in logs — without it the route renders an opaque
      // 410 "Expired or unknown" and operators have no signal that the
      // SQLite row carries corrupted discovery metadata.
      console.warn(
        `[mcp-onboarding] getAuthUrlForPending: corrupt oauth_metadata for pendingId=${pendingId}: ${(err as Error).message}`,
      );
      return null;
    }
    const challenge = createHash('sha256')
      .update(row.codeVerifier)
      .digest('base64url');
    return buildAuthorizationUrl({
      authorizationEndpoint: meta.authorizationEndpoint,
      clientId: row.clientId,
      redirectUri: `${deps.uiBaseUrl}/api/mcp/oauth/callback`,
      state: row.state,
      codeChallenge: challenge,
      scopes: meta.scopesSupported,
    });
  }

  /**
   * Cancel a pending row by `state`. Used by the OAuth callback when the
   * provider returns `?error=...` (user denied consent). Atomic transition
   * from `pending` → `exchanging` (via `consumeByState`), then immediately
   * to `cancelled` so a replay can't race.
   *
   * Returns true if the row was consumed and cancelled, false if state was
   * unknown or already consumed.
   */
  async function cancelByState(
    state: string,
    reason?: string,
  ): Promise<boolean> {
    const row = deps.pending.consumeByState(state);
    if (!row) return false;
    deps.pending.markCancelled(row.id, reason);
    events.emit('cancelled', {
      pendingId: row.id,
      agentId: row.agentId,
      agentSessionKey: row.agentSessionKey,
      serverId: row.mcpUrl,
      reason,
    } satisfies OnboardingEvent);
    return true;
  }

  type CompleteOAuthResult =
    | { status: 'gone' }
    | { status: 'failed'; reason: string }
    | {
        status: 'completed';
        pendingId: string;
        serverId: string;
        tools: Array<{ name: string; description?: string }>;
        row: PendingConnection;
      };

  /**
   * Complete the OAuth dance: atomically claim the row by `state`, exchange
   * the authorization code for tokens, store the credential, fetch the
   * `tools/list` for the wizard, and mark the row completed.
   *
   * Returns `gone` if state was unknown / already consumed (replay), `failed`
   * with a reason on any error after consume, or `completed` with the
   * tools list and the row so the callback route can decide where to
   * redirect (admin → wizard step 3; agent → done page).
   */
  async function completeOAuth(args: {
    state: string;
    code: string;
  }): Promise<CompleteOAuthResult> {
    const row = deps.pending.consumeByState(args.state);
    if (!row) return { status: 'gone' };
    if (now() > row.expiresAt) {
      deps.pending.markFailed(row.id, 'expired');
      return { status: 'gone' };
    }
    try {
      if (!row.oauthMetadata) throw new Error('missing_oauth_metadata');
      if (!row.clientId) throw new Error('missing_client_id');
      if (!row.codeVerifier) throw new Error('missing_code_verifier');

      let meta: DiscoveredOAuth;
      try {
        meta = JSON.parse(row.oauthMetadata) as DiscoveredOAuth;
      } catch (err) {
        // Same rationale as in getAuthUrlForPending: surface corrupt
        // metadata in logs before the row gets marked failed.
        console.warn(
          `[mcp-onboarding] completeOAuth: corrupt oauth_metadata for pendingId=${row.id}: ${(err as Error).message}`,
        );
        throw new Error('invalid_oauth_metadata');
      }
      // Defensive URL validation — the discovered metadata came from an
      // untrusted MCP server at probe time. Reject if endpoints aren't
      // parseable.
      try {
        // eslint-disable-next-line no-new
        new URL(meta.tokenEndpoint);
        // eslint-disable-next-line no-new
        new URL(meta.authorizationEndpoint);
        if (meta.issuer) {
          // eslint-disable-next-line no-new
          new URL(meta.issuer);
        }
      } catch {
        throw new Error('invalid_oauth_metadata');
      }
      maybeWarnInsecureUrl(meta.tokenEndpoint, 'token_endpoint');
      maybeWarnInsecureUrl(meta.authorizationEndpoint, 'authorization_endpoint');
      if (meta.issuer) {
        maybeWarnInsecureUrl(meta.issuer, 'issuer');
      }

      const tokens = await exchangeCode({
        tokenEndpoint: meta.tokenEndpoint,
        clientId: row.clientId,
        clientSecret: row.clientSecret ?? undefined,
        redirectUri: `${deps.uiBaseUrl}/api/mcp/oauth/callback`,
        code: args.code,
        codeVerifier: row.codeVerifier,
      });

      const takenIds = await deps.listTakenServerIds(row.agentId);
      const serverId = deriveServerId(row.mcpUrl, takenIds);

      await deps.credentials.set(
        { agentId: row.agentId, service: `mcp:${serverId}` },
        {
          kind: 'mcp_oauth',
          service: `mcp:${serverId}`,
          account: serverId,
          scopes: tokens.scopes ?? [],
          mcpUrl: row.mcpUrl,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          tokenEndpoint: meta.tokenEndpoint,
          authorizationServer: meta.issuer,
          clientId: row.clientId,
          clientSecret: row.clientSecret ?? undefined,
          createdAt: now(),
        },
      );

      // Streamable HTTP servers (Linear, Apify, Browserbase, …) need the
      // full initialize → notifications/initialized → tools/list dance
      // with `Accept: text/event-stream` and the `Mcp-Session-Id` header.
      // The naive single-shot tools/list we used to do here got back
      // HTTP 400 from such servers, the JSON parse swallowed the error,
      // and the pending row was marked completed with an empty tools
      // list — the resume wizard then showed "No tools discovered"
      // even though the credential was saved fine.
      let tools: Array<{ name: string; description?: string }> = [];
      try {
        tools = await discoverMcpTools({
          mcpUrl: row.mcpUrl,
          token: tokens.accessToken,
        });
      } catch (err) {
        // Persist what we have (the credential) so the operator can
        // still finalize manually via the Edit allowed tools dialog's
        // Refresh button. Surface the reason in the pending row's
        // tools metadata for debugging.
        console.warn(
          `[mcp-onboarding] completeOAuth: tools/list failed for pendingId=${row.id}: ${(err as Error).message}`,
        );
      }

      deps.pending.markCompleted(row.id, JSON.stringify({ tools, serverId }));
      const updated = deps.pending.byId(row.id) ?? row;
      events.emit('connected', {
        pendingId: row.id,
        agentId: row.agentId,
        agentSessionKey: row.agentSessionKey,
        serverId,
        tools,
      } satisfies OnboardingEvent);
      return { status: 'completed', pendingId: row.id, serverId, tools, row: updated };
    } catch (err) {
      const reason = (err as Error).message ?? 'unknown_error';
      deps.pending.markFailed(row.id, reason);
      events.emit('failed', {
        pendingId: row.id,
        agentId: row.agentId,
        agentSessionKey: row.agentSessionKey,
        serverId: row.mcpUrl,
        reason,
      } satisfies OnboardingEvent);
      return { status: 'failed', reason };
    }
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

    // MCP Streamable HTTP transport requires advertising both
    // application/json AND text/event-stream — servers like Apify
    // (mcp.apify.com) reject the handshake with HTTP 406 otherwise. The
    // server may then issue a session id via the `mcp-session-id` response
    // header that must be echoed on every subsequent call, and it may
    // reply in either content type. See PR #26 for the equivalent fix on
    // the unauthenticated probe.
    const initRes = await mcpFetch(row.mcpUrl, opts.token, undefined, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'anthroclaw', version: '0.1' },
      },
    });
    if (!initRes.ok) return { status: 'invalid_token' };
    const sessionId = initRes.sessionId;

    // Spec-required notification after initialize. Servers that don't use
    // sessions ignore it; servers that do (Apify) reject tools/list until
    // it's sent. Best-effort: failures here surface as failures on the
    // next call.
    if (sessionId) {
      await mcpFetch(row.mcpUrl, opts.token, sessionId, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      }).catch(() => undefined);
    }

    const toolsRes = await mcpFetch(row.mcpUrl, opts.token, sessionId, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    if (!toolsRes.ok) return { status: 'invalid_token' };
    const toolsBody = toolsRes.body as {
      result?: { tools?: Array<{ name: string; description?: string }> };
    } | null;
    const tools = toolsBody?.result?.tools ?? [];

    const takenIds = await deps.listTakenServerIds(row.agentId);
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
    events.emit('connected', {
      pendingId: row.id,
      agentId: row.agentId,
      agentSessionKey: row.agentSessionKey,
      serverId,
      tools,
    } satisfies OnboardingEvent);
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
    // Open servers (authMode='none') are reachable without a credential —
    // emit a credential_ref-free entry so resolveExternalMcpHeaders simply
    // skips the credential lookup and passes the spec through unchanged.
    const entry =
      row.authMode === 'none'
        ? {
            type: 'http' as const,
            url: row.mcpUrl,
            display_name: serverId,
            allowed_tools: allowed,
          }
        : {
            type: 'http' as const,
            url: row.mcpUrl,
            display_name: serverId,
            credential_ref: `mcp:${serverId}`,
            allowed_tools: allowed,
          };
    await deps.writeAgentYml({
      agentId: row.agentId,
      key: serverId,
      entry,
    });

    return { status: 'connected', server: serverId, tools };
  }

  /**
   * Read a pending row's status with derived age and remaining-TTL values.
   * Used by the `connect_mcp` built-in tool's `check` op so the agent can
   * surface "still waiting / expired / failed" without polling the full row.
   * Returns null when the row is unknown.
   */
  function getPending(pendingId: string): {
    status: PendingConnection['status'];
    age_seconds: number;
    expires_in_seconds: number;
  } | null {
    const row = deps.pending.byId(pendingId);
    if (!row) return null;
    const n = now();
    return {
      status: row.status,
      age_seconds: Math.max(0, Math.floor((n - row.createdAt) / 1000)),
      expires_in_seconds: Math.max(0, Math.floor((row.expiresAt - n) / 1000)),
    };
  }

  /**
   * Read the discovered tools + serverId metadata stored on a completed
   * pending row. Used by the OAuth-resume route handler in the UI: after
   * the OAuth callback lands the operator back on the agent page with
   * `?mcpWizard=tools&pendingId=…`, the wizard needs the same `tools` and
   * `serverId` that `attachApiKey` / `completeOAuth` already discovered
   * so the operator can pick which to allow and then `finalize`.
   *
   * Returns null for unknown ids and for rows still in `pending`/`failed`
   * states (tools are only meaningful after a successful initialize +
   * tools/list handshake). Returns the metadata for `completed` and the
   * intermediate `exchanging` state so a slow caller doesn't race.
   */
  function getPendingTools(pendingId: string): {
    status: PendingConnection['status'];
    agentId: string;
    serverId?: string;
    tools: Array<{ name: string; description?: string }>;
  } | null {
    const row = deps.pending.byId(pendingId);
    if (!row) return null;
    if (row.status === 'pending' || row.status === 'failed' || row.status === 'cancelled') {
      return { status: row.status, agentId: row.agentId, tools: [] };
    }
    let parsed: { serverId?: string; tools?: Array<{ name: string; description?: string }> } = {};
    try {
      parsed = JSON.parse(row.toolsMetadata ?? '{}');
    } catch {
      // Corrupt metadata — surface as empty tools rather than 500. The
      // caller will offer the operator a "Save with no tools" path.
    }
    return {
      status: row.status,
      agentId: row.agentId,
      serverId: parsed.serverId,
      tools: parsed.tools ?? [],
    };
  }

  /**
   * Mark an mcp_oauth credential as requiring re-authorization (sets
   * `metadata.needs_reauth = '1'`) and emit a `reauth_required` event so
   * the Gateway can dispatch a synthetic `[system] mcp_reauth_required`
   * into the originating agent session.
   *
   * Called when a runtime tool-call returns 401 / Unauthorized from an MCP
   * server, signalling that the stored token is no longer valid (revoked
   * at the AS, scope changed, etc.) and a fresh OAuth dance is needed.
   *
   * `agentSessionKey` is forwarded into the event so admin-initiated rows
   * (no session) can be distinguished from chat-initiated ones at the
   * subscriber. A null session key produces no synthetic dispatch.
   */
  async function markReauthRequired(args: {
    agentId: string;
    serverId: string;
    agentSessionKey?: string | null;
  }): Promise<void> {
    const service = `mcp:${args.serverId}`;
    try {
      const cred = await deps.credentials.get(
        { agentId: args.agentId, service },
        `mcp_runtime_401:${args.serverId}`,
      );
      if (cred.kind === 'mcp_oauth') {
        await deps.credentials.set(
          { agentId: args.agentId, service },
          {
            ...cred,
            metadata: { ...(cred.metadata ?? {}), needs_reauth: '1' },
          },
        );
      }
    } catch (err) {
      // Credential missing or unreadable — still emit the event so the
      // agent can surface the failure. The Gateway subscriber tolerates
      // a missing credential because the synthetic message itself is
      // informational.
      console.warn(
        `[mcp-onboarding] markReauthRequired: cannot persist needs_reauth for ${service}: ${(err as Error).message}`,
      );
    }
    events.emit('reauth_required', {
      pendingId: '',
      agentId: args.agentId,
      agentSessionKey: args.agentSessionKey ?? null,
      serverId: args.serverId,
    } satisfies OnboardingEvent);
  }

  /**
   * Cancel a pending row by `pendingId`. Used by the `connect_mcp` built-in
   * tool's `cancel` op so an agent can abort a flow it started but no
   * longer needs (e.g. the user changed their mind mid-OAuth).
   *
   * No event emission here: cancelling a chat-initiated row doesn't need a
   * synthetic `[system] mcp_connect_declined` because the agent invoking
   * this op already knows. (Provider-side denial flows through
   * `cancelByState` which DOES emit `cancelled`.)
   */
  function cancel(
    pendingId: string,
  ): { status: 'cancelled' | 'not_cancellable' | 'not_found' } {
    const row = deps.pending.byId(pendingId);
    if (!row) return { status: 'not_found' };
    if (row.status !== 'pending' && row.status !== 'exchanging') {
      return { status: 'not_cancellable' };
    }
    deps.pending.markCancelled(pendingId, 'user_cancelled');
    return { status: 'cancelled' };
  }

  // Gate the test-only debug surface so a stray production caller can't
  // contaminate the credential audit log with accessReason='test_debug'.
  // vitest sets NODE_ENV=test automatically; production runs do not.
  const _debug
    = process.env.NODE_ENV === 'test'
      ? {
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
        }
      : null;

  return {
    startConnection,
    attachApiKey,
    finalize,
    completeOAuth,
    getAuthUrlForPending,
    cancelByState,
    getPending,
    getPendingTools,
    cancel,
    markReauthRequired,
    events,
    _debug,
  };
}

/**
 * `tools/list` against an MCP server with no Authorization header. Used by
 * the `authMode === 'none'` branch of `startConnection` to discover tools
 * for open MCP servers (e.g. mcp.exa.ai) without ever issuing a
 * credential. Throws on non-OK HTTP so the caller can mark the pending row
 * `failed` with a useful reason. SSE responses are parsed via the first
 * `data:` event, matching the Streamable HTTP transport.
 */
async function listToolsNoAuth(
  mcpUrl: string,
): Promise<Array<{ name: string; description?: string }>> {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  });
  if (!res.ok) throw new Error(`tools_list_status_${res.status}`);
  const ct = (res.headers.get('Content-Type') ?? '').toLowerCase();
  if (ct.includes('text/event-stream')) {
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const env = JSON.parse(payload) as {
          result?: { tools?: Array<{ name: string; description?: string }> };
        };
        return env.result?.tools ?? [];
      } catch {
        continue;
      }
    }
    return [];
  }
  const body = (await res.json()) as {
    result?: { tools?: Array<{ name: string; description?: string }> };
  };
  return body.result?.tools ?? [];
}

