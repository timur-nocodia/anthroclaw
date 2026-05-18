import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ApprovalRequest,
  ChannelAdapter,
  InboundMessage,
  OutboundMedia,
  SendOptions,
} from '../../channels/types.js';
import {
  parsePiTimurAgentLiveSendMediaArgs,
  runPiTimurAgentLiveSendMediaCli,
} from '../pi-timur-agent-live-send-media.js';

describe('Pi timur_agent live send_media gate CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-timur-agent-live-send-media-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses live media gate flags and requires values', () => {
    expect(parsePiTimurAgentLiveSendMediaArgs([
      '--',
      '--config', '/tmp/config.yml',
      '--agents-dir', '/tmp/agents',
      '--data-dir', '/tmp/data',
      '--workspace', '/tmp/workspace',
      '--account-id', 'ops',
      '--peer-id', '42',
      '--file-path', 'agents/timur_agent/lab-files/test.txt',
      '--caption', 'HELLO',
      '--confirm-live-send-media',
      '--dry-run',
      '--json',
    ])).toMatchObject({
      configPath: '/tmp/config.yml',
      agentsDir: '/tmp/agents',
      dataDir: '/tmp/data',
      workspacePath: '/tmp/workspace',
      accountId: 'ops',
      peerId: '42',
      filePath: 'agents/timur_agent/lab-files/test.txt',
      caption: 'HELLO',
      confirmLiveSendMedia: true,
      dryRun: true,
      json: true,
    });
    expect(() => parsePiTimurAgentLiveSendMediaArgs(['--caption'])).toThrow(/requires a value/);
    expect(() => parsePiTimurAgentLiveSendMediaArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('refuses real media delivery without explicit confirmation', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentLiveSendMediaCli(['--json'], {
      stdout,
      stderr,
    });

    expect(code).toBe(2);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('Refusing live media send');
  });

  it('runs one fake-backed live media send through the real tool path and records monitorable metrics', async () => {
    const configPath = join(root, 'config.yml');
    const workspace = join(root, 'workspace');
    const dataDir = join(root, 'data');
    const filePath = 'agents/timur_agent/lab-files/test-live-media.txt';
    const caption = 'TEST_TIMUR_AGENT_LIVE_SEND_MEDIA_OK';
    mkdirSync(join(workspace, 'agents/timur_agent/lab-files'), { recursive: true });
    writeFileSync(join(workspace, filePath), 'test live media\n', 'utf8');
    writeFileSync(configPath, [
      'telegram:',
      '  accounts:',
      '    default:',
      '      token: test-token',
    ].join('\n'), 'utf8');

    const fake = createFakeTelegramAdapter();
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentLiveSendMediaCli([
      '--config', configPath,
      '--agents-dir', resolve('agents'),
      '--data-dir', dataDir,
      '--workspace', workspace,
      '--file-path', filePath,
      '--caption', caption,
      '--confirm-live-send-media',
      '--json',
    ], {
      stdout,
      stderr,
      makeChannel: () => fake,
      makeRunId: () => 'test-live-media-run',
      now: fixedClock(1_800_000_000_000, 25),
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(fake.sentMedia).toEqual([
      {
        peerId: '48705953',
        media: {
          type: 'document',
          path: join(workspace, filePath),
          mimeType: 'application/octet-stream',
          caption,
        },
        options: { accountId: 'default' },
      },
    ]);

    const result = JSON.parse(stdout.text());
    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId: 'timur_agent',
      live: true,
      dryRun: false,
      target: {
        channel: 'telegram',
        accountId: 'default',
        peerId: '48705953',
      },
      media: {
        type: 'document',
        filePath,
        caption,
        allowedRoot: 'agents/timur_agent/lab-files',
        fileExists: true,
        fileRootBound: true,
      },
      markerPrefix: 'TIMUR_AGENT_LIVE_SEND_MEDIA_OK',
      permission: {
        mcpToolPresent: true,
        privateAllowlistSinglePeer: true,
        routeBound: true,
        sendMediaApprovalRequested: true,
        sendMediaAllowed: true,
      },
      delivery: {
        sent: true,
        via: 'send_media',
        realTelegramDelivery: true,
        messageId: 'fake-live-media-id',
      },
      metrics: {
        recorded: true,
        runId: 'test-live-media-run',
        sessionKey: 'timur_agent:telegram:dm:48705953:live-send-media',
        toolStarted: true,
        toolCompleted: true,
      },
      safety: {
        operatorApproved: true,
        noBroadFanout: true,
        documentOnly: true,
        noConfigMutation: true,
      },
    });

    const metricsDb = join(dataDir, 'metrics.sqlite');
    expect(existsSync(metricsDb)).toBe(true);
    const db = new Database(metricsDb, { readonly: true, fileMustExist: true });
    try {
      expect(db.prepare('SELECT status FROM agent_runs WHERE run_id = ?').get('test-live-media-run')).toEqual({
        status: 'succeeded',
      });
      expect(db.prepare('SELECT status, count(*) AS count FROM tool_events GROUP BY status ORDER BY status').all()).toEqual([
        { status: 'completed', count: 1 },
        { status: 'started', count: 1 },
      ]);
      expect(db.prepare('SELECT event_type, count(*) AS count FROM diagnostic_events GROUP BY event_type ORDER BY event_type').all()).toEqual([
        { event_type: 'run.completed', count: 1 },
        { event_type: 'run.sdk_started', count: 1 },
        { event_type: 'run.tool_completed', count: 1 },
        { event_type: 'run.tool_started', count: 1 },
      ]);
    } finally {
      db.close();
    }
  });

  it('dry-runs policy and file validation without sending or writing metrics', async () => {
    const workspace = join(root, 'workspace');
    const dataDir = join(root, 'data');
    const filePath = 'agents/timur_agent/lab-files/test-live-media.txt';
    mkdirSync(join(workspace, 'agents/timur_agent/lab-files'), { recursive: true });
    writeFileSync(join(workspace, filePath), 'test live media\n', 'utf8');

    const stdout = createWriter();
    const stderr = createWriter();
    const code = await runPiTimurAgentLiveSendMediaCli([
      '--agents-dir', resolve('agents'),
      '--data-dir', dataDir,
      '--workspace', workspace,
      '--file-path', filePath,
      '--dry-run',
      '--json',
    ], {
      stdout,
      stderr,
      makeChannel: () => {
        throw new Error('dry-run must not create a delivery channel');
      },
      now: () => 1_800_000_000_000,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'passed',
      live: false,
      dryRun: true,
      permission: {
        sendMediaApprovalRequested: true,
        sendMediaAllowed: true,
      },
      delivery: {
        sent: false,
        realTelegramDelivery: false,
      },
      metrics: {
        recorded: false,
      },
    });
    expect(existsSync(join(dataDir, 'metrics.sqlite'))).toBe(false);
  });

  it('rejects media paths outside the timur_agent lab root', async () => {
    const workspace = join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'outside.txt'), 'outside\n', 'utf8');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentLiveSendMediaCli([
      '--agents-dir', resolve('agents'),
      '--workspace', workspace,
      '--file-path', 'outside.txt',
      '--dry-run',
      '--json',
    ], {
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(stdout.text()).toBe('');
    expect(JSON.parse(stderr.text())).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('media file must stay under agents/timur_agent/lab-files'),
    });
  });
});

function createFakeTelegramAdapter(): ChannelAdapter & {
  sentMedia: Array<{ peerId: string; media: OutboundMedia; options: SendOptions }>;
} {
  const sentMedia: Array<{ peerId: string; media: OutboundMedia; options: SendOptions }> = [];
  return {
    id: 'telegram',
    supportsApproval: true,
    start: async () => {},
    stop: async () => {},
    onMessage: (_handler: (msg: InboundMessage) => Promise<void>) => {},
    sendTyping: async () => {},
    editText: async () => {},
    deleteText: async () => {},
    promptForApproval: async (_req: ApprovalRequest) => {},
    sendText: async () => 'fake-text-id',
    sendMedia: async (peerId: string, media: OutboundMedia, options: SendOptions = {}) => {
      sentMedia.push({ peerId, media, options });
      return 'fake-live-media-id';
    },
    sentMedia,
  };
}

function fixedClock(start: number, step: number): () => number {
  let current = start - step;
  return () => {
    current += step;
    return current;
  };
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
