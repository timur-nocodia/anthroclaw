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

  it('allows learning.mode=auto_private only for private agents', () => {
    const trusted = AgentYmlSchema.safeParse({
      ...baseAgent,
      safety_profile: 'trusted',
      learning: { enabled: true, mode: 'auto_private' },
    });
    expect(trusted.success).toBe(false);

    const privateAgent = AgentYmlSchema.safeParse({
      ...baseAgent,
      safety_profile: 'private',
      learning: { enabled: true, mode: 'auto_private' },
    });
    expect(privateAgent.success).toBe(true);
  });

  it('rejects learning.enabled=true with mode=off', () => {
    const r = AgentYmlSchema.safeParse({
      ...baseAgent,
      safety_profile: 'private',
      learning: { enabled: true, mode: 'off' },
    });
    expect(r.success).toBe(false);
  });
});
