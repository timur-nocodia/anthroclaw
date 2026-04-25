import type { Agent } from '../agent/agent.js';
import type { AgentYml, GlobalConfig } from '../config/schema.js';
import { resolveSttTranscriptionConfig } from '../media/transcribe.js';

export type IntegrationCapabilityStatus = 'available' | 'missing_config' | 'disabled' | 'error';
export type IntegrationCapabilityRisk = 'low' | 'medium' | 'high';
export type IntegrationCapabilityKind = 'mcp_tool' | 'stt_provider';

export interface IntegrationCapability {
  id: string;
  kind: IntegrationCapabilityKind;
  provider: string;
  toolNames: string[];
  status: IntegrationCapabilityStatus;
  risk: IntegrationCapabilityRisk;
  costModel?: string;
  requiredConfig?: string[];
  permissionDefaults?: IntegrationPermissionDefaults;
  enabledForAgents: string[];
  selected?: boolean;
  configSnippet?: string;
  reason?: string;
}

export interface IntegrationPermissionDefaults {
  defaultBehavior: 'allow' | 'deny';
  allowMcp?: boolean;
  allowWeb?: boolean;
  allowBash?: boolean;
  allowedMcpTools?: string[];
  notes: string[];
}

export interface IntegrationCapabilityMatrix {
  generatedAt: number;
  capabilities: IntegrationCapability[];
}

interface CapabilityDefinition {
  id: string;
  kind: IntegrationCapabilityKind;
  provider: string;
  toolNames: string[];
  risk: IntegrationCapabilityRisk;
  costModel?: string;
  requiredConfig?: string[];
  permissionDefaults?: IntegrationPermissionDefaults;
  isConfigured?: (config: GlobalConfig, env: NodeJS.ProcessEnv) => boolean;
  isRequested?: (agent: AgentConfigCarrier) => boolean;
}

type AgentConfigCarrier = Pick<Agent, 'id' | 'config'> | { id: string; config: AgentYml };

