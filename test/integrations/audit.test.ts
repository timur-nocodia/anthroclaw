import { describe, expect, it } from 'vitest';
import { classifyIntegrationToolName } from '../../src/integrations/audit.js';

describe('integration audit classification', () => {
  it('classifies local and SDK MCP tool names', () => {
    expect(classifyIntegrationToolName('web_search_brave')).toEqual({
      capabilityId: 'web.brave',
      provider: 'brave',
      localToolName: 'web_search_brave',
    });
    expect(classifyIntegrationToolName('mcp__helper-tools__memory_write')).toEqual({
      capabilityId: 'memory.core',
      provider: 'anthroclaw-memory',
      localToolName: 'memory_write',
    });
    expect(classifyIntegrationToolName('mcp__helper-tools__local_note_search')).toEqual({
      capabilityId: 'notes.local',
      provider: 'anthroclaw-notes',
      localToolName: 'local_note_search',
    });
    expect(classifyIntegrationToolName('mcp__helper-tools__local_note_propose')).toEqual({
      capabilityId: 'notes.proposals',
      provider: 'anthroclaw-notes',
      localToolName: 'local_note_propose',
    });
  });

  it('ignores non-integration SDK tools', () => {
    expect(classifyIntegrationToolName('Read')).toBeUndefined();
    expect(classifyIntegrationToolName('Bash')).toBeUndefined();
  });
});
