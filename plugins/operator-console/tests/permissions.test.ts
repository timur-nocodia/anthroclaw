import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { canManage } from '../src/permissions.js';

describe('operator-console permissions', () => {
  it('canManage true when target listed in manages array', () => {
    const cfg = resolveConfig({ enabled: true, manages: ['amina'] });
    expect(canManage(cfg, 'amina')).toBe(true);
    expect(canManage(cfg, 'larry')).toBe(false);
  });

  it('manages: "*" allows any target', () => {
    const cfg = resolveConfig({ enabled: true, manages: '*' });
    expect(canManage(cfg, 'amina')).toBe(true);
    expect(canManage(cfg, 'literally-anyone')).toBe(true);
  });

  it('disabled config refuses everything (even with "*" manages)', () => {
    const cfg = resolveConfig({ enabled: false, manages: '*' });
    expect(canManage(cfg, 'amina')).toBe(false);
  });

  it('default config (no overrides) is disabled and refuses everything', () => {
    const cfg = resolveConfig(undefined);
    expect(cfg.enabled).toBe(false);
    expect(canManage(cfg, 'amina')).toBe(false);
  });

  it('empty manages array refuses every concrete target even when enabled', () => {
    const cfg = resolveConfig({ enabled: true, manages: [] });
    expect(canManage(cfg, 'amina')).toBe(false);
    expect(canManage(cfg, '')).toBe(false);
  });

  it('multi-target whitelist authorises only listed agents', () => {
    const cfg = resolveConfig({ enabled: true, manages: ['amina', 'larry'] });
    expect(canManage(cfg, 'amina')).toBe(true);
    expect(canManage(cfg, 'larry')).toBe(true);
    expect(canManage(cfg, 'mallory')).toBe(false);
  });

  it('capabilities default to all five tools', () => {
    const cfg = resolveConfig({ enabled: true, manages: '*' });
    expect(cfg.capabilities).toEqual([
      'peer_pause',
      'delegate',
      'list_peers',
      'peer_summary',
      'escalate',
    ]);
  });

  it('capabilities can be narrowed by config', () => {
    const cfg = resolveConfig({
      enabled: true,
      manages: '*',
      capabilities: ['peer_pause', 'escalate'],
    });
    expect(cfg.capabilities).toEqual(['peer_pause', 'escalate']);
  });
});
