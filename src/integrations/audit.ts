export interface IntegrationToolClassification {
  capabilityId: string;
  provider: string;
  localToolName: string;
}

const TOOL_CAPABILITIES: Record<string, { capabilityId: string; provider: string }> = {
  memory_search: { capabilityId: 'memory.core', provider: 'anthroclaw-memory' },
  memory_write: { capabilityId: 'memory.core', provider: 'anthroclaw-memory' },
  memory_wiki: { capabilityId: 'memory.core', provider: 'anthroclaw-memory' },
  session_search: { capabilityId: 'sessions.search', provider: 'anthroclaw-sessions' },
  send_message: { capabilityId: 'channels.messaging', provider: 'anthroclaw-channels' },
  send_media: { capabilityId: 'channels.messaging', provider: 'anthroclaw-channels' },
  web_search_brave: { capabilityId: 'web.brave', provider: 'brave' },
  web_search_exa: { capabilityId: 'web.exa', provider: 'exa' },
  access_control: { capabilityId: 'access.control', provider: 'anthroclaw-routing' },
  list_skills: { capabilityId: 'skills.local', provider: 'anthroclaw-skills' },
  manage_skills: { capabilityId: 'skills.local', provider: 'anthroclaw-skills' },
  manage_cron: { capabilityId: 'cron.manage', provider: 'anthroclaw-cron' },
};

export function classifyIntegrationToolName(toolName: string): IntegrationToolClassification | undefined {
  const localToolName = toolName.split('__').at(-1) ?? toolName;
  const match = TOOL_CAPABILITIES[localToolName];
  if (!match) {
    const external = classifyExternalMcpToolName(toolName);
    if (external) return external;
    return undefined;
  }
  return {
    ...match,
    localToolName,
  };
}

function classifyExternalMcpToolName(toolName: string): IntegrationToolClassification | undefined {
  const parts = toolName.split('__');
  if (parts.length < 3 || parts[0] !== 'mcp') return undefined;
  const serverName = parts[1];
  const localToolName = parts.slice(2).join('__');
  if (!serverName || !localToolName || serverName.endsWith('-tools')) return undefined;
  return {
    capabilityId: `external_mcp.${serverName}`,
    provider: serverName,
    localToolName,
  };
}
