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

  it('calls SDK query() as a single-turn, tool-denied review', async () => {
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
