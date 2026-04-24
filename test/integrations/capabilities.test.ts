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
      permissionDefaults: {
        defaultBehavior: 'deny',
        allowMcp: true,
        allowedMcpTools: ['web_search_brave'],
      },
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
      requiredConfig: ['stt.openai.api_key or OPENAI_API_KEY'],
      permissionDefaults: {
        defaultBehavior: 'deny',
        notes: ['STT runs before SDK query execution; it is not exposed as an SDK MCP tool.'],
      },
    });
    expect(matrix.capabilities.find((capability) => capability.id === 'stt.elevenlabs')).toMatchObject({
      status: 'missing_config',
      requiredConfig: ['stt.elevenlabs.api_key or ELEVENLABS_API_KEY'],
    });
    expect(JSON.stringify(matrix)).not.toContain('assembly-key');
    expect(JSON.stringify(matrix)).not.toContain('openai-key');
  });

  it('does not recommend high-risk mutation tools by default', () => {
    const matrix = buildIntegrationCapabilityMatrix(
      baseConfig(),
      [{
        id: 'ops',
        config: {
          routes: [{ channel: 'telegram', scope: 'dm' }],
          timezone: 'UTC',
          mcp_tools: ['manage_skills', 'manage_cron'],
        },
      }],
      {},
    );

    expect(matrix.capabilities.find((capability) => capability.id === 'skills.local')).toMatchObject({
      permissionDefaults: {
        defaultBehavior: 'deny',
        allowedMcpTools: ['list_skills'],
      },
    });
    expect(matrix.capabilities.find((capability) => capability.id === 'cron.manage')).toMatchObject({
      status: 'available',
      permissionDefaults: {
        defaultBehavior: 'deny',
        allowedMcpTools: [],
      },
    });
  });

  it('adds configured external MCP servers to the capability matrix', () => {
    const matrix = buildIntegrationCapabilityMatrix(
      baseConfig(),
      [{
        id: 'ops',
        config: {
          routes: [{ channel: 'telegram', scope: 'dm' }],
          timezone: 'UTC',
          external_mcp_servers: {
            calendar: {
              type: 'stdio',
              command: 'npx',
              args: ['google-calendar-mcp'],
              env: { GOOGLE_CLIENT_SECRET: 'secret' },
              allowed_tools: ['calendar_daily_brief', 'calendar_lookup'],
            },
          },
        },
      }],
      {},
    );

    expect(matrix.capabilities.find((capability) => capability.id === 'external_mcp.calendar')).toMatchObject({
      kind: 'mcp_tool',
      provider: 'calendar',
      status: 'available',
      risk: 'high',
      toolNames: ['mcp__calendar__calendar_daily_brief', 'mcp__calendar__calendar_lookup'],
      enabledForAgents: ['ops'],
      permissionDefaults: {
        defaultBehavior: 'deny',
        allowMcp: true,
        allowedMcpTools: ['mcp__calendar__calendar_daily_brief', 'mcp__calendar__calendar_lookup'],
      },
    });
    expect(JSON.stringify(matrix)).not.toContain('secret');
  });
});
