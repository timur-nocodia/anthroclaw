import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { Agent } from '../agent.js';
import type { McpToolContext, PluginMcpTool } from '../../plugins/types.js';

function setupAgentDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-plugin-tools-'));
  const agentDir = join(root, name);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'agent.yml'), [
    'safety_profile: private',
    'routes:',
    '  - channel: telegram',
    '    scope: dm',
    'allowlist:',
    '  telegram:',
    '    - "12345"',
  ].join('\n'));
  writeFileSync(join(agentDir, 'CLAUDE.md'), 'You are a test agent.');
  return agentDir;
}

describe('Agent plugin tool session context', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agent-plugin-tools-data-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('passes sessionKey through per-dispatch plugin tool wrappers', async () => {
    const dir = setupAgentDir('agent-a');
    const agent = await Agent.load(dir, dataDir, () => undefined);
    const observed: McpToolContext[] = [];
    const tool: PluginMcpTool = {
      name: 'spy',
      description: 'records tool context',
      inputSchema: z.object({}),
      handler: async (_input, ctx) => {
        observed.push(ctx);
        return { content: [{ type: 'text', text: JSON.stringify(ctx) }] };
      },
    };

    agent.refreshPluginTools([tool]);

    const defaultTool = agent.tools.find((candidate) => candidate.name === 'spy');
    await defaultTool?.handler({});

    const sessionTool = agent.getToolsForSession('telegram:dm:12345').find((candidate) => candidate.name === 'spy');
    await sessionTool?.handler({});

    expect(observed).toEqual([
      { agentId: 'agent-a' },
      { agentId: 'agent-a', sessionKey: 'telegram:dm:12345' },
    ]);

    rmSync(dir, { recursive: true, force: true });
  });
});
