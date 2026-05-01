import { describe, it, expect, vi } from 'vitest';
import { createNotificationsEmitter } from '../emitter.js';

describe('NotificationsEmitter — scaffold', () => {
  it('exists and accepts subscriptions', () => {
    const emitter = createNotificationsEmitter({ sendMessage: vi.fn() });
    expect(typeof emitter.emit).toBe('function');
    expect(typeof emitter.subscribe).toBe('function');
    expect(typeof emitter.subscribeAgent).toBe('function');
    expect(typeof emitter.unsubscribeAgent).toBe('function');
  });

  it('subscribeAgent with undefined cfg is a no-op (and unsubscribes prior config)', () => {
    const emitter = createNotificationsEmitter({ sendMessage: vi.fn() });
    emitter.subscribeAgent('amina', {
      enabled: true,
      routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
      subscriptions: [{ event: 'peer_pause_started', route: 'operator' }],
    });
    expect(() => emitter.subscribeAgent('amina', undefined)).not.toThrow();
    expect(() => emitter.unsubscribeAgent('amina')).not.toThrow();
  });

  it('emit returns a Promise (awaitable) even with no subscribers', async () => {
    const emitter = createNotificationsEmitter({ sendMessage: vi.fn() });
    await expect(
      emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'wa:b:1' }),
    ).resolves.toBeUndefined();
  });
});
