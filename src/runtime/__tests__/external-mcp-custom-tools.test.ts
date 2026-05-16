import { describe, expect, it, vi } from 'vitest';
import {
  buildExternalMcpCustomTools,
  externalMcpCustomToolName,
  type ExternalMcpToolClient,
} from '../external-mcp-custom-tools.js';

describe('external MCP custom tools', () => {
  it('exposes only allowed external MCP tools as headless custom tools', async () => {
    const client: ExternalMcpToolClient = {
      listTools: vi.fn(async () => [
        {
          name: 'list_events',
          description: 'List calendar events',
          inputSchema: { type: 'object', properties: { day: { type: 'string' } } },
        },
        {
          name: 'delete_event',
          description: 'Delete an event',
          inputSchema: { type: 'object' },
        },
      ]),
      callTool: vi.fn(async () => ({
        content: [{ type: 'text', text: 'events' }],
        structuredContent: { count: 1 },
      })),
    };

    const tools = await buildExternalMcpCustomTools({
      cwd: '/workspace',
      client,
      servers: {
        calendar: {
          type: 'http',
          url: 'https://mcp.example.com/mcp',
          allowed_tools: ['list_events'],
        },
      },
    });

    expect(tools.map((tool) => tool.name)).toEqual(['mcp__calendar__list_events']);
    expect(tools[0]).toMatchObject({
      description: '[MCP:calendar] List calendar events',
      inputSchema: { type: 'object', properties: { day: { type: 'string' } } },
    });

    await expect(tools[0]?.handler({ day: 'today' })).resolves.toEqual({
      content: [{ type: 'text', text: 'events' }],
      details: {
        serverName: 'calendar',
        toolName: 'list_events',
        customToolName: 'mcp__calendar__list_events',
        structuredContent: { count: 1 },
        meta: undefined,
      },
    });
    expect(client.callTool).toHaveBeenCalledWith(
      'calendar',
      expect.objectContaining({ url: 'https://mcp.example.com/mcp' }),
      'list_events',
      { day: 'today' },
      expect.objectContaining({ cwd: '/workspace' }),
    );
  });

  it('returns model-visible errors when an external MCP tool call fails', async () => {
    const client: ExternalMcpToolClient = {
      listTools: vi.fn(async () => [
        { name: 'search', inputSchema: { type: 'object' } },
      ]),
      callTool: vi.fn(async () => {
        throw new Error('upstream unavailable');
      }),
    };
    const errors: unknown[] = [];
    const tools = await buildExternalMcpCustomTools({
      cwd: '/workspace',
      client,
      servers: {
        exa: {
          type: 'http',
          url: 'https://mcp.exa.ai/mcp',
          allowed_tools: ['search'],
        },
      },
      onError: (err, context) => errors.push({ err: err.message, context }),
    });

    await expect(tools[0]?.handler({ q: 'pi' })).resolves.toEqual({
      content: [{ type: 'text', text: 'MCP tool exa.search failed: upstream unavailable' }],
      isError: true,
      details: {
        serverName: 'exa',
        toolName: 'search',
        customToolName: 'mcp__exa__search',
      },
    });
    expect(errors).toEqual([{
      err: 'upstream unavailable',
      context: { serverName: 'exa', phase: 'call', toolName: 'search' },
    }]);
  });

  it('skips servers that cannot list tools without failing the whole bridge', async () => {
    const client: ExternalMcpToolClient = {
      listTools: vi.fn(async () => {
        throw new Error('auth required');
      }),
      callTool: vi.fn(),
    };
    const errors: unknown[] = [];

    await expect(buildExternalMcpCustomTools({
      cwd: '/workspace',
      client,
      servers: {
        private_mcp: {
          type: 'http',
          url: 'https://private.example.com/mcp',
          allowed_tools: ['read'],
        },
      },
      onError: (err, context) => errors.push({ err: err.message, context }),
    })).resolves.toEqual([]);

    expect(errors).toEqual([{
      err: 'auth required',
      context: { serverName: 'private_mcp', phase: 'list' },
    }]);
  });

  it('uses Claude-compatible external MCP tool names', () => {
    expect(externalMcpCustomToolName('linear', 'list_issues')).toBe('mcp__linear__list_issues');
  });
});
