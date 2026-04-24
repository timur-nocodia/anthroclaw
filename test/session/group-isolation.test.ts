import { describe, it, expect } from 'vitest';
import { buildGroupSessionKey } from '../../src/session/group-isolation.js';

describe('buildGroupSessionKey', () => {
  it('returns baseKey unchanged in shared mode', () => {
    const result = buildGroupSessionKey('agent:tg:group:123', 'user-456', 'shared');
    expect(result).toBe('agent:tg:group:123');
  });

  it('appends senderId in per_user mode', () => {
    const result = buildGroupSessionKey('agent:tg:group:123', 'user-456', 'per_user');
    expect(result).toBe('agent:tg:group:123:user:user-456');
  });

  it('handles empty senderId in per_user mode', () => {
    const result = buildGroupSessionKey('base', '', 'per_user');
    expect(result).toBe('base:user:');
  });

  it('preserves complex baseKey in shared mode', () => {
    const base = 'bot:wa:group:120363@g.us:thread:abc';
    expect(buildGroupSessionKey(base, 'user-1', 'shared')).toBe(base);
  });
});
