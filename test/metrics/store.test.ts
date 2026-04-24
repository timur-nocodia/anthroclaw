import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MetricsStore } from '../../src/metrics/store.js';

describe('MetricsStore', () => {
  let tmpDir: string;
  let store: MetricsStore | null = null;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'metrics-store-'));
  });

  afterEach(() => {
    store?.close();
    store = null;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists counters, windows, usage, and lifecycle events', () => {
    const dbPath = join(tmpDir, 'metrics.sqlite');
    const now = Date.now();

    store = new MetricsStore(dbPath);
    store.recordCounter('messages_received');
    store.recordCounter('messages_received', 2);
    store.recordQueryDuration(100, now);
    store.recordQueryDuration(300, now + 1);
    store.recordTokens('claude-sonnet', 10, 5, 2, now);
    store.recordMessage(now);
    store.recordUsage({
      sessionKey: 'web:agent:session-1',
      agentId: 'agent',
      platform: 'web',
      timestamp: now,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      toolCalls: { Read: 2 },
      durationMs: 123,
      model: 'claude-sonnet',
    });
    store.recordToolEvent({
      timestamp: now,
      agentId: 'agent',
      sessionKey: 'web:agent:session-1',
      toolName: 'Bash',
      status: 'started',
    });
    store.recordSessionEvent({
      timestamp: now,
      agentId: 'agent',
      sessionId: 'session-1',
      sessionKey: 'web:agent:session-1',
      eventType: 'created',
    });
    store.recordSubagentEvent({
      timestamp: now,
      agentId: 'agent',
      parentSessionId: 'session-1',
      subagentId: 'researcher',
      runId: 'run-1',
      eventType: 'started',
      status: 'running',
    });
    store.close();
    store = null;

    store = new MetricsStore(dbPath);

    expect(store.counters()).toEqual({ messages_received: 3 });
    expect(store.queryDurationHistogram()).toMatchObject({ count: 2, p50: 300, p95: 300, avg: 200 });
    expect(store.tokensSince(now - 1)).toEqual({
      input: 10,
      output: 5,
      cache_read: 2,
      byModel: {
        'claude-sonnet': { input: 10, output: 5, cache_read: 2 },
      },
    });
    expect(store.messagesSince(now - 1)).toBe(1);
    expect(store.eventsSince(now - 1)).toEqual({
      tools: { started: 1 },
      sessions: { created: 1 },
      subagents: { started: 1 },
    });

    const report = store.usageReport(30);
    expect(report.totalSessions).toBe(1);
    expect(report.totalMessages).toBe(1);
    expect(report.totalInputTokens).toBe(10);
    expect(report.totalOutputTokens).toBe(5);
    expect(report.totalCacheReadTokens).toBe(2);
    expect(report.topModels).toEqual([{ model: 'claude-sonnet', sessions: 1 }]);
    expect(report.topTools).toEqual([
      { name: 'Read', count: 2 },
      { name: 'Bash', count: 1 },
    ]);
  });
});
