import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyzeToolEvents,
  parsePiTimurAgentMemoryReadSmokeArgs,
  runPiTimurAgentMemoryReadSmokeCli,
} from '../pi-timur-agent-memory-read-smoke.js';

describe('Pi timur_agent memory-read smoke CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-timur-agent-memory-read-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses narrow flags', () => {
    expect(parsePiTimurAgentMemoryReadSmokeArgs([
      '--',
      '--agents-dir', '/tmp/agents',
      '--plugins-dir', '/tmp/plugins',
      '--model', 'test/model',
      '--auth-path', '/secure/auth.json',
      '--models-path', '/secure/models.json',
      '--peer-id', '42',
      '--sender-id', '43',
      '--timeout-ms', '1000',
      '--keep-data',
      '--allow-skip',
      '--json',
    ])).toMatchObject({
      agentsDir: '/tmp/agents',
      pluginsDir: '/tmp/plugins',
      model: 'test/model',
      authPath: '/secure/auth.json',
      modelsPath: '/secure/models.json',
      peerId: '42',
      senderId: '43',
      timeoutMs: 1000,
      keepData: true,
      allowSkip: true,
      json: true,
    });
    expect(() => parsePiTimurAgentMemoryReadSmokeArgs(['--timeout-ms', '0'])).toThrow(/positive integer/);
    expect(() => parsePiTimurAgentMemoryReadSmokeArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('aggregates required and forbidden tool evidence with MCP prefixes', () => {
    const evidence = analyzeToolEvents([
      { toolName: 'mcp__timur_agent-tools__memory_search', status: 'started', count: 1 },
      { toolName: 'mcp__timur_agent-tools__memory_search', status: 'completed', count: 1 },
      { toolName: 'session_search', status: 'started', count: 1 },
      { toolName: 'session_search', status: 'completed', count: 1 },
      { toolName: 'local_note_search', status: 'started', count: 1 },
      { toolName: 'local_note_search', status: 'completed', count: 1 },
      { toolName: 'mcp__timur_agent-tools__send_message', status: 'started', count: 1 },
    ]);

    expect(evidence.required.memory_search).toEqual({ started: 1, completed: 1, failed: 0 });
    expect(evidence.required.session_search).toEqual({ started: 1, completed: 1, failed: 0 });
    expect(evidence.required.local_note_search).toEqual({ started: 1, completed: 1, failed: 0 });
    expect(evidence.forbidden.send_message).toEqual({ started: 1, completed: 0, failed: 0 });
  });

  it('turns missing optional Pi setup into an explicit skip without leaking workspaces', async () => {
    const workspace = join(root, 'workspace');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentMemoryReadSmokeCli([
      '--allow-skip',
      '--json',
    ], {
      makeWorkspace: () => workspace,
      preflightPiRuntime: async () => {
        throw new Error('Pi timur_agent memory-read smoke requires optional package @earendil-works/pi-coding-agent.');
      },
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'skipped',
      runtime: 'pi',
      agentId: 'timur_agent',
      error: expect.stringContaining('@earendil-works/pi-coding-agent'),
    });
    expect(existsSync(workspace)).toBe(false);
  });
});

function createWriter() {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    text() {
      return chunks.join('');
    },
  };
}
