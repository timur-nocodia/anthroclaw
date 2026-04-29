import { describe, it, expect } from 'vitest';
import { publicProfile } from '../public.js';
import { BUILTIN_META } from '../../builtin-tool-meta.js';

describe('publicProfile', () => {
  it('uses string system prompt mode', () => {
    expect(publicProfile.systemPrompt.mode).toBe('string');
  });

  it('settingSources is empty', () => {
    expect(publicProfile.settingSources).toEqual([]);
  });

  it('Read is in built-in allowed set', () => {
    expect(publicProfile.builtinTools.allowed.has('Read')).toBe(true);
  });

  it('Bash is in built-in forbidden set and hard blacklist', () => {
    expect(publicProfile.builtinTools.forbidden.has('Bash')).toBe(true);
    expect(publicProfile.hardBlacklist.has('Bash')).toBe(true);
  });

  it('Write is forbidden', () => {
    expect(publicProfile.builtinTools.forbidden.has('Write')).toBe(true);
  });

  it('mcp policy: rejects tools with safe_in_public=false', () => {
    expect(publicProfile.mcpToolPolicy.allowedByMeta(BUILTIN_META.Bash)).toBe(false);
    expect(publicProfile.mcpToolPolicy.allowedByMeta(BUILTIN_META.Read)).toBe(true);
  });

  it('mcp policy: nothing requires approval (strict-deny mode)', () => {
    expect(publicProfile.mcpToolPolicy.requiresApproval(BUILTIN_META.Bash)).toBe(false);
  });

  it('permissionFlow is strict-deny', () => {
    expect(publicProfile.permissionFlow).toBe('strict-deny');
  });

  it('rateLimitFloor enforces 30/hour', () => {
    expect(publicProfile.rateLimitFloor).toEqual({ windowMs: 3_600_000, max: 30 });
  });

  it('validateAllowlist: ok for empty allowlist', () => {
    const result = publicProfile.validateAllowlist(undefined);
    expect(result.ok).toBe(true);
  });

  it('validateAllowlist: ok for [*]', () => {
    const result = publicProfile.validateAllowlist({ telegram: ['*'] });
    expect(result.ok).toBe(true);
  });

  it('validateAllowlist: warns for specific peer ids', () => {
    const result = publicProfile.validateAllowlist({ telegram: ['12345'] });
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
