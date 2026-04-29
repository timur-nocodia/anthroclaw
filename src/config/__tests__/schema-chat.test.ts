import { describe, it, expect } from 'vitest';
import { AgentYmlSchema } from '../schema.js';

const baseConfig = {
  routes: [{ channel: 'telegram' as const, scope: 'dm' as const }],
};

describe('AgentYmlSchema chat extensions', () => {
  it('accepts safety_profile=chat_like_openclaw', () => {
    const result = AgentYmlSchema.safeParse({
      ...baseConfig,
      safety_profile: 'chat_like_openclaw',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional personality string', () => {
    const result = AgentYmlSchema.safeParse({
      ...baseConfig,
      safety_profile: 'chat_like_openclaw',
      personality: 'You are warm and chatty.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.personality).toBe('You are warm and chatty.');
    }
  });

  it('personality field is optional (undefined when missing)', () => {
    const result = AgentYmlSchema.safeParse({
      ...baseConfig,
      safety_profile: 'chat_like_openclaw',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.personality).toBeUndefined();
    }
  });

  it('rejects non-string personality', () => {
    const result = AgentYmlSchema.safeParse({
      ...baseConfig,
      safety_profile: 'chat_like_openclaw',
      personality: 42,
    });
    expect(result.success).toBe(false);
  });

  it('keeps backward compat: public/trusted/private still valid', () => {
    for (const p of ['public', 'trusted', 'private'] as const) {
      const r = AgentYmlSchema.safeParse({ ...baseConfig, safety_profile: p });
      expect(r.success).toBe(true);
    }
  });
});
