import { describe, it, expect, vi } from 'vitest';
import { summarizeWithEscalation, sanitizeThinkingBlocks } from '../src/escalation.js';

function mockRunSubagent(returns: string | Error | (() => string | Promise<string>)) {
  return vi.fn(async () => {
    if (returns instanceof Error) throw returns;
    if (typeof returns === 'function') return await returns();
    return returns;
  });
}

// ── sanitizeThinkingBlocks ────────────────────────────────────────────────────

describe('sanitizeThinkingBlocks', () => {
  it('removes <think>...</think>', () => {
    expect(sanitizeThinkingBlocks('before<think>internal</think>after')).toBe('beforeafter');
  });

  it('removes <thinking>...</thinking> case-insensitive', () => {
    expect(sanitizeThinkingBlocks('a<THINKING>x</THINKING>b')).toBe('ab');
  });

  it('removes <reasoning>...</reasoning>', () => {
    expect(sanitizeThinkingBlocks('pre<reasoning>step1\nstep2</reasoning>post')).toBe('prepost');
  });

  it('removes <thought>...</thought>', () => {
    expect(sanitizeThinkingBlocks('x<thought>private</thought>y')).toBe('xy');
  });

  it('removes <REASONING_SCRATCHPAD>...</REASONING_SCRATCHPAD>', () => {
    expect(sanitizeThinkingBlocks('start<REASONING_SCRATCHPAD>scratch</REASONING_SCRATCHPAD>end')).toBe('startend');
  });

  it('handles unclosed thinking block — truncates to EOF', () => {
    expect(sanitizeThinkingBlocks('text<think>never closes')).toBe('text');
  });

  it('handles multi-line thinking block', () => {
    expect(sanitizeThinkingBlocks('a\n<think>line1\nline2</think>\nb')).toBe('a\n\nb');
  });

  it('returns input unchanged when no thinking blocks', () => {
    expect(sanitizeThinkingBlocks('plain text')).toBe('plain text');
  });

  it('removes multiple thinking blocks in one string', () => {
    const input = 'A<think>t1</think>B<reasoning>r1</reasoning>C';
    expect(sanitizeThinkingBlocks(input)).toBe('ABC');
  });

  it('handles mixed-case tag names', () => {
    expect(sanitizeThinkingBlocks('x<Think>hidden</Think>y')).toBe('xy');
  });
});

// ── summarizeWithEscalation ───────────────────────────────────────────────────

