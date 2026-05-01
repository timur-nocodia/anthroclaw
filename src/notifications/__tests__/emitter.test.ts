import { describe, it, expect, vi } from 'vitest';
import { createNotificationsEmitter, parseThrottle } from '../emitter.js';

describe('NotificationsEmitter — scaffold', () => {
  it('exists and exposes the public surface', () => {
    const emitter = createNotificationsEmitter({ sendMessage: vi.fn() });
    expect(typeof emitter.emit).toBe('function');
    expect(typeof emitter.subscribe).toBe('function');
    expect(typeof emitter.subscribeAgent).toBe('function');
    expect(typeof emitter.unsubscribeAgent).toBe('function');
  });

  it('emit returns a Promise (awaitable) even with no subscribers', async () => {
    const emitter = createNotificationsEmitter({ sendMessage: vi.fn() });
    await expect(
      emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'wa:b:1' }),
    ).resolves.toBeUndefined();
  });
});

describe('NotificationsEmitter — subscription dispatch', () => {
  it('emit calls sendMessage on each matching subscription', async () => {
    const sendMessage = vi.fn();
    const emitter = createNotificationsEmitter({ sendMessage });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', account_id: 'control', peer_id: '48705953' } },
      subscriptions: [{ event: 'peer_pause_started', route: 'operator' }],
    });
    await emitter.emit('peer_pause_started', {
      agentId: 'amina',
      peerKey: 'wa:b:1',
      expiresAt: '2026-05-01T12:30:00Z',
    });
    expect(sendMessage).toHaveBeenCalledOnce();
    const [route, text, meta] = sendMessage.mock.calls[0]!;
    expect(route).toMatchObject({ channel: 'telegram', account_id: 'control', peer_id: '48705953' });
    expect(text).toContain('Auto-pause');
    expect(text).toContain('amina');
    expect(meta).toMatchObject({ event: 'peer_pause_started', agentId: 'amina' });
  });

  it('does not match unsubscribed events', async () => {
    const sendMessage = vi.fn();
    const emitter = createNotificationsEmitter({ sendMessage });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', account_id: 'control', peer_id: '48705953' } },
      subscriptions: [{ event: 'peer_pause_started', route: 'operator' }],
    });
    await emitter.emit('peer_pause_ended', { agentId: 'amina', peerKey: 'wa:b:1' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('skips when notifications.enabled is false', async () => {
    const sendMessage = vi.fn();
    const emitter = createNotificationsEmitter({ sendMessage });
    emitter.subscribeAgent('amina', {
      enabled: false,
      routes: { operator: { channel: 'telegram', account_id: 'control', peer_id: '48705953' } },
      subscriptions: [{ event: 'peer_pause_started', route: 'operator' }],
    });
    await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'wa:b:1' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('emits to multiple subscriptions on the same event', async () => {
    const sendMessage = vi.fn();
    const emitter = createNotificationsEmitter({ sendMessage });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: {
        operator: { channel: 'telegram', account_id: 'control', peer_id: '48705953' },
        team: { channel: 'whatsapp', account_id: 'business', peer_id: '37120@s.whatsapp.net' },
      },
      subscriptions: [
        { event: 'peer_pause_started', route: 'operator' },
        { event: 'peer_pause_started', route: 'team' },
      ],
    });
    await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'wa:b:1' });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('skips subscriptions with unresolved route name (logs warn)', async () => {
    const sendMessage = vi.fn();
    const emitter = createNotificationsEmitter({ sendMessage });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: {},
      subscriptions: [{ event: 'peer_pause_started', route: 'missing' }],
    });
    await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'wa:b:1' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('subscribe(agent, sub, route) is equivalent to subscribeAgent for a single sub', async () => {
    const sendMessage = vi.fn();
    const emitter = createNotificationsEmitter({ sendMessage });
    emitter.subscribe(
      'amina',
      { event: 'peer_pause_started', route: 'operator' },
      { channel: 'telegram', account_id: 'control', peer_id: '48705953' },
    );
    await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'wa:b:1' });
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('subscribeAgent(undefined) clears prior subscription', async () => {
    const sendMessage = vi.fn();
    const emitter = createNotificationsEmitter({ sendMessage });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', account_id: 'control', peer_id: '48705953' } },
      subscriptions: [{ event: 'peer_pause_started', route: 'operator' }],
    });
    emitter.subscribeAgent('amina', undefined);
    await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'wa:b:1' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('subscribeAgent is idempotent — second call replaces, not appends', async () => {
    const sendMessage = vi.fn();
    const emitter = createNotificationsEmitter({ sendMessage });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', account_id: 'control', peer_id: '48705953' } },
      subscriptions: [{ event: 'peer_pause_started', route: 'operator' }],
    });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', account_id: 'control', peer_id: '48705953' } },
      subscriptions: [{ event: 'peer_pause_ended', route: 'operator' }],
    });
    await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'wa:b:1' });
    expect(sendMessage).not.toHaveBeenCalled();
    await emitter.emit('peer_pause_ended', { agentId: 'amina', peerKey: 'wa:b:1' });
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});

