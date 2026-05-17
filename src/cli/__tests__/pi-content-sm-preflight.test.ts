import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MetricsStore } from '../../metrics/store.js';
import {
  parsePiContentSmPreflightArgs,
  runPiContentSmPreflightCli,
} from '../pi-content-sm-preflight.js';

describe('Pi content_sm_building preflight CLI', () => {
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

  it('passes only when multi-root audit, route confirmation, dry-run, and monitor are green', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-content-sm-preflight-root-'));
    liveRoot = mkdtempSync(join(tmpdir(), 'pi-content-sm-preflight-live-'));
    dataRoot = mkdtempSync(join(tmpdir(), 'pi-content-sm-preflight-data-'));
    writeAgent(liveRoot, 'content_sm_building', `
routes:
  - channel: telegram
    account: content_sm
    scope: group
    peers: ["-1003729315809"]
    topics: ["4", "4198"]
    mention_only: true
allowlist:
  telegram: ["*"]
safety_profile: chat_like_openclaw
mcp_tools:
  - memory_search
  - memory_write
  - memory_wiki
  - send_message
  - send_media
  - list_skills
  - manage_cron
external_mcp_servers:
  apify:
    type: http
    url: https://mcp.apify.com
    credential_ref: mcp:apify
    allowed_tools: ["search-actors"]
plugins:
  lcm:
    enabled: true
learning:
  enabled: false
  mode: propose
`);
    store = new MetricsStore(join(dataRoot, 'metrics.sqlite'));
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
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiContentSmPreflightCli([
      '--agents-dir', root,
      '--agents-dir', liveRoot,
      '--data-dir', dataRoot,
      '--confirm-peer', '-1003729315809',
      '--confirm-topic', '4',
      '--confirm-topic', '4198',
      '--json',
    ], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId: 'content_sm_building',
      checks: [
        { name: 'expansion-audit', status: 'passed' },
        { name: 'route-confirmation', status: 'passed' },
        { name: 'safe-dry-run', status: 'passed' },
        { name: 'runtime-monitor', status: 'passed' },
      ],
    });
    expect(body.checks[0].details.agents[0]).toMatchObject({
      id: 'content_sm_building',
      risk: 'high',
      recommendedRing: 'ring4',
    });
    expect(body.checks[1].details).toMatchObject({
      confirmedPeer: '-1003729315809',
      confirmedTopics: ['4', '4198'],
      routeHasConfirmedPeer: true,
      missingTopics: [],
    });
    expect(body.checks[2].details).toMatchObject({
      noRealTelegramDelivery: true,
      fakeChannelOnly: true,
      tempCronJobsRemaining: 0,
    });
  });

  it('fails when explicit operator route confirmation is missing', async () => {
    liveRoot = mkdtempSync(join(tmpdir(), 'pi-content-sm-preflight-live-'));
    dataRoot = mkdtempSync(join(tmpdir(), 'pi-content-sm-preflight-data-'));
    writeAgent(liveRoot, 'content_sm_building', `
routes:
  - channel: telegram
    account: content_sm
    scope: group
    peers: ["-1003729315809"]
    topics: ["4"]
    mention_only: true
safety_profile: chat_like_openclaw
mcp_tools: [send_message]
learning:
  enabled: false
  mode: propose
`);
    store = new MetricsStore(join(dataRoot, 'metrics.sqlite'));
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiContentSmPreflightCli([
      '--agents-dir', liveRoot,
      '--data-dir', dataRoot,
      '--json',
    ], { stdout, stderr });

    expect(code).toBe(1);
    expect(stdout.text()).toBe('');
    expect(JSON.parse(stderr.text())).toMatchObject({
      status: 'failed',
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: 'route-confirmation',
          status: 'failed',
          summary: expect.stringContaining('--confirm-peer'),
        }),
      ]),
    });
  });

  it('parses repeated agents roots and topics narrowly', () => {
    expect(parsePiContentSmPreflightArgs([
      '--',
      '--agents-dir', '/tmp/tracked',
      '--agents-dir', '/tmp/live',
      '--data-dir', '/tmp/data',
      '--confirm-peer', '-100',
      '--confirm-topic', '4',
      '--confirm-topic', '4198',
      '--since-minutes', '15',
      '--stale-minutes', '5',
      '--json',
    ])).toMatchObject({
      agentsDir: '/tmp/tracked',
      agentsDirs: ['/tmp/tracked', '/tmp/live'],
      dataDir: '/tmp/data',
      confirmPeer: '-100',
      confirmTopics: ['4', '4198'],
      sinceMinutes: 15,
      staleMinutes: 5,
      json: true,
    });
    expect(() => parsePiContentSmPreflightArgs(['--confirm-topic'])).toThrow(/requires a value/);
    expect(() => parsePiContentSmPreflightArgs(['--since-minutes', '0'])).toThrow(/positive integer/);
    expect(() => parsePiContentSmPreflightArgs(['--wat'])).toThrow(/Unknown argument/);
  });
});

function writeAgent(root: string, agentId: string, body: string): void {
  const dir = join(root, agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.yml'), body.trimStart(), 'utf8');
}

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