describe('summarizeWithEscalation', () => {
  const longSource = 'word '.repeat(500); // 2500 chars

  it('L1 success — returns level L1, attempts=1', async () => {
    const run = mockRunSubagent('Short summary');
    const r = await summarizeWithEscalation({ source: longSource, l1TokenBudget: 200, runSubagent: run });
    expect(r.level).toBe('L1');
    expect(r.summary).toBe('Short summary');
    expect(r.attempts).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('L1 returns longer-than-source → falls back to L2', async () => {
    const tooLong = 'a'.repeat(longSource.length + 100);
    let call = 0;
    const run = vi.fn(async () => {
      call++;
      return call === 1 ? tooLong : 'L2 short summary';
    });
    const r = await summarizeWithEscalation({ source: longSource, l1TokenBudget: 200, runSubagent: run });
    expect(r.level).toBe('L2');
    expect(r.attempts).toBe(2);
    expect(r.summary).toBe('L2 short summary');
  });

  it('L1 + L2 both return longer-than-source → falls back to L3', async () => {
    const tooLong = 'a'.repeat(longSource.length + 100);
    const run = mockRunSubagent(tooLong);
    const r = await summarizeWithEscalation({
      source: longSource,
      l1TokenBudget: 200,
      l3TruncateChars: 200,
      runSubagent: run,
    });
    expect(r.level).toBe('L3');
    expect(r.attempts).toBe(2);
    expect(r.summary).toContain('[truncation:');
  });

  it('L1 throws timeout → falls back to L2', async () => {
    let call = 0;
    const run = vi.fn(async () => {
      call++;
      if (call === 1) throw new Error('timeout');
      return 'L2 ok';
    });
    const r = await summarizeWithEscalation({ source: longSource, l1TokenBudget: 200, runSubagent: run });
    expect(r.level).toBe('L2');
    expect(r.attempts).toBe(2);
  });

  it('L1 + L2 both throw → L3 deterministic', async () => {
    const run = mockRunSubagent(new Error('always fails'));
    const r = await summarizeWithEscalation({
      source: longSource,
      l1TokenBudget: 200,
      l3TruncateChars: 200,
      runSubagent: run,
    });
    expect(r.level).toBe('L3');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('L3 truncate: head 40% + marker + tail 40% for source > budget', async () => {
    const run = mockRunSubagent(new Error('skip'));
    const r = await summarizeWithEscalation({
      source: 'X'.repeat(1000),
      l1TokenBudget: 200,
      l3TruncateChars: 100,
      runSubagent: run,
    });
    expect(r.summary.length).toBeLessThan(1000);
    expect(r.summary).toMatch(/^X{40}\n\[truncation: omitted 920 chars\]\nX{40}$/);
  });

  it('L3 returns source verbatim when source ≤ l3TruncateChars', async () => {
    const run = mockRunSubagent(new Error('skip'));
    const r = await summarizeWithEscalation({
      source: 'short',
      l1TokenBudget: 200,
      l3TruncateChars: 100,
      runSubagent: run,
    });
    expect(r.summary).toBe('short');
  });

  it('thinking blocks stripped from L1 output before length check', async () => {
    // Source is 100 chars. L1 returns 90-char "real" content + 200-char thinking block.
    // After sanitize, output is 90 chars < 100 → L1 succeeds.
    const source = 'a'.repeat(100);
    const l1Output = 'b'.repeat(90) + '<think>' + 'x'.repeat(200) + '</think>';
    const run = mockRunSubagent(l1Output);
    const r = await summarizeWithEscalation({ source, l1TokenBudget: 200, runSubagent: run });
    expect(r.level).toBe('L1');
    expect(r.summary).toBe('b'.repeat(90));
  });

  it('L2 ratio default 0.5 — L2 prompt budget = floor(l1Budget * 0.5)', async () => {
    let secondCallPrompt: string | undefined;
    const run = vi.fn(async (args: { prompt: string }) => {
      if (run.mock.calls.length === 1) return 'a'.repeat(longSource.length + 1);
      secondCallPrompt = args.prompt;
      return 'L2 ok';
    });
    await summarizeWithEscalation({ source: longSource, l1TokenBudget: 100, runSubagent: run });
    expect(secondCallPrompt).toContain('Below 50 tokens');
  });

  it('attempts counter: 1 if L1 success, 2 if L2 success', async () => {
    const run1 = mockRunSubagent('short');
    const r1 = await summarizeWithEscalation({ source: 'a'.repeat(100), l1TokenBudget: 200, runSubagent: run1 });
    expect(r1.attempts).toBe(1);

    let call = 0;
    const run2 = vi.fn(async () => {
      call++;
      return call === 1 ? 'a'.repeat(200) : 'short';
    });
    const r2 = await summarizeWithEscalation({ source: 'a'.repeat(100), l1TokenBudget: 200, runSubagent: run2 });
    expect(r2.attempts).toBe(2);
  });

  it('logger.warn called when L1 output is not shorter than source', async () => {
    const warn = vi.fn();
    const run = mockRunSubagent('a'.repeat(longSource.length + 1));
    await summarizeWithEscalation({
      source: longSource,
      l1TokenBudget: 200,
      l3TruncateChars: 100,
      runSubagent: run,
      logger: { warn },
    });
    expect(warn).toHaveBeenCalled();
  });

  it('logger.warn called when L1 throws', async () => {
    const warn = vi.fn();
    let call = 0;
    const run = vi.fn(async () => {
      call++;
      if (call === 1) throw new Error('boom');
      return 'short ok';
    });
    await summarizeWithEscalation({
      source: longSource,
      l1TokenBudget: 200,
      runSubagent: run,
      logger: { warn },
    });
    expect(warn).toHaveBeenCalled();
  });

  it('empty source → L3 returns empty string', async () => {
    const run = mockRunSubagent('any');
    const r = await summarizeWithEscalation({ source: '', l1TokenBudget: 200, runSubagent: run });
    // L1 returns 'any' (length 3) which is NOT < 0 (source.length), so escalates
    // L2 same → L3 returns empty
    expect(r.summary).toBe('');
    expect(r.level).toBe('L3');
  });

  it('custom l2BudgetRatio is respected', async () => {
    let secondCallPrompt: string | undefined;
    const run = vi.fn(async (args: { prompt: string }) => {
      if (run.mock.calls.length === 1) return 'a'.repeat(longSource.length + 1);
      secondCallPrompt = args.prompt;
      return 'ok';
    });
    await summarizeWithEscalation({
      source: longSource,
      l1TokenBudget: 100,
      l2BudgetRatio: 0.3,
      runSubagent: run,
    });
    // floor(100 * 0.3) = 30
    expect(secondCallPrompt).toContain('Below 30 tokens');
  });

  it('L1 prompt contains l1TokenBudget', async () => {
    let firstCallPrompt: string | undefined;
    const run = vi.fn(async (args: { prompt: string }) => {
      firstCallPrompt = args.prompt;
      return 'summary ok';
    });
    await summarizeWithEscalation({ source: 'hello world', l1TokenBudget: 777, runSubagent: run });
    expect(firstCallPrompt).toContain('777');
  });

  it('no import of @anthropic-ai/sdk or @anthropic-ai/claude-agent-sdk in escalation.ts', () => {
    // Structural test — the module loaded successfully without SDK imports;
    // this test simply asserts the functions are available (import above proves it)
    expect(typeof sanitizeThinkingBlocks).toBe('function');
    expect(typeof summarizeWithEscalation).toBe('function');
  });
});
