import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runHonchoLocalGate } from '../side-effect-gates/honcho-local.js';

describe('Honcho local side-effect gate', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-honcho-local-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('exercises disabled/local Honcho activation controls for an arbitrary agent in an isolated workspace', async () => {
    const agentId = 'custom_honcho_agent';
    const peerId = 'peer-honcho-42';
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
      '    peers: [ "peer-honcho-42" ]',
      'allowlist:',
      '  telegram: [ "peer-honcho-42" ]',
      'plugins:',
      '  honcho:',
      '    enabled: false',
      '    mode: tools',
      '    connection:',
      '      workspace_id: anthroclaw-custom-honcho-lab',
      '      environment: local',
      '      base_url: http://localhost:8000',
      '      max_retries: 0',
    ].join('\n'), 'utf8');

    const result = await runHonchoLocalGate({
      agentId,
      sourceAgentsDir,
      workspace,
      peerId,
      sessionKey: `${agentId}:telegram:dm:${peerId}:honcho-local`,
      expectedWorkspaceId: 'anthroclaw-custom-honcho-lab',
    });

    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId,
      gate: {
        id: 'honcho-local',
        spec: {
          gateId: 'honcho-local',
          agentId,
          action: 'mcp.call',
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
      currentConfig: {
        privateAllowlistIncludesPeer: true,
        privateAllowlistSinglePeer: true,
        honchoConfigured: true,
        enabled: false,
        mode: 'tools',
        environment: 'local',
        baseUrlHost: 'localhost:8000',
        workspaceId: 'anthroclaw-custom-honcho-lab',
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
    expect(existsSync(join(workspace, 'agents', agentId, 'agent.yml'))).toBe(true);
  });
});
