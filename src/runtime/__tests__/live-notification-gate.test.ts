import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ApprovalRequest,
  ChannelAdapter,
  InboundMessage,
  OutboundMedia,
  SendOptions,
} from '../../channels/types.js';
import { runLiveNotificationGate } from '../side-effect-gates/live-notification.js';

describe('live notification side-effect gate', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-live-notification-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('emits a configured notification for an arbitrary private Telegram agent', async () => {
    const agentId = 'custom_notification_agent';
    const peerId = 'peer-notification-42';
    const agentsDir = join(root, 'agents');
    const agentDir = join(agentsDir, agentId);
    const configPath = join(root, 'config.yml');
    const dataDir = join(root, 'data');
    const note = 'GENERIC_LIVE_NOTIFICATION_OK test';
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'agent.yml'), [
      'model: test-model',
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      '    account: ops',
      '    peers: [ "peer-notification-42" ]',
      'allowlist:',
      '  telegram: [ "peer-notification-42" ]',
      'notifications:',
      '  enabled: true',
      '  routes:',
      '    ops:',
      '      channel: telegram',
      '      account_id: ops',
      '      peer_id: "peer-notification-42"',
      '  subscriptions:',
      '    - event: escalation_needed',
      '      route: ops',
      '      throttle: 1m',
    ].join('\n'), 'utf8');
    writeFileSync(configPath, [
      'telegram:',
      '  accounts:',
      '    ops:',
      '      token: test-token',
    ].join('\n'), 'utf8');

    const fake = createFakeTelegramAdapter();
    const result = await runLiveNotificationGate({
      agentId,
      configPath,
      agentsDir,
      dataDir,
      accountId: 'ops',
      peerId,
      routeName: 'ops',
      markerPrefix: 'GENERIC_LIVE_NOTIFICATION_OK',
      note,
      confirmLiveNotification: true,
      dryRun: false,
    }, {
      makeChannel: () => fake,
      makeRunId: () => 'generic-live-notification-run',
      now: fixedClock(1_800_000_300_000, 25),
    });

    expect(fake.sentTexts).toHaveLength(1);
    expect(fake.sentTexts[0]).toMatchObject({
      peerId,
      options: { accountId: 'ops' },
    });
    expect(fake.sentTexts[0]?.text).toContain('*Escalation requested*');
    expect(fake.sentTexts[0]?.text).toContain(note);
    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId,
      gate: {
        id: 'live-notification',
        spec: {
          gateId: 'live-notification',
          agentId,
          action: 'notification.emit',
          target: {
            channel: 'telegram',
            accountId: 'ops',
            peerId,
          },
        },
        validation: {
          ok: true,
          errors: [],
          warnings: [],
        },
      },
      notification: {
        event: 'escalation_needed',
        routeName: 'ops',
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
        runId: 'generic-live-notification-run',
        sessionKey: 'custom_notification_agent:telegram:dm:peer-notification-42:live-notification',
        toolStarted: true,
        toolCompleted: true,
      },
    });

    const metricsDb = join(dataDir, 'metrics.sqlite');
    expect(existsSync(metricsDb)).toBe(true);
    const db = new Database(metricsDb, { readonly: true, fileMustExist: true });
    try {
      expect(db.prepare('SELECT agent_id, status FROM agent_runs WHERE run_id = ?').get('generic-live-notification-run')).toEqual({
        agent_id: agentId,
        status: 'succeeded',
      });
      expect(db.prepare('SELECT status, count(*) AS count FROM tool_events GROUP BY status ORDER BY status').all()).toEqual([
        { status: 'completed', count: 1 },
        { status: 'started', count: 1 },
      ]);
    } finally {
      db.close();
    }
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
