import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runHeadlessReview } from '../headless-review.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;

describe('runHeadlessReview', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('calls the default Claude runtime as a single-turn, tool-denied review', async () => {
    const events = (async function* () {
      yield { type: 'result', result: 'review-json' };
    })();
    const close = vi.fn();
    mockedQuery.mockReturnValue({
      [Symbol.asyncIterator]: () => events,
      close,
    });

    const result = await runHeadlessReview({
      prompt: 'review this',
      systemPrompt: 'Return strict JSON.',
      model: 'claude-haiku-4-5',
      cwd: '/tmp',
      purpose: 'test review',
      toolDenyMessage: 'No tools here.',
    });

    expect(result).toBe('review-json');
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const callArg = mockedQuery.mock.calls[0][0];
    expect(callArg.prompt).toBe('review this');
    expect(callArg.options.model).toBe('claude-haiku-4-5');
    expect(callArg.options.cwd).toBe('/tmp');
    expect(callArg.options.maxTurns).toBe(1);
    expect(callArg.options.tools).toEqual([]);
    expect(callArg.options.allowedTools).toEqual([]);
    expect(callArg.options.permissionMode).toBe('dontAsk');
    expect(callArg.options.persistSession).toBe(false);
    expect(callArg.options.settingSources).toEqual(['project']);
    expect(callArg.options.systemPrompt).toMatchObject({
      type: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: true,
      append: 'Return strict JSON.',
    });
    await expect(callArg.options.canUseTool()).resolves.toMatchObject({
      behavior: 'deny',
      message: 'No tools here.',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('can run through an injected headless runtime without calling Claude SDK query()', async () => {
    const runtime = {
      id: 'test-headless',
      runText: vi.fn(async () => 'runtime-output'),
    };

    await expect(runHeadlessReview({
      prompt: 'review this',
      purpose: 'test review',
      runtime,
    })).resolves.toBe('runtime-output');

    expect(runtime.runText).toHaveBeenCalledWith({
      prompt: 'review this',
      purpose: 'test review',
    });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('can explicitly select the experimental Pi runtime with injected options', async () => {
    const session = {
      prompt: vi.fn(async () => undefined),
      subscribe: vi.fn((listener: (event: unknown) => void) => {
        listener({ type: 'assistant_text_delta', delta: 'pi-output' });
        return vi.fn();
      }),
      dispose: vi.fn(),
    };
    const createAgentSession = vi.fn(async () => ({ session }));

    await expect(runHeadlessReview({
      prompt: 'review this',
      runtime: 'pi',
      runtimeOptions: {
        pi: { createAgentSession },
      },
    })).resolves.toBe('pi-output');

    expect(mockedQuery).not.toHaveBeenCalled();
    expect(createAgentSession).toHaveBeenCalledTimes(1);
  });

  it('inherits safe runtime defaults but never inherits tool access', async () => {
    const events = (async function* () {
      yield { type: 'result', result: 'review-json' };
    })();
    mockedQuery.mockReturnValue({
      [Symbol.asyncIterator]: () => events,
      close: vi.fn(),
    });

    await runHeadlessReview({
      prompt: 'review this',
      runtimeDefaults: {
        model: 'claude-opus-4-5',
        cwd: '/workspace/agent',
        timeoutMs: 12_000,
        allowedTools: ['Bash', 'Read'],
      },
    });

    const callArg = mockedQuery.mock.calls[0][0];
    expect(callArg.options.model).toBe('claude-opus-4-5');
    expect(callArg.options.cwd).toBe('/workspace/agent');
    expect(callArg.options.tools).toEqual([]);
    expect(callArg.options.allowedTools).toEqual([]);
    await expect(callArg.options.canUseTool()).resolves.toMatchObject({ behavior: 'deny' });
  });

  it('extracts assistant text blocks if no result event is emitted', async () => {
    const events = (async function* () {
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'part A ' },
            { type: 'text', text: 'part B' },
          ],
        },
      };
    })();
    mockedQuery.mockReturnValue({
      [Symbol.asyncIterator]: () => events,
      close: vi.fn(),
    });

    await expect(runHeadlessReview({ prompt: 'p' })).resolves.toBe('part A part B');
  });

  it('surfaces SDK result errors with purpose context', async () => {
    const events = (async function* () {
      yield {
        type: 'result',
        is_error: true,
        subtype: 'error_during_execution',
        errors: ['auth_failed'],
      };
    })();
    mockedQuery.mockReturnValue({
      [Symbol.asyncIterator]: () => events,
      close: vi.fn(),
    });

    await expect(runHeadlessReview({ prompt: 'p', purpose: 'learning review' }))
      .rejects.toThrow(/learning review LLM error.*error_during_execution.*auth_failed/);
  });

  it('does not treat a successful SDK result marker as an error', async () => {
    const events = (async function* () {
      yield {
        type: 'result',
        is_error: true,
        subtype: 'success',
        errors: ['success'],
        result: '{"actions":[]}',
      };
    })();
    mockedQuery.mockReturnValue({
      [Symbol.asyncIterator]: () => events,
      close: vi.fn(),
    });

    await expect(runHeadlessReview({ prompt: 'p', purpose: 'learning review' }))
      .resolves.toBe('{"actions":[]}');
  });

  it('aborts and closes the stream on timeout', async () => {
    vi.useFakeTimers();
    const events = (async function* () {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      yield { type: 'result', result: 'late' };
    })();
    const close = vi.fn();
    mockedQuery.mockReturnValue({
      [Symbol.asyncIterator]: () => events,
      close,
    });

    try {
      const result = expect(
        runHeadlessReview({ prompt: 'p', purpose: 'learning review', timeoutMs: 50 })
      ).rejects.toThrow(/learning review timeout after 50ms/);
      await vi.advanceTimersByTimeAsync(50);
      await result;
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws on empty output', async () => {
    const events = (async function* () {
      yield { type: 'result', result: '' };
    })();
    mockedQuery.mockReturnValue({
      [Symbol.asyncIterator]: () => events,
      close: vi.fn(),
    });

    await expect(runHeadlessReview({ prompt: 'p', purpose: 'learning review' }))
      .rejects.toThrow(/learning review returned empty result/);
  });
});
