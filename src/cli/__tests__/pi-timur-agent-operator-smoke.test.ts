import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listPiTimurAgentOperatorScenarios,
  parsePiTimurAgentOperatorSmokeArgs,
  runPiTimurAgentOperatorSmokeCli,
} from '../pi-timur-agent-operator-smoke.js';
import { normalizeTelegramText } from '../pi-telegram-lab-smoke.js';

describe('Pi timur_agent operator smoke CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-timur-agent-operator-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('defines the full parity-lab operator command scenario set', () => {
    expect(listPiTimurAgentOperatorScenarios()).toEqual([
      expect.objectContaining({ id: 'smoke', prompt: '/smoke', expectText: 'TIMUR_AGENT_LAB_OK' }),
      expect.objectContaining({
        id: 'help',
        expectIncludes: expect.arrayContaining(['/status', '/scope', '/tools', '/memory', '/learning', '/plugins', '/cron', '/mcp', '/smoke', '/handoff']),
      }),
      expect.objectContaining({
        id: 'status',
        expectIncludes: expect.arrayContaining([
          'timur_agent: ok',
          'runtime: pi',
          'route_account: default',
        ]),
      }),
      expect.objectContaining({ id: 'scope', expectIncludes: expect.arrayContaining(['real side effects']) }),
      expect.objectContaining({ id: 'tools', expectIncludes: expect.arrayContaining(['messaging/media', 'Buildroom']) }),
      expect.objectContaining({ id: 'memory', expectIncludes: expect.arrayContaining(['memory wiki', 'LCM']) }),
      expect.objectContaining({ id: 'learning', expectIncludes: expect.arrayContaining(['propose-only']) }),
      expect.objectContaining({ id: 'plugins', expectIncludes: expect.arrayContaining(['operator-console', 'file-transfer']) }),
      expect.objectContaining({ id: 'cron', expectIncludes: expect.arrayContaining(['disabled']) }),
      expect.objectContaining({ id: 'mcp', expectIncludes: expect.arrayContaining(['managed']) }),
      expect.objectContaining({ id: 'handoff', expectIncludes: expect.arrayContaining(['side effects']) }),
    ]);
  });

  it('parses narrow flags and comma-separated scenario selection', () => {
    expect(parsePiTimurAgentOperatorSmokeArgs([
      '--',
      '--agents-dir', '/tmp/agents',
      '--plugins-dir', '/tmp/plugins',
      '--model', 'test/model',
      '--auth-path', '/secure/auth.json',
      '--models-path', '/secure/models.json',
      '--peer-id', '42',
      '--sender-id', '43',
      '--scenario', 'smoke,status',
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
      scenarios: ['smoke', 'status'],
      timeoutMs: 1000,
      keepData: true,
      allowSkip: true,
      json: true,
    });
    expect(() => parsePiTimurAgentOperatorSmokeArgs(['--scenario', 'unknown'])).toThrow(/Unknown timur_agent operator scenario/);
    expect(() => parsePiTimurAgentOperatorSmokeArgs(['--timeout-ms', '0'])).toThrow(/positive integer/);
    expect(() => parsePiTimurAgentOperatorSmokeArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('turns missing optional Pi setup into an explicit skip without leaking workspaces', async () => {
    const workspace = join(root, 'workspace');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentOperatorSmokeCli([
      '--allow-skip',
      '--json',
    ], {
      makeWorkspace: () => workspace,
      preflightPiRuntime: async () => {
        throw new Error('Pi timur_agent operator smoke requires optional package @earendil-works/pi-coding-agent.');
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
      accountId: 'default',
      error: expect.stringContaining('@earendil-works/pi-coding-agent'),
    });
    expect(existsSync(workspace)).toBe(false);
  });

  it('normalizes Telegram Markdown styling around timur_agent smoke markers', () => {
    expect(normalizeTelegramText('`TIMUR\\_AGENT\\_LAB\\_OK`')).toBe('TIMUR_AGENT_LAB_OK');
    expect(normalizeTelegramText('`route\\_account:` default')).toBe('route_account: default');
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
