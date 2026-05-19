import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMcpFileTransferGate } from '../side-effect-gates/mcp-file-transfer.js';

describe('MCP/file-transfer side-effect gate', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-mcp-file-transfer-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('exercises MCP onboarding and file-transfer controls for an arbitrary agent in an isolated workspace', async () => {
    const agentId = 'custom_mcp_file_agent';
    const peerId = 'peer-mcp-42';
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
      '    peers: [ "peer-mcp-42" ]',
      'allowlist:',
      '  telegram: [ "peer-mcp-42" ]',
      'mcp_onboarding:',
      '  enabled: true',
      'plugins:',
      '  file-transfer:',
      '    enabled: true',
      '    roots:',
      '      - agents/custom_mcp_file_agent/files',
      '      - research',
      '    allowWrite: true',
      '    maxFileBytes: 1048576',
      '    maxEntries: 200',
    ].join('\n'), 'utf8');

    const result = await runMcpFileTransferGate({
      agentId,
      sourceAgentsDir,
      workspace,
      peerId,
      senderId: 'sender-mcp-42',
      sessionKey: `${agentId}:telegram:dm:${peerId}:mcp-file-transfer`,
      pendingId: 'pnd_custom_mcp_file_gate',
      fakeServerName: 'custom-mcp-file-gate',
      expectedConfiguredRoots: ['agents/custom_mcp_file_agent/files', 'research'],
    });

    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId,
      gate: {
        id: 'mcp-file-transfer',
        spec: {
          gateId: 'mcp-file-transfer',
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
      mcp: {
        enabled: true,
        privateAllowlistIncludesPeer: true,
        privateAllowlistSinglePeer: true,
        privateConnectForwarded: true,
        privateSessionBound: true,
        privateChatTypeBound: true,
        groupRejected: true,
        checkReturnedPending: true,
        cancelReturnedCancelled: true,
        noExternalMcpConfigured: true,
      },
      fileTransfer: {
        pluginEnabled: true,
        configuredRoots: ['agents/custom_mcp_file_agent/files', 'research'],
        configuredWriteEnabled: true,
        toolsPresent: true,
        dirListSawSeed: true,
        fileFetchMatchedSeed: true,
        fileWriteSucceeded: true,
        outsideDenied: true,
        tempOnly: true,
      },
      safety: {
        noLiveRootMutation: true,
        noHardcodedSecrets: true,
      },
    });
    expect(existsSync(join(workspace, 'agents', agentId, 'agent.yml'))).toBe(true);
    expect(existsSync(join(workspace, 'agents', agentId, 'files', 'seed.txt'))).toBe(true);
  });
});
