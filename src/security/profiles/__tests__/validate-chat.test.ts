import { describe, it, expect } from 'vitest';
import { validateSafetyProfile } from '../validate.js';
import type { AgentYml } from '../../../config/schema.js';

const baseChat: AgentYml = {
  routes: [{ channel: 'telegram', scope: 'dm' }],
  safety_profile: 'chat_like_openclaw',
  timezone: 'UTC',
} as unknown as AgentYml;

describe('validateSafetyProfile on chat profile', () => {
  it('accepts wildcard allowlist', () => {
    const result = validateSafetyProfile({
      ...baseChat,
      allowlist: { telegram: ['*'] },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts permission_mode=bypass', () => {
    const result = validateSafetyProfile({
      ...baseChat,
      safety_overrides: { permission_mode: 'bypass' },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts permission_mode=default (explicit opt-in to approval flow)', () => {
    const result = validateSafetyProfile({
      ...baseChat,
      safety_overrides: { permission_mode: 'default' },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.find((w) => w.includes('permission_mode=default'))).toBeUndefined();
  });

  it('emits info-warning when allow_tools is set on chat (no-op)', () => {
    const result = validateSafetyProfile({
      ...baseChat,
      safety_overrides: { allow_tools: ['Bash'] },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) =>
      w.includes('safety_overrides.allow_tools') && w.includes('chat_like_openclaw'),
    )).toBe(true);
  });

  it('does NOT warn about deny_tools (it has real effect)', () => {
    const result = validateSafetyProfile({
      ...baseChat,
      safety_overrides: { deny_tools: ['Bash'] },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.find((w) => w.includes('deny_tools'))).toBeUndefined();
  });

  it('emits info-warning when personality is set on non-chat profile', () => {
    const result = validateSafetyProfile({
      ...baseChat,
      safety_profile: 'trusted',
      personality: 'be warm',
    } as unknown as AgentYml);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('personality') && w.includes('trusted'))).toBe(true);
  });
});
