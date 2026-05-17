import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listPiTelegramLabOperatorScenarios,
  parsePiTelegramLabOperatorSmokeArgs,
  runPiTelegramLabOperatorSmokeCli,
} from '../pi-telegram-lab-operator-smoke.js';
import { normalizeTelegramText } from '../pi-telegram-lab-smoke.js';

describe('Pi Telegram lab operator smoke CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-telegram-lab-operator-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('defines a stable operator command scenario set', () => {
    expect(listPiTelegramLabOperatorScenarios()).toEqual([
      expect.objectContaining({
        id: 'smoke',
        prompt: '/smoke',
        expectText: 'PI_TELEGRAM_LAB_OK',
      }),
      expect.objectContaining({
        id: 'help',
        prompt: '/help',
        expectIncludes: expect.arrayContaining(['/status', '/scope', '/memory', '/smoke', '/handoff']),
      }),
      expect.objectContaining({
        id: 'status',
        prompt: '/status',
        expectIncludes: expect.arrayContaining([
          'pi_telegram_lab: ok',
          'runtime: pi',
          'tools: memory_search, memory_write, list_skills',
        ]),
      }),
      expect.objectContaining({
        id: 'scope',
        prompt: '/scope',
        expectIncludes: expect.arrayContaining([
          'blocked: group fanout',
          'blocked: media sending',
          'blocked: cron',
          'blocked: external MCP',
          'blocked: MCP onboarding',
        ]),
      }),
      expect.objectContaining({
        id: 'memory',
        prompt: '/memory',
        expectIncludes: expect.arrayContaining(['memory_search', 'memory_write']),
      }),
      expect.objectContaining({
        id: 'handoff',
        prompt: '/handoff',
        expectIncludes: expect.arrayContaining([
          'pnpm runtime:pi-telegram-lab-readiness -- --json --allow-skip',
          'pnpm runtime:pi-telegram-lab-post-turn -- --json --fail-on-pending',
        ]),
      }),
    ]);
  });

  it('parses narrow flags and comma-separated scenario selection', () => {
    expect(parsePiTelegramLabOperatorSmokeArgs([
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
    expect(() => parsePiTelegramLabOperatorSmokeArgs(['--scenario', 'unknown'])).toThrow(/Unknown Pi Telegram lab operator scenario/);
    expect(() => parsePiTelegramLabOperatorSmokeArgs(['--timeout-ms', '0'])).toThrow(/positive integer/);
    expect(() => parsePiTelegramLabOperatorSmokeArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('turns missing optional Pi setup into an explicit skip without leaking workspaces', async () => {
    const workspace = join(root, 'workspace');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTelegramLabOperatorSmokeCli([
      '--allow-skip',
      '--json',
    ], {
      makeWorkspace: () => workspace,
      preflightPiRuntime: async () => {
        throw new Error('Pi Telegram lab operator smoke requires optional package @earendil-works/pi-coding-agent.');
      },
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'skipped',
      runtime: 'pi',
      agentId: 'pi_telegram_lab',
      error: expect.stringContaining('@earendil-works/pi-coding-agent'),
    });
    expect(existsSync(workspace)).toBe(false);
  });

  it('normalizes Telegram Markdown styling around command smoke markers', () => {
    expect(normalizeTelegramText('`PI\\_TELEGRAM\\_LAB\\_OK`')).toBe('PI_TELEGRAM_LAB_OK');
    expect(normalizeTelegramText('`allowed:` memory\\_search')).toBe('allowed: memory_search');
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
