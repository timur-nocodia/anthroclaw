import { describe, it, expect } from 'vitest';
import { createAgentConfigWriter } from '../writer.js';

describe('AgentConfigWriter — basic shape', () => {
  it('exports the factory and surface API', () => {
    const writer = createAgentConfigWriter({ agentsDir: '/tmp/non-existent' });
    expect(typeof writer.patchSection).toBe('function');
    expect(typeof writer.readSection).toBe('function');
    expect(typeof writer.readFullConfig).toBe('function');
  });
});
