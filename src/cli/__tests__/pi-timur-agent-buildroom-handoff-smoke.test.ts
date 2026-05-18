import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parsePiTimurAgentBuildroomHandoffSmokeArgs,
  runPiTimurAgentBuildroomHandoffSmokeCli,
} from '../pi-timur-agent-buildroom-handoff-smoke.js';

describe('Pi timur_agent Buildroom handoff smoke CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-timur-agent-buildroom-handoff-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses narrow flags', () => {
    expect(parsePiTimurAgentBuildroomHandoffSmokeArgs([
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
    expect(() => parsePiTimurAgentBuildroomHandoffSmokeArgs(['--sender-id'])).toThrow(/requires a value/);
    expect(() => parsePiTimurAgentBuildroomHandoffSmokeArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('runs temp-only Buildroom handoff canaries without leaking workspaces', async () => {
    const workspace = join(root, 'workspace');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentBuildroomHandoffSmokeCli([
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
        buildroomToolsPresent: true,
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
