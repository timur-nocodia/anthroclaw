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

  it('can scope diagnostics to one run', () => {
    const now = Date.now();
    metrics.recordAgentRunStart({
      runId: 'run-1',
      traceId: 'trace-1',
      startedAt: now,
      agentId: 'agent',
      sessionKey: 'web:agent:session-1',
      source: 'web',
      channel: 'web',
      status: 'running',
    });
    metrics.recordAgentRunStart({
      runId: 'run-2',
      traceId: 'trace-2',
      startedAt: now + 1,
      agentId: 'agent',
      sessionKey: 'web:agent:session-2',
      source: 'web',
      channel: 'web',
      status: 'running',
    });
    metrics.recordRouteDecision({
      id: 'route-1',
      timestamp: now,
      messageId: 'message-1',
      channel: 'web',
      accountId: 'web',
      chatType: 'dm',
      peerId: 'peer-1',
      senderId: 'sender-1',
      candidates: [],
      winnerAgentId: 'agent',
      accessAllowed: true,
      sessionKey: 'web:agent:session-1',
      outcome: 'dispatched',
    });
    metrics.recordRouteDecision({
      id: 'route-2',
      timestamp: now + 1,
      messageId: 'message-2',
      channel: 'web',
      accountId: 'web',
      chatType: 'dm',
      peerId: 'peer-2',
      senderId: 'sender-2',
      candidates: [],
      winnerAgentId: 'agent',
      accessAllowed: true,
      sessionKey: 'web:agent:session-2',
      outcome: 'dispatched',
    });
    metrics.recordInterrupt({
      timestamp: now + 2,
      agentId: 'agent',
      runId: 'run-1',
      sessionKey: 'web:agent:session-1',
      targetId: 'run-1',
      requestedBy: 'web',
      result: 'interrupted',
    });
    metrics.recordIntegrationAuditEvent({
      timestamp: now + 3,
      agentId: 'agent',
      sessionKey: 'web:agent:session-1',
      runId: 'run-1',
      toolName: 'mcp__agent-tools__local_note_search',
      provider: 'anthroclaw-notes',
      capabilityId: 'notes.local',
      status: 'completed',
    });
    metrics.recordMemoryInfluenceEvent({
      timestamp: now + 4,
      agentId: 'agent',
      sessionKey: 'web:agent:session-1',
      runId: 'run-1',
      source: 'prefetch',
      query: 'project owner',
      refs: [{
        path: 'memory/profile.md',
        score: 0.75,
      }],
    });

    const bundle = buildDiagnosticsBundle({
      status: {},
      includeLogs: false,
      runId: 'run-1',
    });

    expect(bundle.manifest.filters).toEqual({ runId: 'run-1' });
    expect(bundle.runs.map((run: any) => run.runId)).toEqual(['run-1']);
    expect(bundle.routeDecisions.map((decision: any) => decision.id)).toEqual(['route-1']);
    expect(bundle.diagnosticEvents.every((event: any) => event.runId === 'run-1')).toBe(true);
    expect(bundle.interrupts.map((event: any) => event.runId)).toEqual(['run-1']);
    expect(bundle.integrationAuditEvents.map((event: any) => event.toolName)).toEqual([
      'mcp__agent-tools__local_note_search',
    ]);
    expect(bundle.memoryInfluenceEvents.map((event: any) => event.query)).toEqual(['project owner']);
  });
});
