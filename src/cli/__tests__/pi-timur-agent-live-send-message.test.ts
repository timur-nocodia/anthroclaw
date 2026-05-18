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
  parsePiTimurAgentLiveSendMessageArgs,
  runPiTimurAgentLiveSendMessageCli,
} from '../pi-timur-agent-live-send-message.js';

describe('Pi timur_agent live send_message gate CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-timur-agent-live-send-message-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses live-gate flags and requires values', () => {
    expect(parsePiTimurAgentLiveSendMessageArgs([
      '--',
      '--config', '/tmp/config.yml',
      '--agents-dir', '/tmp/agents',
      '--data-dir', '/tmp/data',
      '--account-id', 'ops',
      '--peer-id', '42',
      '--marker', 'HELLO',
      '--confirm-live-send',
      '--dry-run',
      '--json',
    ])).toMatchObject({
      configPath: '/tmp/config.yml',
      agentsDir: '/tmp/agents',
      dataDir: '/tmp/data',
      accountId: 'ops',
      peerId: '42',
      marker: 'HELLO',
      confirmLiveSend: true,
      dryRun: true,
      json: true,
    });
    expect(() => parsePiTimurAgentLiveSendMessageArgs(['--marker'])).toThrow(/requires a value/);
    expect(() => parsePiTimurAgentLiveSendMessageArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('refuses real delivery without explicit confirmation', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentLiveSendMessageCli(['--json'], {
      stdout,
      stderr,
    });

    expect(code).toBe(2);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('Refusing live send');
  });

  it('runs one fake-backed live send through the real tool path and records monitorable metrics', async () => {
    const configPath = join(root, 'config.yml');
    const dataDir = join(root, 'data');
    const marker = 'TEST_TIMUR_AGENT_LIVE_SEND_MESSAGE_OK';
    writeFileSync(configPath, [
      'telegram:',
      '  accounts:',
      '    default:',
      '      token: test-token',
    ].join('\n'), 'utf8');

    const fake = createFakeTelegramAdapter();
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentLiveSendMessageCli([
      '--config', configPath,
      '--agents-dir', resolve('agents'),
      '--data-dir', dataDir,
      '--marker', marker,
      '--confirm-live-send',
      '--json',
    ], {
      stdout,
      stderr,
      makeChannel: () => fake,
      makeRunId: () => 'test-live-send-run',
      now: fixedClock(1_800_000_000_000, 25),
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(fake.sentTexts).toEqual([
      {
        peerId: '48705953',
        text: marker,
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
      markerPrefix: 'TIMUR_AGENT_LIVE_SEND_MESSAGE_OK',
      markerText: marker,
      permission: {
        mcpToolPresent: true,
        privateAllowlistSinglePeer: true,
        routeBound: true,
        sendMessageAllowed: true,
      },
      delivery: {
        sent: true,
        via: 'send_message',
        realTelegramDelivery: true,
        messageId: 'fake-live-message-id',
      },
      metrics: {
        recorded: true,
        runId: 'test-live-send-run',
        sessionKey: 'timur_agent:telegram:dm:48705953:live-send-message',
        toolStarted: true,
        toolCompleted: true,
      },
      safety: {
        operatorApproved: true,
        noBroadFanout: true,
        noMedia: true,
        noConfigMutation: true,
      },
    });

    const metricsDb = join(dataDir, 'metrics.sqlite');
    expect(existsSync(metricsDb)).toBe(true);
    const db = new Database(metricsDb, { readonly: true, fileMustExist: true });
    try {
      expect(db.prepare('SELECT status FROM agent_runs WHERE run_id = ?').get('test-live-send-run')).toEqual({
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

  it('dry-runs policy validation without sending or writing metrics', async () => {
    const configPath = join(root, 'config.yml');
    const dataDir = join(root, 'data');
    writeFileSync(configPath, [
      'telegram:',
      '  accounts:',
      '    default:',
      '      token: ""',
    ].join('\n'), 'utf8');

    const stdout = createWriter();
    const stderr = createWriter();
    const code = await runPiTimurAgentLiveSendMessageCli([
      '--config', configPath,
      '--agents-dir', resolve('agents'),
      '--data-dir', dataDir,
      '--dry-run',
      '--json',
    ], {
      stdout,
      stderr,
      makeChannel: () => {
        throw new Error('dry-run must not create a channel');
      },
      now: () => 1_800_000_000_000,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'passed',
      live: false,
      dryRun: true,
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
});

function createFakeTelegramAdapter(): ChannelAdapter & {
  sentTexts: Array<{ peerId: string; text: string; options: SendOptions }>;
} {
  const sentTexts: Array<{ peerId: string; text: string; options: SendOptions }> = [];
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
    sendText: async (peerId: string, text: string, options: SendOptions = {}) => {
      sentTexts.push({ peerId, text, options });
      return 'fake-live-message-id';
    },
    sendMedia: async (_peerId: string, _media: OutboundMedia, _options: SendOptions = {}) => 'fake-media-id',
    sentTexts,
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
