import { describe, it, expect, vi } from 'vitest';
import { runSubagent } from '../subagent-runner.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';

describe('runSubagent', () => {
  it('calls SDK query() with maxTurns:1, tools:[], canUseTool: deny', async () => {
    const events = (async function* () {
      yield { type: 'result', result: 'mock-summary-text' };
    })();
    (query as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      [Symbol.asyncIterator]: () => events,
      close: vi.fn(),
    });

    const result = await runSubagent({
      prompt: 'summarize these messages',
      systemPrompt: 'You are a summarizer.',
      model: 'claude-haiku-4-5',
    });

    expect(result).toBe('mock-summary-text');
    expect(query).toHaveBeenCalledTimes(1);
    const callArg = (query as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.options.maxTurns).toBe(1);
    expect(callArg.options.tools).toEqual([]);
    expect(callArg.options.allowedTools).toEqual([]);
    expect(callArg.options.permissionMode).toBe('dontAsk');
    expect(callArg.options.model).toBe('claude-haiku-4-5');
  });

  it('extracts text from assistant blocks if no result event', async () => {
    const events = (async function* () {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'partial-1 ' }, { type: 'text', text: 'partial-2' }] },
      };
    })();
    (query as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      [Symbol.asyncIterator]: () => events,
      close: vi.fn(),
    });

    const result = await runSubagent({ prompt: 'p' });
    expect(result).toBe('partial-1 partial-2');
  });

  it('respects timeoutMs and aborts long-running query', async () => {
    const neverEnding = (async function* () {
      await new Promise((r) => setTimeout(r, 5000));
      yield { type: 'result', result: 'too late' };
    })();
    (query as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      [Symbol.asyncIterator]: () => neverEnding,
      close: vi.fn(),
    });

    await expect(
      runSubagent({ prompt: 'p', timeoutMs: 100 })
    ).rejects.toThrow(/timeout|abort/i);
  });

  it('throws on empty result', async () => {
    const events = (async function* () {
      yield { type: 'result', result: '' };
    })();
    (query as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      [Symbol.asyncIterator]: () => events,
      close: vi.fn(),
    });

    await expect(runSubagent({ prompt: 'p' })).rejects.toThrow(/empty|no result/i);
  });
});
