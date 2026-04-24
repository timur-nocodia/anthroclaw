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
  enabledForAgents: string[];
  reason?: string;
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
  },
  {
    id: 'sessions.search',
    kind: 'mcp_tool',
    provider: 'anthroclaw-sessions',
    toolNames: ['session_search'],
    risk: 'low',
  },
  {
    id: 'channels.messaging',
    kind: 'mcp_tool',
    provider: 'anthroclaw-channels',
    toolNames: ['send_message', 'send_media'],
    risk: 'high',
    requiredConfig: ['telegram.accounts or whatsapp.accounts'],
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
    isConfigured: (config) => Boolean(config.exa?.api_key),
  },
  {
    id: 'access.control',
    kind: 'mcp_tool',
    provider: 'anthroclaw-routing',
    toolNames: ['access_control'],
    risk: 'high',
  },
  {
    id: 'skills.local',
    kind: 'mcp_tool',
    provider: 'anthroclaw-skills',
    toolNames: ['list_skills', 'manage_skills'],
    risk: 'high',
  },
  {
    id: 'cron.manage',
    kind: 'mcp_tool',
    provider: 'anthroclaw-cron',
    toolNames: ['manage_cron'],
    risk: 'high',
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
        enabledForAgents,
        reason: capabilityReason(definition, status, requested),
      };
    }),
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
