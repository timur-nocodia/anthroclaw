import { describe, expect, it } from 'vitest';
import {
  AuthorityPolicyError,
  createApprovalArtifact,
  createBuildPlanArtifact,
} from '../authority.js';
import type { BuildroomArtifact } from '../../artifacts/model.js';

describe('Auto-Buildroom authority policy', () => {
  it('rejects approval for a raw idea because approval must target main_review', () => {
    expect(() =>
      createApprovalArtifact({
        review: artifact('idea_20260512_docs', 'idea_contract', {
          title: 'Improve docs',
        }),
        operator: { id: 'cli:user:local-operator', route: 'cli:local' },
        now: '2026-05-12T00:00:00.000Z',
      }),
    ).toThrow(AuthorityPolicyError);
  });

  it('rejects approval when Main Review did not approve the proposal for operator', () => {
    expect(() =>
      createApprovalArtifact({
        review: artifact('review_20260512_docs', 'main_review', {
          decision: 'needs_more_research',
          lockedScope: { allowedPaths: ['docs/**'] },
        }),
        operator: { id: 'cli:user:local-operator', route: 'cli:local' },
        now: '2026-05-12T00:00:00.000Z',
      }),
    ).toThrow(/approved_for_operator/);
  });

  it('creates approval as an explicit authority artifact with operator identity and route', () => {
    const review = artifact('review_20260512_docs', 'main_review', {
      decision: 'approved_for_operator',
      lockedScope: { allowedPaths: ['docs/**'], blockedPaths: ['.env'] },
    });

    const approval = createApprovalArtifact({
      review,
      operator: { id: 'cli:user:local-operator', route: 'cli:local' },
      now: '2026-05-12T00:00:00.000Z',
    });

    expect(approval).toMatchObject({
      id: 'approval_20260512_docs',
      type: 'approval',
      status: 'granted',
      parentIds: [review.id],
      producer: { role: 'operator', runId: 'cli:user:local-operator' },
      payload: {
        approvedBy: 'cli:user:local-operator',
        approvalRoute: 'cli:local',
        targetReviewId: review.id,
        consumedAt: null,
      },
    });
  });

  it('rejects build plan creation when approval has already been consumed', () => {
    const review = artifact('review_20260512_docs', 'main_review', {
      decision: 'approved_for_operator',
      lockedScope: { allowedPaths: ['docs/**'] },
    });
    const approval = createApprovalArtifact({
      review,
      operator: { id: 'cli:user:local-operator', route: 'cli:local' },
      now: '2026-05-12T00:00:00.000Z',
    });
    approval.payload.consumedAt = '2026-05-12T00:05:00.000Z';

    expect(() =>
      createBuildPlanArtifact({
        approval,
        review,
        now: '2026-05-12T00:10:00.000Z',
      }),
    ).toThrow(/consumed/);
  });

  it('creates build plan only from an unconsumed approval and locked Main Review scope', () => {
    const review = artifact('review_20260512_docs', 'main_review', {
      decision: 'approved_for_operator',
      lockedScope: {
        allowedPaths: ['docs/Auto-Buildroom/**'],
        blockedPaths: ['.env', 'agents/**'],
        nonGoals: ['deploy', 'external side effects'],
      },
    });
    const approval = createApprovalArtifact({
      review,
      operator: { id: 'cli:user:local-operator', route: 'cli:local' },
      now: '2026-05-12T00:00:00.000Z',
    });

    const plan = createBuildPlanArtifact({
      approval,
      review,
      now: '2026-05-12T00:10:00.000Z',
    });

    expect(plan).toMatchObject({
      id: 'plan_20260512_docs',
      type: 'build_plan',
      status: 'ready',
      parentIds: [approval.id, review.id],
      payload: {
        approvalId: approval.id,
        reviewId: review.id,
        scope: review.payload.lockedScope,
      },
    });
  });

  function artifact(
    id: string,
    type: BuildroomArtifact['type'],
    payload: Record<string, unknown>,
  ): BuildroomArtifact {
    return {
      id,
      type,
      schemaVersion: 'auto-buildroom/v1',
      status: 'completed',
      createdAt: '2026-05-12T00:00:00.000Z',
      producer: { role: 'main', runId: `run_${id}` },
      room: { id: 'anthroclaw-core' },
      parentIds: [],
      inputRefs: [],
      outputRefs: [],
      runtimeRefs: [],
      traceId: `trace_${id}`,
      redaction: {
        rawTranscriptsIncluded: false,
        secretsRedacted: true,
        redactedFields: [],
      },
      contentHash: '',
      payload,
    };
  }
});

