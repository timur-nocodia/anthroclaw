import { describe, expect, it, vi } from 'vitest';
import {
  LearningQueue,
  detectLearningTriggers,
  type LearningReviewJob,
} from '../queue.js';

describe('LearningQueue', () => {
  it('detects configured post-response trigger types', () => {
    expect(detectLearningTriggers({
      reviewIntervalTurns: 3,
      turnCount: 6,
      userText: 'Я говорил тебе, запомни это на будущее.',
      recoveredToolErrors: 1,
      toolCalls: 5,
      toolCallThreshold: 5,
      skillOrMemoryActivity: true,
      compressionOrLcmActivity: true,
    })).toEqual([
      'turn_interval',
      'user_correction',
      'tool_error_recovered',
      'tool_call_threshold',
      'skill_or_memory_activity',
      'compression_or_lcm',
    ]);
  });

  it('runs one active review per agent/session and coalesces duplicate triggers', async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: LearningReviewJob[] = [];
    const queue = new LearningQueue({
      runner: vi.fn(async (job) => {
        started.push(job);
        await blocker;
      }),
      now: (() => {
        let ts = 100;
        return () => ts++;
      })(),
    });

    const first = queue.enqueueAfterResponse({
      agentId: 'agent-a',
      sessionKey: 'private:1',
      runId: 'run-1',
      trigger: 'user_correction',
    });
    const second = queue.enqueueAfterResponse({
      agentId: 'agent-a',
      sessionKey: 'private:1',
      runId: 'run-2',
      trigger: 'tool_call_threshold',
      metadata: { toolCalls: 8 },
    });

    expect(first.status).toBe('started');
    expect(second.status).toBe('coalesced');
    expect(queue.listActive()).toHaveLength(1);
    expect(queue.listPending()).toEqual([
      expect.objectContaining({
        runId: 'run-2',
        coalescedCount: 1,
        triggers: ['user_correction', 'tool_call_threshold'],
        metadata: { toolCalls: 8 },
      }),
    ]);

    release();
    await vi.waitFor(() => {
      expect(started).toHaveLength(2);
    });
    expect(started[1]).toMatchObject({
      runId: 'run-2',
      triggers: ['user_correction', 'tool_call_threshold'],
    });
  });

  it('allows different sessions to run in parallel', async () => {
    const started: string[] = [];
    const queue = new LearningQueue({
      runner: vi.fn(async (job) => {
        started.push(job.sessionKey);
      }),
    });

    queue.enqueueAfterResponse({ agentId: 'agent-a', sessionKey: 's1', trigger: 'turn_interval' });
    queue.enqueueAfterResponse({ agentId: 'agent-a', sessionKey: 's2', trigger: 'turn_interval' });

    await vi.waitFor(() => {
      expect(started.sort()).toEqual(['s1', 's2']);
    });
  });

  it('does not throw runner failures into the enqueue caller and records them as non-fatal', async () => {
    const onError = vi.fn();
    const queue = new LearningQueue({
      runner: vi.fn(async () => {
        throw new Error('review failed with token=abcdefghijklmnopqrstuvwxyz1234567890');
      }),
      onError,
    });

    expect(() => queue.enqueueAfterResponse({
      agentId: 'agent-a',
      sessionKey: 's1',
      runId: 'run-1',
      trigger: 'user_correction',
    })).not.toThrow();

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    expect(queue.listActive()).toHaveLength(0);
  });
});