const TOOL_DEFINITIONS: CapabilityDefinition[] = [
  {
    id: 'memory.core',
    kind: 'mcp_tool',
    provider: 'anthroclaw-memory',
    toolNames: ['memory_search', 'memory_write', 'memory_wiki'],
    risk: 'medium',
    permissionDefaults: {
      defaultBehavior: 'deny',
      allowMcp: true,
      allowedMcpTools: ['memory_search', 'memory_write', 'memory_wiki'],
      notes: ['Prefer exact MCP allowlists; memory_write and memory_wiki persist durable agent state.'],
    },
  },
  {
    id: 'sessions.search',
    kind: 'mcp_tool',
    provider: 'anthroclaw-sessions',
    toolNames: ['session_search'],
    risk: 'low',
    permissionDefaults: {
      defaultBehavior: 'deny',
      allowMcp: true,
      allowedMcpTools: ['session_search'],
      notes: ['Read-only recall tool; keep transcript content access scoped per agent.'],
    },
  },
  {
    id: 'notes.local',
    kind: 'mcp_tool',
    provider: 'anthroclaw-notes',
    toolNames: ['local_note_search'],
    risk: 'low',
    permissionDefaults: {
      defaultBehavior: 'deny',
      allowMcp: true,
      allowedMcpTools: ['local_note_search'],
      notes: ['Read-only search over workspace notes directories; does not expose arbitrary filesystem reads.'],
    },
  },
  {
    id: 'notes.proposals',
    kind: 'mcp_tool',
    provider: 'anthroclaw-notes',
    toolNames: ['local_note_propose'],
    risk: 'medium',
    permissionDefaults: {
      defaultBehavior: 'deny',
      allowMcp: true,
      allowedMcpTools: ['local_note_propose'],
      notes: ['Writes proposed notes under notes/review/ and keeps them pending until operator approval.'],
    },
  },
  {
    id: 'channels.messaging',
    kind: 'mcp_tool',
    provider: 'anthroclaw-channels',
    toolNames: ['send_message', 'send_media'],
    risk: 'high',
    requiredConfig: ['telegram.accounts or whatsapp.accounts'],
    permissionDefaults: {
      defaultBehavior: 'deny',
      allowMcp: true,
      allowedMcpTools: ['send_message', 'send_media'],
      notes: ['Outbound channel tools can message real users; enable only for agents that must send proactive replies.'],
    },
    isConfigured: (config) => Boolean(config.telegram?.accounts || config.whatsapp?.accounts),
  },
  {
    id: 'web.brave',
    kind: 'mcp_tool',
    provider: 'brave',
    toolNames: ['web_search_brave'],
    risk: 'medium',
    costModel: 'external_api',
    requiredConfig: ['brave.api_key'],
    permissionDefaults: {
      defaultBehavior: 'deny',
      allowMcp: true,
      allowedMcpTools: ['web_search_brave'],
      notes: ['External search provider; expect network egress and provider-side query logging.'],
    },
    isConfigured: (config) => Boolean(config.brave?.api_key),
  },
  {
    id: 'web.exa',
    kind: 'mcp_tool',
    provider: 'exa',
    toolNames: ['web_search_exa'],
    risk: 'medium',
    costModel: 'external_api',
    requiredConfig: ['exa.api_key'],
    permissionDefaults: {
      defaultBehavior: 'deny',
      allowMcp: true,
      allowedMcpTools: ['web_search_exa'],
      notes: ['External search provider; expect network egress and provider-side query logging.'],
    },
    isConfigured: (config) => Boolean(config.exa?.api_key),
  },
  {
    id: 'access.control',
    kind: 'mcp_tool',
    provider: 'anthroclaw-routing',
    toolNames: ['access_control'],
    risk: 'high',
    permissionDefaults: {
      defaultBehavior: 'deny',
      allowMcp: true,
      allowedMcpTools: ['access_control'],
      notes: ['Can change routing authorization state; keep operator-visible audit enabled.'],
    },
  },
  {
    id: 'skills.local',
    kind: 'mcp_tool',
    provider: 'anthroclaw-skills',
    toolNames: ['list_skills', 'manage_skills'],
    risk: 'high',
    permissionDefaults: {
      defaultBehavior: 'deny',
      allowMcp: true,
      allowedMcpTools: ['list_skills'],
      notes: ['Do not enable manage_skills by default; it can modify local agent behavior.'],
    },
  },
  {
    id: 'cron.manage',
    kind: 'mcp_tool',
    provider: 'anthroclaw-cron',
    toolNames: ['manage_cron'],
    risk: 'high',
    permissionDefaults: {
      defaultBehavior: 'deny',
      allowMcp: true,
      allowedMcpTools: [],
      notes: ['Operator review recommended before enabling scheduled task mutation.'],
    },
  },
];

const STT_DEFINITIONS: CapabilityDefinition[] = [
  {
    id: 'stt.assemblyai',
    kind: 'stt_provider',
    provider: 'assemblyai',
    toolNames: [],
    risk: 'medium',
    costModel: 'external_api',
    requiredConfig: ['stt.assemblyai.api_key or assemblyai.api_key'],
    permissionDefaults: {
      defaultBehavior: 'deny',
      notes: ['STT runs before SDK query execution; it is not exposed as an SDK MCP tool.'],
    },
    isConfigured: (config) => Boolean(config.stt?.assemblyai?.api_key ?? config.assemblyai?.api_key),
    isRequested: () => true,
  },
  {
    id: 'stt.openai',
    kind: 'stt_provider',
    provider: 'openai',
    toolNames: [],
    risk: 'medium',
    costModel: 'external_api',
    requiredConfig: ['stt.openai.api_key or OPENAI_API_KEY'],
    permissionDefaults: {
      defaultBehavior: 'deny',
      notes: ['STT runs before SDK query execution; it is not exposed as an SDK MCP tool.'],
    },
    isConfigured: (config, env) => Boolean(config.stt?.openai?.api_key ?? env.OPENAI_API_KEY),
    isRequested: () => true,
  },
  {
    id: 'stt.elevenlabs',
    kind: 'stt_provider',
    provider: 'elevenlabs',
    toolNames: [],
    risk: 'medium',
    costModel: 'external_api',
    requiredConfig: ['stt.elevenlabs.api_key or ELEVENLABS_API_KEY'],
    permissionDefaults: {
      defaultBehavior: 'deny',
      notes: ['STT runs before SDK query execution; it is not exposed as an SDK MCP tool.'],
    },
    isConfigured: (config, env) => Boolean(config.stt?.elevenlabs?.api_key ?? env.ELEVENLABS_API_KEY),
    isRequested: () => true,
  },
];

