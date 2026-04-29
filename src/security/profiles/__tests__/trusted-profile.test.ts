import { describe, it, expect } from 'vitest';
import { trustedProfile } from '../trusted.js';
import { BUILTIN_META } from '../../builtin-tool-meta.js';

describe('trustedProfile', () => {
  it('uses preset claude_code with excludeDynamicSections', () => {
    expect(trustedProfile.systemPrompt).toEqual({
      mode: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: true,
    });
  });

  it('settingSources includes project only', () => {
    expect(trustedProfile.settingSources).toEqual(['project']);
  });

  it('Write is allowed but requires approval', () => {
    expect(trustedProfile.builtinTools.allowed.has('Write')).toBe(true);
    expect(trustedProfile.builtinTools.requiresApproval.has('Write')).toBe(true);
  });

  it('Bash is forbidden', () => {
    expect(trustedProfile.builtinTools.forbidden.has('Bash')).toBe(true);
  });

  it('mcp policy: memory_write allowed without approval', () => {
    const memoryWriteMeta = { ...BUILTIN_META.Read, safe_in_trusted: true, destructive: false };
    expect(trustedProfile.mcpToolPolicy.allowedByMeta(memoryWriteMeta)).toBe(true);
    expect(trustedProfile.mcpToolPolicy.requiresApproval(memoryWriteMeta)).toBe(false);
  });

  it('mcp policy: destructive tools require approval', () => {
    const destructiveMeta = { ...BUILTIN_META.Write, safe_in_trusted: true, destructive: true };
    expect(trustedProfile.mcpToolPolicy.requiresApproval(destructiveMeta)).toBe(true);
  });

  it('hardBlacklist includes manage_skills and access_control', () => {
    expect(trustedProfile.hardBlacklist.has('manage_skills')).toBe(true);
    expect(trustedProfile.hardBlacklist.has('access_control')).toBe(true);
  });

  it('permissionFlow is interactive', () => {
    expect(trustedProfile.permissionFlow).toBe('interactive');
  });

  it('rateLimitFloor 100/hour', () => {
    expect(trustedProfile.rateLimitFloor).toEqual({ windowMs: 3_600_000, max: 100 });
  });

  it('validateAllowlist: rejects [*]', () => {
    const r = trustedProfile.validateAllowlist({ telegram: ['*'] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/wildcard/i);
  });

  it('validateAllowlist: ok for specific ids', () => {
    expect(trustedProfile.validateAllowlist({ telegram: ['12345', '67890'] })).toMatchObject({ ok: true });
  });
});
