import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parsePiLearningProposeGateArgs,
  runPiLearningProposeGateCli,
} from '../pi-learning-propose-gate.js';

describe('Pi learning propose gate CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-learning-propose-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses generic flags', () => {
    expect(parsePiLearningProposeGateArgs([
      '--',
      '--agent-id', 'custom_agent',
      '--agents-dir', '/tmp/agents',
      '--data-root', '/tmp/data',
      '--model', 'test/model',
      '--auth-path', '/secure/auth.json',
      '--models-path', '/secure/models.json',
      '--peer-id', '42',
      '--sender-id', '43',
      '--session-key', 'custom:session',
      '--run-id', 'custom-run',
      '--timeout-ms', '1000',
      '--keep-data',
      '--allow-skip',
      '--json',
    ])).toMatchObject({
      agentId: 'custom_agent',
      agentsDir: '/tmp/agents',
      dataRoot: '/tmp/data',
      model: 'test/model',
      authPath: '/secure/auth.json',
      modelsPath: '/secure/models.json',
      peerId: '42',
      senderId: '43',
      sessionKey: 'custom:session',
      runId: 'custom-run',
      timeoutMs: 1000,
      keepData: true,
      allowSkip: true,
      json: true,
    });
    expect(() => parsePiLearningProposeGateArgs(['--timeout-ms', '0'])).toThrow(/positive integer/);
    expect(() => parsePiLearningProposeGateArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('turns missing optional Pi setup into an explicit skip without leaking workspaces', async () => {
    const workspace = join(root, 'workspace');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiLearningProposeGateCli([
      '--agent-id', 'custom_agent',
      '--peer-id', '42',
      '--sender-id', '43',
      '--allow-skip',
      '--json',
    ], {
      makeWorkspace: () => workspace,
      preflightPiRuntime: async () => {
        throw new Error('Pi learning propose gate requires optional package @earendil-works/pi-coding-agent.');
      },
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'skipped',
      runtime: 'pi',
      agentId: 'custom_agent',
      error: expect.stringContaining('@earendil-works/pi-coding-agent'),
    });
    expect(existsSync(workspace)).toBe(false);
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
