import { existsSync, rmSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { piRunMock, startupMock } = vi.hoisted(() => ({
  piRunMock: vi.fn(),
  startupMock: vi.fn(),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...real,
    startup: startupMock,
  };
});

vi.mock('../../runtime/pi-headless.js', () => ({
  DEFAULT_PI_MODEL_ID: 'anthropic/claude-sonnet-4-6',
  createPiHeadlessRuntime: () => ({
    id: 'pi',
    run: piRunMock,
    runText: vi.fn(),
  }),
}));

import {
  parsePiSessionsMemoryCanaryArgs,
  runPiSessionsMemoryCanaryCli,
} from '../pi-sessions-memory-canary.js';

describe('Pi sessions/memory canary CLI', () => {
  beforeEach(() => {
    piRunMock.mockReset();
    startupMock.mockReset();
    startupMock.mockRejectedValue(new Error('Claude SDK not needed for Pi canary tests'));
  });

  it('runs the scripted sessions, memory, and learning canary', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiSessionsMemoryCanaryCli(['--json'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      scenario: 'pi.sessions-memory-learning',
    });
    expect(body.workspacePath).toBeUndefined();
    expect(body.assertions).toMatchObject({
      recalledSessions: 1,
      title: 'Pi Runtime Memory Migration',
      learningActions: 1,
      reviewStatus: 'completed',
    });
    expect(body.assertions.memoryEntryPath).toContain('memory/learning/pi-canary-run-1/');
    expect(body.assertions.memoryHits).toBeGreaterThanOrEqual(1);
  });

  it('can run Gateway-level Pi session continuity checks', async () => {
    const stdout = createWriter();
    const stderr = createWriter();
    piRunMock
      .mockResolvedValueOnce({
        text: 'Lego Pi harness provenance',
        sessionId: 'gateway-pi-session-1',
      })
      .mockResolvedValueOnce({
        text: 'session continuity confirmed',
        sessionId: 'gateway-pi-session-1',
      });

    const code = await runPiSessionsMemoryCanaryCli([
      '--json',
      '--gateway',
      '--model', 'test/model',
      '--timeout-ms', '5000',
    ], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(piRunMock).toHaveBeenCalledTimes(2);
    expect(piRunMock.mock.calls[0]?.[0]).toMatchObject({
      model: 'test/model',
      purpose: 'gateway agent query',
    });
    expect(piRunMock.mock.calls[0]?.[0]).not.toHaveProperty('sessionId');
    expect(piRunMock.mock.calls[1]?.[0]).toMatchObject({
      sessionId: 'gateway-pi-session-1',
      model: 'test/model',
    });
    const body = JSON.parse(stdout.text());
    expect(body.assertions.gateway).toMatchObject({
      sessionId: 'gateway-pi-session-1',
      sentText: 2,
      sessions: 1,
      detailsMessageCount: 2,
      runs: 2,
      routeDecisions: 2,
      memoryInfluenceEvents: 1,
      provenanceStatus: 'succeeded',
    });
  });

  it('can keep the temporary workspace for inspection', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiSessionsMemoryCanaryCli(['--json', '--keep-workspace'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(typeof body.workspacePath).toBe('string');
    expect(existsSync(body.workspacePath)).toBe(true);
    rmSync(body.workspacePath, { recursive: true, force: true });
  });

  it('parses flags narrowly', () => {
    expect(parsePiSessionsMemoryCanaryArgs([
      '--',
      '--json',
      '--keep-workspace',
      '--gateway',
      '--allow-skip',
      '--model', 'test/model',
      '--auth-path', '/secure/pi-auth.json',
      '--models-path', '/secure/pi-models.json',
      '--timeout-ms', '500',
    ])).toEqual({
      json: true,
      keepWorkspace: true,
      gateway: true,
      allowSkip: true,
      model: 'test/model',
      authPath: '/secure/pi-auth.json',
      modelsPath: '/secure/pi-models.json',
      timeoutMs: 500,
      help: false,
    });
    expect(() => parsePiSessionsMemoryCanaryArgs(['--runtime', 'pi'])).toThrow(/Unknown argument/);
  });
});

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
