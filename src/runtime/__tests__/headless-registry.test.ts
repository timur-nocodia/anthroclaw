import { describe, expect, it, vi } from 'vitest';
import { claudeAgentHeadlessRuntime } from '../claude-agent-sdk.js';
import {
  isBuiltInHeadlessRuntimeId,
  resolveHeadlessRuntime,
} from '../headless-registry.js';

vi.mock('@anthroclaw/legacy-claude-agent-sdk', () => ({
  claudeAgentHeadlessRuntime: { id: 'claude-agent-sdk', runText: vi.fn() },
  query: vi.fn(),
  startup: vi.fn(),
  createSdkMcpServer: vi.fn(),
}));

vi.mock('../../sdk/options.js', () => ({
  buildSdkOptions: vi.fn(),
}));

describe('headless runtime registry', () => {
  it('defaults to the Claude Agent SDK headless runtime', () => {
    expect(resolveHeadlessRuntime()).toBe(claudeAgentHeadlessRuntime);
    expect(resolveHeadlessRuntime('claude-agent-sdk')).toBe(claudeAgentHeadlessRuntime);
  });

  it('passes custom runtime objects through unchanged', () => {
    const runtime = {
      id: 'custom-headless',
      runText: vi.fn(async () => 'ok'),
    };

    expect(resolveHeadlessRuntime(runtime)).toBe(runtime);
  });

  it('creates Pi runtimes only when explicitly selected', async () => {
    const session = {
      prompt: vi.fn(async () => undefined),
      subscribe: vi.fn((listener: (event: unknown) => void) => {
        listener({ type: 'assistant_text_delta', delta: 'from pi' });
        return vi.fn();
      }),
      dispose: vi.fn(),
    };
    const createAgentSession = vi.fn(async () => ({ session }));
    const runtime = resolveHeadlessRuntime('pi', {
      pi: { createAgentSession },
    });

    expect(runtime.id).toBe('pi');
    await expect(runtime.runText({ prompt: 'p' })).resolves.toBe('from pi');
    expect(createAgentSession).toHaveBeenCalledTimes(1);
  });

  it('creates OpenCode runtimes only when explicitly selected', async () => {
    const client = {
      session: {
        create: vi.fn(async () => ({ data: { id: 'oc-session-1' } })),
        prompt: vi.fn(async () => ({
          data: {
            info: { sessionID: 'oc-session-1' },
            parts: [{ type: 'text', text: 'from opencode' }],
          },
        })),
      },
    };
    const runtime = resolveHeadlessRuntime('opencode', {
      opencode: { client },
    });

    expect(runtime.id).toBe('opencode');
    await expect(runtime.runText({ prompt: 'p' })).resolves.toBe('from opencode');
    expect(client.session.create).toHaveBeenCalledTimes(1);
  });

  it('identifies built-in runtime ids', () => {
    expect(isBuiltInHeadlessRuntimeId('claude-agent-sdk')).toBe(true);
    expect(isBuiltInHeadlessRuntimeId('pi')).toBe(true);
    expect(isBuiltInHeadlessRuntimeId('opencode')).toBe(true);
    expect(isBuiltInHeadlessRuntimeId('other')).toBe(false);
  });
});
