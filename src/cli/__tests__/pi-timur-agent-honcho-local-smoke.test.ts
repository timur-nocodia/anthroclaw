import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parsePiTimurAgentHonchoLocalSmokeArgs,
  runPiTimurAgentHonchoLocalSmokeCli,
} from '../pi-timur-agent-honcho-local-smoke.js';

describe('Pi timur_agent Honcho local smoke CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-timur-agent-honcho-local-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses narrow flags', () => {
    expect(parsePiTimurAgentHonchoLocalSmokeArgs([
      '--',
      '--agents-dir', '/tmp/agents',
      '--peer-id', '42',
      '--keep-data',
      '--json',
    ])).toMatchObject({
      agentsDir: '/tmp/agents',
      peerId: '42',
      keepData: true,
      json: true,
    });
    expect(() => parsePiTimurAgentHonchoLocalSmokeArgs(['--agents-dir'])).toThrow(/requires a value/);
    expect(() => parsePiTimurAgentHonchoLocalSmokeArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('runs temp-only Honcho disabled/local activation canaries without leaking workspaces', async () => {
    const workspace = join(root, 'workspace');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentHonchoLocalSmokeCli([
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
      currentConfig: {
        privateAllowlistSinglePeer: true,
        honchoConfigured: true,
        enabled: false,
        mode: 'tools',
        environment: 'local',
        baseUrlHost: 'localhost:8000',
        workspaceId: 'anthroclaw-timur-agent-lab',
        keylessLocal: true,
        maxRetriesZero: true,
      },
      disabledGate: {
        startupPlanSkipsHoncho: true,
        noHonchoToolsExposed: true,
        noContextEngineActive: true,
      },
      activationCandidate: {
        tempOnly: true,
        pluginRegistered: true,
        contextEngineRegistered: true,
        observeHookRegistered: true,
        toolsPresent: true,
        statusToolWorks: true,
        statusReportsLocalHost: true,
        sessionToolRequiresDispatch: true,
        sessionToolUsesDispatchKey: true,
        noApiKeyRequiredByConfig: true,
      },
      safety: {
        noLiveConfigMutation: true,
        noNetworkCall: true,
        noHardcodedSecrets: true,
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
