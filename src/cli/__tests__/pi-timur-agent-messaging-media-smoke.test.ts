import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parsePiTimurAgentMessagingMediaSmokeArgs,
  runPiTimurAgentMessagingMediaSmokeCli,
} from '../pi-timur-agent-messaging-media-smoke.js';

describe('Pi timur_agent messaging/media smoke CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-timur-agent-messaging-media-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses narrow flags', () => {
    expect(parsePiTimurAgentMessagingMediaSmokeArgs([
      '--',
      '--agents-dir', '/tmp/agents',
      '--peer-id', '42',
      '--sender-id', '43',
      '--thread-id', 'topic-7',
      '--keep-data',
      '--json',
    ])).toMatchObject({
      agentsDir: '/tmp/agents',
      peerId: '42',
      senderId: '43',
      threadId: 'topic-7',
      keepData: true,
      json: true,
    });
    expect(() => parsePiTimurAgentMessagingMediaSmokeArgs(['--thread-id'])).toThrow(/requires a value/);
    expect(() => parsePiTimurAgentMessagingMediaSmokeArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('runs fake-only messaging and media canaries without leaking workspaces', async () => {
    const workspace = join(root, 'workspace');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentMessagingMediaSmokeCli([
      '--json',
    ], {
      makeWorkspace: () => workspace,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(existsSync(workspace)).toBe(false);
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId: 'timur_agent',
      permissions: {
        mcpToolsPresent: true,
        privateAllowlistSinglePeer: true,
        sendMessageAllowed: true,
        sendMediaApprovalRequested: true,
        sendMediaApprovalAllowed: true,
      },
      delivery: {
        fakeChannelOnly: true,
        noRealTelegramDelivery: true,
        textSends: 1,
        mediaSends: 1,
        textPeerBound: true,
        mediaPeerBound: true,
        textAccountBound: true,
        mediaAccountBound: true,
        textThreadBound: true,
        mediaThreadBound: true,
        textMarkerSeen: true,
        mediaMarkerSeen: true,
      },
      safety: {
        pathTraversalBlocked: true,
        pausedPeerSuppressed: true,
        pausedPeerExtraSends: 0,
        pauseNotificationEmitted: true,
      },
    });
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
