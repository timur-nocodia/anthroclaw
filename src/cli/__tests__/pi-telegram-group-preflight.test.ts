import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MetricsStore } from '../../metrics/store.js';
import {
  parsePiTelegramGroupPreflightArgs,
  runPiTelegramGroupPreflightCli,
} from '../pi-telegram-group-preflight.js';

describe('Pi Telegram group preflight CLI', () => {
  let root: string | undefined;
  let liveRoot: string | undefined;
  let dataRoot: string | undefined;
  let store: MetricsStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
    if (root) rmSync(root, { recursive: true, force: true });
    if (liveRoot) rmSync(liveRoot, { recursive: true, force: true });
    if (dataRoot) rmSync(dataRoot, { recursive: true, force: true });
    root = undefined;
    liveRoot = undefined;
    dataRoot = undefined;
  });

  it('passes for any explicit agent when audit, route confirmation, and monitor are green', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-telegram-group-preflight-root-'));
    liveRoot = mkdtempSync(join(tmpdir(), 'pi-telegram-group-preflight-live-'));
    dataRoot = mkdtempSync(join(tmpdir(), 'pi-telegram-group-preflight-data-'));
    await writeAgent(liveRoot, 'group-agent', `
routes:
  - channel: telegram
    account: content_sm
    scope: group
    peers: ["-1003729315809"]
    topics: ["8"]
    mention_only: true
safety_profile: chat_like_openclaw
mcp_tools: [manage_cron]
learning:
  enabled: true
  mode: propose
`);
    writeGreenMonitor(dataRoot);
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTelegramGroupPreflightCli([
      '--agents-dir', root,
      '--agents-dir', liveRoot,
      '--data-dir', dataRoot,
      '--agent-id', 'group-agent',
      '--confirm-account', 'content_sm',
      '--confirm-peer', '-1003729315809',
      '--confirm-topic', '8',
      '--json',
    ], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId: 'group-agent',
      checks: [
        { name: 'expansion-audit', status: 'passed' },
        { name: 'route-confirmation', status: 'passed' },
        { name: 'runtime-monitor', status: 'passed' },
      ],
    });
    expect(body.checks[1].details).toMatchObject({
      confirmAccount: 'content_sm',
      confirmedPeer: '-1003729315809',
      confirmedTopics: ['8'],
      routeHasConfirmedPeer: true,
      missingTopics: [],
      accountMatches: true,
      mentionOnlyOk: true,
    });
  });

  it('fails non-mention-only group routes unless explicitly allowed', async () => {
    liveRoot = mkdtempSync(join(tmpdir(), 'pi-telegram-group-preflight-live-'));
    dataRoot = mkdtempSync(join(tmpdir(), 'pi-telegram-group-preflight-data-'));
    await writeAgent(liveRoot, 'broad_group_agent', `
routes:
  - channel: telegram
    account: ops
    scope: group
    peers: ["-100"]
    topics: ["4"]
    mention_only: false
safety_profile: chat_like_openclaw
mcp_tools: [manage_cron]
`);
    writeGreenMonitor(dataRoot);

    const failedStdout = createWriter();
    const failedStderr = createWriter();
    const failedCode = await runPiTelegramGroupPreflightCli([
      '--agents-dir', liveRoot,
      '--data-dir', dataRoot,
      '--agent-id', 'broad_group_agent',
      '--confirm-peer', '-100',
      '--confirm-topic', '4',
      '--json',
    ], { stdout: failedStdout, stderr: failedStderr });

    expect(failedCode).toBe(1);
    expect(failedStdout.text()).toBe('');
    expect(JSON.parse(failedStderr.text())).toMatchObject({
      status: 'failed',
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: 'route-confirmation',
          status: 'failed',
          details: expect.objectContaining({ mentionOnlyOk: false }),
        }),
      ]),
    });

    const passedStdout = createWriter();
    const passedCode = await runPiTelegramGroupPreflightCli([
      '--agents-dir', liveRoot,
      '--data-dir', dataRoot,
      '--agent-id', 'broad_group_agent',
      '--confirm-peer', '-100',
      '--confirm-topic', '4',
      '--allow-non-mention-only',
      '--json',
    ], { stdout: passedStdout, stderr: createWriter() });

    expect(passedCode).toBe(0);
    expect(JSON.parse(passedStdout.text()).checks[1].details).toMatchObject({
      mentionOnlyOk: true,
    });
  });

  it('parses explicit agent and route confirmation flags narrowly', () => {
    expect(parsePiTelegramGroupPreflightArgs([
      '--',
      '--agents-dir', '/tmp/tracked',
      '--agents-dir', '/tmp/live',
      '--data-dir', '/tmp/data',
      '--agent-id', 'group-agent',
      '--confirm-account', 'content_sm',
      '--confirm-peer', '-100',
      '--confirm-topic', '8',
      '--since-minutes', '15',
      '--stale-minutes', '5',
      '--allow-non-mention-only',
      '--json',
    ])).toMatchObject({
      agentsDir: '/tmp/tracked',
      agentsDirs: ['/tmp/tracked', '/tmp/live'],
      dataDir: '/tmp/data',
      agentId: 'group-agent',
      confirmAccount: 'content_sm',
      confirmPeer: '-100',
      confirmTopics: ['8'],
      sinceMinutes: 15,
      staleMinutes: 5,
      allowNonMentionOnly: true,
      json: true,
    });
    expect(() => parsePiTelegramGroupPreflightArgs(['--confirm-topic'])).toThrow(/requires a value/);
    expect(() => parsePiTelegramGroupPreflightArgs(['--since-minutes', '0'])).toThrow(/positive integer/);
    expect(() => parsePiTelegramGroupPreflightArgs(['--wat'])).toThrow(/Unknown argument/);
    expect(() => parsePiTelegramGroupPreflightArgs(['--confirm-peer', '-100'])).toThrow(/--agent-id is required/);
  });

  async function writeAgent(agentsRoot: string, agentId: string, body: string): Promise<void> {
    const dir = join(agentsRoot, agentId);
    mkdirSync(dir, { recursive: true });
    await writeFile(join(dir, 'agent.yml'), body.trimStart(), 'utf8');
  }

  function writeGreenMonitor(metricsRoot: string): void {
    store = new MetricsStore(join(metricsRoot, 'metrics.sqlite'));
    store.recordAgentRunStart({
      runId: 'run-ok',
      startedAt: Date.now() - 1_000,
      agentId: 'pi_telegram_lab',
      sessionKey: 'pi_telegram_lab:telegram:dm:48705953',
      source: 'channel',
      channel: 'telegram',
      model: 'claude-sonnet-4-6',
    });
    store.recordAgentRunFinish({
      runId: 'run-ok',
      completedAt: Date.now(),
      status: 'succeeded',
      sdkSessionId: 'session-ok',
      usage: { durationMs: 1_000 },
    });
  }
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
