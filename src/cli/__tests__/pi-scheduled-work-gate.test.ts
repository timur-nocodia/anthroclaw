import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parsePiScheduledWorkGateArgs,
  runPiScheduledWorkGateCli,
} from '../pi-scheduled-work-gate.js';

describe('Pi scheduled-work gate CLI', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('runs scheduled-work gate for an arbitrary agent', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-scheduled-work-gate-'));
    const agentsDir = join(root, 'agents');
    const workspace = join(root, 'workspace');
    writeAgent(agentsDir, 'project-manager', `
routes:
  - channel: telegram
    account: content_sm
    scope: group
    peers: ["-1003729315809"]
    topics: ["8"]
    mention_only: true
safety_profile: chat_like_openclaw
mcp_tools: [manage_cron]
`);
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiScheduledWorkGateCli([
      '--agents-dir', agentsDir,
      '--agent-id', 'project-manager',
      '--account-id', 'content_sm',
      '--peer-id', '-1003729315809',
      '--sender-id', '48705953',
      '--thread-id', '8',
      '--cron-id', 'project-manager-scheduled-work',
      '--json',
    ], { stdout, stderr, makeWorkspace: () => workspace });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId: 'project-manager',
      target: {
        accountId: 'content_sm',
        peerId: '-1003729315809',
        threadId: '8',
      },
      cron: {
        id: 'project-manager-scheduled-work',
        created: true,
        listed: true,
        toggledDisabled: true,
        deleted: true,
        remaining: 0,
        deliverToBound: true,
        createdByBound: true,
        ignoredModelSuppliedDeliverTo: true,
      },
      sourceConfigUnchanged: true,
    });
  });

  it('returns failed JSON when manage_cron is not exposed', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-scheduled-work-gate-'));
    const agentsDir = join(root, 'agents');
    writeAgent(agentsDir, 'no_cron_agent', `
routes:
  - channel: telegram
    scope: dm
safety_profile: private
mcp_tools: [memory_search]
`);
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiScheduledWorkGateCli([
      '--agents-dir', agentsDir,
      '--agent-id', 'no_cron_agent',
      '--peer-id', 'peer',
      '--sender-id', 'sender',
      '--json',
    ], { stdout, stderr, makeWorkspace: () => join(root!, 'workspace') });

    expect(code).toBe(1);
    expect(stdout.text()).toBe('');
    expect(JSON.parse(stderr.text())).toMatchObject({
      status: 'failed',
      agentId: 'no_cron_agent',
      error: expect.stringContaining('must expose manage_cron'),
    });
  });

  it('parses scheduled-work flags narrowly', () => {
    expect(parsePiScheduledWorkGateArgs([
      '--',
      '--agents-dir', '/tmp/agents',
      '--agent-id', 'project-manager',
      '--account-id', 'content_sm',
      '--peer-id', '-100',
      '--sender-id', '48705953',
      '--thread-id', '8',
      '--cron-id', 'work',
      '--cron-schedule', '0 9 * * *',
      '--cron-prompt', 'Run it',
      '--keep-data',
      '--json',
    ])).toMatchObject({
      agentsDir: '/tmp/agents',
      agentId: 'project-manager',
      accountId: 'content_sm',
      peerId: '-100',
      senderId: '48705953',
      threadId: '8',
      cronId: 'work',
      cronSchedule: '0 9 * * *',
      cronPrompt: 'Run it',
      keepData: true,
      json: true,
    });
    expect(() => parsePiScheduledWorkGateArgs(['--agent-id'])).toThrow(/requires a value/);
    expect(() => parsePiScheduledWorkGateArgs(['--wat'])).toThrow(/Unknown argument/);
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
