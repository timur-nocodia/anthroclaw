import type { AgentMcpServerSpec, McpHttpServerConfig, McpSSEServerConfig, McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { AgentYml } from '../config/schema.js';
import type { CredentialStore, StoredCredential } from '../agent/credentials/index.js';

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
