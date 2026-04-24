import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { jitteredBackoff, withRetry } from '../../src/errors/retry.js';
import { FailoverReason, type ClassifiedError } from '../../src/errors/classifier.js';

// ---------------------------------------------------------------------------
// Mock logger so tests don't emit pino output
// ---------------------------------------------------------------------------

vi.mock('../../src/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// jitteredBackoff
// ---------------------------------------------------------------------------

describe('jitteredBackoff', () => {
  it('returns a value >= baseDelay for attempt 1', () => {
    const delay = jitteredBackoff(1, { baseDelay: 1000, jitterRatio: 0 });
    // With jitter 0, delay === baseDelay exactly
    expect(delay).toBe(1000);
  });

  it('doubles the base each attempt (no jitter)', () => {
    const opts = { baseDelay: 1000, jitterRatio: 0, maxDelay: 1_000_000 };
    expect(jitteredBackoff(1, opts)).toBe(1000);
    expect(jitteredBackoff(2, opts)).toBe(2000);
    expect(jitteredBackoff(3, opts)).toBe(4000);
    expect(jitteredBackoff(4, opts)).toBe(8000);
  });

  it('caps at maxDelay', () => {
    const opts = { baseDelay: 1000, maxDelay: 3000, jitterRatio: 0 };
    expect(jitteredBackoff(10, opts)).toBe(3000);
  });

  it('adds jitter within expected range', () => {
    const base = 1000;
    const jitterRatio = 0.5;
    // With jitter, attempt 1 delay should be in [1000, 1500)
    for (let i = 0; i < 50; i++) {
      const d = jitteredBackoff(1, { baseDelay: base, jitterRatio });
      expect(d).toBeGreaterThanOrEqual(base);
      expect(d).toBeLessThan(base + jitterRatio * base);
    }
  });

  it('uses default values when no opts provided', () => {
    const d = jitteredBackoff(1);
    // Default base=5000, jitter=0.5 → [5000, 7500)
    expect(d).toBeGreaterThanOrEqual(5000);
    expect(d).toBeLessThan(7500);
  });
});

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable errors and eventually succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Something completely unexpected'))
      .mockRejectedValueOnce(new Error('Something completely unexpected'))
      .mockResolvedValue('recovered');

    const promise = withRetry(fn, {
      maxAttempts: 3,
      baseDelay: 100,
      jitterRatio: 0,
    });

    // Advance through retry delays
    await vi.advanceTimersByTimeAsync(100); // first retry delay
    await vi.advanceTimersByTimeAsync(200); // second retry delay

    const result = await promise;
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on non-retryable errors', async () => {
    const err = Object.assign(new Error('Invalid API key'), { status: 401 });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(
      withRetry(fn, { maxAttempts: 3 }),
    ).rejects.toThrow('Invalid API key');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws the last error when all retries exhausted', async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      throw new Error('Something completely unexpected');
    });

    const promise = withRetry(fn, {
      maxAttempts: 2,
      baseDelay: 50,
      jitterRatio: 0,
    });

    // Catch the rejection early to avoid unhandled rejection warnings
    const settled = promise.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(50);

    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Something completely unexpected');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('calls onClassified for each attempt', async () => {
    const classified: { reason: FailoverReason; attempt: number }[] = [];
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Something completely unexpected'))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, {
      maxAttempts: 3,
      baseDelay: 50,
      jitterRatio: 0,
      onClassified(c, attempt) {
        classified.push({ reason: c.reason, attempt });
      },
    });

    await vi.advanceTimersByTimeAsync(50);
    await promise;

    expect(classified).toHaveLength(1);
    expect(classified[0]!.attempt).toBe(1);
    expect(classified[0]!.reason).toBe(FailoverReason.Unknown);
  });

  it('does not retry billing errors (non-retryable)', async () => {
    const err = Object.assign(new Error('Payment required'), { status: 402 });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(
      withRetry(fn, { maxAttempts: 5 }),
    ).rejects.toThrow('Payment required');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries rate limit errors', async () => {
    const rateLimitErr = Object.assign(new Error('Too many requests'), { status: 429 });
    const fn = vi.fn()
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValue('done');

    const promise = withRetry(fn, {
      maxAttempts: 3,
      baseDelay: 100,
      jitterRatio: 0,
    });

    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries server errors and backs off exponentially', async () => {
    const serverErr = Object.assign(new Error('Internal error'), { status: 500 });
    const fn = vi.fn()
      .mockRejectedValueOnce(serverErr) // attempt 1 fails
      .mockRejectedValueOnce(serverErr) // attempt 2 fails
      .mockResolvedValue('finally');    // attempt 3 succeeds

    const promise = withRetry(fn, {
      maxAttempts: 3,
      baseDelay: 100,
      jitterRatio: 0,
    });

    // First retry delay: 100ms (100 * 2^0)
    await vi.advanceTimersByTimeAsync(100);
    // Second retry delay: 200ms (100 * 2^1)
    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toBe('finally');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('defaults to 3 maxAttempts', async () => {
    const fn = vi.fn(async () => {
      throw new Error('Something completely unexpected');
    });

    const promise = withRetry(fn, { baseDelay: 10, jitterRatio: 0 });

    // Catch early to avoid unhandled rejection warnings
    const settled = promise.catch((e: unknown) => e);

    // Advance through both retry delays
    await vi.advanceTimersByTimeAsync(10);  // retry after attempt 1
    await vi.advanceTimersByTimeAsync(20);  // retry after attempt 2

    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
