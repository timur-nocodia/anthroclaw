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
  parsePiTimurAgentLiveNotificationArgs,
  runPiTimurAgentLiveNotificationCli,
} from '../pi-timur-agent-live-notification.js';

describe('Pi timur_agent live notification gate CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-timur-agent-live-notification-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses live notification flags and requires values', () => {
    expect(parsePiTimurAgentLiveNotificationArgs([
      '--',
      '--config', '/tmp/config.yml',
      '--agents-dir', '/tmp/agents',
      '--data-dir', '/tmp/data',
      '--account-id', 'ops',
      '--peer-id', '42',
      '--note', 'HELLO',
      '--confirm-live-notification',
      '--dry-run',
      '--json',
    ])).toMatchObject({
      configPath: '/tmp/config.yml',
      agentsDir: '/tmp/agents',
      dataDir: '/tmp/data',
      accountId: 'ops',
      peerId: '42',
      note: 'HELLO',
      confirmLiveNotification: true,
      dryRun: true,
      json: true,
    });
    expect(() => parsePiTimurAgentLiveNotificationArgs(['--note'])).toThrow(/requires a value/);
    expect(() => parsePiTimurAgentLiveNotificationArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('refuses real notification delivery without explicit confirmation', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentLiveNotificationCli(['--json'], {
      stdout,
      stderr,
    });

    expect(code).toBe(2);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('Refusing live notification');
  });

  it('runs one fake-backed live notification through the emitter and records monitorable metrics', async () => {
    const configPath = join(root, 'config.yml');
    const dataDir = join(root, 'data');
    const note = 'TEST_TIMUR_AGENT_LIVE_NOTIFICATION_OK';
    writeFileSync(configPath, [
      'telegram:',
      '  accounts:',
      '    default:',
      '      token: test-token',
    ].join('\n'), 'utf8');

    const fake = createFakeTelegramAdapter();
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentLiveNotificationCli([
      '--config', configPath,
      '--agents-dir', resolve('agents'),
      '--data-dir', dataDir,
      '--note', note,
      '--confirm-live-notification',
      '--json',
    ], {
      stdout,
      stderr,
      makeChannel: () => fake,
      makeRunId: () => 'test-live-notification-run',
      now: fixedClock(1_800_000_000_000, 25),
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(fake.sentTexts).toHaveLength(1);
    expect(fake.sentTexts[0]).toMatchObject({
      peerId: '48705953',
      options: { accountId: 'default' },
    });
    expect(fake.sentTexts[0]?.text).toContain('*Escalation requested*');
    expect(fake.sentTexts[0]?.text).toContain(note);

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
      markerPrefix: 'TIMUR_AGENT_LIVE_NOTIFICATION_OK',
      note,
      notification: {
        event: 'escalation_needed',
        operatorRoutePresent: true,
        subscriptionPresent: true,
        notificationsEnabled: true,
        formattedTextIncludesMarker: true,
      },
      delivery: {
        sent: true,
        via: 'notifications.emit',
        realTelegramDelivery: true,
        messageId: 'fake-live-notification-id',
      },
      metrics: {
        recorded: true,
        runId: 'test-live-notification-run',
        sessionKey: 'timur_agent:telegram:dm:48705953:live-notification',
        toolStarted: true,
        toolCompleted: true,
      },
      safety: {
        operatorApproved: true,
        noBroadFanout: true,
        noCronMutation: true,
        noConfigMutation: true,
      },
    });

    const metricsDb = join(dataDir, 'metrics.sqlite');
    expect(existsSync(metricsDb)).toBe(true);
    const db = new Database(metricsDb, { readonly: true, fileMustExist: true });
    try {
      expect(db.prepare('SELECT status FROM agent_runs WHERE run_id = ?').get('test-live-notification-run')).toEqual({
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

  it('dry-runs notification policy without sending or writing metrics', async () => {
    const dataDir = join(root, 'data');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentLiveNotificationCli([
      '--agents-dir', resolve('agents'),
      '--data-dir', dataDir,
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
      notification: {
        event: 'escalation_needed',
        operatorRoutePresent: true,
        subscriptionPresent: true,
        notificationsEnabled: true,
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
      return 'fake-live-notification-id';
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
