import { describe, expect, it } from 'vitest';
import { SdkSubagentRegistry } from '../../src/sdk/subagent-registry.js';

describe('SdkSubagentRegistry', () => {
  it('tracks start and stop events for the same subagent run', () => {
    const registry = new SdkSubagentRegistry();

    const started = registry.recordStart({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      parentSessionKeys: ['web:orchestrator:temp-1'],
      subagentId: 'researcher',
      subagentType: 'research',
      cwd: '/tmp/workspace',
      parentTranscriptPath: '/tmp/parent.jsonl',
    }, 1_000);

    const stopped = registry.recordStop({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      parentSessionKeys: ['web:orchestrator:temp-1'],
      subagentId: 'researcher',
      subagentType: 'research',
      subagentTranscriptPath: '/tmp/subagent.jsonl',
      lastAssistantMessage: 'Done.',
    }, 2_000);

    expect(stopped.runId).toBe(started.runId);
    expect(stopped.status).toBe('completed');
    expect(stopped.startedAt).toBe(1_000);
    expect(stopped.finishedAt).toBe(2_000);
    expect(stopped.subagentTranscriptPath).toBe('/tmp/subagent.jsonl');
    expect(stopped.lastAssistantMessage).toBe('Done.');
  });

  it('matches nested runs of the same subagent id in LIFO order', () => {
    const registry = new SdkSubagentRegistry();

    const first = registry.recordStart({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      subagentId: 'helper',
    }, 1_000);

    const second = registry.recordStart({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      subagentId: 'helper',
    }, 2_000);

    const stopSecond = registry.recordStop({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      subagentId: 'helper',
    }, 3_000);

    const stopFirst = registry.recordStop({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      subagentId: 'helper',
    }, 4_000);

    expect(stopSecond.runId).toBe(second.runId);
    expect(stopFirst.runId).toBe(first.runId);
  });

  it('returns the active run for a subagent in LIFO order', () => {
    const registry = new SdkSubagentRegistry();

    const first = registry.recordStart({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      subagentId: 'helper',
    }, 1_000);
    const second = registry.recordStart({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      subagentId: 'helper',
    }, 2_000);

    expect(registry.getActiveRun('orchestrator', 'session-1', 'helper')?.runId).toBe(second.runId);
    registry.recordStop({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      subagentId: 'helper',
    }, 3_000);
    expect(registry.getActiveRun('orchestrator', 'session-1', 'helper')?.runId).toBe(first.runId);
  });

  it('summarizes tool events for the active subagent run', () => {
    const registry = new SdkSubagentRegistry();

    const run = registry.recordStart({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      subagentId: 'helper',
    }, 1_000);

    registry.recordToolEvent({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      subagentId: 'helper',
      toolName: 'Read',
      status: 'started',
    }, 1_100);
    registry.recordToolEvent({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      subagentId: 'helper',
      toolName: 'Read',
      status: 'completed',
    }, 1_200);
    registry.recordToolEvent({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      subagentId: 'helper',
      toolName: 'Bash',
      status: 'failed',
    }, 1_300);

    const updated = registry.getRun('orchestrator', run.runId);
    expect(updated?.toolSummary).toEqual({
      started: 1,
      completed: 1,
      failed: 1,
      toolNames: ['Bash', 'Read'],
      byTool: {
        Bash: { started: 0, completed: 0, failed: 1 },
        Read: { started: 1, completed: 1, failed: 0 },
      },
      lastToolName: 'Bash',
      lastStatus: 'failed',
      lastAt: 1_300,
    });
  });

  it('creates a completed synthetic record when a stop arrives without a start', () => {
    const registry = new SdkSubagentRegistry();

    const run = registry.recordStop({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      subagentId: 'helper',
      lastAssistantMessage: 'Recovered.',
    }, 5_000);

    expect(run.status).toBe('completed');
    expect(run.startedAt).toBe(5_000);
    expect(run.finishedAt).toBe(5_000);
    expect(run.lastAssistantMessage).toBe('Recovered.');
  });

  it('filters and deletes runs by parent session', () => {
    const registry = new SdkSubagentRegistry();

    registry.recordStart({
      agentId: 'orchestrator',
      parentSessionId: 'session-1',
      subagentId: 'helper-a',
    }, 1_000);
    registry.recordStart({
      agentId: 'orchestrator',
      parentSessionId: 'session-2',
      subagentId: 'helper-b',
    }, 2_000);

    expect(registry.listRuns({ agentId: 'orchestrator', parentSessionId: 'session-1' }))
      .toHaveLength(1);
    expect(registry.deleteSession('orchestrator', 'session-1')).toBe(1);
    expect(registry.listRuns({ agentId: 'orchestrator' })).toHaveLength(1);
  });
});
