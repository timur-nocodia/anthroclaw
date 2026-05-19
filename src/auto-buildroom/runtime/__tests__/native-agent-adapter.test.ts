import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeAgentRuntimeAdapter } from '../native-agent-adapter.js';

vi.mock('@anthroclaw/legacy-claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthroclaw/legacy-claude-agent-sdk';

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;

describe('NativeAgentRuntimeAdapter', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('starts Builder through native SDK query with bounded Buildroom options', async () => {
    const close = vi.fn();
    mockedQuery.mockReturnValue({
      [Symbol.asyncIterator]: () => asyncEvents([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'changed docs' }] } },
        { type: 'result', result: 'done', session_id: 'session_builder_1' },
      ]),
      close,
    });

    const adapter = new NativeAgentRuntimeAdapter();
    const result = await adapter.runBuilder({
      prompt: 'Apply approved docs change.',
      model: 'claude-sonnet-4-6',
      workingDirectory: '/tmp/worktree',
      allowedTools: ['Read', 'Edit'],
      idempotencyKey: 'room:approval:plan',
      scopeSummary: 'allowed docs only',
      timeoutMs: 10_000,
    });

    expect(result).toMatchObject({
      status: 'completed',
      resultText: 'done',
      runtimeRefs: [
        {
          runtime: 'native-agent-sdk',
          sessionId: 'session_builder_1',
        },
      ],
    });
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const callArg = mockedQuery.mock.calls[0][0];
    expect(callArg.prompt).toContain('Apply approved docs change.');
    expect(callArg.options.cwd).toBe('/tmp/worktree');
    expect(callArg.options.model).toBe('claude-sonnet-4-6');
    expect(callArg.options.allowedTools).toEqual(['Read', 'Edit']);
    expect(callArg.options.permissionMode).toBe('default');
    expect(callArg.options.maxTurns).toBe(1);
    expect(callArg.options.systemPrompt.append).toContain('allowed docs only');
    await expect(callArg.options.canUseTool()).resolves.toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('Native tool approval is not auto-granted'),
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('maps native runtime error events to failed runtime result', async () => {
    mockedQuery.mockReturnValue({
      [Symbol.asyncIterator]: () => asyncEvents([
        {
          type: 'result',
          is_error: true,
          subtype: 'error_during_execution',
          errors: ['permission denied'],
        },
      ]),
      close: vi.fn(),
    });

    const adapter = new NativeAgentRuntimeAdapter();

    await expect(
      adapter.runBuilder({
        prompt: 'Apply approved docs change.',
        workingDirectory: '/tmp/worktree',
        allowedTools: [],
        idempotencyKey: 'room:approval:plan',
        scopeSummary: 'allowed docs only',
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      errorType: 'runtime_error',
      message: expect.stringContaining('permission denied'),
    });
  });
});

async function* asyncEvents(events: Array<Record<string, unknown>>) {
  for (const event of events) yield event;
}