describe('NotificationsEmitter — throttle', () => {
  it('throttle dedupes identical events within window', async () => {
    const sendMessage = vi.fn();
    let now = 1_700_000_000_000;
    const emitter = createNotificationsEmitter({ sendMessage, clock: () => now });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', account_id: 'control', peer_id: '48705953' } },
      subscriptions: [{ event: 'peer_pause_started', route: 'operator', throttle: '5m' }],
    });
    const payload = { agentId: 'amina', peerKey: 'wa:b:1' };
    await emitter.emit('peer_pause_started', payload);
    await emitter.emit('peer_pause_started', payload); // within window — dropped
    expect(sendMessage).toHaveBeenCalledTimes(1);
    now += 6 * 60_000;
    await emitter.emit('peer_pause_started', payload); // window passed → fires
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('throttle key incorporates peerKey — different peers do not throttle each other', async () => {
    const sendMessage = vi.fn();
    let now = 1_700_000_000_000;
    const emitter = createNotificationsEmitter({ sendMessage, clock: () => now });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', account_id: 'control', peer_id: '48705953' } },
      subscriptions: [{ event: 'peer_pause_started', route: 'operator', throttle: '5m' }],
    });
    await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'wa:b:1' });
    await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'wa:b:2' });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('malformed throttle is treated as no-throttle', async () => {
    const sendMessage = vi.fn();
    const emitter = createNotificationsEmitter({ sendMessage });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', account_id: 'control', peer_id: '48705953' } },
      subscriptions: [{ event: 'peer_pause_started', route: 'operator', throttle: 'whenever' }],
    });
    await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'wa:b:1' });
    await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'wa:b:1' });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('LRU eviction — touched entries survive cap eviction', async () => {
    // Cap=3, insert A,B,C, then touch A; the next insert (D) should
    // evict the least-recently-used (B), not A.
    const sendMessage = vi.fn();
    let now = 1_700_000_000_000;
    const emitter = createNotificationsEmitter({
      sendMessage,
      clock: () => now,
      throttleMaxEntries: 3,
    });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', account_id: 'control', peer_id: '48705953' } },
      subscriptions: [{ event: 'peer_pause_started', route: 'operator', throttle: '5m' }],
    });
    const peers = ['A', 'B', 'C', 'D'];
    // Insert A, B, C (each populates a throttle entry).
    for (const p of peers.slice(0, 3)) {
      await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: p });
    }
    // Touch A (re-emit while throttled is the cheapest way to bump LRU,
    // but emit returns early on hit. Simulate with a direct re-emit by
    // advancing slightly past window for A only — instead rely on an
    // explicit re-emit for A with same payload after throttle clears
    // would also bump. Cleaner: emit A again with an extra payload key
    // that does not affect dedupe — dedupe key uses peerKey, so a second
    // emit for A within window is a hit and updates noteThrottle? No —
    // hit returns BEFORE noteThrottle. To touch A reliably we re-emit
    // after window; the throttle window is 5m so advance and emit A.
    now += 6 * 60_000;
    await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'A' });
    // Now A was inserted most-recently. Insert D (cap=3) → oldest is B.
    await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'D' });
    // Verify by checking that B re-emit within window still fires (its
    // entry was evicted, so no throttle hit), while A and C re-emit
    // within window are throttled (still in map).
    const before = sendMessage.mock.calls.length;
    // Re-emit A within current window — should be throttled (entry alive).
    await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'A' });
    // Re-emit B within window — should fire (entry evicted).
    await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'B' });
    expect(sendMessage.mock.calls.length).toBe(before + 1);
    expect(sendMessage.mock.calls.at(-1)![1]).toContain('B');
  });

  it('scheduled events bypass throttle (cron is the rate limit)', async () => {
    // peer_pause_summary_daily must fire on every cron tick even if a
    // throttle is configured — the cron schedule itself bounds cadence,
    // and a process restart clears the throttle map but not the cron.
    const sendMessage = vi.fn();
    let now = 1_700_000_000_000;
    const emitter = createNotificationsEmitter({ sendMessage, clock: () => now });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', account_id: 'control', peer_id: '48705953' } },
      subscriptions: [
        { event: 'peer_pause_summary_daily', route: 'operator', schedule: '0 9 * * *', throttle: '1h' },
      ],
    });
    await emitter.fireScheduled('peer_pause_summary_daily', { agentId: 'amina' });
    // Within throttle window — must still fire (scheduled-event bypass).
    now += 30_000;
    await emitter.fireScheduled('peer_pause_summary_daily', { agentId: 'amina' });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe('parseThrottle', () => {
  it('parses common forms', () => {
    expect(parseThrottle('30s')).toBe(30_000);
    expect(parseThrottle('5m')).toBe(300_000);
    expect(parseThrottle('1h')).toBe(3_600_000);
    expect(parseThrottle('90m')).toBe(5_400_000);
  });
  it('returns null for malformed', () => {
    expect(parseThrottle('')).toBeNull();
    expect(parseThrottle(undefined)).toBeNull();
    expect(parseThrottle('5')).toBeNull();
    expect(parseThrottle('m')).toBeNull();
    expect(parseThrottle('5d')).toBeNull();
    expect(parseThrottle('-5m')).toBeNull();
  });
});
