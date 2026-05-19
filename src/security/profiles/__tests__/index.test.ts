import { describe, it, expect } from 'vitest';
import { getProfile, ALL_PROFILES, getDefaultProfile, chatLikeAnthroclawProfile } from '../index.js';

describe('profile registry', () => {
  it('returns publicProfile for "public"', () => {
    expect(getProfile('public').name).toBe('public');
  });

  it('returns trustedProfile for "trusted"', () => {
    expect(getProfile('trusted').name).toBe('trusted');
  });

  it('returns privateProfile for "private"', () => {
    expect(getProfile('private').name).toBe('private');
  });

  it('throws on unknown name', () => {
    expect(() => getProfile('admin' as any)).toThrow(/unknown safety_profile/i);
  });

  it('ALL_PROFILES contains all three', () => {
    expect(ALL_PROFILES.map((p) => p.name).sort()).toEqual(['chat_like_anthroclaw', 'private', 'public', 'trusted']);
  });
});

describe('profiles registry', () => {
  it('getProfile("chat_like_anthroclaw") returns chatLikeAnthroclawProfile', () => {
    expect(getProfile('chat_like_anthroclaw')).toBe(chatLikeAnthroclawProfile);
  });

  it('getProfile("chat_like_openclaw") remains a legacy alias', () => {
    expect(getProfile('chat_like_openclaw')).toBe(chatLikeAnthroclawProfile);
  });

  it('ALL_PROFILES contains chat profile', () => {
    expect(ALL_PROFILES.some((p) => p.name === 'chat_like_anthroclaw')).toBe(true);
  });

  it('getDefaultProfile returns "chat_like_anthroclaw"', () => {
    expect(getDefaultProfile()).toBe('chat_like_anthroclaw');
  });
});
