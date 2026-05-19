import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBuildroomHandoffGate } from '../side-effect-gates/buildroom-handoff.js';

describe('Buildroom handoff side-effect gate', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-buildroom-handoff-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('submits sanitized Buildroom handoff artifacts for an arbitrary agent in an isolated workspace', async () => {
    const agentId = 'custom_buildroom_agent';
    const peerId = 'peer-buildroom-42';
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
      '    peers: [ "peer-buildroom-42" ]',
      'allowlist:',
      '  telegram: [ "peer-buildroom-42" ]',
      'mcp_tools:',
      '  - buildroom_submit_signal',
      '  - buildroom_submit_session_summary',
    ].join('\n'), 'utf8');

    const result = await runBuildroomHandoffGate({
      agentId,
      sourceAgentsDir,
      workspace,
      accountId: 'ops',
      peerId,
      senderId: 'sender-buildroom-42',
      roomId: 'custom-room',
      sourceSessionId: 'custom_buildroom_agent:telegram:ops:peer-buildroom-42:buildroom-gate',
      requestedAction: 'research_only',
    });

    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId,
      roomId: 'custom-room',
      gate: {
        id: 'buildroom-handoff',
        spec: {
          gateId: 'buildroom-handoff',
          agentId,
          action: 'buildroom.handoff',
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
      permissions: {
        buildroomToolsPresent: true,
        privateAllowlistIncludesPeer: true,
        privateAllowlistSinglePeer: true,
        sessionSummaryAllowed: true,
        handoffSignalAllowed: true,
      },
      summary: {
        submitted: true,
        sanitized: true,
        noRawTranscript: true,
        cannotApproveWork: true,
        sourceSessionBound: true,
        candidateSignals: 1,
      },
      handoff: {
        submitted: true,
        parentLinked: true,
        sourceSessionBound: true,
        targetBuildroomBound: true,
        requestedAction: 'research_only',
        cannotApprove: true,
        cannotBuild: true,
      },
      safety: {
        tempOnly: true,
        uninitializedFailsClosed: true,
        artifactsWritten: 2,
      },
    });
    expect(result.summary.artifactId).toBeTruthy();
    expect(result.handoff.artifactId).toBeTruthy();
    expect(existsSync(join(workspace, 'agents', agentId, 'agent.yml'))).toBe(true);
    expect(existsSync(join(workspace, 'buildroom-project', '.anthroclaw', 'auto-buildroom'))).toBe(true);
  });
});
