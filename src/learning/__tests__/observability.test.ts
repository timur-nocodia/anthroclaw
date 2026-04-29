import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsStore } from '../../metrics/store.js';
import { metrics } from '../../metrics/collector.js';
import { LearningQueue } from '../queue.js';
import { LearningStore } from '../store.js';
import { MemoryStore } from '../../memory/store.js';
import { parseLearningReviewOutput, persistLearningReviewResult } from '../reviewer.js';
import { applyMemoryCandidateAction } from '../memory-applier.js';
import { applySkillAction } from '../skill-applier.js';
import { runLearningCli } from '../../cli/learning.js';
import { getLearningDiagnostics } from '../diagnostics.js';

describe('learning observability', () => {
  let dir: string;
  let metricsStore: MetricsStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'anthroclaw-learning-observability-'));
    metricsStore = new MetricsStore(join(dir, 'metrics.sqlite'));
    metrics.setStore(metricsStore);
  });

  afterEach(() => {
    metrics.setStore(null);
    metricsStore.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('records started and failed review counters without raw payload text', async () => {
    const queue = new LearningQueue({
      runner: vi.fn(async () => {
        throw new Error('failed with token=abcdefghijklmnopqrstuvwxyz1234567890');
      }),
    });

    queue.enqueueAfterResponse({
      agentId: 'agent-a',
      sessionKey: 's1',
      runId: 'run-1',
      trigger: 'user_correction',
      metadata: { privateText: 'do not store this in metrics' },
    });

    await vi.waitFor(() => {
      expect(metrics.snapshot().counters.learning_reviews_failed).toBe(1);
    });
    expect(metrics.snapshot().counters).toMatchObject({
      learning_reviews_started: 1,
      learning_reviews_failed: 1,
    });
    expect(JSON.stringify(metrics.snapshot().counters)).not.toContain('do not store');
  });

  it('records proposed action counts', () => {
    const store = new LearningStore(join(dir, 'learning.sqlite'));
    try {
      const review = store.createReview({
        id: 'review-1',
        agentId: 'agent-a',
        trigger: 'manual',
        mode: 'propose',
      });
      const result = parseLearningReviewOutput(JSON.stringify({
        actions: [
          { type: 'memory_candidate', payload: { text: 'Remember concise replies.' } },
          { type: 'none', rationale: 'No skill change.' },
        ],
      }));

      persistLearningReviewResult({
        store,
        reviewId: review.id,
        agentId: 'agent-a',
        result,
      });

      expect(metrics.snapshot().counters.learning_actions_proposed).toBe(2);
    } finally {
      store.close();
    }
  });

  it('records auto-applied, rejected, and skill patch failure counters', async () => {
    const store = new LearningStore(join(dir, 'learning.sqlite'));
    const memoryStore = new MemoryStore(join(dir, 'memory.sqlite'));
    try {
      store.createReview({ id: 'review-1', agentId: 'agent-a', trigger: 'manual', mode: 'auto_private' });
      const memoryAction = store.addAction({
        id: 'memory-1',
        reviewId: 'review-1',
        agentId: 'agent-a',
        actionType: 'memory_candidate',
        confidence: 0.95,
        payload: { text: 'High confidence private preference.' },
      });
      applyMemoryCandidateAction({
        memoryStore,
        action: memoryAction,
        safetyProfile: 'private',
        mode: 'auto_private',
        agentId: 'agent-a',
      });

      const workspacePath = join(dir, 'workspace');
      const skillDir = join(workspacePath, '.claude', 'skills', 'publishing');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# Publishing\n\nOriginal\n', 'utf8');
      const patchAction = store.addAction({
        id: 'skill-1',
        reviewId: 'review-1',
        agentId: 'agent-a',
        actionType: 'skill_patch',
        payload: { skillName: 'publishing', oldText: 'Missing', newText: 'New' },
      });
      expect(() => applySkillAction({
        workspacePath,
        learningStore: store,
        action: patchAction,
        safetyProfile: 'private',
        mode: 'auto_private',
        agentId: 'agent-a',
      })).toThrow(/not found/);

      await runLearningCli([
        'reject',
        'memory-1',
        '--data-dir',
        dir,
      ], {
        stdout: () => {},
        stderr: () => {},
      });

      expect(metrics.snapshot().counters).toMatchObject({
        learning_actions_auto_applied: 1,
        learning_skill_patch_failed: 1,
        learning_actions_rejected: 1,
      });
    } finally {
      memoryStore.close();
      store.close();
    }
  });

  it('returns count-only diagnostics without raw private action payloads', () => {
    const store = new LearningStore(join(dir, 'learning.sqlite'));
    try {
      store.createReview({ id: 'review-1', agentId: 'agent-a', trigger: 'manual', mode: 'propose' });
      store.completeReview('review-1');
      store.addAction({
        id: 'action-1',
        reviewId: 'review-1',
        agentId: 'agent-a',
        actionType: 'memory_candidate',
        status: 'proposed',
        payload: { text: 'private raw text that must not appear' },
      });

      const diagnostics = getLearningDiagnostics(store);
      expect(diagnostics).toMatchObject({
        reviewsByStatus: { completed: 1 },
        actionsByStatus: { proposed: 1 },
        actionsByType: { memory_candidate: 1 },
      });
      expect(JSON.stringify(diagnostics)).not.toContain('private raw text');
    } finally {
      store.close();
    }
  });
});