interface ExternalMcpPresetDefinition {
  id: string;
  provider: string;
  serverName: string;
  command: string;
  args: string[];
  toolNames: string[];
  requiredEnv: string[];
  risk: IntegrationCapabilityRisk;
  notes: string[];
}

const EXTERNAL_MCP_PRESETS: ExternalMcpPresetDefinition[] = [
  {
    id: 'google.calendar',
    provider: 'google-calendar',
    serverName: 'calendar',
    command: 'npx',
    args: ['google-calendar-mcp'],
    toolNames: [
      'calendar_daily_brief',
      'calendar_availability',
      'calendar_event_lookup',
      'calendar_meeting_prep',
    ],
    requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
    risk: 'medium',
    notes: ['Personal calendar access; use exact tool allowlists and keep Google OAuth credentials in env/config secrets.'],
  },
  {
    id: 'google.gmail',
    provider: 'gmail',
    serverName: 'gmail',
    command: 'npx',
    args: ['gmail-mcp'],
    toolNames: ['gmail_search', 'gmail_thread_summary', 'gmail_draft_reply'],
    requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
    risk: 'high',
    notes: ['Mailbox access and draft creation; prefer read-only tools unless the agent explicitly drafts replies.'],
  },
];

export function buildIntegrationCapabilityMatrix(
  config: GlobalConfig,
  agents: AgentConfigCarrier[] = [],
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): IntegrationCapabilityMatrix {
  const selectedSttProvider = resolveSttTranscriptionConfig(config, env)?.provider;
  const builtinCapabilities = [...TOOL_DEFINITIONS, ...STT_DEFINITIONS].map((definition) => {
    const enabledForAgents = agents
      .filter((agent) => isCapabilityRequested(definition, agent))
      .map((agent) => agent.id)
      .sort();
    const configured = definition.isConfigured ? definition.isConfigured(config, env) : true;
    const requested = definition.kind === 'stt_provider' || enabledForAgents.length > 0;
    const status = resolveCapabilityStatus(definition, requested, configured);
    const selected = definition.kind === 'stt_provider'
      && definition.provider === selectedSttProvider
      && status === 'available';

    return {
      id: definition.id,
      kind: definition.kind,
      provider: definition.provider,
      toolNames: [...definition.toolNames],
      status,
      risk: definition.risk,
      costModel: definition.costModel,
      requiredConfig: definition.requiredConfig ? [...definition.requiredConfig] : undefined,
      permissionDefaults: clonePermissionDefaults(definition.permissionDefaults),
      enabledForAgents,
      selected,
      configSnippet: buildCapabilityConfigSnippet(definition.toolNames, definition.permissionDefaults, true),
      reason: capabilityReason(definition, status, requested, selected),
    };
  });

  return {
    generatedAt: now,
    capabilities: [
      ...builtinCapabilities,
      ...buildExternalMcpPresetCapabilities(agents),
      ...buildExternalMcpCapabilities(agents),
    ],
  };
}

function buildExternalMcpPresetCapabilities(agents: AgentConfigCarrier[]): IntegrationCapability[] {
  return EXTERNAL_MCP_PRESETS.map((preset) => {
    const matches = agents.flatMap((agent) => findExternalPresetMatches(agent, preset));
    const enabledForAgents = [...new Set(matches.map((match) => match.agentId))].sort();
    const configuredToolNames = [...new Set(matches.flatMap((match) => match.toolNames))].sort();
    const missingEnv = [...new Set(matches.flatMap((match) => match.missingEnv))].sort();
    const configured = matches.length > 0;
    const status: IntegrationCapabilityStatus = !configured
      ? 'disabled'
      : missingEnv.length > 0
        ? 'missing_config'
        : 'available';

    return {
      id: preset.id,
      kind: 'mcp_tool',
      provider: preset.provider,
      toolNames: configuredToolNames.length > 0 ? configuredToolNames : [...preset.toolNames],
      status,
      risk: preset.risk,
      costModel: 'external_mcp',
      requiredConfig: preset.requiredEnv.map((key) => `external_mcp_servers.${preset.serverName}.env.${key}`),
      permissionDefaults: {
        defaultBehavior: 'deny',
        allowMcp: true,
        allowedMcpTools: configuredToolNames,
        notes: [...preset.notes],
      },
      enabledForAgents,
      configSnippet: buildExternalPresetConfigSnippet(preset, configuredToolNames),
      reason: externalPresetReason(preset, status, missingEnv),
    };
  });
}

