import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MetricsStore } from '../../metrics/store.js';
import {
  collectPiMonitorSnapshot,
  parsePiMonitorArgs,
  runPiMonitorCli,
} from '../pi-monitor.js';

const NOW = Date.UTC(2026, 4, 17, 1, 0, 0);

describe('Pi runtime monitor CLI', () => {
  let root: string;
  let dataDir: string;
  let store: MetricsStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-pi-monitor-'));
    dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    store = new MetricsStore(join(dataDir, 'metrics.sqlite'));
  });

  afterEach(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('reports a passing monitoring window with successful Pi runs', () => {
    recordRun('run-ok', 'succeeded', NOW - 60_000);

    const result = collectPiMonitorSnapshot({
      dataDir,
      sinceMinutes: 60,
      staleMinutes: 10,
    }, () => NOW);

    expect(result).toMatchObject({
      status: 'passed',
      runs: {
        total: 1,
        failed: 0,
        interrupted: 0,
        staleRunning: 0,
        byStatus: { succeeded: 1 },
      },
      diagnostics: {
        authOrModelErrors: 0,
      },
      alerts: [],
    });
  });

  it('alerts on failed, interrupted, stale, and auth diagnostic conditions', () => {
    recordRun('run-failed', 'failed', NOW - 120_000, 'Invalid authentication credentials');
    recordRun('run-interrupted', 'interrupted', NOW - 90_000);
    store.recordAgentRunStart({
      runId: 'run-stale',
      startedAt: NOW - 20 * 60_000,
      agentId: 'example',
      sessionKey: 'web:example:new',
      source: 'web',
      channel: 'web',
      model: 'claude-sonnet-4-6',
    });
    store.recordDiagnosticEvent({
      timestamp: NOW - 30_000,
      traceId: 'trace-auth',
      eventType: 'run.failed',
      detail: { message: 'redacted auth failure' },
    });
    store.recordToolEvent({
      timestamp: NOW - 20_000,
      agentId: 'example',
      sessionKey: 'web:example:new',
      toolName: 'read',
      status: 'failed',
    });

    const result = collectPiMonitorSnapshot({
      dataDir,
      sinceMinutes: 60,
      staleMinutes: 10,
    }, () => NOW);

    expect(result.status).toBe('alert');
    expect(result.runs.failed).toBe(1);
    expect(result.runs.interrupted).toBe(1);
    expect(result.runs.staleRunning).toBe(1);
    expect(result.diagnostics.authOrModelErrors).toBeGreaterThan(0);
    expect(result.tools.failedByTool).toEqual({ read: 1 });
    expect(result.alerts).toEqual(expect.arrayContaining([
      expect.stringContaining('failed run'),
      expect.stringContaining('interrupted run'),
      expect.stringContaining('stale running'),
      expect.stringContaining('auth/model'),
    ]));
    expect(result.warnings).toEqual([expect.stringContaining('failed tool')]);
  });

  it('returns exit 1 only when fail-on-alert is requested', async () => {
    recordRun('run-failed', 'failed', NOW - 120_000, 'provider failed');

    const softStdout = createWriter();
    const softCode = await runPiMonitorCli([
      '--data-dir', dataDir,
      '--json',
    ], { stdout: softStdout, stderr: createWriter(), now: () => NOW });
    expect(softCode).toBe(0);
    expect(JSON.parse(softStdout.text())).toMatchObject({ status: 'alert' });

    const hardStderr = createWriter();
    const hardCode = await runPiMonitorCli([
      '--data-dir', dataDir,
      '--json',
      '--fail-on-alert',
    ], { stdout: createWriter(), stderr: hardStderr, now: () => NOW });
    expect(hardCode).toBe(1);
    expect(JSON.parse(hardStderr.text())).toMatchObject({ status: 'alert' });
  });

  it('accepts pnpm-style separators and validates numeric options', () => {
    expect(parsePiMonitorArgs(['--', '--data-dir', dataDir, '--since-minutes', '15']))
      .toMatchObject({
        dataDir,
        sinceMinutes: 15,
      });
    expect(() => parsePiMonitorArgs(['--since-minutes', '0'])).toThrow(/positive integer/);
  });

  function recordRun(
    runId: string,
    status: 'succeeded' | 'failed' | 'interrupted',
    timestamp: number,
    error?: string,
  ) {
    store.recordAgentRunStart({
      runId,
      startedAt: timestamp,
      agentId: 'example',
      sessionKey: 'web:example:new',
      source: 'web',
      channel: 'web',
      model: 'claude-sonnet-4-6',
    });
    store.recordAgentRunFinish({
      runId,
      completedAt: timestamp + 1_000,
      status,
      sdkSessionId: `${runId}-session`,
      usage: { durationMs: 1_000 },
      error,
    });
  }
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
