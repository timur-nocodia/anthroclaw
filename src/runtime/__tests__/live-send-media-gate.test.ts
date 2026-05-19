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
import { runLiveSendMediaGate } from '../side-effect-gates/live-send-media.js';

describe('live send_media side-effect gate', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-live-send-media-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('runs document delivery for an arbitrary private Telegram agent with an input file-root guard', async () => {
    const agentId = 'custom_media_agent';
    const peerId = 'peer-media-42';
    const agentsDir = join(root, 'agents');
    const agentDir = join(agentsDir, agentId);
    const workspace = join(root, 'workspace');
    const allowedFileRoot = 'agent-media/outbox';
    const filePath = 'agent-media/outbox/canary.txt';
    const configPath = join(root, 'config.yml');
    const dataDir = join(root, 'data');
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(workspace, allowedFileRoot), { recursive: true });
    writeFileSync(join(workspace, filePath), 'generic media canary\n', 'utf8');
    writeFileSync(join(agentDir, 'agent.yml'), [
      'model: test-model',
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      '    account: ops',
      '    peers: [ "peer-media-42" ]',
      'allowlist:',
      '  telegram: [ "peer-media-42" ]',
      'mcp_tools:',
      '  - send_media',
    ].join('\n'), 'utf8');
    writeFileSync(configPath, [
      'telegram:',
      '  accounts:',
      '    ops:',
      '      token: test-token',
    ].join('\n'), 'utf8');

    const fake = createFakeTelegramAdapter();
    const result = await runLiveSendMediaGate({
      agentId,
      configPath,
      agentsDir,
      dataDir,
      workspacePath: workspace,
      accountId: 'ops',
      peerId,
      filePath,
      allowedFileRoot,
      markerPrefix: 'GENERIC_LIVE_SEND_MEDIA_OK',
      caption: 'GENERIC_LIVE_SEND_MEDIA_OK test',
      confirmLiveSendMedia: true,
      dryRun: false,
    }, {
      makeChannel: () => fake,
      makeRunId: () => 'generic-live-media-run',
      now: fixedClock(1_800_000_200_000, 25),
    });

    expect(fake.sentMedia).toEqual([
      {
        peerId,
        media: {
          type: 'document',
          path: join(workspace, filePath),
          mimeType: 'application/octet-stream',
          caption: 'GENERIC_LIVE_SEND_MEDIA_OK test',
        },
        options: { accountId: 'ops' },
      },
    ]);
    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId,
      gate: {
        id: 'live-send-media',
        spec: {
          gateId: 'live-send-media',
          agentId,
          action: 'media.send',
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
      media: {
        type: 'document',
        filePath,
        caption: 'GENERIC_LIVE_SEND_MEDIA_OK test',
        allowedRoot: allowedFileRoot,
        fileExists: true,
        fileRootBound: true,
      },
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
        runId: 'generic-live-media-run',
        sessionKey: 'custom_media_agent:telegram:dm:peer-media-42:live-send-media',
        toolStarted: true,
        toolCompleted: true,
      },
    });

    const metricsDb = join(dataDir, 'metrics.sqlite');
    expect(existsSync(metricsDb)).toBe(true);
    const db = new Database(metricsDb, { readonly: true, fileMustExist: true });
    try {
      expect(db.prepare('SELECT agent_id, status FROM agent_runs WHERE run_id = ?').get('generic-live-media-run')).toEqual({
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

  it('rejects media files outside the supplied allowed root', async () => {
    const agentId = 'custom_media_agent';
    const peerId = 'peer-media-42';
    const agentsDir = join(root, 'agents');
    const agentDir = join(agentsDir, agentId);
    const workspace = join(root, 'workspace');
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(workspace, 'agent-media/outbox'), { recursive: true });
    writeFileSync(join(workspace, 'outside.txt'), 'outside\n', 'utf8');
    writeFileSync(join(agentDir, 'agent.yml'), [
      'model: test-model',
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      '    account: ops',
      '    peers: [ "peer-media-42" ]',
      'allowlist:',
      '  telegram: [ "peer-media-42" ]',
      'mcp_tools:',
      '  - send_media',
    ].join('\n'), 'utf8');

    await expect(runLiveSendMediaGate({
      agentId,
      configPath: join(root, 'config.yml'),
      agentsDir,
      dataDir: join(root, 'data'),
      workspacePath: workspace,
      accountId: 'ops',
      peerId,
      filePath: 'outside.txt',
      allowedFileRoot: 'agent-media/outbox',
      confirmLiveSendMedia: true,
      dryRun: false,
    })).rejects.toThrow(/media file must stay under agent-media\/outbox/);
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
