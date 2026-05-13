import { describe, expect, it } from 'vitest';
import { createRetentionReviewArtifact } from '../retention.js';
import type { BuildroomArtifact } from '../../artifacts/model.js';

describe('Buildroom retention review artifacts', () => {
  it('creates a completed recommendation receipt without destructive cleanup authority', () => {
    const trust = artifact('trust_20260512_docs', 'trust_report', 'watch', {
      trustState: 'watch',
      reasons: ['missing claim evidence'],
    });

    const retention = createRetentionReviewArtifact({
      trust,
      now: '2026-05-12T00:00:00.000Z',
    });

    expect(retention).toMatchObject({
      id: 'retention_20260512_docs',
      type: 'retention_review',
      status: 'completed',
      producer: { role: 'retention', runId: 'retention:trust_20260512_docs' },
      parentIds: ['trust_20260512_docs'],
      inputRefs: [{ kind: 'artifact', ref: 'trust_20260512_docs' }],
      outputRefs: [],
      payload: {
        targetArtifactId: 'trust_20260512_docs',
        recommendation: 'improve',
        trustStateAtReview: 'watch',
        followUpNeeded: true,
        archiveAllowed: true,
        destructiveCleanupAllowed: false,
      },
    });
  });

  it('keeps clean trust reports available without implying permanent activity', () => {
    const trust = artifact('trust_20260512_docs', 'trust_report', 'clean', {
      trustState: 'clean',
      reasons: [],
    });

    const retention = createRetentionReviewArtifact({
      trust,
      now: '2026-05-12T00:00:00.000Z',
    });

    expect(retention.status).toBe('completed');
    expect(retention.payload.recommendation).toBe('keep');
    expect(retention.payload.followUpNeeded).toBe(false);
    expect(retention.payload.reviewAfter).toBe('2026-06-11T00:00:00.000Z');
  });

  function artifact(
    id: string,
    type: BuildroomArtifact['type'],
    status: string,
    payload: Record<string, unknown>,
  ): BuildroomArtifact {
    return {
      id,
      type,
      schemaVersion: 'auto-buildroom/v1',
      status,
      createdAt: '2026-05-12T00:00:00.000Z',
      producer: { role: 'test', runId: `run_${id}` },
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
