import { describe, expect, it, vi } from 'vitest';
import {
  parsePiSmokeSuiteArgs,
  runPiSmokeSuiteCli,
} from '../pi-smoke-suite.js';

describe('Pi smoke suite CLI', () => {
  it('runs auth, workspace, then Gateway probes and reports a suite pass', async () => {
    const stdout = createWriter();
    const stderr = createWriter();
    const auth = createProbe('passed');
    const workspace = createProbe('passed');
    const gateway = createProbe('passed');

    const code = await runPiSmokeSuiteCli([
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
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(auth).toHaveBeenCalledBefore(workspace);
    expect(workspace).toHaveBeenCalledBefore(gateway);
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
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      probes: {
        auth: { status: 'passed', code: 0 },
        workspace: { status: 'passed', code: 0 },
        gateway: { status: 'passed', code: 0 },
      },
    });
  });

  it('returns skipped when at least one probe skips and none fail', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiSmokeSuiteCli(['--allow-skip', '--json'], {
      runAuthCli: createProbe('passed'),
      runWorkspaceCli: createProbe('skipped'),
      runGatewayCli: createProbe('skipped'),
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'skipped',
      probes: {
        auth: { status: 'passed', code: 0 },
        workspace: { status: 'skipped', code: 0 },
        gateway: { status: 'skipped', code: 0 },
      },
    });
  });

  it('returns failed when any probe fails', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiSmokeSuiteCli(['--json'], {
      runAuthCli: createProbe('passed'),
      runWorkspaceCli: createProbe('passed'),
      runGatewayCli: createProbe('failed', 1),
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(stdout.text()).toBe('');
    expect(JSON.parse(stderr.text())).toMatchObject({
      status: 'failed',
      probes: {
        auth: { status: 'passed', code: 0 },
        workspace: { status: 'passed', code: 0 },
        gateway: {
          status: 'failed',
          code: 1,
          error: 'Smoke probe exited with code 1.',
        },
      },
    });
  });

  it('stops after failed auth preflight and marks runtime probes skipped', async () => {
    const stdout = createWriter();
    const stderr = createWriter();
    const workspace = createProbe('passed');
    const gateway = createProbe('passed');

    const code = await runPiSmokeSuiteCli(['--json'], {
      runAuthCli: createProbe('failed', 1),
      runWorkspaceCli: workspace,
      runGatewayCli: gateway,
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(workspace).not.toHaveBeenCalled();
    expect(gateway).not.toHaveBeenCalled();
    expect(JSON.parse(stderr.text())).toMatchObject({
      status: 'failed',
      probes: {
        auth: {
          status: 'failed',
          code: 1,
        },
        workspace: {
          status: 'skipped',
          code: 0,
          error: 'Skipped because Pi auth preflight did not pass.',
        },
        gateway: {
          status: 'skipped',
          code: 0,
          error: 'Skipped because Pi auth preflight did not pass.',
        },
      },
    });
  });

  it('parses flags narrowly', () => {
    expect(parsePiSmokeSuiteArgs([
      '--',
      '--model', 'test/model',
      '--auth-path', '/secure/pi-auth.json',
      '--models-path', '/secure/pi-models.json',
      '--timeout-ms', '500',
      '--keep-workspace',
      '--allow-skip',
      '--json',
    ])).toMatchObject({
      model: 'test/model',
      authPath: '/secure/pi-auth.json',
      modelsPath: '/secure/pi-models.json',
      timeoutMs: 500,
      keepWorkspace: true,
      allowSkip: true,
      json: true,
    });
    expect(() => parsePiSmokeSuiteArgs(['--runtime', 'pi'])).toThrow(/Unknown argument/);
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
