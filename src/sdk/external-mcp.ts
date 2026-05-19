import type { AgentMcpServerSpec, McpHttpServerConfig, McpSSEServerConfig, McpStdioServerConfig } from '@anthroclaw/legacy-claude-agent-sdk';
import type { AgentYml } from '../config/schema.js';
import type { CredentialStore, StoredCredential, McpOAuthCredential } from '../agent/credentials/index.js';
import { refreshToken } from '../integrations/mcp-onboarding/oauth-client.js';

type ExternalMcpServers = NonNullable<AgentYml['external_mcp_servers']>;
type ExternalMcpServer = ExternalMcpServers[string];
type ExternalSdkMcpServerConfig = McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig;

export function buildExternalMcpServerSpec(
  servers: ExternalMcpServers | undefined,
): Record<string, ExternalSdkMcpServerConfig> {
  if (!servers) return {};
  return Object.fromEntries(
    Object.entries(servers).map(([serverName, server]) => [serverName, toSdkMcpServerConfig(server)]),
  );
}

export function buildExternalMcpToolNames(
  servers: ExternalMcpServers | undefined,
): string[] {
  if (!servers) return [];
  return Object.entries(servers).flatMap(([serverName, server]) => (
    (server.allowed_tools ?? []).map((toolName) => `mcp__${serverName}__${toolName}`)
  ));
}

export function buildExternalMcpToolNamesByServer(
  servers: ExternalMcpServers | undefined,
): Record<string, string[]> {
  if (!servers) return {};
  return Object.fromEntries(
    Object.entries(servers).map(([serverName, server]) => [serverName, [...(server.allowed_tools ?? [])]]),
  );
}

export function hasExternalMcpServers(servers: ExternalMcpServers | undefined): boolean {
  return Boolean(servers && Object.keys(servers).length > 0);
}

export function asAgentMcpServerSpec(
  servers: ExternalMcpServers | undefined,
): AgentMcpServerSpec {
  return buildExternalMcpServerSpec(servers) as AgentMcpServerSpec;
}

/**
 * Materialize `credential_ref` entries in an `external_mcp_servers` spec by
 * loading the referenced credential and injecting an `Authorization` header.
 *
 * Failure modes:
 *   - Entry without `credential_ref` → passes through unchanged.
 *   - `credential_ref` resolves but credential kind is unrecognised → entry
 *     is OMITTED from the output (gateway will surface a notification).
 *   - Credential store throws (missing / decrypt error) → entry omitted.
 *
 * Header merge rule: user-provided `headers` are kept; we then SET the
 * `Authorization` key, so the materialized credential wins over any literal
 * Authorization header. The schema's `superRefine` already forbids combining
 * both at config-validation time, but this defence-in-depth ensures a
 * post-hoc edit can't silently break auth.
 */
/** Window before `expiresAt` in which we proactively refresh OAuth tokens. */
const OAUTH_REFRESH_WINDOW_MS = 5 * 60_000;

export async function resolveExternalMcpHeaders(
  spec: ExternalMcpServers | undefined,
  store: CredentialStore,
  ctx: { agentId: string },
): Promise<ExternalMcpServers> {
  if (!spec) return {};
  const out: Record<string, ExternalMcpServer> = {};
  for (const [name, entry] of Object.entries(spec)) {
    if ((entry.type === 'http' || entry.type === 'sse') && entry.credential_ref) {
      let cred: StoredCredential;
      try {
        cred = await store.get(
          { agentId: ctx.agentId, service: entry.credential_ref },
          `mcp_load:${name}`,
        );
      } catch {
        // Credential missing or unreadable — omit so the SDK doesn't wire up
        // a half-configured server. Surface is left to the caller.
        continue;
      }

      // Pre-flight refresh for OAuth credentials that are close to expiry.
      // mcp_apikey tokens are static, so they never enter this branch.
      if (cred.kind === 'mcp_oauth' && needsRefresh(cred)) {
        const refreshed = await tryRefreshOAuthCredential(
          cred,
          store,
          { agentId: ctx.agentId, service: entry.credential_ref },
        );
        if (!refreshed) {
          // refresh_revoked or generic failure — omit this entry (same as
          // a resolver failure). On revoke the credential gets
          // `metadata.needs_reauth = '1'` inside the helper; on transient
          // failure we leave the credential as-is so a future call can retry.
          continue;
        }
        cred = refreshed;
      }

      const header = headerFromCredential(cred);
      if (!header) continue;
      out[name] = {
        ...entry,
        headers: {
          ...(entry.headers ?? {}),
          Authorization: header,
        },
      };
    } else {
      out[name] = entry;
    }
  }
  return out as ExternalMcpServers;
}

