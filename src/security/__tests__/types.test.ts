import { describe, it, expect } from 'vitest';
import type { ToolMeta, ProfileName } from '../types.js';

describe('ToolMeta type', () => {
  it('accepts a fully-specified meta object', () => {
    const meta: ToolMeta = {
      category: 'agent-config',
      safe_in_public: false,
      safe_in_trusted: true,
      safe_in_private: true,
      destructive: true,
      reads_only: false,
      hard_blacklist_in: ['public'],
    };
    expect(meta.category).toBe('agent-config');
    expect(meta.hard_blacklist_in).toContain('public');
  });

  it('ProfileName is one of the three values', () => {
    const a: ProfileName = 'public';
    const b: ProfileName = 'trusted';
    const c: ProfileName = 'private';
    expect([a, b, c]).toEqual(['public', 'trusted', 'private']);
  });
});
