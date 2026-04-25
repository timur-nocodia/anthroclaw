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
      configSnippet: [
        'mcp_tools:',
        '  - web_search_brave',
        'sdk:',
        '  permissions:',
        '    default_behavior: deny',
        '    allow_mcp: true',
        '    allowed_mcp_tools:',
        '      - web_search_brave',
      ].join('\n'),
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

  it('reports local notes as a read-only pilot integration', () => {
    const matrix = buildIntegrationCapabilityMatrix(
      baseConfig(),
      [{
        id: 'researcher',
        config: {
          routes: [{ channel: 'telegram', scope: 'dm' }],
          timezone: 'UTC',
          mcp_tools: ['local_note_search'],
        },
      }],
      {},
    );

    expect(matrix.capabilities.find((capability) => capability.id === 'notes.local')).toMatchObject({
      provider: 'anthroclaw-notes',
      status: 'available',
      risk: 'low',
      toolNames: ['local_note_search'],
      enabledForAgents: ['researcher'],
      permissionDefaults: {
        defaultBehavior: 'deny',
        allowMcp: true,
        allowedMcpTools: ['local_note_search'],
      },
      configSnippet: [
        'mcp_tools:',
        '  - local_note_search',
        'sdk:',
        '  permissions:',
        '    default_behavior: deny',
        '    allow_mcp: true',
        '    allowed_mcp_tools:',
        '      - local_note_search',
      ].join('\n'),
    });
  });

  it('shows calendar and gmail MCP presets before they are configured', () => {
    const matrix = buildIntegrationCapabilityMatrix(baseConfig(), [], {});

    expect(matrix.capabilities.find((capability) => capability.id === 'google.calendar')).toMatchObject({
      provider: 'google-calendar',
      status: 'disabled',
      toolNames: [
        'calendar_daily_brief',
        'calendar_availability',
        'calendar_event_lookup',
        'calendar_meeting_prep',
      ],
      enabledForAgents: [],
      reason: 'google-calendar preset is not configured on any loaded agent yet.',
    });
    expect(matrix.capabilities.find((capability) => capability.id === 'google.gmail')).toMatchObject({
      provider: 'gmail',
      status: 'disabled',
      risk: 'high',
      toolNames: ['gmail_search', 'gmail_thread_summary', 'gmail_draft_reply'],
      enabledForAgents: [],
    });
  });

  it('marks configured external MCP presets with missing env and SDK permission snippets', () => {
    const matrix = buildIntegrationCapabilityMatrix(
      baseConfig(),
      [{
        id: 'assistant',
        config: {
          routes: [{ channel: 'telegram', scope: 'dm' }],
          timezone: 'UTC',
          external_mcp_servers: {
            calendar: {
              type: 'stdio',
              command: 'npx',
              args: ['google-calendar-mcp'],
              env: {
                GOOGLE_CLIENT_ID: 'client-id',
                GOOGLE_CLIENT_SECRET: '',
                GOOGLE_REFRESH_TOKEN: 'refresh-token',
              },
              allowed_tools: ['calendar_daily_brief', 'calendar_availability'],
            },
          },
        },
      }],
      {},
    );

    expect(matrix.capabilities.find((capability) => capability.id === 'google.calendar')).toMatchObject({
      status: 'missing_config',
      enabledForAgents: ['assistant'],
      toolNames: ['mcp__calendar__calendar_availability', 'mcp__calendar__calendar_daily_brief'],
      permissionDefaults: {
        defaultBehavior: 'deny',
        allowMcp: true,
        allowedMcpTools: ['mcp__calendar__calendar_availability', 'mcp__calendar__calendar_daily_brief'],
      },
      reason: 'Configured preset is missing required env: GOOGLE_CLIENT_SECRET',
    });
    expect(matrix.capabilities.find((capability) => capability.id === 'google.calendar')?.configSnippet)
      .toContain('external_mcp_servers:\n  calendar:');
    expect(matrix.capabilities.find((capability) => capability.id === 'google.calendar')?.configSnippet)
      .toContain('      - mcp__calendar__calendar_daily_brief');
    expect(JSON.stringify(matrix)).not.toContain('client-id');
    expect(JSON.stringify(matrix)).not.toContain('refresh-token');
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
      selected: true,
      reason: 'Provider is selected for inbound media transcription by current STT config.',
    });
    expect(matrix.capabilities.find((capability) => capability.id === 'stt.openai')).toMatchObject({
      status: 'available',
      selected: false,
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

  it('marks an explicitly selected STT provider in the capability matrix', () => {
    const matrix = buildIntegrationCapabilityMatrix(
      {
        ...baseConfig(),
        assemblyai: { api_key: 'assembly-key' },
        stt: {
          provider: 'openai',
          openai: { api_key: 'openai-key' },
        },
      },
      [],
      {},
    );

    expect(matrix.capabilities.find((capability) => capability.id === 'stt.assemblyai')).toMatchObject({
      status: 'available',
      selected: false,
    });
    expect(matrix.capabilities.find((capability) => capability.id === 'stt.openai')).toMatchObject({
      status: 'available',
      selected: true,
      reason: 'Provider is selected for inbound media transcription by current STT config.',
    });
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
      configSnippet: [
        'mcp_tools:',
        '  - manage_cron',
        'sdk:',
        '  permissions:',
        '    default_behavior: deny',
        '    allow_mcp: true',
        '    allowed_mcp_tools:',
        '      # operator review required before enabling this capability',
      ].join('\n'),
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
              env: { GOOGLE_CLIENT_SECRET: 'super-private-value' },
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
      configSnippet: [
        '# external_mcp_servers already defines the MCP server and allowed tools',
        'sdk:',
        '  permissions:',
        '    default_behavior: deny',
        '    allow_mcp: true',
        '    allowed_mcp_tools:',
        '      - mcp__calendar__calendar_daily_brief',
        '      - mcp__calendar__calendar_lookup',
      ].join('\n'),
      permissionDefaults: {
        defaultBehavior: 'deny',
        allowMcp: true,
        allowedMcpTools: ['mcp__calendar__calendar_daily_brief', 'mcp__calendar__calendar_lookup'],
      },
    });
    expect(JSON.stringify(matrix)).not.toContain('super-private-value');
  });
});
