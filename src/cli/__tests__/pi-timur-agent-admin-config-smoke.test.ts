import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parsePiTimurAgentAdminConfigSmokeArgs,
  runPiTimurAgentAdminConfigSmokeCli,
} from '../pi-timur-agent-admin-config-smoke.js';

describe('Pi timur_agent admin/config smoke CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-timur-agent-admin-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses narrow flags', () => {
    expect(parsePiTimurAgentAdminConfigSmokeArgs([
      '--',
      '--agents-dir', '/tmp/agents',
      '--peer-id', '42',
      '--session-key', 'timur:test:session',
      '--keep-data',
      '--json',
    ])).toMatchObject({
      agentsDir: '/tmp/agents',
      peerId: '42',
      sessionKey: 'timur:test:session',
      keepData: true,
      json: true,
    });
    expect(() => parsePiTimurAgentAdminConfigSmokeArgs(['--session-key'])).toThrow(/requires a value/);
    expect(() => parsePiTimurAgentAdminConfigSmokeArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('runs temp-only admin/config canaries without leaking workspaces', async () => {
    const workspace = join(root, 'workspace');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentAdminConfigSmokeCli([
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
        adminToolsPresent: true,
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