function needsRefresh(cred: McpOAuthCredential): boolean {
  if (typeof cred.expiresAt !== 'number') return false;
  if (!cred.refreshToken || !cred.tokenEndpoint || !cred.clientId) return false;
  return cred.expiresAt < Date.now() + OAUTH_REFRESH_WINDOW_MS;
}

/**
 * Attempt to refresh an mcp_oauth credential whose access token is about to
 * expire. Returns the updated credential on success, or `null` when the
 * caller should omit the MCP entry (revoked refresh token, or transient
 * failure).
 *
 * On `refresh_revoked` we persist `metadata.needs_reauth = '1'` so the UI
 * can surface a "re-authorize" banner without first hitting the live server.
 * On other failures (network blip, 5xx from the AS) we leave the credential
 * untouched — a later call will retry.
 */
async function tryRefreshOAuthCredential(
  cred: McpOAuthCredential,
  store: CredentialStore,
  ref: { agentId: string; service: string },
): Promise<McpOAuthCredential | null> {
  try {
    const fresh = await refreshToken({
      tokenEndpoint: cred.tokenEndpoint!,
      clientId: cred.clientId!,
      clientSecret: cred.clientSecret,
      refreshToken: cred.refreshToken!,
    });
    const updated: McpOAuthCredential = {
      ...cred,
      accessToken: fresh.accessToken,
      refreshToken: fresh.refreshToken ?? cred.refreshToken,
      expiresAt: fresh.expiresAt,
      lastRefreshAt: Date.now(),
    };
    // Clear any prior needs_reauth flag — we just got a fresh token.
    if (updated.metadata?.needs_reauth) {
      const { needs_reauth: _drop, ...rest } = updated.metadata;
      updated.metadata = Object.keys(rest).length > 0 ? rest : undefined;
    }
    await store.set(ref, updated);
    return updated;
  } catch (err) {
    const message = (err as Error).message ?? '';
    if (message === 'refresh_revoked') {
      const flagged: McpOAuthCredential = {
        ...cred,
        metadata: { ...(cred.metadata ?? {}), needs_reauth: '1' },
      };
      try {
        await store.set(ref, flagged);
      } catch (writeErr) {
        // Persisting the flag is best-effort; log but don't throw so a
        // disk hiccup doesn't blow up the entire MCP wire-up.
        console.warn(
          `[external-mcp] failed to persist needs_reauth flag for ${ref.service}: ${(writeErr as Error).message}`,
        );
      }
      return null;
    }
    // Transient failure (5xx, network) — log and skip the entry. Do NOT
    // mark needs_reauth, so the next call can retry once the AS recovers.
    console.warn(
      `[external-mcp] OAuth refresh failed for ${ref.service}: ${message || 'unknown_error'}`,
    );
    return null;
  }
}

function headerFromCredential(cred: StoredCredential): string | null {
  if (cred.kind === 'mcp_apikey') return `${cred.scheme ?? 'Bearer'} ${cred.token}`;
  if (cred.kind === 'mcp_oauth') return `Bearer ${cred.accessToken}`;
  if (cred.kind === 'oauth' || cred.kind === undefined) return `Bearer ${cred.accessToken}`;
  return null;
}

function toSdkMcpServerConfig(server: ExternalMcpServer): ExternalSdkMcpServerConfig {
  if (server.type === 'sse' || server.type === 'http') {
    return {
      type: server.type,
      url: server.url,
      ...(server.headers ? { headers: { ...server.headers } } : {}),
    };
  }

  return {
    type: 'stdio',
    command: server.command,
    ...(server.args ? { args: [...server.args] } : {}),
    ...(server.env ? { env: { ...server.env } } : {}),
  };
}
