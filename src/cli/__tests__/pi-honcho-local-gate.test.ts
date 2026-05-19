import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parsePiHonchoLocalGateArgs,
  runPiHonchoLocalGateCli,
} from '../pi-honcho-local-gate.js';

describe('Pi Honcho local gate CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-honcho-local-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses generic flags', () => {
    expect(parsePiHonchoLocalGateArgs([
      '--',
      '--agent-id', 'custom_agent',
      '--agents-dir', '/tmp/agents',
      '--peer-id', '42',
      '--session-key', 'custom:session',
      '--expected-mode', 'tools',
      '--expected-environment', 'local',
      '--expected-base-url-host', 'localhost:8000',
      '--expected-workspace-id', 'custom-workspace',
      '--dry-run',
      '--keep-data',
      '--json',
    ])).toMatchObject({
      agentId: 'custom_agent',
      agentsDir: '/tmp/agents',
      peerId: '42',
      sessionKey: 'custom:session',
      expectedMode: 'tools',
      expectedEnvironment: 'local',
      expectedBaseUrlHost: 'localhost:8000',
      expectedWorkspaceId: 'custom-workspace',
      keepData: true,
      json: true,
    });
    expect(() => parsePiHonchoLocalGateArgs(['--peer-id'])).toThrow(/requires a value/);
    expect(() => parsePiHonchoLocalGateArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('runs temp-only Honcho disabled/local activation canaries for an arbitrary agent without leaking workspaces', async () => {
    const workspace = join(root, 'workspace');
    const agentsDir = join(root, 'agents');
    const agentId = 'cli_honcho_agent';
    mkdirSync(join(agentsDir, agentId), { recursive: true });
    writeFileSync(join(agentsDir, agentId, 'agent.yml'), [
      'model: test-model',
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      '    peers: [ "peer-cli-honcho" ]',
      'allowlist:',
      '  telegram: [ "peer-cli-honcho" ]',
      'plugins:',
      '  honcho:',
      '    enabled: false',
      '    mode: tools',
      '    connection:',
      '      workspace_id: anthroclaw-cli-honcho-lab',
      '      environment: local',
      '      base_url: http://localhost:8000',
      '      max_retries: 0',
    ].join('\n'), 'utf8');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiHonchoLocalGateCli([
      '--agent-id', agentId,
      '--agents-dir', agentsDir,
      '--peer-id', 'peer-cli-honcho',
      '--session-key', `${agentId}:telegram:dm:peer-cli-honcho:honcho-local`,
      '--expected-workspace-id', 'anthroclaw-cli-honcho-lab',
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
      currentConfig: {
        privateAllowlistIncludesPeer: true,
        honchoConfigured: true,
        enabled: false,
        mode: 'tools',
        environment: 'local',
        baseUrlHost: 'localhost:8000',
        workspaceId: 'anthroclaw-cli-honcho-lab',
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
        statusReportsExpectedHost: true,
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
