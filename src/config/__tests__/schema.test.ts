import { describe, it, expect } from 'vitest';
import { GlobalConfigSchema, AgentYmlSchema } from '../schema.js';

describe('plugins config schema', () => {
  // Minimal valid AgentYml with all required fields
  const minimalValidAgentYml = {
    routes: [{ channel: 'telegram' }],
    memory_extraction: undefined,
    subagents: undefined,
  };

  it('GlobalConfigSchema accepts plugins.{name}.defaults section', () => {
    const result = GlobalConfigSchema.safeParse({
      plugins: { lcm: { defaults: { enabled: false, foo: 'bar' } } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plugins?.lcm?.defaults?.enabled).toBe(false);
    }
  });

  it('AgentYmlSchema accepts plugins.{name}.enabled', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      plugins: { lcm: { enabled: true } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plugins?.lcm?.enabled).toBe(true);
    }
  });

  it('AgentYmlSchema accepts plugins.{name} with extra fields (passthrough)', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      plugins: { lcm: { enabled: true, customSetting: 42 } },
    });
    expect(result.success).toBe(true);
  });

  it('plugins section is fully optional in GlobalConfigSchema', () => {
    const result = GlobalConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plugins).toBeUndefined();
    }
  });

  it('plugins section is fully optional in AgentYmlSchema', () => {
    const result = AgentYmlSchema.safeParse(minimalValidAgentYml);
    expect(result.success).toBe(true);
  });

  it('AgentYmlSchema rejects plugins.{name}.enabled with non-boolean', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      plugins: { lcm: { enabled: 'yes' } },     // not a boolean
    });
    expect(result.success).toBe(false);
  });
});
