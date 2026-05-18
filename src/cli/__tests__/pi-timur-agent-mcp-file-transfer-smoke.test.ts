import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parsePiTimurAgentMcpFileTransferSmokeArgs,
  runPiTimurAgentMcpFileTransferSmokeCli,
} from '../pi-timur-agent-mcp-file-transfer-smoke.js';

describe('Pi timur_agent MCP/file-transfer smoke CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-timur-agent-mcp-file-transfer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses narrow flags', () => {
    expect(parsePiTimurAgentMcpFileTransferSmokeArgs([
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
    expect(() => parsePiTimurAgentMcpFileTransferSmokeArgs(['--peer-id'])).toThrow(/requires a value/);
    expect(() => parsePiTimurAgentMcpFileTransferSmokeArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('runs temp-only MCP onboarding and file-transfer canaries without leaking workspaces', async () => {
    const workspace = join(root, 'workspace');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiTimurAgentMcpFileTransferSmokeCli([
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
      mcp: {
        enabled: true,
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
        configuredRoots: ['agents/timur_agent/lab-files', 'research'],
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
