import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parsePiAdminConfigGateArgs,
  runPiAdminConfigGateCli,
} from '../pi-admin-config-gate.js';

describe('Pi admin/config gate CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-admin-config-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses generic flags', () => {
    expect(parsePiAdminConfigGateArgs([
      '--',
      '--agent-id', 'custom_agent',
      '--agents-dir', '/tmp/agents',
      '--peer-id', '42',
      '--session-key', 'custom:session',
      '--pending-sender-id', 'pending-42',
      '--unauthorized-target-id', 'other-agent',
      '--dry-run',
      '--keep-data',
      '--json',
    ])).toMatchObject({
      agentId: 'custom_agent',
      agentsDir: '/tmp/agents',
      peerId: '42',
      sessionKey: 'custom:session',
      pendingSenderId: 'pending-42',
      unauthorizedTargetId: 'other-agent',
      keepData: true,
      json: true,
    });
    expect(() => parsePiAdminConfigGateArgs(['--agent-id'])).toThrow(/requires a value/);
    expect(() => parsePiAdminConfigGateArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('runs temp-only admin/config canaries for an arbitrary agent without leaking workspaces', async () => {
    const workspace = join(root, 'workspace');
    const agentsDir = join(root, 'agents');
    const agentId = 'cli_admin_agent';
    mkdirSync(join(agentsDir, agentId), { recursive: true });
    writeFileSync(join(agentsDir, agentId, 'agent.yml'), [
      'model: test-model',
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      '    peers: [ "peer-cli-admin" ]',
      'allowlist:',
      '  telegram: [ "peer-cli-admin" ]',
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
      '      peer_id: "peer-cli-admin"',
    ].join('\n'), 'utf8');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiAdminConfigGateCli([
      '--agent-id', agentId,
      '--agents-dir', agentsDir,
      '--peer-id', 'peer-cli-admin',
      '--session-key', `${agentId}:telegram:dm:peer-cli-admin`,
      '--pending-sender-id', 'pending-cli-admin',
      '--unauthorized-target-id', 'other-cli-agent',
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
      agentId,
      permissions: {
        adminToolsPresent: true,
        privateAllowlistIncludesPeer: true,
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
