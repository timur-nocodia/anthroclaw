import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent as SdkHookEvent,
  HookInput,
  Options,
  PermissionRequestHookInput,
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
  PreToolUseHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import type { HookEmitter, HookEvent } from '../hooks/emitter.js';

const MAX_STRING_LENGTH = 2_000;
const MAX_OBJECT_KEYS = 40;
const MAX_ARRAY_ITEMS = 40;
const MAX_DEPTH = 4;

type SdkHooks = NonNullable<Options['hooks']>;

export interface SdkHookBridgeParams {
  agentId: string;
  emitter?: HookEmitter;
}

function makeBasePayload(agentId: string, input: HookInput): Record<string, unknown> {
  return {
    source: 'claude-agent-sdk',
    agentId,
    sdkSessionId: input.session_id,
    transcriptPath: input.transcript_path,
    cwd: input.cwd,
    permissionMode: input.permission_mode,
    sdkAgentId: input.agent_id,
    sdkAgentType: input.agent_type,
  };
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}... [truncated ${value.length - MAX_STRING_LENGTH} chars]`;
}

function toHookSafeValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') return truncateString(value);
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[MaxDepth]';

  seen.add(value);

  if (Array.isArray(value)) {
    const out = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((entry) => toHookSafeValue(entry, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      out.push(`[truncated ${value.length - MAX_ARRAY_ITEMS} items]`);
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  for (const [key, nested] of entries) {
    out[key] = toHookSafeValue(nested, depth + 1, seen);
  }
  const extraKeys = Object.keys(value).length - entries.length;
  if (extraKeys > 0) {
    out.__truncatedKeys = extraKeys;
  }
  return out;
}

async function emitHook(
  emitter: HookEmitter,
  event: HookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  await emitter.emit(event, payload);
}

function createBridgeHook(agentId: string, emitter: HookEmitter): HookCallback {
  return async (input): Promise<Record<string, never>> => {
    const base = makeBasePayload(agentId, input);

    switch (input.hook_event_name) {
      case 'PreToolUse': {
        const toolInput = input as PreToolUseHookInput;
        await emitHook(emitter, 'on_tool_use', {
          ...base,
          toolName: toolInput.tool_name,
          toolUseId: toolInput.tool_use_id,
          toolInput: toHookSafeValue(toolInput.tool_input),
        });
        break;
      }

      case 'PostToolUse': {
        const toolInput = input as PostToolUseHookInput;
        await emitHook(emitter, 'on_tool_result', {
          ...base,
          toolName: toolInput.tool_name,
          toolUseId: toolInput.tool_use_id,
          toolInput: toHookSafeValue(toolInput.tool_input),
          toolResponse: toHookSafeValue(toolInput.tool_response),
        });
        break;
      }

      case 'PostToolUseFailure': {
        const toolInput = input as PostToolUseFailureHookInput;
        await emitHook(emitter, 'on_tool_error', {
          ...base,
          toolName: toolInput.tool_name,
          toolUseId: toolInput.tool_use_id,
          toolInput: toHookSafeValue(toolInput.tool_input),
          error: truncateString(toolInput.error),
          isInterrupt: toolInput.is_interrupt,
        });
        break;
      }

      case 'PermissionRequest': {
        const permissionInput = input as PermissionRequestHookInput;
        await emitHook(emitter, 'on_permission_request', {
          ...base,
          toolName: permissionInput.tool_name,
          toolInput: toHookSafeValue(permissionInput.tool_input),
          permissionSuggestions: toHookSafeValue(permissionInput.permission_suggestions),
        });
        break;
      }

      case 'Notification':
        await emitHook(emitter, 'on_sdk_notification', {
          ...base,
          title: input.title,
          message: truncateString(input.message),
          notificationType: input.notification_type,
        });
        break;

      case 'SubagentStart': {
        const subagentInput = input as SubagentStartHookInput;
        await emitHook(emitter, 'on_subagent_start', {
          ...base,
          subagentId: subagentInput.agent_id,
          subagentType: subagentInput.agent_type,
        });
        break;
      }

      case 'SubagentStop': {
        const subagentInput = input as SubagentStopHookInput;
        await emitHook(emitter, 'on_subagent_stop', {
          ...base,
          subagentId: subagentInput.agent_id,
          subagentType: subagentInput.agent_type,
          subagentTranscriptPath: subagentInput.agent_transcript_path,
          lastAssistantMessage: subagentInput.last_assistant_message
            ? truncateString(subagentInput.last_assistant_message)
            : undefined,
        });
        break;
      }
    }

    return {};
  };
}

export function buildSdkHookBridge(params: SdkHookBridgeParams): SdkHooks | undefined {
  if (!params.emitter) return undefined;

  const matcher: HookCallbackMatcher = {
    hooks: [createBridgeHook(params.agentId, params.emitter)],
  };

  return {
    PreToolUse: [matcher],
    PostToolUse: [matcher],
    PostToolUseFailure: [matcher],
    PermissionRequest: [matcher],
    Notification: [matcher],
    SubagentStart: [matcher],
    SubagentStop: [matcher],
  };
}

export function mergeSdkHooks(...hookSets: Array<Options['hooks'] | undefined>): SdkHooks | undefined {
  const merged: Partial<Record<SdkHookEvent, HookCallbackMatcher[]>> = {};

  for (const hooks of hookSets) {
    if (!hooks) continue;

    for (const [event, matchers] of Object.entries(hooks) as Array<[SdkHookEvent, HookCallbackMatcher[] | undefined]>) {
      if (!matchers || matchers.length === 0) continue;
      merged[event] = [...(merged[event] ?? []), ...matchers];
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}
