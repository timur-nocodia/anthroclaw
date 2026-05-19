import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCronNotificationGate } from '../side-effect-gates/cron-notification.js';

describe('cron notification side-effect gate', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-cron-notification-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('exercises cron and notification controls for an arbitrary agent in an isolated workspace', async () => {
    const agentId = 'custom_cron_agent';
    const peerId = 'peer-cron-42';
    const sourceAgentsDir = join(root, 'source-agents');
    const sourceAgentDir = join(sourceAgentsDir, agentId);
    const workspace = join(root, 'workspace');
    mkdirSync(sourceAgentDir, { recursive: true });
    writeFileSync(join(sourceAgentDir, 'agent.yml'), [
      'model: test-model',
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      '    account: ops',
      '    peers: [ "peer-cron-42" ]',
      'allowlist:',
      '  telegram: [ "peer-cron-42" ]',
      'mcp_tools:',
      '  - manage_cron',
      '  - manage_notifications',
      'cron:',
      '  - id: custom-disabled-cron',
      '    schedule: "0 9 * * *"',
      '    prompt: "Disabled cron canary"',
      '    enabled: false',
      'notifications:',
      '  enabled: true',
      '  routes:',
      '    ops:',
      '      channel: telegram',
      '      account_id: ops',
      '      peer_id: "peer-cron-42"',
      '  subscriptions:',
      '    - event: escalation_needed',
      '      route: ops',
      '      throttle: 1m',
    ].join('\n'), 'utf8');

    const result = await runCronNotificationGate({
      agentId,
      sourceAgentsDir,
      workspace,
      accountId: 'ops',
      peerId,
      senderId: 'sender-cron-42',
      staticCronId: 'custom-disabled-cron',
      dynamicCronId: 'custom-dynamic-cron',
      dynamicCronPrompt: 'Run a disabled custom cron smoke. Reply [SILENT] if healthy.',
      notificationRouteName: 'ops',
      notificationMarker: 'GENERIC_CRON_NOTIFICATION_CANARY',
    });

    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId,
      gate: {
        id: 'cron-notification',
        spec: {
          gateId: 'cron-notification',
          agentId,
          action: 'cron.schedule',
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
      staticCron: {
        id: 'custom-disabled-cron',
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
        routeName: 'ops',
        event: 'escalation_needed',
        operatorRoutePresent: true,
        manageToolTestDispatched: true,
        emitterSends: 1,
        fakeOnly: true,
        markerSeen: true,
      },
    });
    expect(existsSync(join(workspace, 'agents', agentId, 'agent.yml'))).toBe(true);
    expect(existsSync(join(workspace, 'data', 'dynamic-cron.json'))).toBe(true);
  });
});
