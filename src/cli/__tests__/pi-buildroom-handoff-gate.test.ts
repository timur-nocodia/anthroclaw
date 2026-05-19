import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parsePiBuildroomHandoffGateArgs,
  runPiBuildroomHandoffGateCli,
} from '../pi-buildroom-handoff-gate.js';

describe('Pi Buildroom handoff gate CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-buildroom-handoff-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses generic flags', () => {
    expect(parsePiBuildroomHandoffGateArgs([
      '--',
      '--agent-id', 'custom_agent',
      '--agents-dir', '/tmp/agents',
      '--account-id', 'ops',
      '--peer-id', '42',
      '--sender-id', '43',
      '--room-id', 'room-1',
      '--source-session-id', 'session-1',
      '--requested-action', 'research_only',
      '--dry-run',
      '--keep-data',
      '--json',
    ])).toMatchObject({
      agentId: 'custom_agent',
      agentsDir: '/tmp/agents',
      accountId: 'ops',
      peerId: '42',
      senderId: '43',
      roomId: 'room-1',
      sourceSessionId: 'session-1',
      requestedAction: 'research_only',
      keepData: true,
      json: true,
    });
    expect(() => parsePiBuildroomHandoffGateArgs(['--agent-id'])).toThrow(/requires a value/);
    expect(() => parsePiBuildroomHandoffGateArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('runs temp-only Buildroom handoff canaries for an arbitrary agent without leaking workspaces', async () => {
    const workspace = join(root, 'workspace');
    const agentsDir = join(root, 'agents');
    const agentId = 'cli_buildroom_agent';
    mkdirSync(join(agentsDir, agentId), { recursive: true });
    writeFileSync(join(agentsDir, agentId, 'agent.yml'), [
      'model: test-model',
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      '    account: ops',
      '    peers: [ "peer-cli-buildroom" ]',
      'allowlist:',
      '  telegram: [ "peer-cli-buildroom" ]',
      'mcp_tools:',
      '  - buildroom_submit_signal',
      '  - buildroom_submit_session_summary',
    ].join('\n'), 'utf8');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiBuildroomHandoffGateCli([
      '--agent-id', agentId,
      '--agents-dir', agentsDir,
      '--account-id', 'ops',
      '--peer-id', 'peer-cli-buildroom',
      '--sender-id', 'sender-cli-buildroom',
      '--room-id', 'cli-room',
      '--source-session-id', 'cli-session',
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
      roomId: 'cli-room',
      permissions: {
        buildroomToolsPresent: true,
        privateAllowlistIncludesPeer: true,
        sessionSummaryAllowed: true,
        handoffSignalAllowed: true,
      },
      summary: {
        submitted: true,
        sanitized: true,
        sourceSessionBound: true,
      },
      handoff: {
        submitted: true,
        targetBuildroomBound: true,
        requestedAction: 'research_only',
      },
      safety: {
        tempOnly: true,
        uninitializedFailsClosed: true,
        artifactsWritten: 2,
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
