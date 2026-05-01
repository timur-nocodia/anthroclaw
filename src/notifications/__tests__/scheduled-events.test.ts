import { describe, it, expect, vi } from 'vitest';
import { createNotificationsEmitter } from '../emitter.js';
import { createNotificationsScheduler } from '../scheduler.js';
import { createPeerPauseStore } from '../../routing/peer-pause.js';

describe('NotificationsEmitter — fireScheduled', () => {
  it('peer_pause_summary_daily fires at scheduled cron and emits aggregated payload', async () => {
    const sendMessage = vi.fn();
    const peerPauseStore = createPeerPauseStore({ filePath: ':memory:' });
    peerPauseStore.pause('amina', 'wa:b:1', { ttlMinutes: 30, reason: 'operator_takeover', source: 'wa' });
    peerPauseStore.pause('amina', 'wa:b:2', { ttlMinutes: 60, reason: 'operator_takeover', source: 'wa' });
    peerPauseStore.pause('larry', 'wa:b:3', { ttlMinutes: 30, reason: 'operator_takeover', source: 'wa' });

    const emitter = createNotificationsEmitter({ sendMessage, peerPauseStore });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
      subscriptions: [{ event: 'peer_pause_summary_daily', route: 'operator', schedule: '0 9 * * *' }],
    });

    await emitter.fireScheduled('peer_pause_summary_daily', { agentId: 'amina' });
    expect(sendMessage).toHaveBeenCalledOnce();
    const [, text] = sendMessage.mock.calls[0]!;
    expect(text).toContain('Daily pause summary');
    expect(text).toContain('Active pauses: 2');
    expect(text).toContain('wa:b:1');
    expect(text).toContain('wa:b:2');
    // Cross-agent pause must not leak into amina's summary.
    expect(text).not.toContain('wa:b:3');
  });

  it('summary fires with empty list when peerPauseStore is omitted', async () => {
    const sendMessage = vi.fn();
    const emitter = createNotificationsEmitter({ sendMessage });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
      subscriptions: [{ event: 'peer_pause_summary_daily', route: 'operator', schedule: '0 9 * * *' }],
    });
    await emitter.fireScheduled('peer_pause_summary_daily', { agentId: 'amina' });
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0]![1]).toContain('Active pauses: 0');
  });

  it('fireScheduled is a no-op when no subscription matches', async () => {
    const sendMessage = vi.fn();
    const emitter = createNotificationsEmitter({ sendMessage });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
      subscriptions: [{ event: 'peer_pause_started', route: 'operator' }],
    });
    await emitter.fireScheduled('peer_pause_summary_daily', { agentId: 'amina' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('fireScheduled respects enabled=false', async () => {
    const sendMessage = vi.fn();
    const emitter = createNotificationsEmitter({ sendMessage });
    emitter.subscribeAgent('amina', {
      enabled: false,
      routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
      subscriptions: [{ event: 'peer_pause_summary_daily', route: 'operator', schedule: '0 9 * * *' }],
    });
    await emitter.fireScheduled('peer_pause_summary_daily', { agentId: 'amina' });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('NotificationsScheduler', () => {
  it('registers one cron job per scheduled subscription', () => {
    const fireScheduled = vi.fn(async () => {});
    const subscribeAgent = vi.fn();
    const scheduler = createNotificationsScheduler({
      emitter: { subscribeAgent, fireScheduled },
      testNoStart: true,
    });
    scheduler.registerAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
      subscriptions: [
        { event: 'peer_pause_summary_daily', route: 'operator', schedule: '0 9 * * *' },
        { event: 'peer_pause_started', route: 'operator' }, // no schedule → not registered
      ],
    });
    expect(scheduler.listJobs()).toHaveLength(1);
    expect(scheduler.listJobs()[0]).toContain('amina');
    expect(scheduler.listJobs()[0]).toContain('peer_pause_summary_daily');
  });

  it('registerAgent is idempotent — replaces prior jobs for that agent', () => {
    const scheduler = createNotificationsScheduler({
      emitter: { subscribeAgent: vi.fn(), fireScheduled: vi.fn(async () => {}) },
      testNoStart: true,
    });
    scheduler.registerAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
      subscriptions: [
        { event: 'peer_pause_summary_daily', route: 'operator', schedule: '0 9 * * *' },
      ],
    });
    expect(scheduler.listJobs()).toHaveLength(1);
    scheduler.registerAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
      subscriptions: [
        { event: 'peer_pause_summary_daily', route: 'operator', schedule: '0 10 * * *' },
        { event: 'peer_pause_summary_daily', route: 'operator', schedule: '0 18 * * *' },
      ],
    });
    expect(scheduler.listJobs()).toHaveLength(2);
  });

  it('unregisterAgent removes jobs for that agent only', () => {
    const scheduler = createNotificationsScheduler({
      emitter: { subscribeAgent: vi.fn(), fireScheduled: vi.fn(async () => {}) },
      testNoStart: true,
    });
    scheduler.registerAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
      subscriptions: [{ event: 'peer_pause_summary_daily', route: 'operator', schedule: '0 9 * * *' }],
    });
    scheduler.registerAgent('larry', {
      enabled: true,
      routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
      subscriptions: [{ event: 'peer_pause_summary_daily', route: 'operator', schedule: '0 10 * * *' }],
    });
    expect(scheduler.listJobs()).toHaveLength(2);
    scheduler.unregisterAgent('amina');
    expect(scheduler.listJobs()).toHaveLength(1);
    expect(scheduler.listJobs()[0]).toContain('larry');
  });

  it('skips registration when notifications disabled', () => {
    const scheduler = createNotificationsScheduler({
      emitter: { subscribeAgent: vi.fn(), fireScheduled: vi.fn(async () => {}) },
      testNoStart: true,
    });
    scheduler.registerAgent('amina', {
      enabled: false,
      routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
      subscriptions: [{ event: 'peer_pause_summary_daily', route: 'operator', schedule: '0 9 * * *' }],
    });
    expect(scheduler.listJobs()).toHaveLength(0);
  });

  it('malformed cron expression is logged but does not throw', () => {
    const scheduler = createNotificationsScheduler({
      emitter: { subscribeAgent: vi.fn(), fireScheduled: vi.fn(async () => {}) },
      testNoStart: true,
    });
    expect(() =>
      scheduler.registerAgent('amina', {
        enabled: true,
        routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
        subscriptions: [{ event: 'peer_pause_summary_daily', route: 'operator', schedule: 'not a cron' }],
      }),
    ).not.toThrow();
    expect(scheduler.listJobs()).toHaveLength(0);
  });
});
