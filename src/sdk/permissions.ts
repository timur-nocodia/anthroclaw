import { resolve } from 'node:path';
import type { Agent } from '../agent/agent.js';
import type { ToolDefinition } from '../agent/tools/types.js';
import { isReadDenied, isWriteDenied } from '../security/file-safety.js';
import { logger } from '../logger.js';
import type {
  CanUseTool,
  HookCallback,
  HookCallbackMatcher,
  HookJSONOutput,
  Options,
  PermissionResult,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import {
  evaluateFileOwnershipToolUse,
  type FileOwnershipToolUseContext,
} from './file-ownership-permissions.js';
import type { FileOwnershipRegistry } from './file-ownership.js';
import type { StoredFileOwnershipEvent } from '../metrics/store.js';
import { buildExternalMcpToolNames } from './external-mcp.js';
import { BUILTIN_META } from '../security/builtin-tool-meta.js';
import { MCP_META } from '../security/mcp-meta-registry.js';
import type { ToolMeta } from '../security/types.js';
import { ApprovalBroker } from '../security/approval-broker.js';
import type { ChannelAdapter } from '../channels/types.js';

const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'LS',
  'Bash',
  'BashOutput',
  'KillBash',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
  'NotebookEdit',
  'ListMcpResources',
  'ReadMcpResource',
] as const;

const FILE_READ_TOOLS = new Set(['Read']);
const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

const DANGEROUS_BASH_PATTERNS = [
  'rm -rf /',
  'rm -rf ~',
  'sudo rm',
  'chmod 777',
  'mkfs',
  'dd if=/dev/zero',
  '> /dev/sda',
  'shutdown',
  'reboot',
] as const;

const WEB_TOOLS = ['WebFetch', 'WebSearch'] as const;

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function collectPathLikeStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectPathLikeStrings(entry, out);
    return out;
  }
  if (!value || typeof value !== 'object') {
    return out;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === 'string' && /(path|file|notebook|target|destination)/i.test(key)) {
      out.push(nested);
      continue;
    }
    collectPathLikeStrings(nested, out);
  }
  return out;
}

function normalizePath(workspacePath: string, candidate: string): string {
  return resolve(workspacePath, candidate);
}

function findProtectedPath(
  toolName: string,
  toolInput: Record<string, unknown>,
  workspacePath: string,
): { action: 'read' | 'write'; path: string } | null {
  const candidates = collectPathLikeStrings(toolInput);
  if (candidates.length === 0) return null;

  if (FILE_READ_TOOLS.has(toolName)) {
    for (const candidate of candidates) {
      const resolved = normalizePath(workspacePath, candidate);
      if (isReadDenied(resolved)) {
        return { action: 'read', path: candidate };
      }
    }
  }

  if (FILE_WRITE_TOOLS.has(toolName)) {
    for (const candidate of candidates) {
      const resolved = normalizePath(workspacePath, candidate);
      if (isWriteDenied(resolved)) {
        return { action: 'write', path: candidate };
      }
    }
  }

  return null;
}

function deny(reason: string): PermissionResult {
  return { behavior: 'deny', message: reason };
}

function allow(input: Record<string, unknown>): PermissionResult {
  return { behavior: 'allow', updatedInput: input };
}

export interface FileOwnershipPermissionHooks {
  registry: FileOwnershipRegistry;
  resolveContext(input: PreToolUseHookInput): FileOwnershipToolUseContext | undefined;
  onEvent?: (event: StoredFileOwnershipEvent) => void;
}

export function getAgentMcpToolNames(agent: Pick<Agent, 'mcpServer' | 'tools'>): string[] {
  return agent.tools.map((tool: ToolDefinition) => `mcp__${agent.mcpServer.name}__${tool.name}`);
}

function isLocalMcpToolApproved(
  policyList: string[] | undefined,
  fullToolName: string,
): boolean {
  if (!policyList || policyList.length === 0) return true;
  const localName = fullToolName.split('__').at(-1) ?? fullToolName;
  return policyList.includes(fullToolName) || policyList.includes(localName);
}

