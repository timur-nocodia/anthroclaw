import { describe, it, expect } from 'vitest';
import { getProfile, ALL_PROFILES } from '../index.js';

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
    expect(ALL_PROFILES.map((p) => p.name).sort()).toEqual(['private', 'public', 'trusted']);
  });
});
