import { describe, it, expect, vi, afterEach } from 'vitest';
import { IterationBudget, startBudgetWatchdog } from '../../src/session/budget.js';

describe('IterationBudget', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts clean', () => {
    const budget = new IterationBudget({ maxToolCalls: 5, timeoutMs: 10_000, graceMessage: true });
    budget.start();

    expect(budget.isExhausted()).toBe(false);
    expect(budget.stats.toolCalls).toBe(0);
  });

  it('exhausts after max tool calls', () => {
    const budget = new IterationBudget({ maxToolCalls: 3, timeoutMs: 60_000, graceMessage: true });
    budget.start();

    expect(budget.recordToolCall()).toBe(false);
    expect(budget.recordToolCall()).toBe(false);
    expect(budget.recordToolCall()).toBe(true);
    expect(budget.isExhausted()).toBe(true);
  });

  it('detects timeout', () => {
    vi.useFakeTimers();
    const budget = new IterationBudget({ maxToolCalls: 100, timeoutMs: 5_000, graceMessage: true });
    budget.start();

    expect(budget.isTimeoutExceeded()).toBe(false);
    vi.advanceTimersByTime(5_001);
    expect(budget.isTimeoutExceeded()).toBe(true);
    expect(budget.isExhausted()).toBe(true);
  });

  it('treats timeoutMs as inactivity timeout', () => {
    vi.useFakeTimers();
    const budget = new IterationBudget({ maxToolCalls: 100, timeoutMs: 5_000, graceMessage: true });
    budget.start();

    vi.advanceTimersByTime(4_000);
    budget.recordActivity('task_progress');
    vi.advanceTimersByTime(4_000);

    expect(budget.isTimeoutExceeded()).toBe(false);
    expect(budget.timeUntilInterruptMs).toBe(1_000);
    expect(budget.stats).toMatchObject({
      elapsedMs: 8_000,
      idleMs: 4_000,
      lastEventType: 'task_progress',
    });
  });

  it('honors absolute timeout even when activity continues', () => {
    vi.useFakeTimers();
    const budget = new IterationBudget({
      maxToolCalls: 100,
      timeoutMs: 5_000,
      absoluteTimeoutMs: 10_000,
      graceMessage: true,
    });
    budget.start();

    vi.advanceTimersByTime(4_000);
    budget.recordActivity('task_progress');
    vi.advanceTimersByTime(4_000);
    budget.recordActivity('partial_text');
    vi.advanceTimersByTime(2_001);

    expect(budget.isTimeoutExceeded()).toBe(false);
    expect(budget.timeUntilInterruptMs).toBe(0);
    expect(budget.isAbsoluteTimeoutExceeded()).toBe(true);
    expect(budget.isExhausted()).toBe(true);
  });

  it('tracks stats correctly', () => {
    vi.useFakeTimers();
    const budget = new IterationBudget({ maxToolCalls: 100, timeoutMs: 60_000, graceMessage: false });
    budget.start();

    budget.recordToolCall();
    budget.recordToolCall();
    vi.advanceTimersByTime(3_000);

    const stats = budget.stats;
    expect(stats.toolCalls).toBe(2);
    expect(stats.elapsedMs).toBe(3_000);
    expect(stats.idleMs).toBe(3_000);
  });

  it('graceMessage reflects config', () => {
    const withGrace = new IterationBudget({ maxToolCalls: 5, timeoutMs: 10_000, graceMessage: true });
    expect(withGrace.graceMessage).toBe(true);

    const noGrace = new IterationBudget({ maxToolCalls: 5, timeoutMs: 10_000, graceMessage: false });
    expect(noGrace.graceMessage).toBe(false);
  });

  it('uses default config', () => {
    const budget = new IterationBudget();
    budget.start();

    for (let i = 0; i < 29; i++) {
      expect(budget.recordToolCall()).toBe(false);
    }
    expect(budget.recordToolCall()).toBe(true);
  });

  describe('getPressureWarning', () => {
    it('returns null at 0% usage', () => {
      const budget = new IterationBudget({ maxToolCalls: 10, timeoutMs: 60_000, graceMessage: true });
      budget.start();
      expect(budget.getPressureWarning()).toBeNull();
    });

    it('returns null at 69% usage', () => {
      const budget = new IterationBudget({ maxToolCalls: 100, timeoutMs: 60_000, graceMessage: true });
      budget.start();
      for (let i = 0; i < 69; i++) budget.recordToolCall();
      expect(budget.getPressureWarning()).toBeNull();
    });

    it('returns 70% warning at exactly 70% usage', () => {
      const budget = new IterationBudget({ maxToolCalls: 10, timeoutMs: 60_000, graceMessage: true });
      budget.start();
      for (let i = 0; i < 7; i++) budget.recordToolCall();
      expect(budget.getPressureWarning()).toBe('⚠️ 70% of iteration budget used. Consolidate your work.');
    });

    it('returns 70% warning at 89% usage', () => {
      const budget = new IterationBudget({ maxToolCalls: 100, timeoutMs: 60_000, graceMessage: true });
      budget.start();
      for (let i = 0; i < 89; i++) budget.recordToolCall();
      expect(budget.getPressureWarning()).toBe('⚠️ 70% of iteration budget used. Consolidate your work.');
    });

    it('returns 90% warning at exactly 90% usage', () => {
      const budget = new IterationBudget({ maxToolCalls: 10, timeoutMs: 60_000, graceMessage: true });
      budget.start();
      for (let i = 0; i < 9; i++) budget.recordToolCall();
      expect(budget.getPressureWarning()).toBe('⚠️ 90% of iteration budget used. Respond NOW with what you have.');
    });

    it('returns 90% warning at 100% usage', () => {
      const budget = new IterationBudget({ maxToolCalls: 10, timeoutMs: 60_000, graceMessage: true });
      budget.start();
      for (let i = 0; i < 10; i++) budget.recordToolCall();
      expect(budget.getPressureWarning()).toBe('⚠️ 90% of iteration budget used. Respond NOW with what you have.');
    });
  });
});

describe('startBudgetWatchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onExpire after absolute timeout + grace', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    startBudgetWatchdog(10_000, onExpire, { graceMs: 1_000 });

    vi.advanceTimersByTime(10_999);
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('cancel() prevents onExpire from firing', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const handle = startBudgetWatchdog(5_000, onExpire);

    vi.advanceTimersByTime(4_000);
    handle.cancel();
    vi.advanceTimersByTime(10_000);

    expect(onExpire).not.toHaveBeenCalled();
  });

  it('is a no-op when absoluteTimeoutMs is undefined', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const handle = startBudgetWatchdog(undefined, onExpire);

    vi.advanceTimersByTime(60_000);
    expect(onExpire).not.toHaveBeenCalled();
    expect(() => handle.cancel()).not.toThrow();
  });

  it('is a no-op when absoluteTimeoutMs is zero', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    startBudgetWatchdog(0, onExpire);
    vi.advanceTimersByTime(60_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('swallows onExpire callback throws so cancel() stays safe', () => {
    vi.useFakeTimers();
    const handle = startBudgetWatchdog(1_000, () => {
      throw new Error('boom');
    }, { graceMs: 0 });

    expect(() => vi.advanceTimersByTime(1_001)).not.toThrow();
    expect(() => handle.cancel()).not.toThrow();
  });

  it('fires exactly once even if cancel() is called after expiry', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const handle = startBudgetWatchdog(500, onExpire, { graceMs: 0 });

    vi.advanceTimersByTime(501);
    handle.cancel();
    vi.advanceTimersByTime(10_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
