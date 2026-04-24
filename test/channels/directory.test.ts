import { describe, it, expect, beforeEach } from 'vitest';
import { ChannelDirectory, type ChannelEntry } from '../../src/channels/directory.js';

const ENTRIES: ChannelEntry[] = [
  { platform: 'telegram', peerId: 'tg-123', name: 'Alice', type: 'dm', accountId: 'bot1' },
  { platform: 'telegram', peerId: 'tg-456', name: 'Bob Builder', type: 'dm', accountId: 'bot1' },
  { platform: 'whatsapp', peerId: 'wa-789', name: 'Alice Wonder', type: 'dm', accountId: 'wa1' },
  { platform: 'telegram', peerId: 'tg-grp-1', name: 'Dev Team', type: 'group', accountId: 'bot1' },
  { platform: 'whatsapp', peerId: 'wa-grp-2', name: 'Dev Ops', type: 'group', accountId: 'wa1' },
];

describe('ChannelDirectory', () => {
  let dir: ChannelDirectory;

  beforeEach(() => {
    dir = new ChannelDirectory();
  });

  // ─── update ─────────────────────────────────────────────────────

  it('update() replaces entries and sets lastRefresh', () => {
    expect(dir.list()).toEqual([]);
    dir.update(ENTRIES);
    expect(dir.list()).toHaveLength(5);
    expect(dir.staleMs).toBeLessThan(100);
  });

  it('update() replaces previous entries entirely', () => {
    dir.update(ENTRIES);
    dir.update([ENTRIES[0]]);
    expect(dir.list()).toHaveLength(1);
  });

  // ─── lookup ─────────────────────────────────────────────────────

  it('lookup() returns case-insensitive substring matches', () => {
    dir.update(ENTRIES);
    const results = dir.lookup('alice');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name)).toContain('Alice');
    expect(results.map((r) => r.name)).toContain('Alice Wonder');
  });

  it('lookup() filters by platform when specified', () => {
    dir.update(ENTRIES);
    const results = dir.lookup('alice', 'whatsapp');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Alice Wonder');
  });

  it('lookup() returns empty array for no matches', () => {
    dir.update(ENTRIES);
    expect(dir.lookup('nonexistent')).toEqual([]);
  });

  it('lookup() matches partial name', () => {
    dir.update(ENTRIES);
    const results = dir.lookup('dev');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name)).toContain('Dev Team');
    expect(results.map((r) => r.name)).toContain('Dev Ops');
  });

  // ─── list ───────────────────────────────────────────────────────

  it('list() returns all entries', () => {
    dir.update(ENTRIES);
    expect(dir.list()).toHaveLength(5);
  });

  it('list() filters by platform', () => {
    dir.update(ENTRIES);
    expect(dir.list('telegram')).toHaveLength(3);
    expect(dir.list('whatsapp')).toHaveLength(2);
  });

  it('list() returns empty array when no entries', () => {
    expect(dir.list()).toEqual([]);
  });

  it('list() returns a copy, not the internal array', () => {
    dir.update(ENTRIES);
    const result = dir.list();
    result.pop();
    expect(dir.list()).toHaveLength(5);
  });

  // ─── resolve ────────────────────────────────────────────────────

  it('resolve() matches by exact peerId', () => {
    dir.update(ENTRIES);
    const result = dir.resolve('tg-123');
    expect(result?.name).toBe('Alice');
  });

  it('resolve() falls back to name lookup', () => {
    dir.update(ENTRIES);
    const result = dir.resolve('Bob Builder');
    expect(result?.peerId).toBe('tg-456');
  });

  it('resolve() prefers peerId over name match', () => {
    const entries: ChannelEntry[] = [
      { platform: 'telegram', peerId: 'Alice', name: 'Something', type: 'dm', accountId: 'bot1' },
      { platform: 'telegram', peerId: 'tg-999', name: 'Alice', type: 'dm', accountId: 'bot1' },
    ];
    dir.update(entries);
    const result = dir.resolve('Alice');
    // Should match peerId='Alice' first
    expect(result?.name).toBe('Something');
  });

  it('resolve() respects platform filter', () => {
    dir.update(ENTRIES);
    const result = dir.resolve('Alice', 'whatsapp');
    expect(result?.name).toBe('Alice Wonder');
  });

  it('resolve() returns undefined for no match', () => {
    dir.update(ENTRIES);
    expect(dir.resolve('nonexistent')).toBeUndefined();
  });

  // ─── staleMs ────────────────────────────────────────────────────

  it('staleMs reflects time since last update', async () => {
    dir.update(ENTRIES);
    // Immediately after update, staleMs should be very small
    expect(dir.staleMs).toBeLessThan(50);
  });

  it('staleMs is large before any update', () => {
    // lastRefresh = 0, so staleMs = Date.now() - 0 ≈ Date.now()
    expect(dir.staleMs).toBeGreaterThan(1_000_000);
  });
});
