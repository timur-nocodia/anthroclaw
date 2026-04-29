import { describe, it, expect } from 'vitest';
import { inferProfile } from '../migrate-safety-profile.js';

describe('inferProfile', () => {
  it('single peer in 1 channel → private', () => {
    const cfg = { allowlist: { telegram: ['12345'] }, pairing: { mode: 'off' } } as any;
    expect(inferProfile(cfg).profile).toBe('private');
  });

  it('pairing.mode=open → public', () => {
    const cfg = { pairing: { mode: 'open' } } as any;
    expect(inferProfile(cfg).profile).toBe('public');
  });

  it('allowlist [*] → chat_like_openclaw (wildcard without pairing.open)', () => {
    const cfg = { allowlist: { telegram: ['*'] }, pairing: { mode: 'off' } } as any;
    expect(inferProfile(cfg).profile).toBe('chat_like_openclaw');
  });

  it('pairing.mode=approve with peers → trusted', () => {
    const cfg = { allowlist: { telegram: ['1', '2'] }, pairing: { mode: 'approve' } } as any;
    expect(inferProfile(cfg).profile).toBe('trusted');
  });

  it('pairing.mode=off without allowlist → chat_like_openclaw (minimal config default)', () => {
    const cfg = { pairing: { mode: 'off' } } as any;
    const r = inferProfile(cfg);
    expect(r.profile).toBe('chat_like_openclaw');
    expect(r.error).toBeUndefined();
  });

  it('flags incompatible tools (manage_cron in inferred public) for review', () => {
    const cfg = { pairing: { mode: 'open' }, mcp_tools: ['manage_cron'] } as any;
    const r = inferProfile(cfg);
    expect(r.profile).toBe('public');
    expect(r.toolConflicts).toContain('manage_cron');
  });

  it('flags HARD_BLACKLIST tools as needing manual review', () => {
    const cfg = { pairing: { mode: 'open' }, mcp_tools: ['access_control'] } as any;
    const r = inferProfile(cfg);
    expect(r.profile).toBe('public');
    expect(r.hardBlacklistConflicts).toContain('access_control');
  });
});
