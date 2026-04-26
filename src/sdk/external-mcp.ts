import type { AgentMcpServerSpec, McpHttpServerConfig, McpSSEServerConfig, McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { AgentYml } from '../config/schema.js';

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
