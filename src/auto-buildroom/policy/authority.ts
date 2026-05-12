import type { BuildroomArtifact } from '../artifacts/model.js';

export interface BuildroomOperatorContext {
  id: string;
  route?: string;
}

export interface CreateApprovalArtifactOptions {
  review: BuildroomArtifact;
  operator: BuildroomOperatorContext;
  now: string;
}

export interface CreateBuildPlanArtifactOptions {
  approval: BuildroomArtifact;
  review: BuildroomArtifact;
  now: string;
}

export class AuthorityPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorityPolicyError';
  }
}

export function createApprovalArtifact(opts: CreateApprovalArtifactOptions): BuildroomArtifact {
  assertMainReviewApprovedForOperator(opts.review);

  const suffix = artifactSuffix(opts.review.id, 'review');
  const payload: Record<string, unknown> = {
    targetReviewId: opts.review.id,
    approvedBy: opts.operator.id,
    approvedAt: opts.now,
    approvedScope: opts.review.payload.lockedScope,
    consumedAt: null,
  };
  if (opts.operator.route) payload.approvalRoute = opts.operator.route;

  return {
    id: `approval_${suffix}`,
    type: 'approval',
    schemaVersion: 'auto-buildroom/v1',
    status: 'granted',
    createdAt: opts.now,
    producer: { role: 'operator', runId: opts.operator.id },
    room: opts.review.room,
    parentIds: [opts.review.id],
    inputRefs: [{ kind: 'artifact', ref: opts.review.id }],
    outputRefs: [],
    runtimeRefs: [],
    traceId: opts.review.traceId,
    redaction: opts.review.redaction,
    contentHash: '',
    payload,
  };
}

export function createBuildPlanArtifact(opts: CreateBuildPlanArtifactOptions): BuildroomArtifact {
  assertMainReviewApprovedForOperator(opts.review);
  assertApprovalCanBuild(opts.approval, opts.review);

  const suffix = artifactSuffix(opts.review.id, 'review');
  return {
    id: `plan_${suffix}`,
    type: 'build_plan',
    schemaVersion: 'auto-buildroom/v1',
    status: 'ready',
    createdAt: opts.now,
    producer: { role: 'orchestrator', runId: `build-plan:${opts.approval.id}` },
    room: opts.review.room,
    parentIds: [opts.approval.id, opts.review.id],
    inputRefs: [
      { kind: 'artifact', ref: opts.approval.id },
      { kind: 'artifact', ref: opts.review.id },
    ],
    outputRefs: [],
    runtimeRefs: [],
    traceId: opts.review.traceId,
    redaction: opts.review.redaction,
    contentHash: '',
    payload: {
      approvalId: opts.approval.id,
      reviewId: opts.review.id,
      scope: opts.review.payload.lockedScope,
      executionBoundary: 'not_started',
    },
  };
}

function assertMainReviewApprovedForOperator(review: BuildroomArtifact): void {
  if (review.type !== 'main_review') {
    throw new AuthorityPolicyError('Approval target must be a main_review artifact');
  }
  if (review.payload.decision !== 'approved_for_operator') {
    throw new AuthorityPolicyError('Main Review decision must be approved_for_operator');
  }
  if (!isRecord(review.payload.lockedScope)) {
    throw new AuthorityPolicyError('Main Review must include lockedScope');
  }
}

function assertApprovalCanBuild(approval: BuildroomArtifact, review: BuildroomArtifact): void {
  if (approval.type !== 'approval') {
    throw new AuthorityPolicyError('Build plan requires an approval artifact');
  }
  if (approval.status !== 'granted') {
    throw new AuthorityPolicyError('Build plan requires granted approval');
  }
  if (approval.payload.targetReviewId !== review.id) {
    throw new AuthorityPolicyError('Approval target does not match Main Review');
  }
  if (approval.payload.consumedAt) {
    throw new AuthorityPolicyError('Approval has already been consumed');
  }
}

function artifactSuffix(id: string, prefix: string): string {
  const expectedPrefix = `${prefix}_`;
  return id.startsWith(expectedPrefix) ? id.slice(expectedPrefix.length) : id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