function findExternalPresetMatches(
  agent: AgentConfigCarrier,
  preset: ExternalMcpPresetDefinition,
): Array<{ agentId: string; toolNames: string[]; missingEnv: string[] }> {
  const out: Array<{ agentId: string; toolNames: string[]; missingEnv: string[] }> = [];
  const presetTools = new Set(preset.toolNames);

  for (const [serverName, server] of Object.entries(agent.config.external_mcp_servers ?? {})) {
    const allowedTools = server.allowed_tools ?? [];
    const matchedTools = allowedTools.filter((toolName) => presetTools.has(toolName));
    const nameMatches = serverName === preset.serverName || serverName.startsWith(`${preset.serverName}-`);
    if (matchedTools.length === 0 && !nameMatches) continue;

    const env = 'env' in server ? server.env : undefined;
    const missingEnv = preset.requiredEnv.filter((key) => !env?.[key]?.trim());
    const selectedTools = matchedTools.length > 0 ? matchedTools : preset.toolNames;
    out.push({
      agentId: agent.id,
      toolNames: selectedTools.map((toolName) => `mcp__${serverName}__${toolName}`),
      missingEnv,
    });
  }

  return out;
}

function buildExternalMcpCapabilities(agents: AgentConfigCarrier[]): IntegrationCapability[] {
  const byServer = new Map<string, {
    toolNames: Set<string>;
    enabledForAgents: Set<string>;
    risk: IntegrationCapabilityRisk;
  }>();

  for (const agent of agents) {
    for (const [serverName, server] of Object.entries(agent.config.external_mcp_servers ?? {})) {
      const entry = byServer.get(serverName) ?? {
        toolNames: new Set<string>(),
        enabledForAgents: new Set<string>(),
        risk: 'medium' as IntegrationCapabilityRisk,
      };
      entry.enabledForAgents.add(agent.id);
      for (const toolName of server.allowed_tools ?? []) {
        entry.toolNames.add(`mcp__${serverName}__${toolName}`);
      }
      if ('env' in server && server.env && Object.keys(server.env).some((key) => /(API|KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|CLIENT)/i.test(key))) {
        entry.risk = 'high';
      }
      if ('headers' in server && server.headers && Object.keys(server.headers).some((key) => /AUTH|TOKEN|KEY|SECRET/i.test(key))) {
        entry.risk = 'high';
      }
      byServer.set(serverName, entry);
    }
  }

  return [...byServer.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([serverName, entry]) => ({
      id: `external_mcp.${serverName}`,
      kind: 'mcp_tool',
      provider: serverName,
      toolNames: [...entry.toolNames].sort(),
      status: 'available',
      risk: entry.risk,
      costModel: 'external_mcp',
      permissionDefaults: {
        defaultBehavior: 'deny',
        allowMcp: true,
        allowedMcpTools: [...entry.toolNames].sort(),
        notes: ['External MCP server configured on one or more agents; review MCP preflight before enabling in production.'],
      },
      enabledForAgents: [...entry.enabledForAgents].sort(),
      configSnippet: buildCapabilityConfigSnippet(
        [...entry.toolNames].sort(),
        {
          defaultBehavior: 'deny',
          allowMcp: true,
          allowedMcpTools: [...entry.toolNames].sort(),
          notes: [],
        },
        false,
      ),
      reason: 'External MCP server is configured in agent.yml and passed through Claude Agent SDK mcpServers.',
    }));
}

