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
import { runLiveSendMessageGate } from '../side-effect-gates/live-send-message.js';

describe('live send_message side-effect gate', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-live-send-message-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('runs for an arbitrary private Telegram agent without agent-specific gate naming', async () => {
    const agentId = 'custom_operator_agent';
    const peerId = 'peer-42';
    const agentsDir = join(root, 'agents');
    const agentDir = join(agentsDir, agentId);
    const configPath = join(root, 'config.yml');
    const dataDir = join(root, 'data');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'agent.yml'), [
      'model: test-model',
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      '    account: ops',
      '    peers: [ "peer-42" ]',
      'allowlist:',
      '  telegram: [ "peer-42" ]',
      'mcp_tools:',
      '  - send_message',
    ].join('\n'), 'utf8');
    writeFileSync(configPath, [
      'telegram:',
      '  accounts:',
      '    ops:',
      '      token: test-token',
    ].join('\n'), 'utf8');

    const fake = createFakeTelegramAdapter();
    const result = await runLiveSendMessageGate({
      agentId,
      configPath,
      agentsDir,
      dataDir,
      accountId: 'ops',
      peerId,
      markerPrefix: 'GENERIC_LIVE_SEND_MESSAGE_OK',
      marker: 'GENERIC_LIVE_SEND_MESSAGE_OK test',
      confirmLiveSend: true,
      dryRun: false,
    }, {
      makeChannel: () => fake,
      makeRunId: () => 'generic-live-send-run',
      now: fixedClock(1_800_000_100_000, 25),
    });

    expect(fake.sentTexts).toEqual([
      {
        peerId,
        text: 'GENERIC_LIVE_SEND_MESSAGE_OK test',
        options: { accountId: 'ops' },
      },
    ]);
    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId,
      gate: {
        id: 'live-send-message',
        spec: {
          gateId: 'live-send-message',
          agentId,
          action: 'message.send',
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
      delivery: {
        sent: true,
        via: 'send_message',
        realTelegramDelivery: true,
        messageId: 'fake-live-message-id',
      },
      metrics: {
        recorded: true,
        runId: 'generic-live-send-run',
        sessionKey: 'custom_operator_agent:telegram:dm:peer-42:live-send-message',
        toolStarted: true,
        toolCompleted: true,
      },
    });

    const metricsDb = join(dataDir, 'metrics.sqlite');
    expect(existsSync(metricsDb)).toBe(true);
    const db = new Database(metricsDb, { readonly: true, fileMustExist: true });
    try {
      expect(db.prepare('SELECT agent_id, status FROM agent_runs WHERE run_id = ?').get('generic-live-send-run')).toEqual({
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
    approvalMode: 'interactive_buttons',
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