export function buildAllowedTools(
  agent: Pick<Agent, 'config' | 'mcpServer' | 'tools'>,
  hasSubagents: boolean,
): string[] {
  const out = new Set<string>(DEFAULT_ALLOWED_TOOLS);
  const cfg = agent.config.sdk;

  for (const toolName of cfg?.allowedTools ?? []) {
    out.add(toolName);
  }

  if (cfg?.permissions?.allow_mcp !== false) {
    for (const toolName of getAgentMcpToolNames(agent)) {
      if (isLocalMcpToolApproved(cfg?.permissions?.allowed_mcp_tools, toolName)) {
        out.add(toolName);
      }
    }
    for (const toolName of buildExternalMcpToolNames(agent.config.external_mcp_servers)) {
      if (isLocalMcpToolApproved(cfg?.permissions?.allowed_mcp_tools, toolName)) {
        out.add(toolName);
      }
    }
  }

  if (cfg?.permissions?.allow_bash === false) {
    out.delete('Bash');
    out.delete('BashOutput');
    out.delete('KillBash');
  }

  if (cfg?.permissions?.allow_web === false) {
    for (const toolName of WEB_TOOLS) {
      out.delete(toolName);
    }
  }

  if (hasSubagents) {
    out.add('Task');
  }

  out.delete('AskUserQuestion');
  out.delete('ExitPlanMode');

  for (const toolName of cfg?.disallowedTools ?? []) {
    out.delete(toolName);
  }

  return Array.from(out);
}

export interface CanUseToolDeps {
  agent: Pick<Agent, 'config' | 'safetyProfile' | 'id'>;
  approvalBroker: ApprovalBroker;
  channel?: ChannelAdapter;
  sessionContext: { peerId: string; senderId?: string; accountId?: string; threadId?: string };
}

export function createCanUseTool(deps: CanUseToolDeps): CanUseTool {
  const { agent, approvalBroker, channel, sessionContext } = deps;
  const profile = agent.safetyProfile;
  const overrides = agent.config.safety_overrides ?? {};
  const sdkPermissions = agent.config.sdk?.permissions;

  let bypassWarnLogged = false;

  return async (toolName, input) => {
    // 1. Bypass mode short-circuit — allow everything without any checks
    if (overrides.permission_mode === 'bypass') {
      if (!bypassWarnLogged) {
        logger.warn(
          { agentId: agent.id, profile: profile.name },
          'safety_overrides.permission_mode=bypass: tool calls run without approval',
        );
        bypassWarnLogged = true;
      }
      return allow(input);
    }

    // 2. Resolve meta: for prefixed MCP tools (mcp__server__tool), look up by local name
    const isMcpPrefixed = toolName.startsWith('mcp__');
    const localName = isMcpPrefixed ? (toolName.split('__').at(-1) ?? toolName) : toolName;
    const meta = lookupMeta(localName);

    // 3. HARD_BLACKLIST — cannot be opened even with overrides
    if (
      profile.hardBlacklist.has(toolName) ||
      profile.hardBlacklist.has(localName) ||
      (meta && meta.hard_blacklist_in.includes(profile.name))
    ) {
      return deny(`Tool "${toolName}" is hard-blacklisted in safety_profile=${profile.name}`);
    }

    // 4. For prefixed MCP tools, apply sdk.permissions.allowed_mcp_tools filter
    if (isMcpPrefixed && sdkPermissions?.allowed_mcp_tools) {
      const approved = isLocalMcpToolApproved(sdkPermissions.allowed_mcp_tools, toolName);
      if (!approved) {
        return deny(`MCP tool "${toolName}" is not in allowed_mcp_tools list`);
      }
    }

    // 5. Explicit override allow_tools takes effect (after blacklist and filter checks)
    const overrideAllow =
      (overrides.allow_tools ?? []).includes(toolName) ||
      (overrides.allow_tools ?? []).includes(localName);

    // 6. Determine if profile allows the tool
    const profileAllows =
      profile.builtinTools.allowed.has(toolName) ||
      profile.builtinTools.allowed.has(localName) ||
      (meta !== undefined && profile.mcpToolPolicy.allowedByMeta(meta));

    if (!profileAllows && !overrideAllow) {
      return deny(`Tool "${toolName}" is not allowed by safety_profile=${profile.name}`);
    }

    // 7. Public profile: send_message is restricted to the originating peer only.
    // This prevents prompt-injected public agents from spamming arbitrary recipients.
    if (profile.name === 'public' && (toolName === 'send_message' || localName === 'send_message')) {
      const targetPeer = (input as any)?.peer_id ?? (input as any)?.peerId;
      if (typeof targetPeer === 'string' && targetPeer !== sessionContext.peerId) {
        return deny(
          `safety_profile=public: send_message can only target the originating peer (got "${targetPeer}", expected "${sessionContext.peerId}")`,
        );
      }
    }

    // 8. Approval flow — check if tool requires interactive approval
    const requiresApproval =
      profile.builtinTools.requiresApproval.has(toolName) ||
      profile.builtinTools.requiresApproval.has(localName) ||
      (meta !== undefined && profile.mcpToolPolicy.requiresApproval(meta));

    if (!requiresApproval) {
      return allow(input);
    }

    // Channel must support interactive approval
    if (!channel || !channel.supportsApproval) {
      return deny(
        `Tool "${toolName}" requires approval; channel does not support interactive approval`,
      );
    }

    // Generate unique id for this approval request
    const id = `${agent.id}:${toolName}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await channel.promptForApproval({
      id,
      toolName,
      argsPreview: previewArgs(input),
      argsFull: JSON.stringify(input),
      peerId: sessionContext.peerId,
      accountId: sessionContext.accountId,
      threadId: sessionContext.threadId,
    });
    // Pass senderId (originating user) and the original input so they are
    // verified and preserved when the broker resolves.
    return approvalBroker.request(
      id,
      60_000,
      sessionContext.senderId ?? sessionContext.peerId,
      input,
    );
  };
}

function lookupMeta(localToolName: string): ToolMeta | undefined {
  return (MCP_META as Record<string, ToolMeta>)[localToolName] ??
    (BUILTIN_META as Record<string, ToolMeta>)[localToolName];
}

function previewArgs(input: unknown): string {
  const json = JSON.stringify(input, null, 2);
  if (json.length <= 500) return json;
  return json.slice(0, 480) + '\n...(truncated)';
}

function createDenyDangerousOperationsHook(
  agent: Pick<Agent, 'config'>,
): HookCallback {
  const extraPatterns = agent.config.sdk?.permissions?.denied_bash_patterns ?? [];
  const blockedPatterns = [...DANGEROUS_BASH_PATTERNS, ...extraPatterns];

  return async (input): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== 'PreToolUse') {
      return {};
    }

    const preToolInput = input as PreToolUseHookInput;
    const toolName = preToolInput.tool_name;
    const toolInput = toRecord(preToolInput.tool_input);

    if (toolName === 'Bash') {
      const command = typeof toolInput.command === 'string' ? toolInput.command : '';
      const blocked = blockedPatterns.find((pattern) => command.includes(pattern));
      if (blocked) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `Blocked dangerous Bash pattern: ${blocked}`,
          },
        };
      }
    }

    const protectedPath = findProtectedPath(toolName, toolInput, input.cwd);
    if (protectedPath) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Protected ${protectedPath.action} path denied: ${protectedPath.path}`,
        },
      };
    }

    return {};
  };
}

