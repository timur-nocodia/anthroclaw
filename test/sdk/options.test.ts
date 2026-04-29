import { describe, expect, it, vi } from 'vitest';
import { AgentYmlSchema } from '../../src/config/schema.js';
import { buildSdkOptions } from '../../src/sdk/options.js';
import { FileOwnershipRegistry } from '../../src/sdk/file-ownership.js';

function makeAgent(overrides?: Record<string, unknown>, workspacePath = '/tmp/test-agent') {
  const config = AgentYmlSchema.parse({
    safety_profile: 'trusted' as const,
    routes: [{ channel: 'telegram' }],
    mcp_tools: ['memory_search'],
    ...overrides,
  });

  return {
    id: 'test-agent',
    config,
    workspacePath,
    mcpServer: { name: 'test-agent-tools' },
    tools: [
      {
        name: 'memory_search',
        description: 'Search memory',
        inputSchema: {},
        handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      },
      {
        name: 'send_message',
        description: 'Send a message',
        inputSchema: {},
        handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      },
    ],
  } as any;
}

describe('buildSdkOptions', () => {
  it('builds native sdk options for user-facing queries', () => {
    const agent = makeAgent({
      model: 'claude-sonnet-4-6',
      sdk: {
        includePartialMessages: true,
        fallbackModel: 'claude-haiku-4-5',
      },
    });

    const options = buildSdkOptions({
      agent,
      resume: 'session-123',
      subagents: {
        helper: {
          description: 'Helper',
          prompt: 'Be helpful',
        },
      },
    });

    expect(options.model).toBe('claude-sonnet-4-6');
    expect(options.cwd).toBe('/tmp/test-agent');
    expect(options.resume).toBe('session-123');
    expect(options.fallbackModel).toBe('claude-haiku-4-5');
    expect(options.includePartialMessages).toBe(true);
    expect(options.settingSources).toEqual(['project']);
    expect(options.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: true,
    });
    expect(options.permissionMode).toBe('default');
    expect(options.allowedTools).toContain('Task');
    expect(options.allowedTools).toContain('mcp__test-agent-tools__memory_search');
    expect(options.allowedTools).not.toContain('AskUserQuestion');
    expect(options.mcpServers).toEqual({ 'test-agent-tools': agent.mcpServer });
    expect(typeof options.canUseTool).toBe('function');
    expect(options.hooks?.PreToolUse).toBeDefined();
  });

  it('supports trusted bypass for internal flows', () => {
    const agent = makeAgent({
      sdk: {
        allowedTools: ['Read'],
      },
    });

    const options = buildSdkOptions({
      agent,
      trustedBypass: true,
      includeMcpServer: false,
    });

    expect(options.permissionMode).toBe('bypassPermissions');
    expect(options.allowDangerouslySkipPermissions).toBe(true);
    expect(options.allowedTools).toBeUndefined();
    expect(options.canUseTool).toBeUndefined();
    expect(options.mcpServers).toBeUndefined();
  });

  it('passes SDK elicitation handler through to query options', () => {
    const agent = makeAgent();
    const onElicitation = vi.fn();
    const options = buildSdkOptions({ agent, onElicitation });

    expect(options.onElicitation).toBe(onElicitation);
  });

  it('respects explicit permission mode and disallowed tools', () => {
    const agent = makeAgent({
      sdk: {
        disallowedTools: ['WebSearch'],
        permissions: {
          mode: 'dontAsk',
        },
      },
    });

    const options = buildSdkOptions({ agent });

    expect(options.permissionMode).toBe('dontAsk');
    expect(options.disallowedTools).toEqual(['WebSearch']);
    expect(options.allowedTools).not.toContain('WebSearch');
  });

  it('supports stricter web and mcp policy controls', async () => {
    const agent = makeAgent({
      sdk: {
        permissions: {
          allow_web: false,
          allowed_mcp_tools: ['memory_search'],
          denied_bash_patterns: ['npm publish'],
        },
      },
    });

    const options = buildSdkOptions({ agent });

    expect(options.allowedTools).not.toContain('WebSearch');
    expect(options.allowedTools).not.toContain('WebFetch');
    expect(options.allowedTools).toContain('mcp__test-agent-tools__memory_search');
    expect(options.allowedTools).not.toContain('mcp__test-agent-tools__send_message');

    const canUseTool = options.canUseTool!;
    await expect(canUseTool('mcp__test-agent-tools__memory_search', {}, { signal: new AbortController().signal }))
      .resolves.toMatchObject({ behavior: 'allow' });
    await expect(canUseTool('mcp__test-agent-tools__send_message', {}, { signal: new AbortController().signal }))
      .resolves.toMatchObject({ behavior: 'deny' });

    const preToolHook = options.hooks!.PreToolUse![0]!.hooks[0]!;
    const hookResult = await preToolHook({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      transcript_path: '/tmp/t.jsonl',
      cwd: '/tmp/test-agent',
      tool_name: 'Bash',
      tool_input: { command: 'npm publish' },
      tool_use_id: 'tool-1',
    } as any, 'tool-1', { signal: new AbortController().signal });

    expect(hookResult).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
      },
    });
  });

  it('merges configured external MCP servers into native SDK options', () => {
    const agent = makeAgent({
      external_mcp_servers: {
        calendar: {
          type: 'stdio',
          command: 'npx',
          args: ['google-calendar-mcp'],
          env: { GOOGLE_CLIENT_ID: 'client-id' },
          allowed_tools: ['calendar_daily_brief'],
        },
      },
    });

    const options = buildSdkOptions({ agent });

    expect(options.mcpServers).toMatchObject({
      'test-agent-tools': agent.mcpServer,
      calendar: {
        type: 'stdio',
        command: 'npx',
        args: ['google-calendar-mcp'],
        env: { GOOGLE_CLIENT_ID: 'client-id' },
      },
    });
    expect(options.allowedTools).toContain('mcp__calendar__calendar_daily_brief');
    expect(options.allowedTools).toContain('mcp__test-agent-tools__memory_search');
  });

  it('merges permission hooks with the SDK hook bridge when an emitter is provided', () => {
    const agent = makeAgent();
    const hookEmitter = {
      emit: vi.fn(async () => {}),
    } as any;

    const options = buildSdkOptions({ agent, hookEmitter });

    expect(options.hooks!.PreToolUse).toHaveLength(2);
    expect(options.hooks!.PostToolUse).toHaveLength(1);
    expect(options.hooks!.PermissionRequest).toHaveLength(1);
  });

  it('wires file ownership enforcement through SDK PreToolUse hooks', async () => {
    const agent = makeAgent();
    const registry = new FileOwnershipRegistry();
    const events: unknown[] = [];
    registry.claim({
      sessionKey: 'session-key-1',
      runId: 'run-a',
      subagentId: 'coder-a',
      path: '/tmp/test-agent/src/app.ts',
      mode: 'write',
    }, 'strict');

    const options = buildSdkOptions({
      agent,
      fileOwnership: {
        registry,
        resolveContext: () => ({
          sessionKey: 'session-key-1',
          runId: 'run-b',
          subagentId: 'coder-b',
          toolName: 'Edit',
          toolInput: { file_path: 'src/app.ts' },
          cwd: '/tmp/test-agent',
          conflictMode: 'strict',
        }),
        onEvent: (event) => events.push(event),
      },
    });

    const preToolHooks = options.hooks!.PreToolUse![0]!.hooks;
    const hookResult = await preToolHooks[1]!({
      hook_event_name: 'PreToolUse',
      session_id: 'sdk-session-1',
      transcript_path: '/tmp/t.jsonl',
      cwd: '/tmp/test-agent',
      agent_id: 'coder-b',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/app.ts' },
      tool_use_id: 'tool-1',
    } as any, 'tool-1', { signal: new AbortController().signal });

    expect(hookResult).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
      },
    });
    expect(events).toMatchObject([
      { eventType: 'conflict', action: 'deny', subagentId: 'coder-b' },
      { eventType: 'denied_write', action: 'deny', subagentId: 'coder-b' },
    ]);
  });

  it('passes SDK session store options through centralized builder', () => {
    const agent = makeAgent();
    const sessionStore = {
      append: vi.fn(async () => {}),
      load: vi.fn(async () => null),
    };

    const options = buildSdkOptions({
      agent,
      sessionStore,
      loadTimeoutMs: 1234,
    });

    expect(options.sessionStore).toBe(sessionStore);
    expect(options.loadTimeoutMs).toBe(1234);
  });
});
