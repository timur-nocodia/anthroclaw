import { describe, it, expect } from 'vitest';
import { AgentYmlSchema } from '../schema.js';

const baseAgent = {
  routes: [{ channel: 'telegram', scope: 'dm' }],
};

describe('AgentYmlSchema safety_profile', () => {
  it('rejects config without safety_profile', () => {
    const result = AgentYmlSchema.safeParse(baseAgent);
    expect(result.success).toBe(false);
  });

  it('accepts safety_profile=public', () => {
    const r = AgentYmlSchema.safeParse({ ...baseAgent, safety_profile: 'public' });
    expect(r.success).toBe(true);
  });

  it('accepts safety_profile=trusted', () => {
    const r = AgentYmlSchema.safeParse({ ...baseAgent, safety_profile: 'trusted' });
    expect(r.success).toBe(true);
  });

  it('accepts safety_profile=private', () => {
    const r = AgentYmlSchema.safeParse({ ...baseAgent, safety_profile: 'private' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown safety_profile', () => {
    const r = AgentYmlSchema.safeParse({ ...baseAgent, safety_profile: 'admin' });
    expect(r.success).toBe(false);
  });

  it('accepts safety_overrides', () => {
    const r = AgentYmlSchema.safeParse({
      ...baseAgent,
      safety_profile: 'public',
      safety_overrides: { allow_tools: ['manage_cron'], permission_mode: 'default' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown override field', () => {
    const r = AgentYmlSchema.safeParse({
      ...baseAgent,
      safety_profile: 'public',
      safety_overrides: { unknown_field: true },
    });
    expect(r.success).toBe(false);
  });
});
