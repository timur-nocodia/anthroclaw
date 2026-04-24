import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { metrics } from '../src/metrics/collector.js';
import { MetricsStore } from '../src/metrics/store.js';

describe('MetricsCollector', () => {
  let tmpDir: string | undefined;
  let store: MetricsStore | null = null;

  beforeEach(() => {
    metrics._reset();
  });

  afterEach(() => {
    metrics._reset();
    store?.close();
    store = null;
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  // ─── increment ───────────────────────────────────────────────────

  it('increment() increases counter by 1 by default', () => {
    metrics.increment('messages_received');
    metrics.increment('messages_received');
    metrics.increment('messages_received');

    const snap = metrics.snapshot();
    expect(snap.counters.messages_received).toBe(3);
  });

  it('increment() increases counter by specified value', () => {
    metrics.increment('tool_calls', 5);

    const snap = metrics.snapshot();
    expect(snap.counters.tool_calls).toBe(5);
  });

  it('increment() handles multiple distinct counters', () => {
    metrics.increment('messages_received');
    metrics.increment('tool_calls');
    metrics.increment('query_errors');

    const snap = metrics.snapshot();
    expect(snap.counters.messages_received).toBe(1);
    expect(snap.counters.tool_calls).toBe(1);
    expect(snap.counters.query_errors).toBe(1);
  });

  // ─── recordQueryDuration ─────────────────────────────────────────

  it('recordQueryDuration() stores samples', () => {
    metrics.recordQueryDuration(100);
    metrics.recordQueryDuration(200);
    metrics.recordQueryDuration(300);

    const snap = metrics.snapshot();
    expect(snap.histograms.query_duration_ms.count).toBe(3);
    expect(snap.histograms.query_duration_ms.avg).toBe(200);
  });

  it('histogram returns zeros when no samples', () => {
    const snap = metrics.snapshot();
    expect(snap.histograms.query_duration_ms.count).toBe(0);
    expect(snap.histograms.query_duration_ms.p50).toBe(0);
    expect(snap.histograms.query_duration_ms.p95).toBe(0);
    expect(snap.histograms.query_duration_ms.p99).toBe(0);
    expect(snap.histograms.query_duration_ms.avg).toBe(0);
  });

  it('p50/p95/p99 calculations are correct', () => {
    // Add 100 samples: 1, 2, 3, ..., 100
    for (let i = 1; i <= 100; i++) {
      metrics.recordQueryDuration(i);
    }

    const snap = metrics.snapshot();
    const h = snap.histograms.query_duration_ms;

    expect(h.count).toBe(100);
    // p50 = sorted[50] = 51
    expect(h.p50).toBe(51);
    // p95 = sorted[95] = 96
    expect(h.p95).toBe(96);
    // p99 = sorted[99] = 100
    expect(h.p99).toBe(100);
    // avg = (1+2+...+100)/100 = 50.5
    expect(h.avg).toBe(50.5);
  });

  it('recordQueryDuration() caps at 1000 samples', () => {
    for (let i = 0; i < 1100; i++) {
      metrics.recordQueryDuration(i);
    }

    const snap = metrics.snapshot();
    expect(snap.histograms.query_duration_ms.count).toBe(1000);
  });

  // ─── recordTokens ───────────────────────────────────────────────

  it('recordTokens() tracks by model', () => {
    metrics.recordTokens('claude-sonnet-4-6', 100, 50, 25);
    metrics.recordTokens('claude-sonnet-4-6', 200, 100, 50);
    metrics.recordTokens('claude-opus-4', 500, 250, 0);

    const snap = metrics.snapshot();
    expect(snap.tokens_24h.input).toBe(800);
    expect(snap.tokens_24h.output).toBe(400);
    expect(snap.tokens_24h.cache_read).toBe(75);
    expect(snap.tokens_24h.byModel['claude-sonnet-4-6']).toEqual({ input: 300, output: 150, cache_read: 75 });
    expect(snap.tokens_24h.byModel['claude-opus-4']).toEqual({ input: 500, output: 250, cache_read: 0 });
  });

  it('recordTokens() returns empty when no entries', () => {
    const snap = metrics.snapshot();
    expect(snap.tokens_24h.input).toBe(0);
    expect(snap.tokens_24h.output).toBe(0);
    expect(snap.tokens_24h.cache_read).toBe(0);
    expect(snap.tokens_24h.byModel).toEqual({});
  });

  // ─── recordMessage ──────────────────────────────────────────────

  it('recordMessage() counts messages in 24h window', () => {
    metrics.recordMessage();
    metrics.recordMessage();
    metrics.recordMessage();

    const snap = metrics.snapshot();
    expect(snap.messages_24h).toBe(3);
  });

  // ─── snapshot structure ─────────────────────────────────────────

  it('snapshot() returns correct structure', () => {
    const snap = metrics.snapshot();

    expect(snap).toHaveProperty('counters');
    expect(snap).toHaveProperty('gauges');
    expect(snap).toHaveProperty('histograms');
    expect(snap).toHaveProperty('tokens_24h');
    expect(snap).toHaveProperty('messages_24h');
    expect(snap).toHaveProperty('insights_30d');
    expect(snap).toHaveProperty('events_30d');
    expect(snap).toHaveProperty('system');

    expect(snap.gauges).toHaveProperty('active_sessions');
    expect(snap.gauges).toHaveProperty('agents_loaded');
    expect(snap.gauges).toHaveProperty('queued_messages');
    expect(snap.gauges).toHaveProperty('memory_store_bytes');
    expect(snap.gauges).toHaveProperty('media_store_bytes');
    expect(snap.insights_30d).toMatchObject({ periodDays: 30, topTools: [], topModels: [] });
    expect(snap.events_30d).toEqual({ tools: {}, sessions: {}, subagents: {} });
  });

  it('snapshot() reads persisted metrics when a store is attached', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'metrics-collector-'));
    store = new MetricsStore(join(tmpDir, 'metrics.sqlite'));
    metrics.setStore(store);

    metrics.increment('messages_received');
    metrics.recordQueryDuration(250);
    metrics.recordTokens('claude-sonnet', 11, 7, 3);
    metrics.recordMessage();
    metrics.recordUsage({
      sessionKey: 'web:agent:session-1',
      agentId: 'agent',
      platform: 'web',
      timestamp: Date.now(),
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 3,
      toolCalls: {},
      durationMs: 250,
      model: 'claude-sonnet',
    });
    metrics.recordToolEvent({ toolName: 'Read', status: 'started' });
    metrics.recordSessionEvent({ agentId: 'agent', sessionId: 'session-1', eventType: 'created' });
    metrics.recordSubagentEvent({
      agentId: 'agent',
      parentSessionId: 'session-1',
      subagentId: 'researcher',
      eventType: 'started',
      status: 'running',
    });

    const snap = metrics.snapshot();
    expect(snap.counters.messages_received).toBe(1);
    expect(snap.histograms.query_duration_ms).toMatchObject({ count: 1, p50: 250 });
    expect(snap.tokens_24h.byModel['claude-sonnet']).toEqual({ input: 11, output: 7, cache_read: 3 });
    expect(snap.messages_24h).toBe(1);
    expect(snap.insights_30d.totalMessages).toBe(1);
    expect(snap.insights_30d.topTools).toEqual([{ name: 'Read', count: 1 }]);
    expect(snap.events_30d).toEqual({
      tools: { started: 1 },
      sessions: { created: 1 },
      subagents: { started: 1 },
    });
  });

  // ─── gauge providers ────────────────────────────────────────────

  it('snapshot() uses gauge providers when set', () => {
    metrics.gaugeProviders = {
      activeSessions: () => 42,
      agentsLoaded: () => 3,
      queuedMessages: () => 7,
      memoryStoreBytes: () => 1024,
      mediaStoreBytes: () => 2048,
    };

    const snap = metrics.snapshot();
    expect(snap.gauges.active_sessions).toBe(42);
    expect(snap.gauges.agents_loaded).toBe(3);
    expect(snap.gauges.queued_messages).toBe(7);
    expect(snap.gauges.memory_store_bytes).toBe(1024);
    expect(snap.gauges.media_store_bytes).toBe(2048);
  });

  it('snapshot() returns 0 for gauges when no providers set', () => {
    const snap = metrics.snapshot();
    expect(snap.gauges.active_sessions).toBe(0);
    expect(snap.gauges.agents_loaded).toBe(0);
    expect(snap.gauges.queued_messages).toBe(0);
  });

  // ─── getSystemMetrics ───────────────────────────────────────────

  it('getSystemMetrics() returns valid structure', () => {
    const sys = metrics.getSystemMetrics();

    expect(typeof sys.cpu_percent).toBe('number');
    expect(sys.cpu_percent).toBeGreaterThanOrEqual(0);
    expect(sys.cpu_percent).toBeLessThanOrEqual(100);

    expect(typeof sys.mem_percent).toBe('number');
    expect(sys.mem_percent).toBeGreaterThan(0);
    expect(sys.mem_percent).toBeLessThanOrEqual(100);

    expect(typeof sys.mem_rss_bytes).toBe('number');
    expect(sys.mem_rss_bytes).toBeGreaterThan(0);

    expect(typeof sys.disk_percent).toBe('number');
    expect(typeof sys.disk_used_bytes).toBe('number');
    expect(typeof sys.disk_total_bytes).toBe('number');

    expect(sys.node_version).toMatch(/^v\d+/);
    expect(typeof sys.platform).toBe('string');
    expect(typeof sys.git_version).toBe('string');
    expect(typeof sys.git_dirty).toBe('boolean');
    expect(sys.ssl_expiry_days).toBeNull();
  });

  it('getSystemMetrics() returns disk metrics with positive values', () => {
    const sys = metrics.getSystemMetrics();
    // On any system with a disk, these should be positive
    expect(sys.disk_total_bytes).toBeGreaterThan(0);
    expect(sys.disk_used_bytes).toBeGreaterThan(0);
    expect(sys.disk_percent).toBeGreaterThan(0);
  });

  it('getSystemMetrics() caches git info', () => {
    const sys1 = metrics.getSystemMetrics();
    const sys2 = metrics.getSystemMetrics();

    // Both calls should return the same git info (cached)
    expect(sys1.git_version).toBe(sys2.git_version);
    expect(sys1.git_dirty).toBe(sys2.git_dirty);
  });
});
