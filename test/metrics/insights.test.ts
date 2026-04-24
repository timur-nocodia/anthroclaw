import { describe, it, expect, beforeEach } from 'vitest';
import { InsightsEngine, type UsageRecord } from '../../src/metrics/insights.js';

function makeRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    sessionKey: 'session-1',
    agentId: 'agent-1',
    platform: 'telegram',
    timestamp: Date.now(),
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 10,
    toolCalls: {},
    durationMs: 500,
    model: 'claude-sonnet-4-6',
    ...overrides,
  };
}

describe('InsightsEngine', () => {
  let engine: InsightsEngine;

  beforeEach(() => {
    engine = new InsightsEngine();
  });

  // ─── record ─────────────────────────────────────────────────────

  it('record() adds usage records', () => {
    engine.record(makeRecord());
    engine.record(makeRecord());
    const report = engine.report();
    expect(report.totalMessages).toBe(2);
  });

  it('record() caps at 10000 entries', () => {
    for (let i = 0; i < 10_050; i++) {
      engine.record(makeRecord({ sessionKey: `s-${i}` }));
    }
    const report = engine.report();
    expect(report.totalMessages).toBeLessThanOrEqual(10_000);
  });

  // ─── report: totalSessions ─────────────────────────────────────

  it('report() counts unique sessions', () => {
    engine.record(makeRecord({ sessionKey: 'a' }));
    engine.record(makeRecord({ sessionKey: 'a' }));
    engine.record(makeRecord({ sessionKey: 'b' }));

    const report = engine.report();
    expect(report.totalSessions).toBe(2);
  });

  // ─── report: totalMessages ─────────────────────────────────────

  it('report() counts total messages', () => {
    engine.record(makeRecord());
    engine.record(makeRecord());
    engine.record(makeRecord());

    const report = engine.report();
    expect(report.totalMessages).toBe(3);
  });

  // ─── report: tokens ────────────────────────────────────────────

  it('report() sums token counts', () => {
    engine.record(makeRecord({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 }));
    engine.record(makeRecord({ inputTokens: 200, outputTokens: 100, cacheReadTokens: 20 }));

    const report = engine.report();
    expect(report.totalInputTokens).toBe(300);
    expect(report.totalOutputTokens).toBe(150);
    expect(report.totalCacheReadTokens).toBe(30);
  });

  // ─── report: topTools ──────────────────────────────────────────

  it('report() aggregates tool calls and sorts descending', () => {
    engine.record(makeRecord({ toolCalls: { search: 3, read: 1 } }));
    engine.record(makeRecord({ toolCalls: { search: 2, write: 4 } }));

    const report = engine.report();
    expect(report.topTools[0]).toEqual({ name: 'search', count: 5 });
    expect(report.topTools[1]).toEqual({ name: 'write', count: 4 });
    expect(report.topTools[2]).toEqual({ name: 'read', count: 1 });
  });

  it('report() limits topTools to 10', () => {
    const toolCalls: Record<string, number> = {};
    for (let i = 0; i < 15; i++) {
      toolCalls[`tool_${i}`] = i + 1;
    }
    engine.record(makeRecord({ toolCalls }));

    const report = engine.report();
    expect(report.topTools).toHaveLength(10);
    // Highest tool should be first
    expect(report.topTools[0].name).toBe('tool_14');
    expect(report.topTools[0].count).toBe(15);
  });

  // ─── report: topModels ─────────────────────────────────────────

  it('report() aggregates models and sorts descending', () => {
    engine.record(makeRecord({ model: 'claude-sonnet-4-6' }));
    engine.record(makeRecord({ model: 'claude-sonnet-4-6' }));
    engine.record(makeRecord({ model: 'claude-opus-4-6' }));

    const report = engine.report();
    expect(report.topModels[0]).toEqual({ model: 'claude-sonnet-4-6', sessions: 2 });
    expect(report.topModels[1]).toEqual({ model: 'claude-opus-4-6', sessions: 1 });
  });

  it('report() limits topModels to 5', () => {
    for (let i = 0; i < 8; i++) {
      engine.record(makeRecord({ model: `model-${i}` }));
    }

    const report = engine.report();
    expect(report.topModels).toHaveLength(5);
  });

  // ─── report: time filtering ────────────────────────────────────

  it('report() filters by time window', () => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Record from 2 days ago
    engine.record(makeRecord({ timestamp: now - 2 * dayMs, sessionKey: 'old' }));
    // Record from today
    engine.record(makeRecord({ timestamp: now, sessionKey: 'new' }));

    // 1-day window should only include today's record
    const report = engine.report(1);
    expect(report.totalMessages).toBe(1);
    expect(report.totalSessions).toBe(1);
    expect(report.periodDays).toBe(1);
  });

  it('report() defaults to 30 days', () => {
    engine.record(makeRecord());
    const report = engine.report();
    expect(report.periodDays).toBe(30);
  });

  // ─── report: empty ─────────────────────────────────────────────

  it('report() returns zeros when no records', () => {
    const report = engine.report();
    expect(report.totalSessions).toBe(0);
    expect(report.totalMessages).toBe(0);
    expect(report.totalInputTokens).toBe(0);
    expect(report.totalOutputTokens).toBe(0);
    expect(report.totalCacheReadTokens).toBe(0);
    expect(report.topTools).toEqual([]);
    expect(report.topModels).toEqual([]);
  });
});
