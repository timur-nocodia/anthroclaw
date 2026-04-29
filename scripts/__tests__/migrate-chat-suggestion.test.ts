import { describe, it, expect } from 'vitest';
import { inferProfile } from '../migrate-safety-profile.js';

describe('inferProfile chat suggestions', () => {
  it('suggests chat_like_openclaw when safety_overrides.permission_mode=bypass', () => {
    const result = inferProfile({
      allowlist: { telegram: ['12345'] },
      pairing: { mode: 'off' },
      safety_overrides: { permission_mode: 'bypass' },
    } as any);
    expect(result.profile).toBe('chat_like_openclaw');
    expect(result.reason).toContain('bypass');
  });

  it('suggests chat_like_openclaw when wildcard in allowlist (instead of public)', () => {
    const result = inferProfile({
      allowlist: { telegram: ['*'] },
      pairing: { mode: 'off' },
    } as any);
    expect(result.profile).toBe('chat_like_openclaw');
    expect(result.reason.toLowerCase()).toContain('wildcard');
  });

  it('suggests chat_like_openclaw on minimal/empty config (default)', () => {
    const result = inferProfile({} as any);
    expect(result.profile).toBe('chat_like_openclaw');
  });

  it('still suggests private for clean single-peer allowlist (no bypass)', () => {
    const result = inferProfile({
      allowlist: { telegram: ['12345'] },
      pairing: { mode: 'off' },
    } as any);
    expect(result.profile).toBe('private');
  });

  it('still suggests trusted for paired multi-peer config', () => {
    const result = inferProfile({
      allowlist: { telegram: ['12345', '67890'] },
      pairing: { mode: 'approve' },
    } as any);
    expect(result.profile).toBe('trusted');
  });
});
