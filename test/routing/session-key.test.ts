import { describe, it, expect } from 'vitest';
import { buildSessionKey } from '../../src/routing/session-key.js';

describe('buildSessionKey', () => {
  it('builds DM key', () => {
    expect(buildSessionKey('jarvis', 'telegram', 'dm', '123456')).toBe(
      'jarvis:telegram:dm:123456',
    );
  });

  it('builds group key', () => {
    expect(buildSessionKey('support', 'whatsapp', 'group', '-100123')).toBe(
      'support:whatsapp:group:-100123',
    );
  });

  it('builds key with thread', () => {
    expect(
      buildSessionKey('jarvis', 'telegram', 'group', '-100123', '42'),
    ).toBe('jarvis:telegram:group:-100123:thread:42');
  });
});