function createFileOwnershipHook(options: FileOwnershipPermissionHooks): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== 'PreToolUse') {
      return {};
    }

    const preToolInput = input as PreToolUseHookInput;
    const resolved = options.resolveContext(preToolInput);
    if (!resolved) return {};

    const decision = evaluateFileOwnershipToolUse(options.registry, {
      ...resolved,
      toolName: preToolInput.tool_name,
      toolInput: preToolInput.tool_input,
      cwd: preToolInput.cwd ?? resolved.cwd,
    });

    for (const conflict of decision.conflicts) {
      options.onEvent?.({
        sessionKey: conflict.sessionKey,
        runId: conflict.requested.runId,
        subagentId: conflict.requested.subagentId,
        path: conflict.path,
        eventType: 'conflict',
        action: conflict.action,
        reason: conflict.reason,
      });
    }

    if (decision.applies && !decision.allowed) {
      options.onEvent?.({
        sessionKey: resolved.sessionKey,
        runId: resolved.runId,
        subagentId: resolved.subagentId,
        path: decision.path ?? 'unknown',
        eventType: 'denied_write',
        action: 'deny',
        reason: decision.message,
      });
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: decision.message ?? 'File ownership denied this write.',
        },
      };
    }

    return {};
  };
}

export function buildPermissionHooks(
  agent: Pick<Agent, 'config'>,
  fileOwnership?: FileOwnershipPermissionHooks,
): NonNullable<Options['hooks']> {
  const hooks = [createDenyDangerousOperationsHook(agent)];
  if (fileOwnership) hooks.push(createFileOwnershipHook(fileOwnership));
  const matcher: HookCallbackMatcher = {
    hooks,
  };
  return { PreToolUse: [matcher] };
}
