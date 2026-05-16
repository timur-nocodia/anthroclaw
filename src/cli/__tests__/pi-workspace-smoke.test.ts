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

  it('prefers streamed partial text over duplicate final message text', async () => {
    const runtime = createSmokeRuntime([
      smokeTextEvent('SMOKE_OK', 'partial'),
      smokeTextEvent('SMOKE_OK', 'message'),
    ]);
    const workspace = join(root, 'workspace');

    const result = await runPiWorkspaceSmoke({
      runtime,
      workspace,
      model: 'test/model',
      timeoutMs: 1000,
    });

    expect(result.text).toBe('SMOKE_OK');
  });

  it('accepts the requested smoke file content with or without a final newline', async () => {
    const runtime = createSmokeRuntime(
      [smokeTextEvent('SMOKE_OK', 'partial')],
      'after AnthroClaw Pi smoke',
    );
    const workspace = join(root, 'workspace');

    const result = await runPiWorkspaceSmoke({
      runtime,
      workspace,
      model: 'test/model',
      timeoutMs: 1000,
    });

    expect(result.status).toBe('passed');
    expect(result.text).toBe('SMOKE_OK');
    expect(readFileSync(join(workspace, 'anthroclaw-pi-smoke.txt'), 'utf8'))
      .toBe('before AnthroClaw Pi smoke\n');
  });

  it('fails when the Pi workspace smoke reply is not exact', async () => {
    const runtime = createSmokeRuntime([
      smokeTextEvent('SMOKE_OKSMOKE_OK', 'partial'),
    ]);

    await expect(runPiWorkspaceSmoke({
      runtime,
      workspace: join(root, 'workspace'),
      model: 'test/model',
      timeoutMs: 1000,
    })).rejects.toThrow(/expected reply "SMOKE_OK", got "SMOKE_OKSMOKE_OK"/);
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

function createSmokeRuntime(
  textEvents: RuntimeEvent[] = [smokeTextEvent('SMOKE_OK', 'partial')],
  editedText = 'after AnthroClaw Pi smoke\n',
): HeadlessRuntime & { seenInput?: HeadlessRunInput } {
  return {
    id: 'pi',
    async runText() {
      return 'unused';
    },
    async runHandle(input: HeadlessRunInput): Promise<RuntimeRunHandle<RuntimeEvent>> {
      const runtime = this as HeadlessRuntime & { seenInput?: HeadlessRunInput };
      runtime.seenInput = input;
      return createSmokeHandle(input.cwd!, textEvents, editedText);
    },
  } as HeadlessRuntime & { seenInput?: HeadlessRunInput };
}

function createSmokeHandle(
  workspace: string,
  textEvents: RuntimeEvent[],
  editedText: string,
): RuntimeRunHandle<RuntimeEvent> & { sessionId: string } {
  const smokePath = join(workspace, 'anthroclaw-pi-smoke.txt');
  return {
    sessionId: 'pi-smoke-session-1',
    async interrupt() {},
    close: vi.fn(),
    async rewindFiles(_messageId, options) {
      const current = readFileSync(smokePath, 'utf8');
      if (normalizeSmokeText(current) !== normalizeSmokeText('after AnthroClaw Pi smoke\n')) {
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
      writeFileSync(smokePath, editedText, 'utf8');
      for (const event of textEvents) yield event;
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

function normalizeSmokeText(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function smokeTextEvent(
  text: string,
  source: 'partial' | 'message',
): RuntimeEvent {
  return {
    type: 'text.delta',
    runtime: 'pi',
    runId: 'run-1',
    sessionId: 'pi-smoke-session-1',
    timestamp: Date.now(),
    text,
    source,
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
