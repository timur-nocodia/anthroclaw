import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parsePiControlledLiveTurnGateArgs,
  runPiControlledLiveTurnGateCli,
} from '../pi-controlled-live-turn-gate.js';

describe('Pi controlled live turn gate CLI', () => {
  let root: string | undefined;
  let liveRoot: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (liveRoot) rmSync(liveRoot, { recursive: true, force: true });
    root = undefined;
    liveRoot = undefined;
  });

  it('dry-runs any explicit group agent from repeated agents roots', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-controlled-live-turn-root-'));
    liveRoot = mkdtempSync(join(tmpdir(), 'pi-controlled-live-turn-live-'));
    await writeAgent(liveRoot, 'any_group_agent', `
routes:
  - channel: telegram
    account: ops
    scope: group
    peers: ["-10042"]
    topics: ["8"]
    mention_only: true
safety_profile: chat_like_openclaw
mcp_tools: [send_message]
`);
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiControlledLiveTurnGateCli([
      '--agents-dir', root,
      '--agents-dir', liveRoot,
      '--data-dir', join(root, 'data'),
      '--agent-id', 'any_group_agent',
      '--account-id', 'ops',
      '--peer-id', '-10042',
      '--thread-id', '8',
      '--marker', 'CONTROLLED_LIVE_TURN_OK dry-run',
      '--dry-run',
      '--json',
    ], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId: 'any_group_agent',
      dryRun: true,
      live: false,
      target: {
        channel: 'telegram',
        accountId: 'ops',
        peerId: '-10042',
        threadId: '8',
      },
      route: {
        bound: true,
        mentionOnly: true,
        topicBound: true,
      },
      delivery: {
        sent: false,
        realTelegramDelivery: false,
      },
      metrics: {
        recorded: false,
        toolStarted: false,
        toolCompleted: false,
      },
    });
  });

  it('refuses live turns without the controlled live approval flag', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiControlledLiveTurnGateCli([
      '--agent-id', 'any_group_agent',
      '--peer-id', '-10042',
      '--thread-id', '8',
    ], { stdout, stderr });

    expect(code).toBe(2);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('--confirm-controlled-live-turn');
  });

  it('parses repeated roots and topic aliases narrowly', () => {
    expect(parsePiControlledLiveTurnGateArgs([
      '--',
      '--agents-dir', '/tmp/tracked',
      '--agents-dir', '/tmp/live',
      '--data-dir', '/tmp/data',
      '--agent-id', 'any_group_agent',
      '--account-id', 'ops',
      '--peer-id', '-10042',
      '--topic-id', '8',
      '--marker-prefix', 'MARKER',
      '--allow-non-mention-only',
      '--dry-run',
      '--json',
    ])).toMatchObject({
      agentsDir: '/tmp/tracked',
      agentsDirs: ['/tmp/tracked', '/tmp/live'],
      dataDir: '/tmp/data',
      agentId: 'any_group_agent',
      accountId: 'ops',
      peerId: '-10042',
      threadId: '8',
      markerPrefix: 'MARKER',
      allowNonMentionOnly: true,
      dryRun: true,
      json: true,
    });
    expect(() => parsePiControlledLiveTurnGateArgs(['--thread-id'])).toThrow(/requires a value/);
    expect(() => parsePiControlledLiveTurnGateArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  async function writeAgent(agentsRoot: string, agentId: string, body: string): Promise<void> {
    const dir = join(agentsRoot, agentId);
    mkdirSync(dir, { recursive: true });
    await writeFile(join(dir, 'agent.yml'), body.trimStart(), 'utf8');
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
