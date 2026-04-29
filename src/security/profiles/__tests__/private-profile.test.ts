import { describe, it, expect } from 'vitest';
import { privateProfile } from '../private.js';
import { BUILTIN_META } from '../../builtin-tool-meta.js';

describe('privateProfile', () => {
  it('uses preset claude_code without excluding dynamic sections', () => {
    expect(privateProfile.systemPrompt).toEqual({
      mode: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: false,
    });
  });

  it('settingSources includes project and user', () => {
    expect(privateProfile.settingSources).toEqual(['project', 'user']);
  });

  it('all built-ins allowed', () => {
    for (const name of Object.keys(BUILTIN_META)) {
      expect(privateProfile.builtinTools.allowed.has(name)).toBe(true);
    }
    expect(privateProfile.builtinTools.forbidden.size).toBe(0);
  });

  it('Bash and WebFetch require approval', () => {
    expect(privateProfile.builtinTools.requiresApproval.has('Bash')).toBe(true);
    expect(privateProfile.builtinTools.requiresApproval.has('WebFetch')).toBe(true);
  });

  it('hardBlacklist is empty', () => {
    expect(privateProfile.hardBlacklist.size).toBe(0);
  });

  it('rateLimitFloor is null', () => {
    expect(privateProfile.rateLimitFloor).toBeNull();
  });

  it('validateAllowlist: accepts exactly 1 peer per channel', () => {
    expect(privateProfile.validateAllowlist({ telegram: ['12345'] })).toMatchObject({ ok: true });
  });

  it('validateAllowlist: rejects 0 peers', () => {
    const r = privateProfile.validateAllowlist({ telegram: [] });
    expect(r.ok).toBe(false);
  });

  it('validateAllowlist: rejects 2+ peers in same channel', () => {
    const r = privateProfile.validateAllowlist({ telegram: ['1', '2'] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/exactly 1/i);
  });

  it('validateAllowlist: rejects wildcard', () => {
    const r = privateProfile.validateAllowlist({ telegram: ['*'] });
    expect(r.ok).toBe(false);
  });

  it('validateAllowlist: rejects undefined allowlist', () => {
    const r = privateProfile.validateAllowlist(undefined);
    expect(r.ok).toBe(false);
  });

  it('validateAllowlist: ok with peers across multiple channels (1 each)', () => {
    expect(privateProfile.validateAllowlist({ telegram: ['1'], whatsapp: ['2'] })).toMatchObject({ ok: true });
  });
});
