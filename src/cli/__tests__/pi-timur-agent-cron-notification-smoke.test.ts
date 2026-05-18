import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parsePiTimurAgentCronNotificationSmokeArgs,
  runPiTimurAgentCronNotificationSmokeCli,
} from '../pi-timur-agent-cron-notification-smoke.js';

describe('Pi timur_agent cron/notification smoke CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-timur-agent-cron-notification-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses narrow flags', () => {
    expect(parsePiTimurAgentCronNotificationSmokeArgs([
      '--',
      '--agents-dir', '/tmp/agents',
      '--peer-id', '42',
      '--sender-id', '43',
      '--keep-data',
      '--json',
    ])).toMatchObject({
      agentsDir: '/tmp/agents',
      peerId: '42',
      senderId: '43',
      keepData: true,
      json: true,
    });
    expect(() => parsePiTimurAgentCronNotificationSmokeArgs(['--agents-dir'])).toThrow(/requires a value/);
    expect(() => parsePiTimurAgentCronNotificationSmokeArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('runs fake-only cron and notification canaries without leaking workspaces', async () => {
    const workspace = join(root, 'workspace');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentCronNotificationSmokeCli([
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
      staticCron: {
        id: 'timur-agent-lab-silent-check',
        exists: true,
        enabled: false,
      },
      dynamicCron: {
        created: true,
        listed: true,
        toggledDisabled: true,
        deleted: true,
        remaining: 0,
        deliverToBound: true,
        ignoredModelSuppliedDeliverTo: true,
      },
      notifications: {
        operatorRoutePresent: true,
        manageToolTestDispatched: true,
        emitterSends: 1,
        fakeOnly: true,
        markerSeen: true,
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
