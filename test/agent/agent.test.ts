import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from '../../src/agent/agent.js';

function writeMinimalAgentYml(dir: string, mcpTools?: string[]): void {
  const tools = mcpTools ? `\nmcp_tools:\n${mcpTools.map((t) => `  - ${t}`).join('\n')}` : '';
  writeFileSync(
    join(dir, 'agent.yml'),
    `routes:
  - channel: telegram
    scope: dm${tools}
`,
  );
}

describe('Agent', () => {
  let tmpDir: string;
  let agentDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agent-test-'));
    agentDir = join(tmpDir, 'my-bot');
    dataDir = join(tmpDir, 'data');
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── 1. loads agent from directory ───────────────────────────────
  it('loads agent from directory', async () => {
    writeMinimalAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);

    expect(agent.id).toBe('my-bot');
    expect(agent.config).toBeDefined();
    expect(agent.config.routes).toHaveLength(1);
    expect(agent.config.routes[0].channel).toBe('telegram');
  });

  // ─── 2. exposes workspace path ──────────────────────────────────
  it('exposes workspace path', async () => {
    writeMinimalAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);

    expect(agent.workspacePath).toBe(agentDir);
  });

  // ─── 3. creates memory store ────────────────────────────────────
  it('creates memory store', async () => {
    writeMinimalAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);

    expect(agent.memoryStore).toBeDefined();
    // The sqlite file should exist
    const dbPath = join(dataDir, 'memory-db', 'my-bot.sqlite');
    expect(existsSync(dbPath)).toBe(true);
  });

  // ─── 4. creates MCP server with requested tools ─────────────────
  it('creates MCP server with requested tools', async () => {
    writeMinimalAgentYml(agentDir, ['memory_search', 'session_search', 'local_note_search', 'local_note_propose', 'memory_write', 'manage_skills']);
    const agent = await Agent.load(agentDir, dataDir);

    expect(agent.mcpServer).toBeDefined();
    expect(agent.mcpServer.name).toBe('my-bot-tools');

    const toolNames = agent.tools.map((t) => t.name);
    expect(toolNames).toContain('memory_search');
    expect(toolNames).toContain('session_search');
    expect(toolNames).toContain('local_note_search');
    expect(toolNames).toContain('local_note_propose');
    expect(toolNames).toContain('memory_write');
    expect(toolNames).toContain('manage_skills');
    expect(toolNames).not.toContain('send_message');
    expect(toolNames).not.toContain('send_media');
  });

  it('includes send_message and send_media only when getChannel is provided', async () => {
    writeMinimalAgentYml(agentDir, ['memory_search', 'send_message', 'send_media']);
    const getChannel = () => undefined;
    const agent = await Agent.load(agentDir, dataDir, getChannel);

    const toolNames = agent.tools.map((t) => t.name);
    expect(toolNames).toContain('send_message');
    expect(toolNames).toContain('send_media');
  });

  it('skips send_message and send_media when getChannel is not provided', async () => {
    writeMinimalAgentYml(agentDir, ['memory_search', 'send_message', 'send_media']);
    const agent = await Agent.load(agentDir, dataDir);

    const toolNames = agent.tools.map((t) => t.name);
    expect(toolNames).toContain('memory_search');
    expect(toolNames).not.toContain('send_message');
    expect(toolNames).not.toContain('send_media');
  });

  it('creates MCP server with no tools when mcp_tools is omitted', async () => {
    writeMinimalAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);

    expect(agent.tools).toHaveLength(0);
  });

  // ─── 5. session management: getSessionId returns undefined ──────
  it('getSessionId returns undefined for unknown key', async () => {
    writeMinimalAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);

    expect(agent.getSessionId('unknown-key')).toBeUndefined();
  });

  // ─── 6. session management: setSessionId + getSessionId works ───
  it('setSessionId + getSessionId round-trips', async () => {
    writeMinimalAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);

    agent.setSessionId('telegram:dm:123', 'sess-abc');
    expect(agent.getSessionId('telegram:dm:123')).toBe('sess-abc');

    agent.setSessionId('telegram:dm:123', 'sess-def');
    expect(agent.getSessionId('telegram:dm:123')).toBe('sess-def');
  });
});
