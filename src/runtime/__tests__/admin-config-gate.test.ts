import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAdminConfigGate } from '../side-effect-gates/admin-config.js';

describe('admin/config side-effect gate', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-admin-config-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('exercises admin/config tools for an arbitrary agent in an isolated workspace', async () => {
    const agentId = 'custom_admin_agent';
    const peerId = 'peer-admin-42';
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
      '    peers: [ "peer-admin-42" ]',
      'allowlist:',
      '  telegram: [ "peer-admin-42" ]',
      'mcp_tools:',
      '  - access_control',
      '  - show_config',
      '  - manage_human_takeover',
      '  - manage_operator_console',
      'human_takeover:',
      '  enabled: false',
      'operator_console:',
      '  enabled: false',
      'notifications:',
      '  enabled: true',
      '  routes:',
      '    operator:',
      '      channel: telegram',
      '      account_id: default',
      '      peer_id: "peer-admin-42"',
    ].join('\n'), 'utf8');

    const result = await runAdminConfigGate({
      agentId,
      sourceAgentsDir,
      workspace,
      peerId,
      sessionKey: `${agentId}:telegram:dm:${peerId}`,
      pendingSenderId: 'pending-admin-42',
      unauthorizedTargetId: 'other_admin_agent',
    });

    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId,
      gate: {
        id: 'admin-config',
        spec: {
          gateId: 'admin-config',
          agentId,
          action: 'config.mutate',
          target: {
            channel: 'telegram',
            peerId,
          },
        },
        validation: {
          ok: true,
          errors: [],
          warnings: [],
        },
      },
      permissions: {
        adminToolsPresent: true,
        privateAllowlistIncludesPeer: true,
        privateAllowlistSinglePeer: true,
        selfManageAllowed: true,
        crossAgentDenied: true,
      },
      config: {
        showConfigRead: true,
        operatorConsolePatched: true,
        humanTakeoverPatched: true,
        lastModifiedSeen: true,
        tempOnly: true,
      },
      accessControl: {
        pendingListed: true,
        approved: true,
        approvedListed: true,
        revoked: true,
        approvedAfterRevoke: 0,
        tempOnly: true,
      },
    });
    expect(result.config.auditEntries).toBeGreaterThanOrEqual(2);
    expect(result.config.backupsCreated).toBeGreaterThanOrEqual(2);
    expect(existsSync(join(workspace, 'agents', agentId, 'agent.yml'))).toBe(true);
    expect(existsSync(join(workspace, 'data', 'config-audit'))).toBe(true);
  });
});
