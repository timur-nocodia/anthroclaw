import { describe, it, expect } from 'vitest';
import { validateSafetyProfile } from '../validate.js';
import type { AgentYml } from '../../../config/schema.js';

const base = (overrides: Partial<AgentYml>): AgentYml => ({
  routes: [{ channel: 'telegram', scope: 'dm' }],
  safety_profile: 'public',
  ...overrides,
} as AgentYml);

describe('validateSafetyProfile', () => {
  it('public + no allowlist + safe mcp_tools → ok', () => {
    const r = validateSafetyProfile(base({ mcp_tools: ['memory_search'] }));
    expect(r.ok).toBe(true);
  });

  it('public + manage_cron without override → fatal', () => {
    const r = validateSafetyProfile(base({ mcp_tools: ['manage_cron'] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/manage_cron/);
    expect(r.error).toMatch(/safety_profile/);
  });

  it('public + manage_cron with allow_tools override → ok with WARN', () => {
    const r = validateSafetyProfile(base({
      mcp_tools: ['manage_cron'],
      safety_overrides: { allow_tools: ['manage_cron'] },
    }));
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('manage_cron'))).toBe(true);
  });

  it('public + access_control even with override → fatal (HARD_BLACKLIST)', () => {
    const r = validateSafetyProfile(base({
      mcp_tools: ['access_control'],
      safety_overrides: { allow_tools: ['access_control'] },
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/access_control/);
    expect(r.error).toMatch(/HARD_BLACKLIST|hard.blacklist/i);
  });

  it('private + 0 peers → fatal', () => {
    const r = validateSafetyProfile(base({
      safety_profile: 'private',
      allowlist: {},
    }));
    expect(r.ok).toBe(false);
  });

  it('private + 2 peers in same channel → fatal', () => {
    const r = validateSafetyProfile(base({
      safety_profile: 'private',
      allowlist: { telegram: ['1', '2'] },
    }));
    expect(r.ok).toBe(false);
  });

  it('private + exactly 1 peer → ok', () => {
    const r = validateSafetyProfile(base({
      safety_profile: 'private',
      allowlist: { telegram: ['1'] },
    }));
    expect(r.ok).toBe(true);
  });

  it('public + bypass permission_mode → fatal', () => {
    const r = validateSafetyProfile(base({
      safety_overrides: { permission_mode: 'bypass' },
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/bypass.*private/i);
  });

  it('private + bypass permission_mode → ok with WARN', () => {
    const r = validateSafetyProfile(base({
      safety_profile: 'private',
      allowlist: { telegram: ['1'] },
      safety_overrides: { permission_mode: 'bypass' },
    }));
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => /bypass/i.test(w))).toBe(true);
  });

  it('public + specific peer in allowlist → ok with WARN', () => {
    const r = validateSafetyProfile(base({
      allowlist: { telegram: ['12345'] },
    }));
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('error message includes "Options:" guide', () => {
    const r = validateSafetyProfile(base({ mcp_tools: ['manage_cron'] }));
    expect(r.error).toMatch(/Options:/);
  });

  it('builds error message with allowed-in info per tool', () => {
    const r = validateSafetyProfile(base({ mcp_tools: ['manage_cron', 'access_control'] }));
    expect(r.error).toMatch(/manage_cron.*allowed in.*trusted.*private/);
    expect(r.error).toMatch(/access_control.*allowed in.*private/);
  });
});
