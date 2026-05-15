import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '../../runtime/events.js';
import type { HeadlessRunInput } from '../../runtime/headless.js';
import type { RuntimeRunHandle } from '../../runtime/types.js';

const { piRunHandleMock, piRuntimeState } = vi.hoisted(() => ({
  piRunHandleMock: vi.fn(),
  piRuntimeState: { useRunHandle: true },
}));

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...real,
    startup: vi.fn(async () => {
      throw new Error('Claude unavailable in Pi Gateway smoke tests');
    }),
    query: vi.fn(),
  };
});

vi.mock('../../runtime/pi-headless.js', () => ({
  DEFAULT_PI_MODEL_ID: 'anthropic/claude-sonnet-4-6',
  createPiHeadlessRuntime: () => {
    const runtime: Record<string, unknown> = {
      id: 'pi',
      runText: vi.fn(),
    };
    if (piRuntimeState.useRunHandle) {
      runtime.runHandle = piRunHandleMock;
    }
    return runtime;
  },
}));

import {
  parsePiGatewaySmokeArgs,
  runPiGatewaySmoke,
  runPiGatewaySmokeCli,
} from '../pi-gateway-smoke.js';

describe('Pi Gateway smoke CLI', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-pi-gateway-smoke-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    piRunHandleMock.mockReset();
    piRuntimeState.useRunHandle = true;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('runs a production-shaped Gateway dispatch through an injected Pi runtime handle', async () => {
    piRunHandleMock.mockImplementationOnce(async (input: HeadlessRunInput) => createGatewaySmokeHandle(input));

    const result = await runPiGatewaySmoke({
      workspace: join(root, 'workspace'),
      model: 'test/model',
      timeoutMs: 10_000,
    });

    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId: 'pi-gateway-smoke',
      approvals: 1,
      sentText: ['SMOKE_GATEWAY_OK'],
      sessionId: 'pi-gateway-smoke-session',
    });
    expect(readFileSync(result.file, 'utf8')).toBe('after AnthroClaw Pi Gateway smoke\n');
    expect(piRunHandleMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'test/model',
      cwd: join(root, 'workspace', 'agents', 'pi-gateway-smoke'),
      purpose: 'gateway agent query',
      toolDenyMessage: 'Tool denied by AnthroClaw policy.',
      toolPolicy: expect.objectContaining({
        mode: 'allow-list',
        tools: expect.arrayContaining(['Read', 'Write', 'Edit']),
      }),
    }), expect.objectContaining({
      agentId: 'pi-gateway-smoke',
      runId: expect.any(String),
    }));
    const runInput = piRunHandleMock.mock.calls[0]?.[0] as HeadlessRunInput;
    if (runInput.toolPolicy?.mode !== 'allow-list') {
      throw new Error('expected allow-list tool policy');
    }
    expect(runInput.toolPolicy.tools).not.toContain('Bash');
  });

  it('prints JSON from the CLI wrapper and removes temporary workspaces by default', async () => {
    piRunHandleMock.mockImplementationOnce(async (input: HeadlessRunInput) => createGatewaySmokeHandle(input));
    const workspace = join(root, 'workspace');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiGatewaySmokeCli(['--json'], {
      makeWorkspace: () => workspace,
      preflightPiRuntime: async () => undefined,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      approvals: 1,
      sentText: ['SMOKE_GATEWAY_OK'],
    });
    expect(existsSync(workspace)).toBe(false);
  });

  it('can turn missing optional Pi setup into an explicit skip for CI smoke wiring', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiGatewaySmokeCli(['--allow-skip', '--json'], {
      makeWorkspace: () => join(root, 'workspace'),
      preflightPiRuntime: async () => {
        throw new Error('Pi Gateway smoke requires optional package @earendil-works/pi-coding-agent.');
      },
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

  it('surfaces Gateway runtime failures before file verification symptoms', async () => {
    piRunHandleMock.mockRejectedValueOnce(new Error('No API key found for the selected model.'));

    await expect(runPiGatewaySmoke({
      workspace: join(root, 'workspace'),
      timeoutMs: 10_000,
    })).rejects.toThrow(/No API key found for the selected model/);
  });

  it('parses flags narrowly', () => {
    expect(parsePiGatewaySmokeArgs([
      '--',
      '--model', 'test/model',
      '--auth-path', '/secure/pi-auth.json',
      '--models-path', '/secure/pi-models.json',
      '--timeout-ms', '1000',
      '--keep-workspace',
      '--allow-skip',
      '--json',
    ])).toMatchObject({
      model: 'test/model',
      authPath: '/secure/pi-auth.json',
      modelsPath: '/secure/pi-models.json',
      timeoutMs: 1000,
      keepWorkspace: true,
      allowSkip: true,
      json: true,
    });
    expect(() => parsePiGatewaySmokeArgs(['--runtime', 'pi'])).toThrow(/Unknown argument/);
  });
});

async function createGatewaySmokeHandle(input: HeadlessRunInput): Promise<RuntimeRunHandle<RuntimeEvent> & { sessionId: string }> {
  const smokePath = join(input.cwd!, 'gateway-pi-smoke.txt');
  if (input.toolPolicy?.mode !== 'allow-list' || !input.toolPolicy.canUseTool) {
    throw new Error('expected allow-list tool policy with canUseTool');
  }
  const decision = await input.toolPolicy.canUseTool({
    toolName: 'write',
    originalToolName: 'write',
    toolCallId: 'pi-gateway-smoke-tool',
    input: {
      file_path: smokePath,
      content: 'after AnthroClaw Pi Gateway smoke\n',
    },
  }, input);
  expect(decision).toMatchObject({ behavior: 'allow' });
  writeFileSync(smokePath, 'after AnthroClaw Pi Gateway smoke\n', 'utf8');

  return {
    sessionId: 'pi-gateway-smoke-session',
    async interrupt() {},
    close: vi.fn(),
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'tool.call.started',
        runtime: 'pi',
        runId: 'run-1',
        sessionId: 'pi-gateway-smoke-session',
        timestamp: Date.now(),
        toolCallId: 'pi-gateway-smoke-tool',
        toolName: 'Write',
      };
      yield {
        type: 'tool.call.completed',
        runtime: 'pi',
        runId: 'run-1',
        sessionId: 'pi-gateway-smoke-session',
        timestamp: Date.now(),
        toolCallId: 'pi-gateway-smoke-tool',
        toolName: 'Write',
      };
      yield {
        type: 'text.delta',
        runtime: 'pi',
        runId: 'run-1',
        sessionId: 'pi-gateway-smoke-session',
        timestamp: Date.now(),
        text: 'SMOKE_GATEWAY_OK',
        source: 'partial',
      };
      yield {
        type: 'run.completed',
        runtime: 'pi',
        runId: 'run-1',
        sessionId: 'pi-gateway-smoke-session',
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