function buildCapabilityConfigSnippet(
  toolNames: readonly string[],
  defaults: IntegrationPermissionDefaults | undefined,
  includeMcpTools: boolean,
): string | undefined {
  if (!defaults?.allowMcp || toolNames.length === 0) return undefined;

  const localTools = toolNames.map((toolName) => toolName.split('__').at(-1) ?? toolName).sort();
  const allowedTools = (defaults.allowedMcpTools ?? [])
    .sort();

  return [
    ...(includeMcpTools
      ? [
          'mcp_tools:',
          ...localTools.map((toolName) => `  - ${toolName}`),
        ]
      : ['# external_mcp_servers already defines the MCP server and allowed tools']),
    'sdk:',
    '  permissions:',
    `    default_behavior: ${defaults.defaultBehavior}`,
    '    allow_mcp: true',
    '    allowed_mcp_tools:',
    ...(allowedTools.length > 0
      ? allowedTools.map((toolName) => `      - ${toolName}`)
      : ['      # operator review required before enabling this capability']),
  ].join('\n');
}

function buildExternalPresetConfigSnippet(
  preset: ExternalMcpPresetDefinition,
  configuredToolNames: readonly string[],
): string {
  const allowedTools = configuredToolNames.length > 0
    ? [...configuredToolNames].sort()
    : preset.toolNames.map((toolName) => `mcp__${preset.serverName}__${toolName}`);

  return [
    'external_mcp_servers:',
    `  ${preset.serverName}:`,
    '    type: stdio',
    `    command: ${preset.command}`,
    '    args:',
    ...preset.args.map((arg) => `      - ${arg}`),
    '    env:',
    ...preset.requiredEnv.map((key) => `      ${key}: ""`),
    '    allowed_tools:',
    ...preset.toolNames.map((toolName) => `      - ${toolName}`),
    'sdk:',
    '  permissions:',
    '    default_behavior: deny',
    '    allow_mcp: true',
    '    allowed_mcp_tools:',
    ...allowedTools.map((toolName) => `      - ${toolName}`),
  ].join('\n');
}

function externalPresetReason(
  preset: ExternalMcpPresetDefinition,
  status: IntegrationCapabilityStatus,
  missingEnv: readonly string[],
): string {
  if (status === 'disabled') {
    return `${preset.provider} preset is not configured on any loaded agent yet.`;
  }
  if (status === 'missing_config') {
    return `Configured preset is missing required env: ${missingEnv.join(', ')}`;
  }
  return `${preset.provider} MCP preset is configured and exposed through Claude Agent SDK mcpServers.`;
}

function clonePermissionDefaults(
  defaults: IntegrationPermissionDefaults | undefined,
): IntegrationPermissionDefaults | undefined {
  if (!defaults) return undefined;
  return {
    ...defaults,
    allowedMcpTools: defaults.allowedMcpTools ? [...defaults.allowedMcpTools] : undefined,
    notes: [...defaults.notes],
  };
}

function isCapabilityRequested(definition: CapabilityDefinition, agent: AgentConfigCarrier): boolean {
  if (definition.isRequested) return definition.isRequested(agent);
  const requestedTools = new Set(agent.config.mcp_tools ?? []);
  return definition.toolNames.some((toolName) => requestedTools.has(toolName));
}

function resolveCapabilityStatus(
  definition: CapabilityDefinition,
  requested: boolean,
  configured: boolean,
): IntegrationCapabilityStatus {
  if (!requested) return 'disabled';
  if (!configured && definition.requiredConfig?.length) return 'missing_config';
  return 'available';
}

function capabilityReason(
  definition: CapabilityDefinition,
  status: IntegrationCapabilityStatus,
  requested: boolean,
  selected = false,
): string | undefined {
  if (status === 'disabled') return 'No loaded agent currently enables this capability.';
  if (status === 'missing_config') {
    return `Missing required configuration: ${(definition.requiredConfig ?? []).join(', ')}`;
  }
  if (selected) {
    return 'Provider is selected for inbound media transcription by current STT config.';
  }
  if (definition.kind === 'stt_provider' && requested) {
    return 'Provider can transcribe inbound media before SDK query execution.';
  }
  return undefined;
}
