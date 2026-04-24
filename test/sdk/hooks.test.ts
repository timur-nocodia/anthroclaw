import { describe, expect, it, vi } from 'vitest';
import type { HookEmitter } from '../../src/hooks/emitter.js';
import { buildSdkHookBridge, mergeSdkHooks } from '../../src/sdk/hooks.js';

function makeEmitter(): HookEmitter {
  return {
    emit: vi.fn(async () => {}),
  } as unknown as HookEmitter;
}

const hookOptions = { signal: new AbortController().signal };

describe('SDK hook bridge', () => {
  it('emits tool lifecycle events without blocking SDK hooks', async () => {
    const emitter = makeEmitter();
    const hooks = buildSdkHookBridge({ agentId: 'bot-a', emitter })!;

    await hooks.PreToolUse![0].hooks[0]({
      hook_event_name: 'PreToolUse',
      session_id: 'session-1',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: '/tmp/workspace',
      tool_name: 'Read',
      tool_input: { file_path: 'README.md' },
      tool_use_id: 'tool-1',
    }, 'tool-1', hookOptions);

    await hooks.PostToolUse![0].hooks[0]({
      hook_event_name: 'PostToolUse',
      session_id: 'session-1',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: '/tmp/workspace',
      tool_name: 'Read',
      tool_input: { file_path: 'README.md' },
      tool_response: { content: 'hello' },
      tool_use_id: 'tool-1',
    }, 'tool-1', hookOptions);

    expect(emitter.emit).toHaveBeenNthCalledWith(1, 'on_tool_use', expect.objectContaining({
      source: 'claude-agent-sdk',
      agentId: 'bot-a',
      sdkSessionId: 'session-1',
      toolName: 'Read',
      toolUseId: 'tool-1',
      toolInput: { file_path: 'README.md' },
    }));
    expect(emitter.emit).toHaveBeenNthCalledWith(2, 'on_tool_result', expect.objectContaining({
      toolName: 'Read',
      toolResponse: { content: 'hello' },
    }));
  });

  it('emits permission, notification, and subagent events', async () => {
    const emitter = makeEmitter();
    const hooks = buildSdkHookBridge({ agentId: 'bot-a', emitter })!;

    await hooks.PermissionRequest![0].hooks[0]({
      hook_event_name: 'PermissionRequest',
      session_id: 'session-1',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: '/tmp/workspace',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    }, undefined, hookOptions);

    await hooks.Notification![0].hooks[0]({
      hook_event_name: 'Notification',
      session_id: 'session-1',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: '/tmp/workspace',
      message: 'Needs attention',
      notification_type: 'info',
      title: 'SDK notification',
    }, undefined, hookOptions);

    await hooks.SubagentStart![0].hooks[0]({
      hook_event_name: 'SubagentStart',
      session_id: 'session-1',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: '/tmp/workspace',
      agent_id: 'sub-1',
      agent_type: 'researcher',
    }, undefined, hookOptions);

    expect(emitter.emit).toHaveBeenNthCalledWith(1, 'on_permission_request', expect.objectContaining({
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
    }));
    expect(emitter.emit).toHaveBeenNthCalledWith(2, 'on_sdk_notification', expect.objectContaining({
      title: 'SDK notification',
      message: 'Needs attention',
      notificationType: 'info',
    }));
    expect(emitter.emit).toHaveBeenNthCalledWith(3, 'on_subagent_start', expect.objectContaining({
      subagentId: 'sub-1',
      subagentType: 'researcher',
    }));
  });

  it('merges SDK hook sets by event', () => {
    const firstHook = vi.fn(async () => ({}));
    const secondHook = vi.fn(async () => ({}));

    const merged = mergeSdkHooks(
      { PreToolUse: [{ hooks: [firstHook] }] },
      { PreToolUse: [{ hooks: [secondHook] }], PostToolUse: [{ hooks: [secondHook] }] },
    );

    expect(merged!.PreToolUse).toHaveLength(2);
    expect(merged!.PostToolUse).toHaveLength(1);
  });
});
