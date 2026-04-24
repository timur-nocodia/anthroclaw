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
    store.recordFileOwnershipEvent({
      timestamp: now + 25,
      agentId: 'agent',
      sessionKey: 'web:agent:session-1',
      runId: 'run-1',
      subagentId: 'researcher',
      path: '/repo/src/app.ts',
      eventType: 'conflict',
      action: 'allow',
      reason: 'soft file ownership records conflict and allows the claim',
    });
    store.recordMemoryInfluenceEvent({
      timestamp: now + 30,
      agentId: 'agent',
      sessionKey: 'web:agent:session-1',
      runId: 'run-1',
      sdkSessionId: 'session-1',
      source: 'prefetch',
      query: 'project owner',
      refs: [{
        memoryEntryId: 'entry-1',
        path: 'memory/profile.md',
        startLine: 1,
        endLine: 3,
        score: 0.75,
      }],
    });
    store.recordAgentRunStart({
      runId: 'run-1',
      traceId: 'trace-1',
      startedAt: now,
      agentId: 'agent',
      sessionKey: 'web:agent:session-1',
      sdkSessionId: 'session-1',
      source: 'web',
      channel: 'web',
      peerId: 'web-user',
      routeDecisionId: 'route-1',
      status: 'running',
      model: 'claude-sonnet',
      budget: { maxTurns: 10 },
    });
    store.recordAgentRunFinish({
      runId: 'run-1',
      completedAt: now + 123,
      status: 'succeeded',
      sdkSessionId: 'session-1',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2,
        durationMs: 123,
      },
    });
    store.recordRouteDecision({
      id: 'route-1',
      timestamp: now,
      messageId: 'mid-1',
      channel: 'telegram',
      accountId: 'default',
      chatType: 'dm',
      peerId: 'peer-123',
      senderId: 'sender-456',
      candidates: [{
        agentId: 'agent',
        channel: 'telegram',
        accountId: 'default',
        scope: 'dm',
        mentionOnly: false,
        priority: 2,
      }],
      winnerAgentId: 'agent',
      accessAllowed: true,
      sessionKey: 'web:agent:session-1',
      outcome: 'dispatched',
    });
    store.recordInterrupt({
      timestamp: now + 50,
      agentId: 'agent',
      runId: 'run-1',
      sessionKey: 'web:agent:session-1',
      sdkSessionId: 'session-1',
      targetId: 'run-1',
      requestedBy: 'web',
      result: 'interrupted',
      reason: 'Active query interrupt requested successfully.',
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
      fileOwnership: { conflict: 1 },
    });
    expect(store.getAgentRun('run-1')).toMatchObject({
      runId: 'run-1',
      traceId: 'trace-1',
      agentId: 'agent',
      sessionKey: 'web:agent:session-1',
      sdkSessionId: 'session-1',
      source: 'web',
      channel: 'web',
      peerId: 'web-user',
      routeDecisionId: 'route-1',
      status: 'succeeded',
      model: 'claude-sonnet',
      budget: { maxTurns: 10 },
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2,
        durationMs: 123,
      },
    });
    expect(store.listAgentRuns({ agentId: 'agent' }).map((run) => run.runId)).toEqual(['run-1']);
    expect(store.listDiagnosticEvents({ runId: 'run-1' }).map((event) => event.eventType)).toEqual([
      'run.completed',
      'run.sdk_started',
    ]);
    expect(store.listDiagnosticEvents({ traceId: 'trace-1' })[0]).toMatchObject({
      traceId: 'trace-1',
      runId: 'run-1',
      agentId: 'agent',
      eventType: 'run.completed',
    });
    expect(store.listAgentRuns({ agentId: 'agent', sdkSessionId: 'session-1' }).map((run) => run.runId)).toEqual(['run-1']);
    expect(store.listAgentRuns({ agentId: 'agent', sdkSessionId: 'missing' })).toEqual([]);
    expect(store.listRouteDecisions({ agentId: 'agent' })).toMatchObject([{
      id: 'route-1',
      messageId: 'mid-1',
      winnerAgentId: 'agent',
      accessAllowed: true,
      sessionKey: 'web:agent:session-1',
      outcome: 'dispatched',
      candidates: [{ agentId: 'agent', priority: 2 }],
    }]);
    expect(store.listRouteDecisions({ sessionKey: 'web:agent:session-1' }).map((decision) => decision.id)).toEqual(['route-1']);
    expect(store.listRouteDecisions({ outcome: 'no_route' })).toEqual([]);
    expect(store.listInterrupts({ runId: 'run-1' })).toMatchObject([{
      agentId: 'agent',
      runId: 'run-1',
      sessionKey: 'web:agent:session-1',
      sdkSessionId: 'session-1',
      targetId: 'run-1',
      requestedBy: 'web',
      result: 'interrupted',
      reason: 'Active query interrupt requested successfully.',
    }]);
    expect(store.listFileOwnershipEvents({ sessionKey: 'web:agent:session-1' })).toMatchObject([{
      agentId: 'agent',
      sessionKey: 'web:agent:session-1',
      runId: 'run-1',
      subagentId: 'researcher',
      path: '/repo/src/app.ts',
      eventType: 'conflict',
      action: 'allow',
    }]);
    expect(store.listMemoryInfluenceEvents({ runId: 'run-1' })).toMatchObject([{
      agentId: 'agent',
      sessionKey: 'web:agent:session-1',
      runId: 'run-1',
      sdkSessionId: 'session-1',
      source: 'prefetch',
      query: 'project owner',
      refs: [{
        memoryEntryId: 'entry-1',
        path: 'memory/profile.md',
        startLine: 1,
        endLine: 3,
        score: 0.75,
      }],
    }]);

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
