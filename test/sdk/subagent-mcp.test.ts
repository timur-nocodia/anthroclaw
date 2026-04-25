import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import type { ToolDefinition } from '../../src/agent/tools/types.js';
import {
  buildPortableSubagentMcpSpec,
  createPortableSubagentTools,
  parsePortableSubagentMcpRuntime,
} from '../../src/sdk/subagent-mcp.js';

function fakeTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    inputSchema: {},
    handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  };
}

describe('portable subagent MCP', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds a stdio MCP spec only for portable approved tools', () => {
    const result = buildPortableSubagentMcpSpec({
      agent: {
        id: 'helper',
        workspacePath: '/tmp/helper',
        config: { timezone: 'Asia/Almaty' } as any,
        tools: [fakeTool('memory_search'), fakeTool('session_search'), fakeTool('local_note_search'), fakeTool('local_note_propose'), fakeTool('manage_cron')],
        mcpServer: { name: 'helper-tools' } as any,
      },
      allowedTools: [
        'Read',
        'mcp__helper-tools__memory_search',
        'mcp__helper-tools__session_search',
        'mcp__helper-tools__local_note_search',
        'mcp__helper-tools__local_note_propose',
        'mcp__helper-tools__manage_cron',
      ],
      dataDir: '/tmp/data',
      globalConfig: null,
    });

    expect(result).not.toBeNull();
    expect(result?.sourceToolNames).toEqual(['memory_search', 'session_search', 'local_note_search', 'local_note_propose']);
    expect(result?.skippedToolNames).toEqual(['manage_cron']);
    expect(result?.toolNames).toEqual([
      'mcp__helper-subagent-tools__memory_search',
      'mcp__helper-subagent-tools__session_search',
      'mcp__helper-subagent-tools__local_note_search',
      'mcp__helper-subagent-tools__local_note_propose',
    ]);
    expect(result?.spec).toEqual({
      'helper-subagent-tools': expect.objectContaining({
        type: 'stdio',
        command: process.execPath,
        env: expect.objectContaining({
          OPENCLAW_SUBAGENT_MCP_AGENT_ID: 'helper',
          OPENCLAW_SUBAGENT_MCP_TOOLS: JSON.stringify(['memory_search', 'session_search', 'local_note_search', 'local_note_propose']),
        }),
      }),
    });
  });

  it('parses subprocess env and recreates portable tool definitions', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'subagent-mcp-'));
    tempDirs.push(rootDir);

    const workspacePath = join(rootDir, 'agent');
    const dataDir = join(rootDir, 'data');
    mkdirSync(join(workspacePath, 'skills'), { recursive: true });
    mkdirSync(dataDir, { recursive: true });

    const runtime = parsePortableSubagentMcpRuntime({
      OPENCLAW_SUBAGENT_MCP_SERVER_NAME: 'helper-subagent-tools',
      OPENCLAW_SUBAGENT_MCP_AGENT_ID: 'helper',
      OPENCLAW_SUBAGENT_MCP_WORKSPACE: workspacePath,
      OPENCLAW_SUBAGENT_MCP_DATA_DIR: dataDir,
      OPENCLAW_SUBAGENT_MCP_TIMEZONE: 'Asia/Almaty',
      OPENCLAW_SUBAGENT_MCP_TOOLS: JSON.stringify(['memory_write', 'session_search', 'local_note_search', 'local_note_propose', 'list_skills']),
    });

    const tools = createPortableSubagentTools(runtime);
    expect(tools.map((tool) => tool.name)).toEqual(['memory_write', 'session_search', 'local_note_search', 'local_note_propose', 'list_skills']);
  });
});
