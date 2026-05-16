import { describe, expect, it, vi } from 'vitest';
import {
  parsePiV1CanaryArgs,
  runPiV1CanaryCli,
} from '../pi-v1-canary.js';

describe('Pi v1 canary CLI', () => {
  it('lists canary scenarios without running probes', async () => {
    const stdout = createWriter();
    const stderr = createWriter();
    const auth = createProbe('passed');

    const code = await runPiV1CanaryCli(['--list', '--json'], {
      runAuthCli: auth,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(auth).not.toHaveBeenCalled();
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      mode: 'list',
      runtime: 'pi',
    });
    expect(body.scenarios[0]).toMatchObject({
      id: 'pi.auth-model-preflight',
      status: 'incomplete',
    });
    expect(body.scenarios.length).toBeGreaterThan(4);
  });

  it('runs only automated smoke scenarios in smoke-only mode', async () => {
    const stdout = createWriter();
    const stderr = createWriter();
    const auth = createProbe('passed');
    const workspace = createProbe('passed');
    const gateway = createProbe('passed');
    const aggregate = createProbe('passed');

    const code = await runPiV1CanaryCli([
      '--smoke-only',
      '--model', 'test/model',
      '--auth-path', '/secure/pi-auth.json',
      '--models-path', '/secure/pi-models.json',
      '--timeout-ms', '1000',
      '--keep-workspace',
      '--json',
    ], {
      runAuthCli: auth,
      runWorkspaceCli: workspace,
      runGatewayCli: gateway,
      runAggregateCli: aggregate,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(auth).toHaveBeenCalledTimes(1);
    expect(workspace).toHaveBeenCalledTimes(1);
    expect(gateway).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(auth.mock.calls[0]?.[0]).toEqual([
      '--json',
      '--model', 'test/model',
      '--auth-path', '/secure/pi-auth.json',
      '--models-path', '/secure/pi-models.json',
    ]);
    expect(workspace.mock.calls[0]?.[0]).toEqual([
      '--json',
      '--model', 'test/model',
      '--auth-path', '/secure/pi-auth.json',
      '--models-path', '/secure/pi-models.json',
      '--timeout-ms', '1000',
      '--keep-workspace',
    ]);
    expect(gateway.mock.calls[0]?.[0]).toEqual(workspace.mock.calls[0]?.[0]);
    expect(aggregate.mock.calls[0]?.[0]).toEqual(workspace.mock.calls[0]?.[0]);
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      mode: 'smoke-only',
    });
    expect(body.scenarios).toHaveLength(4);
    expect(body.scenarios.map((scenario: { id: string }) => scenario.id)).toEqual([
      'pi.auth-model-preflight',
      'pi.workspace-tools-rewind',
      'pi.gateway-channel-approval',
      'pi.aggregate-real-auth',
    ]);
  });

  it('reports full mode incomplete until planned scripted/manual canaries exist', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiV1CanaryCli(['--json'], {
      runAuthCli: createProbe('passed'),
      runWorkspaceCli: createProbe('passed'),
      runGatewayCli: createProbe('passed'),
      runAggregateCli: createProbe('passed'),
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(stdout.text()).toBe('');
    const body = JSON.parse(stderr.text());
    expect(body.status).toBe('incomplete');
    expect(body.mode).toBe('full');
    expect(body.scenarios).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'pi.plugins-context-tools',
        status: 'incomplete',
      }),
      expect.objectContaining({
        id: 'pi.dashboard-operator',
        status: 'incomplete',
      }),
    ]));
  });

  it('returns failed when an automated smoke scenario fails', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiV1CanaryCli(['--smoke-only', '--json'], {
      runAuthCli: createProbe('passed'),
      runWorkspaceCli: createProbe('failed', 1),
      runGatewayCli: createProbe('passed'),
      runAggregateCli: createProbe('passed'),
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(stdout.text()).toBe('');
    const body = JSON.parse(stderr.text());
    expect(body).toMatchObject({
      status: 'failed',
    });
    expect(body.scenarios[0]).toMatchObject({
      id: 'pi.auth-model-preflight',
      status: 'passed',
    });
    expect(body.scenarios[1]).toMatchObject({
      id: 'pi.workspace-tools-rewind',
      status: 'failed',
      code: 1,
      error: 'Canary scenario exited with code 1.',
    });
  });

  it('parses flags narrowly', () => {
    expect(parsePiV1CanaryArgs([
      '--',
      '--model', 'test/model',
      '--auth-path', '/secure/pi-auth.json',
      '--models-path', '/secure/pi-models.json',
      '--timeout-ms', '500',
      '--keep-workspace',
      '--allow-skip',
      '--smoke-only',
      '--list',
      '--json',
    ])).toMatchObject({
      model: 'test/model',
      authPath: '/secure/pi-auth.json',
      modelsPath: '/secure/pi-models.json',
      timeoutMs: 500,
      keepWorkspace: true,
      allowSkip: true,
      smokeOnly: true,
      list: true,
      json: true,
    });
    expect(() => parsePiV1CanaryArgs(['--runtime', 'pi'])).toThrow(/Unknown argument/);
  });
});

function createProbe(status: 'passed' | 'failed' | 'skipped', code = status === 'failed' ? 1 : 0) {
  return vi.fn(async (_argv: string[], deps?: { stdout?: Writer; stderr?: Writer }) => {
    const stream = code === 0 ? deps?.stdout : deps?.stderr;
    stream?.write(`${JSON.stringify({
      status,
      runtime: 'pi',
      probe: status,
      error: status === 'failed' ? 'probe failed' : undefined,
    })}\n`);
    return code;
  });
}

interface Writer {
  write(chunk: string): boolean;
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
