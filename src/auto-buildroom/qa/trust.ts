import type { BuildroomArtifact } from '../artifacts/model.js';

export type QaEvidenceStatus = 'confirmed' | 'rejected' | 'not_in_scope';

export interface QaEvidenceItem {
  claim: string;
  status: QaEvidenceStatus;
}

export interface CreateQaReportArtifactOptions {
  build: BuildroomArtifact;
  now: string;
  evidence: QaEvidenceItem[];
}

export interface CreateVerificationDeltaArtifactOptions {
  build: BuildroomArtifact;
  qa: BuildroomArtifact;
  now: string;
}

export interface CreateTrustReportArtifactOptions {
  build: BuildroomArtifact;
  qa: BuildroomArtifact;
  delta: BuildroomArtifact;
  now: string;
}

type DeltaStatus = QaEvidenceStatus | 'missing_evidence';
type TrustState = 'clean' | 'watch' | 'investigate' | 'blocked';

export function createQaReportArtifact(opts: CreateQaReportArtifactOptions): BuildroomArtifact {
  assertArtifactType(opts.build, 'coder_receipt');
  const suffix = artifactSuffix(opts.build.id, 'build');
  return {
    id: `qa_${suffix}`,
    type: 'qa_report',
    schemaVersion: 'auto-buildroom/v1',
    status: 'submitted',
    createdAt: opts.now,
    producer: { role: 'qa', runId: `qa:${opts.build.id}` },
    room: opts.build.room,
    parentIds: [opts.build.id],
    inputRefs: [{ kind: 'artifact', ref: opts.build.id }],
    outputRefs: [],
    runtimeRefs: [],
    traceId: opts.build.traceId,
    redaction: opts.build.redaction,
    contentHash: '',
    payload: {
      qaStatus: opts.evidence.every((item) => item.status === 'confirmed') ? 'pass' : 'fail',
      evidence: opts.evidence,
    },
  };
}

export function createVerificationDeltaArtifact(
  opts: CreateVerificationDeltaArtifactOptions,
): BuildroomArtifact {
  assertArtifactType(opts.build, 'coder_receipt');
  assertArtifactType(opts.qa, 'qa_report');

  const suffix = artifactSuffix(opts.build.id, 'build');
  const evidenceByClaim = new Map(
    qaEvidence(opts.qa).map((item) => [item.claim, item.status] as const),
  );
  const claimComparisons = builderClaims(opts.build).map((claim) => ({
    claim,
    status: evidenceByClaim.get(claim) ?? 'missing_evidence' as DeltaStatus,
    criticality: 'medium',
  }));

  return {
    id: `delta_${suffix}`,
    type: 'verification_delta',
    schemaVersion: 'auto-buildroom/v1',
    status: 'completed',
    createdAt: opts.now,
    producer: { role: 'delta', runId: `delta:${opts.build.id}` },
    room: opts.build.room,
    parentIds: [opts.qa.id, opts.build.id],
    inputRefs: [
      { kind: 'artifact', ref: opts.qa.id },
      { kind: 'artifact', ref: opts.build.id },
    ],
    outputRefs: [],
    runtimeRefs: [],
    traceId: opts.build.traceId,
    redaction: opts.build.redaction,
    contentHash: '',
    payload: {
      claimComparisons,
      qaOnlyFindings: [],
    },
  };
}

export function createTrustReportArtifact(opts: CreateTrustReportArtifactOptions): BuildroomArtifact {
  assertArtifactType(opts.build, 'coder_receipt');
  assertArtifactType(opts.qa, 'qa_report');
  assertArtifactType(opts.delta, 'verification_delta');

  const suffix = artifactSuffix(opts.build.id, 'build');
  const reasons: string[] = [];
  const postRunPolicyResult = opts.build.payload.postRunPolicyResult as
    | { allowed?: boolean }
    | undefined;

  if (postRunPolicyResult?.allowed === false) {
    reasons.push('post-run policy violation');
  }
  if (claimComparisons(opts.delta).some((comparison) => comparison.status === 'missing_evidence')) {
    reasons.push('missing claim evidence');
  }
  if (claimComparisons(opts.delta).some((comparison) => comparison.status === 'rejected')) {
    reasons.push('rejected claim evidence');
  }

  const trustState = deriveTrustState(reasons);
  return {
    id: `trust_${suffix}`,
    type: 'trust_report',
    schemaVersion: 'auto-buildroom/v1',
    status: trustState,
    createdAt: opts.now,
    producer: { role: 'trust', runId: `trust:${opts.build.id}` },
    room: opts.build.room,
    parentIds: [opts.delta.id, opts.qa.id, opts.build.id],
    inputRefs: [
      { kind: 'artifact', ref: opts.delta.id },
      { kind: 'artifact', ref: opts.qa.id },
      { kind: 'artifact', ref: opts.build.id },
    ],
    outputRefs: [],
    runtimeRefs: [],
    traceId: opts.build.traceId,
    redaction: opts.build.redaction,
    contentHash: '',
    payload: {
      trustState,
      reasons,
      policyResultRefs: [`${opts.build.id}#preRunPolicyResult`, `${opts.build.id}#postRunPolicyResult`],
    },
  };
}

function deriveTrustState(reasons: string[]): TrustState {
  if (reasons.includes('post-run policy violation')) return 'blocked';
  if (reasons.length > 0) return 'investigate';
  return 'clean';
}

function builderClaims(build: BuildroomArtifact): string[] {
  return Array.isArray(build.payload.builderClaims)
    ? build.payload.builderClaims.filter((claim): claim is string => typeof claim === 'string')
    : [];
}

function qaEvidence(qa: BuildroomArtifact): QaEvidenceItem[] {
  return Array.isArray(qa.payload.evidence)
    ? qa.payload.evidence.filter(isQaEvidenceItem)
    : [];
}

function claimComparisons(delta: BuildroomArtifact): Array<{ claim: string; status: DeltaStatus }> {
  return Array.isArray(delta.payload.claimComparisons)
    ? delta.payload.claimComparisons.filter(isClaimComparison)
    : [];
}

function isQaEvidenceItem(value: unknown): value is QaEvidenceItem {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as QaEvidenceItem).claim === 'string' &&
      ['confirmed', 'rejected', 'not_in_scope'].includes((value as QaEvidenceItem).status),
  );
}

function isClaimComparison(value: unknown): value is { claim: string; status: DeltaStatus } {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as { claim?: unknown }).claim === 'string' &&
      ['confirmed', 'rejected', 'not_in_scope', 'missing_evidence'].includes(
        (value as { status?: string }).status ?? '',
      ),
  );
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

