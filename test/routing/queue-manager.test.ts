import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueueManager } from '../../src/routing/queue-manager.js';

/** Create a mock Query object with an interrupt() method */
function mockQuery(interruptFn?: () => Promise<void>) {
  return {
    interrupt: interruptFn ?? vi.fn().mockResolvedValue(undefined),
    next: vi.fn(),
    return: vi.fn(),
    throw: vi.fn(),
    [Symbol.asyncIterator]() { return this; },
  } as any;
}

describe('QueueManager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('register / unregister / isActive basic operations', () => {
    const qm = new QueueManager();
    const q = mockQuery();
    const abort = new AbortController();

    expect(qm.isActive('session-1')).toBe(false);

    qm.register('session-1', q, abort);
    expect(qm.isActive('session-1')).toBe(true);

    qm.unregister('session-1');
    expect(qm.isActive('session-1')).toBe(false);
  });

  it('tracks active run metadata and activity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const qm = new QueueManager();
    const abort = new AbortController();

    qm.register('session-1', mockQuery(), abort, {
      traceId: 'trace-1',
      channelDeliveryTarget: {
        channel: 'telegram',
        peerId: 'peer-1',
        accountId: 'default',
        threadId: 'topic-1',
      },
    });

    expect(qm.getActive('session-1')).toMatchObject({
      sessionKey: 'session-1',
      registeredAt: 1_000,
      lastActivityAt: 1_000,
      lastEventType: 'registered',
      activeTaskIds: [],
      traceId: 'trace-1',
      channelDeliveryTarget: {
        channel: 'telegram',
        peerId: 'peer-1',
      },
    });

    vi.setSystemTime(2_000);
    qm.markActivity('session-1', 'task_progress', 'task-1');
    qm.markActivity('session-1', 'task_progress', 'task-1');
    expect(qm.getActive('session-1')).toMatchObject({
      lastActivityAt: 2_000,
      lastEventType: 'task_progress',
      activeTaskIds: ['task-1'],
    });

    vi.setSystemTime(3_000);
    qm.markTaskFinished('session-1', 'task-1', 'task_completed');
    expect(qm.getActive('session-1')).toMatchObject({
      lastActivityAt: 3_000,
      lastEventType: 'task_completed',
      activeTaskIds: [],
    });
  });

  it('lists active sessions as immutable views', () => {
    const qm = new QueueManager();
    qm.register('session-1', mockQuery(), new AbortController(), { traceId: 'trace-1' });
    qm.markActivity('session-1', 'task_progress', 'task-1');

    const [view] = qm.listActive();
    view.activeTaskIds.push('mutated');

    expect(qm.getActive('session-1')?.activeTaskIds).toEqual(['task-1']);
  });

  it('handleConflict returns "proceed" when no active query', async () => {
    const qm = new QueueManager();
    const result = await qm.handleConflict('session-1', 'steer');
    expect(result).toBe('proceed');
  });

  it('handleConflict with "collect" mode returns "queued"', async () => {
    const qm = new QueueManager();
    const q = mockQuery();
    const abort = new AbortController();
    qm.register('session-1', q, abort);

    const result = await qm.handleConflict('session-1', 'collect');
    expect(result).toBe('queued');
    // Entry should still be active (not removed)
    expect(qm.isActive('session-1')).toBe(true);
  });

  it('handleConflict with "steer" mode calls interrupt() and returns "proceed"', async () => {
    const qm = new QueueManager();
    const interruptFn = vi.fn().mockResolvedValue(undefined);
    const q = mockQuery(interruptFn);
    const abort = new AbortController();
    qm.register('session-1', q, abort);

    const result = await qm.handleConflict('session-1', 'steer');
    expect(result).toBe('proceed');
    expect(interruptFn).toHaveBeenCalledOnce();
    expect(abort.signal.aborted).toBe(true);
    expect(qm.isActive('session-1')).toBe(false);
  });

  it('handleConflict with "interrupt" mode calls interrupt() and returns "skip"', async () => {
    const qm = new QueueManager();
    const interruptFn = vi.fn().mockResolvedValue(undefined);
    const q = mockQuery(interruptFn);
    const abort = new AbortController();
    qm.register('session-1', q, abort);

    const result = await qm.handleConflict('session-1', 'interrupt');
    expect(result).toBe('skip');
    expect(interruptFn).toHaveBeenCalledOnce();
    expect(abort.signal.aborted).toBe(true);
    expect(qm.isActive('session-1')).toBe(false);
  });

  it('stop() aborts all active queries', () => {
    const qm = new QueueManager();
    const abort1 = new AbortController();
    const abort2 = new AbortController();
    qm.register('session-1', mockQuery(), abort1);
    qm.register('session-2', mockQuery(), abort2);

    expect(qm.isActive('session-1')).toBe(true);
    expect(qm.isActive('session-2')).toBe(true);

    qm.stop();

    expect(qm.isActive('session-1')).toBe(false);
    expect(qm.isActive('session-2')).toBe(false);
    expect(abort1.signal.aborted).toBe(true);
    expect(abort2.signal.aborted).toBe(true);
  });

  it('error in interrupt() does not throw', async () => {
    const qm = new QueueManager();
    const interruptFn = vi.fn().mockRejectedValue(new Error('already finished'));
    const q = mockQuery(interruptFn);
    const abort = new AbortController();
    qm.register('session-1', q, abort);

    // Should not throw even though interrupt() rejects
    const result = await qm.handleConflict('session-1', 'steer');
    expect(result).toBe('proceed');
    expect(interruptFn).toHaveBeenCalledOnce();
    expect(abort.signal.aborted).toBe(true);
    expect(qm.isActive('session-1')).toBe(false);
  });

  it('error in interrupt() does not throw for interrupt mode', async () => {
    const qm = new QueueManager();
    const interruptFn = vi.fn().mockRejectedValue(new Error('already finished'));
    const q = mockQuery(interruptFn);
    const abort = new AbortController();
    qm.register('session-1', q, abort);

    const result = await qm.handleConflict('session-1', 'interrupt');
    expect(result).toBe('skip');
    expect(interruptFn).toHaveBeenCalledOnce();
    expect(abort.signal.aborted).toBe(true);
  });
});
