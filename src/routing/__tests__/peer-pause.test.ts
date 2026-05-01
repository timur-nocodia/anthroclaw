import { describe, it, expect } from 'vitest';
import { createPeerPauseStore } from '../peer-pause.js';

describe('PeerPauseStore — basic shape', () => {
  it('starts empty and reports unpaused for unknown peers', () => {
    const store = createPeerPauseStore({ filePath: ':memory:' });
    expect(store.list()).toEqual([]);
    const result = store.isPaused('amina', 'whatsapp:business:37120000@s.whatsapp.net');
    expect(result.paused).toBe(false);
    expect(result.entry).toBeUndefined();
  });
});

describe('PeerPauseStore — pause/unpause/extend', () => {
  const NOW = new Date('2026-05-01T12:00:00Z').getTime();
  const clock = () => NOW;

  it('pause sets entry with expiry and isPaused returns it', () => {
    const store = createPeerPauseStore({ filePath: ':memory:', clock });
    const entry = store.pause('amina', 'wa:b:1', {
      ttlMinutes: 30,
      reason: 'operator_takeover',
      source: 'whatsapp:fromMe',
    });
    expect(entry.expiresAt).toBe('2026-05-01T12:30:00.000Z');
    expect(entry.extendedCount).toBe(0);
    expect(entry.pausedAt).toBe('2026-05-01T12:00:00.000Z');
    expect(entry.lastOperatorMessageAt).toBe('2026-05-01T12:00:00.000Z');
    expect(store.isPaused('amina', 'wa:b:1')).toMatchObject({ paused: true, expired: false });
  });

  it('isPaused returns expired:true after TTL passes', () => {
    const t0 = NOW;
    let now = t0;
    const store = createPeerPauseStore({ filePath: ':memory:', clock: () => now });
    store.pause('amina', 'wa:b:1', { ttlMinutes: 30, reason: 'operator_takeover', source: 'wa' });
    now = t0 + 31 * 60 * 1000;
    const result = store.isPaused('amina', 'wa:b:1');
    expect(result.paused).toBe(true);
    expect(result.expired).toBe(true);
  });

  it('extend resets expiry and increments extendedCount', () => {
    let now = NOW;
    const store = createPeerPauseStore({ filePath: ':memory:', clock: () => now });
    store.pause('amina', 'wa:b:1', { ttlMinutes: 30, reason: 'operator_takeover', source: 'wa' });
    now = NOW + 10 * 60 * 1000;
    const ext = store.extend('amina', 'wa:b:1');
    expect(ext?.expiresAt).toBe('2026-05-01T12:40:00.000Z');
    expect(ext?.extendedCount).toBe(1);
    expect(ext?.lastOperatorMessageAt).toBe('2026-05-01T12:10:00.000Z');
  });

  it('extend on missing entry returns null', () => {
    const store = createPeerPauseStore({ filePath: ':memory:', clock });
    expect(store.extend('amina', 'wa:b:1')).toBeNull();
  });

  it('unpause removes the entry and returns the previous state', () => {
    const store = createPeerPauseStore({ filePath: ':memory:', clock });
    store.pause('amina', 'wa:b:1', { ttlMinutes: 30, reason: 'operator_takeover', source: 'wa' });
    const removed = store.unpause('amina', 'wa:b:1', 'manual');
    expect(removed?.peerKey).toBe('wa:b:1');
    expect(store.isPaused('amina', 'wa:b:1').paused).toBe(false);
  });

  it('unpause on missing entry returns null', () => {
    const store = createPeerPauseStore({ filePath: ':memory:', clock });
    expect(store.unpause('amina', 'wa:b:1', 'manual')).toBeNull();
  });

  it('indefinite pause has expiresAt: null and never reports expired', () => {
    let now = NOW;
    const store = createPeerPauseStore({ filePath: ':memory:', clock: () => now });
    store.pause('amina', 'wa:b:1', { reason: 'manual_indefinite', source: 'mcp:operator-console' });
    now = NOW + 100 * 24 * 60 * 60 * 1000;
    expect(store.isPaused('amina', 'wa:b:1')).toMatchObject({ paused: true, expired: false });
  });

  it('list returns all entries sorted by pausedAt asc; agentId filter applies', () => {
    let now = NOW;
    const store = createPeerPauseStore({ filePath: ':memory:', clock: () => now });
    store.pause('amina', 'wa:b:1', { ttlMinutes: 30, reason: 'operator_takeover', source: 'wa' });
    now = NOW + 60 * 1000;
    store.pause('amina', 'wa:b:2', { ttlMinutes: 30, reason: 'operator_takeover', source: 'wa' });
    store.pause('larry', 'wa:b:3', { ttlMinutes: 30, reason: 'operator_takeover', source: 'wa' });
    expect(store.list().map((e) => e.peerKey)).toEqual(['wa:b:1', 'wa:b:2', 'wa:b:3']);
    expect(store.list('amina').map((e) => e.peerKey)).toEqual(['wa:b:1', 'wa:b:2']);
    expect(store.list('larry').map((e) => e.peerKey)).toEqual(['wa:b:3']);
  });

  it('replacing a pause for the same peer overwrites prior entry, resets extendedCount', () => {
    let now = NOW;
    const store = createPeerPauseStore({ filePath: ':memory:', clock: () => now });
    store.pause('amina', 'wa:b:1', { ttlMinutes: 30, reason: 'operator_takeover', source: 'wa' });
    store.extend('amina', 'wa:b:1');
    now = NOW + 60 * 60 * 1000;
    const replaced = store.pause('amina', 'wa:b:1', { ttlMinutes: 60, reason: 'manual', source: 'mcp' });
    expect(replaced.extendedCount).toBe(0);
    expect(replaced.reason).toBe('manual');
    expect(replaced.expiresAt).toBe('2026-05-01T14:00:00.000Z');
  });
});
