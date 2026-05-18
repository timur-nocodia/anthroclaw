import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runScheduledWorkGate } from '../side-effect-gates/scheduled-work.js';

describe('scheduled-work side-effect gate', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-scheduled-work-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('exercises manage_cron for an arbitrary agent in an isolated workspace', async () => {
    const agentId = 'custom_scheduled_agent';
    const sourceAgentsDir = join(root, 'source-agents');
    const sourceAgentDir = join(sourceAgentsDir, agentId);
    const workspace = join(root, 'workspace');
    mkdirSync(sourceAgentDir, { recursive: true });
    const sourceYml = [
      'model: test-model',
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: group',
      '    account: ops',
      '    peers: [ "peer-scheduled-42" ]',
      '    topics: [ "8" ]',
      '    mention_only: true',
      'allowlist:',
      '  telegram: [ "peer-scheduled-42" ]',
      'mcp_tools:',
      '  - manage_cron',
    ].join('\n');
    writeFileSync(join(sourceAgentDir, 'agent.yml'), sourceYml, 'utf8');

    const result = await runScheduledWorkGate({
      agentId,
      sourceAgentsDir,
      workspace,
      accountId: 'ops',
      peerId: 'peer-scheduled-42',
      senderId: 'sender-scheduled-42',
      threadId: '8',
      cronId: 'custom-scheduled-work',
      cronPrompt: 'Run a disabled scheduled work smoke. Reply [SILENT] if healthy.',
    });

    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId,
      gate: {
        id: 'scheduled-work',
        spec: {
          gateId: 'scheduled-work',
          agentId,
          action: 'cron.schedule',
          target: {
            channel: 'telegram',
            accountId: 'ops',
            peerId: 'peer-scheduled-42',
            threadId: '8',
          },
        },
        validation: {
          ok: true,
          errors: [],
          warnings: [],
        },
      },
      target: {
        accountId: 'ops',
        peerId: 'peer-scheduled-42',
        threadId: '8',
      },
      cron: {
        id: 'custom-scheduled-work',
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
    expect(result.cron.updates).toBe(3);
    expect(readFileSync(join(sourceAgentDir, 'agent.yml'), 'utf8')).toBe(sourceYml);
    expect(existsSync(join(workspace, 'agents', agentId, 'agent.yml'))).toBe(true);
    expect(existsSync(join(workspace, 'data', 'dynamic-cron.json'))).toBe(true);
  });

  it('fails when the agent does not expose manage_cron', async () => {
    const agentId = 'no_cron_agent';
    const sourceAgentsDir = join(root, 'source-agents');
    const sourceAgentDir = join(sourceAgentsDir, agentId);
    mkdirSync(sourceAgentDir, { recursive: true });
    writeFileSync(join(sourceAgentDir, 'agent.yml'), [
      'model: test-model',
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      'mcp_tools:',
      '  - memory_search',
    ].join('\n'), 'utf8');

    await expect(runScheduledWorkGate({
      agentId,
      sourceAgentsDir,
      workspace: join(root, 'workspace'),
      accountId: 'ops',
      peerId: 'peer',
      senderId: 'sender',
    })).rejects.toThrow(/must expose manage_cron/);
  });
});
