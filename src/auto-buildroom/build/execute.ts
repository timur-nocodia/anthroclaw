import { FileArtifactStore } from '../artifacts/store.js';
import type { BuildroomArtifact } from '../artifacts/model.js';
import { FileBuildroomLock } from '../locks/lock.js';
import { evaluatePathPolicy } from '../policy/paths.js';
import type { NativeAgentRuntimeAdapter, NativeBuilderRunResult } from '../runtime/native-agent-adapter.js';

export interface ExecuteBuildPlanOptions {
  projectRoot: string;
  roomId: string;
  planId: string;
  adapter: Pick<NativeAgentRuntimeAdapter, 'runBuilder'>;
  now: string;
}

export async function executeBuildPlan(opts: ExecuteBuildPlanOptions): Promise<BuildroomArtifact> {
  const store = new FileArtifactStore({ projectRoot: opts.projectRoot, roomId: opts.roomId });
  const plan = store.readArtifact(opts.planId);
  if (plan.type !== 'build_plan') {
    throw new Error(`Build execution requires build_plan artifact: ${opts.planId}`);
  }
  const existing = findExistingExecutionReceipt(store, plan.id);
  if (existing) return existing;

  const approvalId = String(plan.payload.approvalId ?? '');
  if (!approvalId) throw new Error(`Build plan is missing approvalId: ${plan.id}`);
  const approval = store.readArtifact(approvalId);
  const lock = new FileBuildroomLock({ projectRoot: opts.projectRoot });
  const handle = lock.acquire({
    roomId: opts.roomId,
    approvalId,
    buildPlanId: plan.id,
    owner: 'auto-buildroom:builder',
    now: opts.now,
  });

  try {
    const consumedApproval = store.writeArtifact(consumeApproval(approval, opts.now));
    const result = await opts.adapter.runBuilder({
      prompt: buildBuilderPrompt(plan),
      workingDirectory: buildWorkingDirectory(opts.projectRoot, opts.roomId, plan.id),
      allowedTools: ['Read', 'Edit'],
      idempotencyKey: handle.idempotencyKey,
      scopeSummary: JSON.stringify(plan.payload.scope ?? {}),
    });

    const artifact = result.status === 'completed'
      ? buildCoderReceipt({ plan, approval: consumedApproval, result, now: opts.now })
      : buildErrorReceipt({ plan, approval: consumedApproval, result, now: opts.now });
    return store.writeArtifact(artifact);
  } finally {
    lock.release(handle);
  }
}

function findExistingExecutionReceipt(
  store: FileArtifactStore,
  planId: string,
): BuildroomArtifact | undefined {
  return [...store.listArtifacts('coder_receipt'), ...store.listArtifacts('error_receipt')]
    .find((artifact) => artifact.parentIds.includes(planId));
}

function consumeApproval(approval: BuildroomArtifact, consumedAt: string): BuildroomArtifact {
  return {
    ...approval,
    status: 'consumed',
    payload: {
      ...approval.payload,
      consumedAt,
    },
    contentHash: '',
  };
}

function buildCoderReceipt(opts: {
  plan: BuildroomArtifact;
  approval: BuildroomArtifact;
  result: Extract<NativeBuilderRunResult, { status: 'completed' }>;
  now: string;
}): BuildroomArtifact {
  const suffix = artifactSuffix(opts.plan.id, 'plan');
  const changedFiles = stringArray(opts.result.changedFiles);
  const scope = scopePolicy(opts.plan);
  const postRunPolicyResult = evaluatePathPolicy({
    paths: changedFiles,
    allowedPaths: scope.allowedPaths,
    blockedPaths: scope.blockedPaths,
  });

  return {
    id: `build_${suffix}`,
    type: 'coder_receipt',
    schemaVersion: 'auto-buildroom/v1',
    status: 'submitted',
    createdAt: opts.now,
    producer: { role: 'builder', runId: `builder:${opts.plan.id}` },
    room: opts.plan.room,
    parentIds: [opts.plan.id, opts.approval.id],
    inputRefs: [
      { kind: 'artifact', ref: opts.plan.id },
      { kind: 'artifact', ref: opts.approval.id },
    ],
    outputRefs: [],
    runtimeRefs: opts.result.runtimeRefs,
    traceId: opts.plan.traceId,
    redaction: opts.plan.redaction,
    contentHash: '',
    payload: {
      runtimeStatus: 'completed',
      builderClaims: [opts.result.resultText],
      preRunPolicyResult: {
        allowed: true,
        violations: [],
      },
      postRunPolicyResult: {
        ...postRunPolicyResult,
        changedFiles,
      },
    },
  };
}

function scopePolicy(plan: BuildroomArtifact): { allowedPaths: string[]; blockedPaths: string[] } {
  const scope = plan.payload.scope;
  const record = scope && typeof scope === 'object' && !Array.isArray(scope)
    ? scope as Record<string, unknown>
    : {};
  return {
    allowedPaths: stringArray(record.allowedPaths),
    blockedPaths: stringArray(record.blockedPaths),
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function buildErrorReceipt(opts: {
  plan: BuildroomArtifact;
  approval: BuildroomArtifact;
  result: Extract<NativeBuilderRunResult, { status: 'failed' }>;
  now: string;
}): BuildroomArtifact {
  const suffix = artifactSuffix(opts.plan.id, 'plan');
  return {
    id: `error_${suffix}`,
    type: 'error_receipt',
    schemaVersion: 'auto-buildroom/v1',
    status: 'failed',
    createdAt: opts.now,
    producer: { role: 'orchestrator', runId: `builder:${opts.plan.id}` },
    room: opts.plan.room,
    parentIds: [opts.plan.id, opts.approval.id],
    inputRefs: [
      { kind: 'artifact', ref: opts.plan.id },
      { kind: 'artifact', ref: opts.approval.id },
    ],
    outputRefs: [],
    runtimeRefs: opts.result.runtimeRefs,
    traceId: opts.plan.traceId,
    redaction: opts.plan.redaction,
    contentHash: '',
    payload: {
      stage: 'builder',
      targetArtifactId: opts.plan.id,
      errorType: opts.result.errorType,
      message: opts.result.message,
      recoverable: true,
      retryAllowed: true,
    },
  };
}

function buildBuilderPrompt(plan: BuildroomArtifact): string {
  return [
    'Execute the approved Auto-Buildroom build plan.',
    'Do not expand scope.',
    `Build plan: ${plan.id}`,
    `Scope: ${JSON.stringify(plan.payload.scope ?? {})}`,
  ].join('\n');
}

function buildWorkingDirectory(projectRoot: string, roomId: string, planId: string): string {
  return `${projectRoot}/.anthroclaw/auto-buildroom/rooms/${roomId}/worktrees/${planId}`;
}

function artifactSuffix(id: string, prefix: string): string {
  const expectedPrefix = `${prefix}_`;
  return id.startsWith(expectedPrefix) ? id.slice(expectedPrefix.length) : id;
}
