import { describe, it, expect, vi } from 'vitest';
import type * as LegacyClaudeSdk from '@anthroclaw/legacy-claude-agent-sdk';
import { runSubagent } from '../subagent-runner.js';

const legacySdkMocks = vi.hoisted(() => {
  const query = vi.fn();

  async function runHeadlessText(input: {
    prompt: string;
    model?: string;
    timeoutMs?: number;
    cwd?: string;
    systemPrompt?: string;
    purpose?: string;
    toolDenyMessage?: string;
  }): Promise<string> {
    const timeoutMs = input.timeoutMs ?? 60_000;
    const purpose = input.purpose ?? 'headless review';
    const controller = new AbortController();
    const stream = query({
      prompt: input.prompt,
      options: {
        model: input.model ?? 'claude-sonnet-4-6',
        cwd: input.cwd ?? process.cwd(),
        tools: [],
        allowedTools: [],
        permissionMode: 'dontAsk',
        persistSession: false,
        maxTurns: 1,
        settingSources: ['project'],
        abortController: controller,
        canUseTool: async () => ({
          behavior: 'deny',
          message: input.toolDenyMessage ?? `Tools disabled for ${purpose}.`,
        }),
        systemPrompt: input.systemPrompt
          ? { type: 'preset', preset: 'claude_code', excludeDynamicSections: true, append: input.systemPrompt }
          : { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
      },
    }) as AsyncIterable<unknown> & { close?: () => void };
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const accumulated: string[] = [];
    let result = '';
    let resultFound = false;

    const complete = (async () => {
      for await (const event of stream) {
        const e = event as Record<string, unknown>;
        const subtype = (e.subtype as string | undefined) ?? 'unknown';
        if (e.type === 'result' && e.is_error && subtype !== 'success') {
          const errors = Array.isArray(e.errors) ? e.errors : [];
          throw new Error(`${purpose} LLM error (${subtype}): ${errors.join('; ') || subtype}`);
        }
        if (e.type === 'result' && typeof e.result === 'string') {
          result = e.result.trim();
          resultFound = true;
          break;
        }
        if (e.type === 'assistant') {
          const message = e.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
          for (const block of message?.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string') accumulated.push(block.text);
          }
        }
      }
    })();
    const timeout = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(new Error(`${purpose} timeout after ${timeoutMs}ms`));
      });
    });

    try {
      await Promise.race([complete, timeout]);
    } finally {
      clearTimeout(timer);
      stream.close?.();
    }

    if (!resultFound) result = accumulated.join('').trim();
    if (!result) throw new Error(`${purpose} returned empty result`);
    return result;
  }

  return { query, runHeadlessText };
});

vi.mock('@anthroclaw/legacy-claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof LegacyClaudeSdk>();
  return {
    ...actual,
    query: legacySdkMocks.query,
    claudeAgentHeadlessRuntime: {
      id: 'claude-agent-sdk',
      runText: legacySdkMocks.runHeadlessText,
      run: async (input: Parameters<typeof legacySdkMocks.runHeadlessText>[0]) => ({
        text: await legacySdkMocks.runHeadlessText(input),
      }),
    },
  };
});

import { query } from '@anthroclaw/legacy-claude-agent-sdk';

describe('runSubagent', () => {
  it('calls the default headless runtime with maxTurns:1, tools:[], canUseTool: deny', async () => {
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
    // I1: Verify canUseTool: deny is actually a function that returns deny behavior.
    expect(typeof callArg.options.canUseTool).toBe('function');
    await expect(callArg.options.canUseTool()).resolves.toMatchObject({ behavior: 'deny' });
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
    vi.useFakeTimers();
    const neverEnding = (async function* () {
      await new Promise((r) => setTimeout(r, 5000));
      yield { type: 'result', result: 'too late' };
    })();
    (query as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      [Symbol.asyncIterator]: () => neverEnding,
      close: vi.fn(),
    });

    try {
      const result = expect(
        runSubagent({ prompt: 'p', timeoutMs: 100 })
      ).rejects.toThrow(/timeout|abort/i);
      await vi.advanceTimersByTimeAsync(100);
      await result;
    } finally {
      vi.useRealTimers();
    }
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

  // M2: Test zero-event case (stream ends with no events).
  it('throws when stream ends with no events', async () => {
    const empty = (async function* () { /* yields nothing */ })();
    (query as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      [Symbol.asyncIterator]: () => empty,
      close: vi.fn(),
    });
    await expect(runSubagent({ prompt: 'p' })).rejects.toThrow(/empty|no result/i);
  });

  // M2: Test provider result error surfacing.
  it('surfaces provider result errors with subtype and errors', async () => {
    const events = (async function* () {
      yield {
        type: 'result',
        is_error: true,
        subtype: 'error_during_execution',
        errors: ['authentication_failed'],
      };
    })();
    (query as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      [Symbol.asyncIterator]: () => events,
      close: vi.fn(),
    });
    await expect(runSubagent({ prompt: 'p' }))
      .rejects.toThrow(/error_during_execution|authentication_failed/);
  });
});
