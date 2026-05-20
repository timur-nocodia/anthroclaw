import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApprovalBroker } from '../approval-broker.js';
import { ApprovalStore } from '../approval-store.js';

describe('ApprovalBroker', () => {
  let broker: ApprovalBroker;

  beforeEach(() => {
    broker = new ApprovalBroker();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Legacy resolve() API (backward compat) ─────────────────────────────────

  it('resolves allow when caller calls resolve(allow)', async () => {
    const promise = broker.request('id-1', 60_000, 'sender-1', { a: 1 });
    broker.resolve('id-1', 'allow');
    const result = await promise;
    expect(result.behavior).toBe('allow');
  });

  it('resolves deny when caller calls resolve(deny)', async () => {
    const promise = broker.request('id-2', 60_000, 'sender-1', {});
    broker.resolve('id-2', 'deny');
    const result = await promise;
    expect(result.behavior).toBe('deny');
  });

  it('returns deny on timeout', async () => {
    const promise = broker.request('id-3', 1000, 'sender-1', {});
    vi.advanceTimersByTime(1500);
    const result = await promise;
    expect(result.behavior).toBe('deny');
    expect((result as any).message).toMatch(/did not respond/i);
    expect(broker.get('id-3')).toMatchObject({ status: 'expired' });
  });

  it('handles concurrent requests independently', async () => {
    const p1 = broker.request('id-4', 60_000, 'sender-1', {});
    const p2 = broker.request('id-5', 60_000, 'sender-2', {});
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
    const promise = broker.request('id-6', 60_000, 'sender-1', {});
    broker.resolve('id-6', 'allow');
    await promise;
    vi.advanceTimersByTime(120_000);
    expect(true).toBe(true);
  });

  // ─── updatedInput preserved through broker ──────────────────────────────────

  it('allow preserves originalInput in updatedInput', async () => {
    const input = { foo: 'bar', nested: { x: 1 } };
    const promise = broker.request('id-7', 60_000, 'sender-1', input);
    broker.resolve('id-7', 'allow');
    const result = await promise;
    expect(result.behavior).toBe('allow');
    expect((result as any).updatedInput).toEqual(input);
  });

  it('deny does not return updatedInput', async () => {
    const input = { secret: 'data' };
    const promise = broker.request('id-8', 60_000, 'sender-1', input);
    broker.resolve('id-8', 'deny');
    const result = await promise;
    expect(result.behavior).toBe('deny');
    expect((result as any).updatedInput).toBeUndefined();
  });

  // ─── resolveBySender — sender authentication ────────────────────────────────

  it('resolveBySender: matching sender allow → resolves allow + input preserved', async () => {
    const input = { foo: 'bar' };
    const promise = broker.request('xyz', 60_000, 'sender-A', input);
    const ok = broker.resolveBySender('xyz', 'sender-A', 'allow');
    expect(ok).toBe(true);
    const result = await promise;
    expect(result.behavior).toBe('allow');
    expect((result as any).updatedInput).toEqual(input);
  });

  it('resolveBySender: matching sender deny → resolves deny', async () => {
    const promise = broker.request('xyz2', 60_000, 'sender-A', {});
    const ok = broker.resolveBySender('xyz2', 'sender-A', 'deny');
    expect(ok).toBe(true);
    const result = await promise;
    expect(result.behavior).toBe('deny');
  });

  it('resolveBySender: mismatched sender → returns false, pending stays active', async () => {
    const promise = broker.request('xyz3', 60_000, 'sender-A', { foo: 'bar' });
    const ok = broker.resolveBySender('xyz3', 'sender-B', 'allow');
    expect(ok).toBe(false);

    // The request must still be pending — resolve it properly to clean up
    const ok2 = broker.resolveBySender('xyz3', 'sender-A', 'allow');
    expect(ok2).toBe(true);
    const result = await promise;
    expect(result.behavior).toBe('allow');
  });

  it('resolveBySender: unknown id → returns false', () => {
    expect(broker.resolveBySender('nonexistent', 'anyone', 'allow')).toBe(false);
  });

  it('persists pending approvals and allows resolution after broker restart', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'approval-store-test-'));
    try {
      const file = join(tmpDir, 'approvals.json');
      const first = new ApprovalBroker(new ApprovalStore(file));
      first.request('restart-1', 60_000, 'sender-A', { foo: 'bar' });

      const second = new ApprovalBroker(new ApprovalStore(file));
      expect(second.listPending().map((record) => record.id)).toEqual(['restart-1']);
      expect(second.resolveBySender('restart-1', 'sender-A', 'allow')).toBe(true);

      const third = new ApprovalBroker(new ApprovalStore(file));
      expect(third.get('restart-1')).toMatchObject({
        status: 'allowed',
        resolvedBy: 'sender-A',
        decision: 'allow',
        originalInput: { foo: 'bar' },
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('prevents replay after an approval has been resolved', async () => {
    const promise = broker.request('replay-1', 60_000, 'sender-A', {});
    expect(broker.resolveBySender('replay-1', 'sender-A', 'allow')).toBe(true);
    expect(broker.resolveBySender('replay-1', 'sender-A', 'deny')).toBe(false);

    const result = await promise;
    expect(result.behavior).toBe('allow');
    expect(broker.get('replay-1')).toMatchObject({
      status: 'allowed',
      decision: 'allow',
      resolvedBy: 'sender-A',
    });
  });
});
