import type { Agent } from '../agent/agent.js';
import type { AgentYml, GlobalConfig } from '../config/schema.js';

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
    requiredConfig: ['assemblyai.api_key'],
    permissionDefaults: {
      defaultBehavior: 'deny',
      notes: ['STT runs before SDK query execution; it is not exposed as an SDK MCP tool.'],
    },
    isConfigured: (config) => Boolean(config.assemblyai?.api_key),
    isRequested: () => true,
  },
  {
    id: 'stt.openai',
    kind: 'stt_provider',
    provider: 'openai',
    toolNames: [],
    risk: 'medium',
    costModel: 'external_api',
    requiredConfig: ['OPENAI_API_KEY'],
    permissionDefaults: {
      defaultBehavior: 'deny',
      notes: ['STT runs before SDK query execution; it is not exposed as an SDK MCP tool.'],
    },
    isConfigured: (_config, env) => Boolean(env.OPENAI_API_KEY),
    isRequested: () => true,
  },
  {
    id: 'stt.elevenlabs',
    kind: 'stt_provider',
    provider: 'elevenlabs',
    toolNames: [],
    risk: 'medium',
    costModel: 'external_api',
    requiredConfig: ['ELEVENLABS_API_KEY'],
    permissionDefaults: {
      defaultBehavior: 'deny',
      notes: ['STT runs before SDK query execution; it is not exposed as an SDK MCP tool.'],
    },
    isConfigured: (_config, env) => Boolean(env.ELEVENLABS_API_KEY),
    isRequested: () => true,
  },
];

export function buildIntegrationCapabilityMatrix(
  config: GlobalConfig,
  agents: AgentConfigCarrier[] = [],
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): IntegrationCapabilityMatrix {
  return {
    generatedAt: now,
    capabilities: [...TOOL_DEFINITIONS, ...STT_DEFINITIONS].map((definition) => {
      const enabledForAgents = agents
        .filter((agent) => isCapabilityRequested(definition, agent))
        .map((agent) => agent.id)
        .sort();
      const configured = definition.isConfigured ? definition.isConfigured(config, env) : true;
      const requested = definition.kind === 'stt_provider' || enabledForAgents.length > 0;
      const status = resolveCapabilityStatus(definition, requested, configured);

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
        reason: capabilityReason(definition, status, requested),
      };
    }),
  };
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
): string | undefined {
  if (status === 'disabled') return 'No loaded agent currently enables this capability.';
  if (status === 'missing_config') {
    return `Missing required configuration: ${(definition.requiredConfig ?? []).join(', ')}`;
  }
  if (definition.kind === 'stt_provider' && requested) {
    return 'Provider can transcribe inbound media before SDK query execution.';
  }
  return undefined;
}
