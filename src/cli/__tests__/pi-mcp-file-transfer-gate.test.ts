import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parsePiMcpFileTransferGateArgs,
  runPiMcpFileTransferGateCli,
} from '../pi-mcp-file-transfer-gate.js';

describe('Pi MCP/file-transfer gate CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-mcp-file-transfer-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses generic flags', () => {
    expect(parsePiMcpFileTransferGateArgs([
      '--',
      '--agent-id', 'custom_agent',
      '--agents-dir', '/tmp/agents',
      '--peer-id', '42',
      '--sender-id', '43',
      '--session-key', 'custom:session',
      '--server-url', 'https://mcp.test',
      '--pending-id', 'pnd-custom',
      '--fake-server-name', 'custom-server',
      '--expect-root', 'agents/custom/files',
      '--expected-root', 'research',
      '--dry-run',
      '--keep-data',
      '--json',
    ])).toMatchObject({
      agentId: 'custom_agent',
      agentsDir: '/tmp/agents',
      peerId: '42',
      senderId: '43',
      sessionKey: 'custom:session',
      serverUrl: 'https://mcp.test',
      pendingId: 'pnd-custom',
      fakeServerName: 'custom-server',
      expectedConfiguredRoots: ['agents/custom/files', 'research'],
      keepData: true,
      json: true,
    });
    expect(() => parsePiMcpFileTransferGateArgs(['--peer-id'])).toThrow(/requires a value/);
    expect(() => parsePiMcpFileTransferGateArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('runs temp-only MCP onboarding and file-transfer canaries for an arbitrary agent without leaking workspaces', async () => {
    const workspace = join(root, 'workspace');
    const agentsDir = join(root, 'agents');
    const agentId = 'cli_mcp_file_agent';
    mkdirSync(join(agentsDir, agentId), { recursive: true });
    writeFileSync(join(agentsDir, agentId, 'agent.yml'), [
      'model: test-model',
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      '    peers: [ "peer-cli-mcp" ]',
      'allowlist:',
      '  telegram: [ "peer-cli-mcp" ]',
      'mcp_onboarding:',
      '  enabled: true',
      'plugins:',
      '  file-transfer:',
      '    enabled: true',
      '    roots:',
      '      - agents/cli_mcp_file_agent/files',
      '      - research',
      '    allowWrite: true',
      '    maxFileBytes: 1048576',
      '    maxEntries: 200',
    ].join('\n'), 'utf8');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiMcpFileTransferGateCli([
      '--agent-id', agentId,
      '--agents-dir', agentsDir,
      '--peer-id', 'peer-cli-mcp',
      '--sender-id', 'sender-cli-mcp',
      '--session-key', `${agentId}:telegram:dm:peer-cli-mcp:mcp-file-transfer`,
      '--pending-id', 'pnd_cli_mcp_file_gate',
      '--fake-server-name', 'cli-mcp-file-gate',
      '--expect-root', 'agents/cli_mcp_file_agent/files',
      '--expect-root', 'research',
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
      mcp: {
        enabled: true,
        privateAllowlistIncludesPeer: true,
        privateConnectForwarded: true,
        groupRejected: true,
        checkReturnedPending: true,
        cancelReturnedCancelled: true,
      },
      fileTransfer: {
        pluginEnabled: true,
        configuredRoots: ['agents/cli_mcp_file_agent/files', 'research'],
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
