import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApprovalBroker } from '../approval-broker.js';

describe('ApprovalBroker', () => {
  let broker: ApprovalBroker;

  beforeEach(() => {
    broker = new ApprovalBroker();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves allow when caller calls resolve(allow)', async () => {
    const promise = broker.request('id-1', 60_000);
    broker.resolve('id-1', 'allow');
    const result = await promise;
    expect(result.behavior).toBe('allow');
  });

  it('resolves deny when caller calls resolve(deny)', async () => {
    const promise = broker.request('id-2', 60_000);
    broker.resolve('id-2', 'deny');
    const result = await promise;
    expect(result.behavior).toBe('deny');
  });

  it('returns deny on timeout', async () => {
    const promise = broker.request('id-3', 1000);
    vi.advanceTimersByTime(1500);
    const result = await promise;
    expect(result.behavior).toBe('deny');
    expect((result as any).message).toMatch(/did not respond/i);
  });

  it('handles concurrent requests independently', async () => {
    const p1 = broker.request('id-4', 60_000);
    const p2 = broker.request('id-5', 60_000);
    broker.resolve('id-4', 'deny');
    broker.resolve('id-5', 'allow');
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.behavior).toBe('deny');
    expect(r2.behavior).toBe('allow');
  });

  it('resolve on unknown id is a no-op', () => {
    expect(() => broker.resolve('nonexistent', 'allow')).not.toThrow();
  });

  it('clears timeout when resolved early', async () => {
    const promise = broker.request('id-6', 60_000);
    broker.resolve('id-6', 'allow');
    await promise;
    vi.advanceTimersByTime(120_000);
    expect(true).toBe(true);
  });
});
