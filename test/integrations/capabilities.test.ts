import { describe, expect, it } from 'vitest';
import { buildIntegrationCapabilityMatrix } from '../../src/integrations/capabilities.js';
import type { GlobalConfig } from '../../src/config/schema.js';

function baseConfig(): GlobalConfig {
  return {
    defaults: {
      model: 'claude-sonnet-4-6',
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
      debounce_ms: 0,
    },
  };
}

describe('integration capability matrix', () => {
  it('marks configured and requested MCP tools as available', () => {
    const matrix = buildIntegrationCapabilityMatrix(
      {
        ...baseConfig(),
        brave: { api_key: 'brave-key' },
      },
      [{
        id: 'researcher',
        config: {
          routes: [{ channel: 'telegram', scope: 'dm' }],
          timezone: 'UTC',
          mcp_tools: ['memory_search', 'web_search_brave'],
        },
      }],
      {},
      123,
    );

    expect(matrix.generatedAt).toBe(123);
    expect(matrix.capabilities.find((capability) => capability.id === 'memory.core')).toMatchObject({
      status: 'available',
      enabledForAgents: ['researcher'],
    });
    expect(matrix.capabilities.find((capability) => capability.id === 'web.brave')).toMatchObject({
      status: 'available',
      requiredConfig: ['brave.api_key'],
      enabledForAgents: ['researcher'],
    });
  });

  it('separates missing config from disabled capabilities', () => {
    const matrix = buildIntegrationCapabilityMatrix(
      baseConfig(),
      [{
        id: 'researcher',
        config: {
          routes: [{ channel: 'telegram', scope: 'dm' }],
          timezone: 'UTC',
          mcp_tools: ['web_search_exa'],
        },
      }],
      {},
    );

    expect(matrix.capabilities.find((capability) => capability.id === 'web.exa')).toMatchObject({
      status: 'missing_config',
      reason: 'Missing required configuration: exa.api_key',
      enabledForAgents: ['researcher'],
    });
    expect(matrix.capabilities.find((capability) => capability.id === 'web.brave')).toMatchObject({
      status: 'disabled',
      enabledForAgents: [],
    });
  });

  it('reports STT provider availability without exposing secrets', () => {
    const matrix = buildIntegrationCapabilityMatrix(
      {
        ...baseConfig(),
        assemblyai: { api_key: 'assembly-key' },
      },
      [],
      {
        OPENAI_API_KEY: 'openai-key',
      },
    );

    expect(matrix.capabilities.find((capability) => capability.id === 'stt.assemblyai')).toMatchObject({
      status: 'available',
      provider: 'assemblyai',
      toolNames: [],
      enabledForAgents: [],
    });
    expect(matrix.capabilities.find((capability) => capability.id === 'stt.openai')).toMatchObject({
      status: 'available',
      requiredConfig: ['OPENAI_API_KEY'],
    });
    expect(matrix.capabilities.find((capability) => capability.id === 'stt.elevenlabs')).toMatchObject({
      status: 'missing_config',
      requiredConfig: ['ELEVENLABS_API_KEY'],
    });
    expect(JSON.stringify(matrix)).not.toContain('assembly-key');
    expect(JSON.stringify(matrix)).not.toContain('openai-key');
  });
});
