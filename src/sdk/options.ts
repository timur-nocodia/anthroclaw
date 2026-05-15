import type { AgentDefinition, OnElicitation, Options } from '@anthropic-ai/claude-agent-sdk';
import type { SessionStore } from '@anthropic-ai/claude-agent-sdk';
import type { Agent } from '../agent/agent.js';
import type { HookEmitter } from '../hooks/emitter.js';
import { buildSdkHookBridge, mergeSdkHooks } from './hooks.js';
import { composeSystemPrompt } from './system-prompt.js';
import {
  buildAllowedTools,
  buildPermissionHooks,
  createCanUseTool,
  type FileOwnershipPermissionHooks,
} from './permissions.js';
import { buildExternalMcpServerSpec } from './external-mcp.js';
import type { AgentYml } from '../config/schema.js';
import { applyCutoffOptions } from './cutoff.js';
import { normalizeSandboxSettings } from './sandbox.js';
import { ApprovalBroker } from '../security/approval-broker.js';
import type { ChannelAdapter } from '../channels/types.js';
import type { SandboxDefaults } from '../security/profiles/types.js';
import type { SdkSandboxConfig } from '../config/schema.js';
import { HARNESS_BLOCKLIST } from '../security/harness-blocklist.js';
import {
  buildClaudeAiDenyRules,
  buildClaudeAiDeniedMcpServers,
} from '../security/claude-ai-blocklist.js';

/**
 * Merges profile sandbox defaults with agent-level overrides.
 * Agent yml values always win; profile fills in missing defaults.
 */
function applySandboxProfile(
  profile: SandboxDefaults,
  agentSandbox: SdkSandboxConfig | undefined,
): SdkSandboxConfig {
  return {
    enabled: agentSandbox?.enabled ?? profile.enabled,
    allowUnsandboxedCommands: agentSandbox?.allowUnsandboxedCommands ?? profile.allowUnsandboxedCommands,
    // Spread remaining agent-level fields so nothing is lost
    ...agentSandbox,
  };
}

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
  onElicitation?: OnElicitation;
  modelOverride?: string;
  /** Required for profile-aware canUseTool with interactive approval. */
  approvalBroker?: ApprovalBroker;
  channel?: ChannelAdapter;
  sessionContext?: { channel?: string; peerId: string; senderId?: string; accountId?: string; threadId?: string };
  /**
   * Pre-resolved `external_mcp_servers` block (typically the agent's spec
   * after running it through `resolveExternalMcpHeaders`). When supplied,
   * overrides `agent.config.external_mcp_servers` for the purpose of wiring
   * `options.mcpServers`. Other consumers of the agent's config (preflight,
   * etc.) continue to read the raw spec, which is what we want — only the
   * wire-up needs materialized auth headers.
   */
  externalMcpServersOverride?: AgentYml['external_mcp_servers'];
}

