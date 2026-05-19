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
import { runControlledLiveTurnGate } from '../side-effect-gates/controlled-live-turn.js';

describe('controlled live turn side-effect gate', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-controlled-live-turn-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('runs for an arbitrary Telegram group agent with a confirmed topic', async () => {
    const agentId = 'group_operator_agent';
    const agentsDir = join(root, 'agents');
    const agentDir = join(agentsDir, agentId);
    const configPath = join(root, 'config.yml');
    const dataDir = join(root, 'data');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'agent.yml'), [
      'model: test-model',
      'safety_profile: chat_like_anthroclaw',
      'routes:',
      '  - channel: telegram',
      '    scope: group',
      '    account: ops',
      '    peers: [ "-10042" ]',
      '    topics: [ "8" ]',
      '    mention_only: true',
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
    const result = await runControlledLiveTurnGate({
      agentId,
      configPath,
      agentsDir,
      dataDir,
      accountId: 'ops',
      peerId: '-10042',
      threadId: '8',
      markerPrefix: 'GENERIC_CONTROLLED_LIVE_TURN_OK',
      marker: 'GENERIC_CONTROLLED_LIVE_TURN_OK test',
      confirmControlledLiveTurn: true,
      dryRun: false,
    }, {
      makeChannel: () => fake,
      makeRunId: () => 'generic-controlled-live-turn-run',
      now: fixedClock(1_800_100_100_000, 25),
    });

    expect(fake.sentTexts).toEqual([
      {
        peerId: '-10042',
        text: 'GENERIC_CONTROLLED_LIVE_TURN_OK test',
        options: { accountId: 'ops', threadId: '8' },
      },
    ]);
    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId,
      gate: {
        id: 'controlled-live-turn',
        spec: {
          gateId: 'controlled-live-turn',
          agentId,
          action: 'message.controlled_live_turn',
          target: {
            channel: 'telegram',
            accountId: 'ops',
            peerId: '-10042',
            threadId: '8',
          },
        },
        validation: {
          ok: true,
          errors: [],
          warnings: [],
        },
      },
      route: {
        bound: true,
        scope: 'group',
        mentionOnly: true,
        topicBound: true,
      },
      delivery: {
        sent: true,
        via: 'telegram_channel',
        realTelegramDelivery: true,
        messageId: 'fake-live-message-id',
      },
      metrics: {
        recorded: true,
        runId: 'generic-controlled-live-turn-run',
        sessionKey: 'group_operator_agent:telegram:group:-10042:8:controlled-live-turn',
        toolStarted: true,
        toolCompleted: true,
      },
      safety: {
        operatorApproved: true,
        noBroadFanout: true,
        noMedia: true,
        noConfigMutation: true,
        routeBound: true,
      },
    });

    const metricsDb = join(dataDir, 'metrics.sqlite');
    expect(existsSync(metricsDb)).toBe(true);
    const db = new Database(metricsDb, { readonly: true, fileMustExist: true });
    try {
      expect(db.prepare('SELECT agent_id, status FROM agent_runs WHERE run_id = ?').get('generic-controlled-live-turn-run')).toEqual({
        agent_id: agentId,
        status: 'succeeded',
      });
    } finally {
      db.close();
    }
  });

  it('rejects unconfirmed group topics before delivery', async () => {
    const agentId = 'group_operator_agent';
    const agentsDir = join(root, 'agents');
    const agentDir = join(agentsDir, agentId);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'agent.yml'), [
      'safety_profile: chat_like_anthroclaw',
      'routes:',
      '  - channel: telegram',
      '    scope: group',
      '    account: ops',
      '    peers: [ "-10042" ]',
      '    topics: [ "8" ]',
      '    mention_only: true',
      'mcp_tools: [send_message]',
    ].join('\n'), 'utf8');

    await expect(runControlledLiveTurnGate({
      agentId,
      configPath: join(root, 'config.yml'),
      agentsDir,
      dataDir: join(root, 'data'),
      accountId: 'ops',
      peerId: '-10042',
      threadId: '9',
      confirmControlledLiveTurn: true,
      dryRun: false,
    }, {
      makeChannel: () => {
        throw new Error('should not create a channel');
      },
    })).rejects.toThrow(/Telegram group route bound/);
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
