import { resolve } from 'node:path';
import type { Agent } from '../agent/agent.js';
import type { ToolDefinition } from '../agent/tools/types.js';
import { isReadDenied, isWriteDenied } from '../security/file-safety.js';
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

export function createCanUseTool(
  agent: Pick<Agent, 'config' | 'mcpServer' | 'tools'>,
  allowedTools: ReadonlySet<string>,
): CanUseTool {
  const cfg = agent.config.sdk;
  const defaultBehavior = cfg?.permissions?.default_behavior ?? 'deny';
  const disallowed = new Set(cfg?.disallowedTools ?? []);
  const ownMcpPrefix = `mcp__${agent.mcpServer.name}__`;

  return async (toolName, input) => {
    if (disallowed.has(toolName)) {
      return deny(`Tool ${toolName} is disallowed by agent config.`);
    }

    if (toolName.startsWith('mcp__') && cfg?.permissions?.allow_mcp === false) {
      return deny(`MCP tool ${toolName} is disabled by agent config.`);
    }

    if (toolName === 'Bash' && cfg?.permissions?.allow_bash === false) {
      return deny('Bash is disabled by agent config.');
    }

    if (WEB_TOOLS.includes(toolName as (typeof WEB_TOOLS)[number]) && cfg?.permissions?.allow_web === false) {
      return deny(`Web tool ${toolName} is disabled by agent config.`);
    }

    if (allowedTools.has(toolName)) {
      return allow(input);
    }

    if (
      toolName.startsWith(ownMcpPrefix)
      && cfg?.permissions?.allow_mcp !== false
      && isLocalMcpToolApproved(cfg?.permissions?.allowed_mcp_tools, toolName)
    ) {
      return allow(input);
    }

    if (defaultBehavior === 'allow') {
      return allow(input);
    }

    return deny(`Tool ${toolName} is not approved for headless execution.`);
  };
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
