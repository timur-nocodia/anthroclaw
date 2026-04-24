import { describe, expect, it } from 'vitest';
import {
  preflightAgentMcpServer,
  preflightAgentMcpServerSpec,
  preflightMcpServer,
} from '../../src/integrations/mcp-preflight.js';
import { Gateway } from '../../src/gateway.js';

describe('MCP preflight', () => {
  it('approves local in-process AnthroClaw agent MCP servers', () => {
    const result = preflightAgentMcpServer({
      serverName: 'agent-tools',
      ownerAgentId: 'agent',
      toolNames: ['memory_search', 'memory_write'],
    });

    expect(result).toMatchObject({
      serverName: 'agent-tools',
      ownerAgentId: 'agent',
      source: 'agent_local',
      transport: 'in_process',
      packageSource: 'in-process',
      approvalStatus: 'approved',
      filesystemRisk: 'medium',
      networkRisk: 'low',
      toolNames: ['memory_search', 'memory_write'],
    });
  });

  it('sanitizes stdio MCP env values and approves generated subagent specs', () => {
    const result = preflightAgentMcpServerSpec({
      'helper-subagent-tools': {
        type: 'stdio',
        command: process.execPath,
        args: ['--import', 'tsx', '/repo/src/cli/subagent-mcp-server.ts'],
        env: {
          OPENCLAW_SUBAGENT_MCP_WORKSPACE: '/repo',
          OPENCLAW_SUBAGENT_MCP_DATA_DIR: '/repo/data',
          OPENCLAW_SUBAGENT_MCP_BRAVE_API_KEY: 'secret-brave-key',
        },
      },
    } as any, {
      ownerAgentId: 'main-agent',
      source: 'subagent_portable',
      toolNamesByServer: {
        'helper-subagent-tools': ['memory_search', 'web_search_brave'],
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      serverName: 'helper-subagent-tools',
      ownerAgentId: 'main-agent',
      source: 'subagent_portable',
      transport: 'stdio',
      packageSource: 'anthroclaw-local-node',
      approvalStatus: 'approved',
      networkRisk: 'high',
      filesystemRisk: 'high',
      envVarNames: [
        'OPENCLAW_SUBAGENT_MCP_BRAVE_API_KEY',
        'OPENCLAW_SUBAGENT_MCP_DATA_DIR',
        'OPENCLAW_SUBAGENT_MCP_WORKSPACE',
      ],
    });
    expect(JSON.stringify(result)).not.toContain('secret-brave-key');
  });

  it('requires review for unknown external MCP servers', () => {
    const result = preflightMcpServer({
      serverName: 'external-tools',
      source: 'external',
      transport: 'stdio',
      command: 'npx',
      args: ['unknown-mcp-server'],
      env: {
        GITHUB_TOKEN: 'secret',
      },
      toolNames: ['github_search'],
    });

    expect(result).toMatchObject({
      packageSource: 'npm-package',
      approvalStatus: 'review_required',
      networkRisk: 'high',
    });
    expect(result.reasons).toContain('MCP server is not recognized as an AnthroClaw-managed server.');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('exposes external spec preflight through the gateway helper', () => {
    const gw = new Gateway();
    const [result] = gw.preflightMcpServerSpec({
      calendar: {
        type: 'stdio',
        command: 'npx',
        args: ['google-calendar-mcp'],
        env: {
          GOOGLE_CLIENT_SECRET: 'secret',
        },
      },
    } as any, {
      ownerAgentId: 'ops-agent',
      toolNamesByServer: {
        calendar: ['calendar_daily_brief'],
      },
    });

    expect(result).toMatchObject({
      serverName: 'calendar',
      ownerAgentId: 'ops-agent',
      source: 'external',
      approvalStatus: 'review_required',
      networkRisk: 'high',
      envVarNames: ['GOOGLE_CLIENT_SECRET'],
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('includes configured agent external MCP servers in gateway preflight', () => {
    const gw = new Gateway();
    (gw as any).agents.set('ops-agent', {
      id: 'ops-agent',
      config: {
        external_mcp_servers: {
          calendar: {
            type: 'stdio',
            command: 'npx',
            args: ['google-calendar-mcp'],
            env: { GOOGLE_CLIENT_SECRET: 'secret' },
            allowed_tools: ['calendar_daily_brief'],
          },
        },
      },
      mcpServer: { name: 'ops-agent-tools' },
      tools: [],
    });

    const result = gw.listMcpServerPreflight();
    expect(result.find((entry) => entry.serverName === 'calendar')).toMatchObject({
      ownerAgentId: 'ops-agent',
      source: 'external',
      approvalStatus: 'review_required',
      networkRisk: 'high',
      envVarNames: ['GOOGLE_CLIENT_SECRET'],
      toolNames: ['calendar_daily_brief'],
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
