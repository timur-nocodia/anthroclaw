import { describe, it, expect, vi, afterEach } from 'vitest';
import { runWithFinalizeTimeout } from '../../src/session/finalize-timeout.js';

describe('runWithFinalizeTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the wrapped value when the promise settles before the timeout', async () => {
    const onTimeout = vi.fn();
    const result = await runWithFinalizeTimeout(Promise.resolve('done'), 1_000, onTimeout);

    expect(result).toBe('done');
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('resolves with undefined and invokes onTimeout when the promise never settles', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const neverSettles = new Promise<void>(() => {});

    const racePromise = runWithFinalizeTimeout(neverSettles, 5_000, onTimeout);
    await vi.advanceTimersByTimeAsync(5_001);
    const result = await racePromise;

    expect(result).toBeUndefined();
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('propagates errors thrown by the wrapped promise without invoking onTimeout', async () => {
    const onTimeout = vi.fn();
    const failure = Promise.reject(new Error('finalize failed'));

    await expect(runWithFinalizeTimeout(failure, 1_000, onTimeout)).rejects.toThrow('finalize failed');
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('clears the timeout so the process can exit naturally after the promise resolves', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const fast = Promise.resolve('ok');

    await runWithFinalizeTimeout(fast, 10_000, onTimeout);
    await vi.advanceTimersByTimeAsync(15_000);

    expect(onTimeout).not.toHaveBeenCalled();
  });
});
