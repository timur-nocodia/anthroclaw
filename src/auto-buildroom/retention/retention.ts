import type { BuildroomArtifact } from '../artifacts/model.js';

export type RetentionRecommendation =
  | 'keep'
  | 'improve'
  | 'park'
  | 'prune_recommended'
  | 'ghost'
  | 'reopen';

export interface CreateRetentionReviewArtifactOptions {
  trust: BuildroomArtifact;
  now: string;
}

export function createRetentionReviewArtifact(
  opts: CreateRetentionReviewArtifactOptions,
): BuildroomArtifact {
  assertArtifactType(opts.trust, 'trust_report');

  const trustState = trustStateOf(opts.trust);
  const recommendation = recommendationForTrustState(trustState);
  const followUpNeeded = recommendation === 'improve' || recommendation === 'reopen';

  return {
    id: `retention_${artifactSuffix(opts.trust.id, 'trust')}`,
    type: 'retention_review',
    schemaVersion: 'auto-buildroom/v1',
    status: 'completed',
    createdAt: opts.now,
    producer: { role: 'retention', runId: `retention:${opts.trust.id}` },
    room: opts.trust.room,
    parentIds: [opts.trust.id],
    inputRefs: [{ kind: 'artifact', ref: opts.trust.id }],
    outputRefs: [],
    runtimeRefs: [],
    traceId: opts.trust.traceId,
    redaction: opts.trust.redaction,
    contentHash: '',
    payload: {
      targetArtifactId: opts.trust.id,
      targetArtifactType: opts.trust.type,
      recommendation,
      reason: reasonForRecommendation(recommendation, trustState),
      trustStateAtReview: trustState,
      followUpNeeded,
      archiveAllowed: true,
      destructiveCleanupAllowed: false,
      reviewAfter: reviewAfter(opts.now),
    },
  };
}

function recommendationForTrustState(trustState: string): RetentionRecommendation {
  if (trustState === 'clean') return 'keep';
  if (trustState === 'watch' || trustState === 'investigate') return 'improve';
  return 'park';
}

function reasonForRecommendation(
  recommendation: RetentionRecommendation,
  trustState: string,
): string {
  switch (recommendation) {
    case 'keep':
      return 'Trust report is clean; keep receipts available for reuse and future review.';
    case 'improve':
      return `Trust report is ${trustState}; preserve receipts and use follow-up only through a new approved Buildroom loop.`;
    case 'park':
      return `Trust report is ${trustState}; preserve receipts and do not continue this chain without operator review.`;
    default:
      return 'Retention recommendation recorded without destructive cleanup authority.';
  }
}

function trustStateOf(trust: BuildroomArtifact): string {
  return typeof trust.payload.trustState === 'string'
    ? trust.payload.trustState
    : trust.status;
}

function reviewAfter(now: string): string {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return now;
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString();
}

function assertArtifactType(artifact: BuildroomArtifact, type: BuildroomArtifact['type']): void {
  if (artifact.type !== type) {
    throw new Error(`Expected ${type} artifact, got ${artifact.type}`);
  }
}

function artifactSuffix(id: string, prefix: string): string {
  const expectedPrefix = `${prefix}_`;
  return id.startsWith(expectedPrefix) ? id.slice(expectedPrefix.length) : id;
}
