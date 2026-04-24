import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDiagnosticsBundle, sanitizeForDiagnostics } from '../../src/diagnostics/bundle.js';
import { metrics } from '../../src/metrics/collector.js';
import { MetricsStore } from '../../src/metrics/store.js';

describe('diagnostics bundle', () => {
  let tmpDir: string;
  let store: MetricsStore | null = null;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'diagnostics-'));
    store = new MetricsStore(join(tmpDir, 'metrics.sqlite'));
    metrics._reset();
    metrics.setStore(store);
  });

  afterEach(() => {
    metrics._reset();
    store?.close();
    store = null;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('redacts nested secret-looking values', () => {
    const value = sanitizeForDiagnostics({
      telegram: { token: '1234567890123456789012345' },
      nested: { text: 'api_key="abcdefghijklmnopqrstuvwxyz"' },
    });

    expect(JSON.stringify(value)).not.toContain('1234567890123456789012345');
    expect(JSON.stringify(value)).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(value).toMatchObject({
      telegram: { token: '[REDACTED]' },
    });
  });

  it('exports metadata-only diagnostics from metrics', () => {
    const now = Date.now();
    metrics.recordAgentRunStart({
      runId: 'run-1',
      traceId: 'trace-1',
      startedAt: now,
      agentId: 'agent',
      sessionKey: 'web:agent:session',
      sdkSessionId: 'session-1',
      source: 'web',
      channel: 'web',
      status: 'running',
      model: 'claude-sonnet',
    });
    metrics.recordAgentRunFinish({
      runId: 'run-1',
      completedAt: now + 10,
      status: 'succeeded',
      sdkSessionId: 'session-1',
      usage: { durationMs: 10 },
    });

    const bundle = buildDiagnosticsBundle({
      status: { agents: ['agent'], secret: 'should-not-leak' },
      includeLogs: false,
    });

    expect(bundle.manifest).toMatchObject({
      version: 1,
      contentPolicy: 'metadata-only',
    });
    expect(bundle.status).toMatchObject({ agents: ['agent'], secret: '[REDACTED]' });
    expect(bundle.runs).toHaveLength(1);
    expect(bundle.runs[0]).toMatchObject({ runId: 'run-1', traceId: 'trace-1' });
    expect(bundle.diagnosticEvents.map((event: any) => event.eventType)).toEqual([
      'run.completed',
      'run.sdk_started',
    ]);
    expect(bundle.logs).toEqual([]);
  });
});
