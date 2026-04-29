import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LearningStore } from '../store.js';

describe('LearningStore', () => {
  let dir: string;
  let store: LearningStore;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'anthroclaw-learning-'));
    dbPath = join(dir, 'learning.sqlite');
    store = new LearningStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('bootstraps learning review tables', () => {
    expect(store.listTables()).toEqual(expect.arrayContaining([
      'learning_reviews',
      'learning_actions',
      'learning_artifacts',
      'skill_snapshots',
    ]));
  });

  it('inserts, lists, and updates reviews and actions', () => {
    const review = store.createReview({
      id: 'review-1',
      agentId: 'agent-a',
      sessionKey: 'private:chat-1',
      runId: 'run-1',
      traceId: 'trace-1',
      sdkSessionId: 'sdk-1',
      trigger: 'user_correction',
      mode: 'propose',
      model: 'claude-sonnet-4-6',
      startedAt: 100,
      input: { correction: 'Always ask before publishing.' },
      metadata: { source: 'test' },
    });

    expect(review).toMatchObject({
      id: 'review-1',
      agentId: 'agent-a',
      status: 'running',
      input: { correction: 'Always ask before publishing.' },
    });

    const action = store.addAction({
      id: 'action-1',
      reviewId: review.id,
      agentId: 'agent-a',
      actionType: 'skill_patch',
      confidence: 0.82,
      title: 'Persist publish confirmation rule',
      rationale: 'The user corrected the agent once.',
      payload: { path: '.claude/skills/publishing/SKILL.md' },
      createdAt: 110,
    });

    expect(action).toMatchObject({
      id: 'action-1',
      reviewId: 'review-1',
      status: 'proposed',
      payload: { path: '.claude/skills/publishing/SKILL.md' },
    });
    expect(store.listActions({ reviewId: 'review-1' })).toHaveLength(1);

    expect(store.updateActionStatus('action-1', 'approved', { updatedAt: 120 })).toBe(true);
    expect(store.getAction('action-1')).toMatchObject({
      status: 'approved',
      updatedAt: 120,
    });

    expect(store.completeReview('review-1', {
      completedAt: 130,
      output: { actions: 1 },
    })).toBe(true);
    expect(store.listReviews({ agentId: 'agent-a', status: 'completed' })[0]).toMatchObject({
      id: 'review-1',
      completedAt: 130,
      output: { actions: 1 },
    });
  });

  it('stores artifacts and skill snapshots', () => {
    const review = store.createReview({
      id: 'review-2',
      agentId: 'agent-a',
      runId: 'run-2',
      trigger: 'manual',
      mode: 'propose',
    });
    const action = store.addAction({
      id: 'action-2',
      reviewId: review.id,
      agentId: 'agent-a',
      actionType: 'skill_patch',
    });

    const artifact = store.addArtifact({
      id: 'artifact-1',
      reviewId: review.id,
      agentId: 'agent-a',
      runId: 'run-2',
      kind: 'manifest',
      path: 'data/learning-artifacts/agent-a/run-2/manifest.json',
      contentHash: 'sha256-manifest',
      sizeBytes: 512,
      reason: 'review input manifest',
      metadata: { fileCount: 2 },
      createdAt: 200,
    });

    const snapshot = store.addSkillSnapshot({
      id: 'snapshot-1',
      actionId: action.id,
      agentId: 'agent-a',
      skillName: 'publishing',
      path: '.claude/skills/publishing/SKILL.md',
      contentHash: 'sha256-skill',
      body: '# Publishing\n',
      reason: 'before skill patch',
      metadata: { source: 'test' },
      createdAt: 210,
    });

    expect(artifact).toMatchObject({
      kind: 'manifest',
      metadata: { fileCount: 2 },
    });
    expect(snapshot).toMatchObject({
      actionId: 'action-2',
      skillName: 'publishing',
      body: '# Publishing\n',
    });
    expect(store.listArtifacts({ runId: 'run-2' })).toHaveLength(1);
    expect(store.listSkillSnapshots({ actionId: 'action-2' })).toHaveLength(1);
  });

  it('survives restart', () => {
    store.createReview({
      id: 'review-restart',
      agentId: 'agent-a',
      trigger: 'manual',
      mode: 'propose',
      input: { durable: true },
    });
    store.close();

    store = new LearningStore(dbPath);

    expect(store.getReview('review-restart')).toMatchObject({
      id: 'review-restart',
      input: { durable: true },
    });
  });
});
