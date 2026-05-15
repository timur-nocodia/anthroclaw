import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalConfigSchema } from '../../config/schema.js';
import type { RuntimeEvent } from '../../runtime/events.js';
import type { HeadlessRunInput, HeadlessRuntime } from '../../runtime/headless.js';
import type { RuntimeRunHandle } from '../../runtime/types.js';
import {
  parsePiWorkspaceSmokeArgs,
  runPiWorkspaceSmoke,
  runPiWorkspaceSmokeCli,
} from '../pi-workspace-smoke.js';

describe('Pi workspace smoke CLI', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-pi-smoke-cli-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('runs a real workspace-edit smoke through an injected Pi-like runtime', async () => {
    const runtime = createSmokeRuntime();
    const workspace = join(root, 'workspace');

    const result = await runPiWorkspaceSmoke({
      runtime,
      workspace,
      model: 'test/model',
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      sessionId: 'pi-smoke-session-1',
      dryRun: {
        canRewind: true,
        filesChanged: ['anthroclaw-pi-smoke.txt'],
      },
      restore: {
        canRewind: true,
        filesChanged: ['anthroclaw-pi-smoke.txt'],
      },
    });
    expect(readFileSync(join(workspace, 'anthroclaw-pi-smoke.txt'), 'utf8'))
      .toBe('before AnthroClaw Pi smoke\n');
    expect((runtime as { seenInput: HeadlessRunInput }).seenInput).toMatchObject({
      cwd: workspace,
      model: 'test/model',
      timeoutMs: 1000,
      purpose: 'pi workspace rewind smoke',
      toolPolicy: {
        mode: 'allow-list',
        tools: ['Read', 'Edit', 'Write'],
      },
    });
  });

  it('prints JSON from the CLI wrapper and removes temporary workspaces by default', async () => {
    const runtime = createSmokeRuntime();
    const workspace = join(root, 'workspace');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiWorkspaceSmokeCli([
      '--model', 'test/model',
      '--json',
    ], {
      resolveRuntime: () => runtime,
      makeWorkspace: () => workspace,
      loadConfig: vi.fn(() => GlobalConfigSchema.parse({})),
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      sessionId: 'pi-smoke-session-1',
    });
    expect(() => readFileSync(join(workspace, 'anthroclaw-pi-smoke.txt'), 'utf8')).toThrow();
  });

  it('can turn missing Pi runtime setup into an explicit skip for CI smoke wiring', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiWorkspaceSmokeCli([
      '--allow-skip',
      '--json',
    ], {
      resolveRuntime: () => {
        throw new Error('Pi headless runtime requires optional package @earendil-works/pi-coding-agent.');
      },
      makeWorkspace: () => join(root, 'workspace'),
      loadConfig: vi.fn(() => GlobalConfigSchema.parse({})),
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'skipped',
      runtime: 'pi',
      error: expect.stringContaining('@earendil-works/pi-coding-agent'),
    });
  });

  it('parses flags narrowly', () => {
    expect(parsePiWorkspaceSmokeArgs([
      '--',
      '--config', 'config.yml',
      '--data', 'data',
      '--model', 'test/model',
      '--auth-path', '/secure/pi-auth.json',
      '--models-path', '/secure/pi-models.json',
      '--timeout-ms', '100',
      '--keep-workspace',
      '--allow-skip',
      '--json',
    ])).toMatchObject({
      configPath: 'config.yml',
      dataDir: 'data',
      model: 'test/model',
      authPath: '/secure/pi-auth.json',
      modelsPath: '/secure/pi-models.json',
      timeoutMs: 100,
      keepWorkspace: true,
      allowSkip: true,
      json: true,
    });
    expect(() => parsePiWorkspaceSmokeArgs(['--runtime', 'pi'])).toThrow(/Unknown argument/);
  });
});

function createSmokeRuntime(): HeadlessRuntime & { seenInput?: HeadlessRunInput } {
  return {
    id: 'pi',
    async runText() {
      return 'unused';
    },
    async runHandle(input: HeadlessRunInput): Promise<RuntimeRunHandle<RuntimeEvent>> {
      const runtime = this as HeadlessRuntime & { seenInput?: HeadlessRunInput };
      runtime.seenInput = input;
      return createSmokeHandle(input.cwd!);
    },
  } as HeadlessRuntime & { seenInput?: HeadlessRunInput };
}

function createSmokeHandle(workspace: string): RuntimeRunHandle<RuntimeEvent> & { sessionId: string } {
  const smokePath = join(workspace, 'anthroclaw-pi-smoke.txt');
  return {
    sessionId: 'pi-smoke-session-1',
    async interrupt() {},
    close: vi.fn(),
    async rewindFiles(_messageId, options) {
      const current = readFileSync(smokePath, 'utf8');
      if (current !== 'after AnthroClaw Pi smoke\n') {
        return { canRewind: false, error: 'unexpected smoke file content' };
      }
      if (!options?.dryRun) {
        writeFileSync(smokePath, 'before AnthroClaw Pi smoke\n', 'utf8');
      }
      return {
        canRewind: true,
        filesChanged: ['anthroclaw-pi-smoke.txt'],
        insertions: 1,
        deletions: 0,
      };
    },
    async *[Symbol.asyncIterator]() {
      writeFileSync(smokePath, 'after AnthroClaw Pi smoke\n', 'utf8');
      yield {
        type: 'text.delta',
        runtime: 'pi',
        runId: 'run-1',
        sessionId: 'pi-smoke-session-1',
        timestamp: Date.now(),
        text: 'SMOKE_OK',
      };
      yield {
        type: 'run.completed',
        runtime: 'pi',
        runId: 'run-1',
        sessionId: 'pi-smoke-session-1',
        timestamp: Date.now(),
      };
    },
  };
}

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
