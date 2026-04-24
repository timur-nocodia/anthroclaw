import type { AgentDefinition, Options } from '@anthropic-ai/claude-agent-sdk';
import type { SessionStore } from '@anthropic-ai/claude-agent-sdk';
import type { Agent } from '../agent/agent.js';
import type { HookEmitter } from '../hooks/emitter.js';
import { buildSdkHookBridge, mergeSdkHooks } from './hooks.js';
import {
  buildAllowedTools,
  buildPermissionHooks,
  createCanUseTool,
  type FileOwnershipPermissionHooks,
} from './permissions.js';
import { normalizeSandboxSettings } from './sandbox.js';

export interface BuildSdkOptionsParams {
  agent: Agent;
  resume?: string;
  subagents?: Record<string, AgentDefinition>;
  trustedBypass?: boolean;
  includeMcpServer?: boolean;
  hookEmitter?: HookEmitter;
  sessionStore?: SessionStore;
  loadTimeoutMs?: number;
  fileOwnership?: FileOwnershipPermissionHooks;
}

export function buildSdkOptions(params: BuildSdkOptionsParams): Options {
  const { agent, resume, subagents, trustedBypass = false, includeMcpServer = true } = params;
  const cfg = agent.config.sdk;
  const hasSubagents = Boolean(subagents && Object.keys(subagents).length > 0);
  const options: Options = {
    model: agent.config.model ?? 'claude-sonnet-4-6',
    cwd: agent.workspacePath,
    thinking: agent.config.thinking,
    effort: agent.config.effort,
    maxTurns: agent.config.maxTurns,
    maxBudgetUsd: agent.config.maxBudgetUsd,
    fallbackModel: cfg?.fallbackModel,
    promptSuggestions: cfg?.promptSuggestions,
    agentProgressSummaries: cfg?.agentProgressSummaries,
    includePartialMessages: cfg?.includePartialMessages,
    includeHookEvents: cfg?.includeHookEvents,
    enableFileCheckpointing: cfg?.enableFileCheckpointing,
    sandbox: normalizeSandboxSettings(cfg?.sandbox),
    settingSources: ['project'],
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: true,
    },
    sessionStore: params.sessionStore,
    loadTimeoutMs: params.loadTimeoutMs,
  };

  if (includeMcpServer) {
    options.mcpServers = { [agent.mcpServer.name]: agent.mcpServer };
  }

  if (subagents) {
    options.agents = subagents;
  }

  if (resume) {
    options.resume = resume;
  }

  if (cfg?.disallowedTools && cfg.disallowedTools.length > 0) {
    options.disallowedTools = cfg.disallowedTools;
  }

  if (trustedBypass) {
    options.permissionMode = 'bypassPermissions';
    options.allowDangerouslySkipPermissions = true;
    return options;
  }

  const allowedTools = buildAllowedTools(agent, hasSubagents);
  options.allowedTools = allowedTools;
  options.permissionMode = cfg?.permissions?.mode ?? 'default';
  options.hooks = mergeSdkHooks(
    buildPermissionHooks(agent, params.fileOwnership),
    buildSdkHookBridge({ agentId: agent.id, emitter: params.hookEmitter }),
  );
  options.canUseTool = createCanUseTool(agent, new Set(allowedTools));

  return options;
}