export function buildSdkOptions(params: BuildSdkOptionsParams): Options {
  const { agent, resume, subagents, trustedBypass = false, includeMcpServer = true, modelOverride } = params;
  const cfg = agent.config.sdk;
  const hasSubagents = Boolean(subagents && Object.keys(subagents).length > 0);
  const profile = agent.safetyProfile;

  const systemPrompt = composeSystemPrompt(agent, profile);

  const options: Options = {
    model: modelOverride ?? agent.config.model ?? 'claude-sonnet-4-6',
    cwd: agent.workspacePath,
    thinking: agent.config.thinking,
    effort: agent.config.effort,
    maxTurns: agent.config.maxTurns,
    maxBudgetUsd: agent.config.maxBudgetUsd,
    fallbackModel: cfg?.fallbackModel,
    promptSuggestions: cfg?.promptSuggestions ?? true,
    agentProgressSummaries: cfg?.agentProgressSummaries ?? true,
    includePartialMessages: cfg?.includePartialMessages ?? true,
    includeHookEvents: cfg?.includeHookEvents,
    enableFileCheckpointing: cfg?.enableFileCheckpointing,
    sandbox: normalizeSandboxSettings(applySandboxProfile(profile.sandboxDefaults, cfg?.sandbox)),
    settingSources: profile.settingSources,
    systemPrompt,
    sessionStore: params.sessionStore,
    loadTimeoutMs: params.loadTimeoutMs,
    onElicitation: params.onElicitation,
  };

  if (includeMcpServer) {
    const externalSpec
      = params.externalMcpServersOverride !== undefined
        ? params.externalMcpServersOverride
        : agent.config.external_mcp_servers;
    options.mcpServers = {
      [agent.mcpServer.name]: agent.mcpServer,
      ...buildExternalMcpServerSpec(externalSpec),
    };
  }

  if (subagents) {
    options.agents = subagents;
  }

  if (resume) {
    options.resume = resume;
  }

  // Always block harness primitives that conflict with our runtime
  // (RemoteTrigger/CronCreate/TodoWrite/etc.). User can extend with
  // sdk.disallowedTools per agent. See src/security/harness-blocklist.ts.
  options.disallowedTools = [
    ...HARNESS_BLOCKLIST,
    ...(cfg?.disallowedTools ?? []),
  ];

  // Strip `mcp__claude_ai_*` tool names from the model's context. These
  // leak in via the operator's Claude Code subscription OAuth scope
  // (`user:mcp_servers`) even when `settingSources: []` and
  // `enabledMcpjsonServers: []` are forced. Without this layer the model
  // sees claude.ai-attached integrations (Gmail, Linear, Notion, ...) and
  // hallucinates promises it cannot deliver. The capability cutoff blocks
  // execution as a backstop, but cleaning the announcement is what stops
  // the hallucination. Details: src/security/claude-ai-blocklist.ts.
  options.settings = {
    permissions: { deny: buildClaudeAiDenyRules() },
    deniedMcpServers: buildClaudeAiDeniedMcpServers(),
  };

  if (trustedBypass) {
    // The Claude CLI rejects `bypassPermissions` mode under uid 0 and
    // exits with code 1 before any model call:
    //   "--dangerously-skip-permissions cannot be used with root/sudo
    //    privileges for security reasons"
    // (the error message uses the dangerous-skip wording even when only
    // permissionMode='bypassPermissions' is passed — the root gate
    // covers the whole bypass capability, not just the flag).
    //
    // Our production Docker runtime runs as uid 0 (required for
    // bubblewrap user namespaces in tool sandboxing), so the v0.x
    // trustedBypass shape was 100%-broken in prod (auto-compress,
    // /compact, monthly memory rollup all failed). On root we instead
    // use permissionMode='default' with an auto-allow canUseTool — same
    // effective trust level (no human-in-the-loop prompts), but the
    // CLI doesn't trigger its root gate. The capability cutoff in
    // applyCutoffOptions still composes over the top, so a trusted
    // agent still cannot reach another tenant's MCP resources.
    if (process.getuid?.() === 0) {
      options.permissionMode = 'default';
      options.canUseTool = async () => ({ behavior: 'allow' });
    } else {
      options.permissionMode = 'bypassPermissions';
      options.allowDangerouslySkipPermissions = true;
    }
    // Capability cutoff applies even on trustedBypass: capability ≠ permission.
    // A trusted agent still must not reach another tenant's MCP-exposed
    // resources (e.g. another operator's Google Calendar). The cutoff layer
    // hardens cwd, env, settingSources, and adds a runtime canUseTool gate
    // limited to declared capabilities — independent of permission mode.
    return applyCutoffOptions(options, agent);
  }

  const allowedTools = buildAllowedTools(agent, hasSubagents);
  options.allowedTools = allowedTools;
  options.permissionMode = cfg?.permissions?.mode ?? 'default';
  options.hooks = mergeSdkHooks(
    buildPermissionHooks(agent, params.fileOwnership),
    buildSdkHookBridge({ agentId: agent.id, emitter: params.hookEmitter }),
  );
  options.canUseTool = createCanUseTool({
    agent,
    approvalBroker: params.approvalBroker ?? new ApprovalBroker(),
    channel: params.channel,
    sessionContext: params.sessionContext ?? { peerId: '__headless__' },
  });

  return applyCutoffOptions(options, agent);
}
