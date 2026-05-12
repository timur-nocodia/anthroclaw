import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { FileArtifactStore } from '../artifacts/store.js';
import type { BuildroomArtifact } from '../artifacts/model.js';
import { FileBuildroomLock } from '../locks/lock.js';
import { evaluatePathPolicy, normalizeRepoPath } from '../policy/paths.js';
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
    const preRunPolicyResult = evaluatePreRunPolicy(plan);
    if (!preRunPolicyResult.allowed) {
      return store.writeArtifact(
        buildPolicyErrorReceipt({ plan, approval, policyResult: preRunPolicyResult, now: opts.now }),
      );
    }

    const consumedApproval = store.writeArtifact(consumeApproval(approval, opts.now));
    const workingDirectory = buildWorkingDirectory(opts.projectRoot, opts.roomId, plan.id);
    mkdirSync(workingDirectory, { recursive: true });
    prepareWorkingDirectory(opts.projectRoot, workingDirectory, plan);
    const baseline = snapshotDirectory(workingDirectory);
    const result = await opts.adapter.runBuilder({
      prompt: buildBuilderPrompt(plan),
      workingDirectory,
      allowedTools: ['Read', 'Edit'],
      idempotencyKey: handle.idempotencyKey,
      scopeSummary: JSON.stringify(plan.payload.scope ?? {}),
    });
    const changedFiles = diffSnapshot(workingDirectory, baseline);
    const changedSymlinks = listSymlinks(workingDirectory)
      .filter((path) => changedFiles.includes(path));

    const artifact = result.status === 'completed'
      ? buildCoderReceipt({
          plan,
          approval: consumedApproval,
          result,
          changedFiles,
          changedSymlinks,
          preRunPolicyResult,
          now: opts.now,
        })
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
  changedFiles: string[];
  changedSymlinks: string[];
  preRunPolicyResult: PathScopePolicyResult;
  now: string;
}): BuildroomArtifact {
  const suffix = artifactSuffix(opts.plan.id, 'plan');
  const changedFiles = uniqueStrings([
    ...stringArray(opts.result.changedFiles),
    ...opts.changedFiles,
  ]);
  const scope = scopePolicy(opts.plan);
  const postRunPolicyResult = evaluatePathPolicy({
    paths: changedFiles,
    allowedPaths: scope.allowedPaths,
    blockedPaths: scope.blockedPaths,
  });
  const symlinkViolations = opts.changedSymlinks.map((path) => ({
    path,
    reason: 'symlink' as const,
  }));

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
      preRunPolicyResult: opts.preRunPolicyResult,
      postRunPolicyResult: {
        ...postRunPolicyResult,
        allowed: postRunPolicyResult.allowed && symlinkViolations.length === 0,
        changedFiles,
        violations: [...postRunPolicyResult.violations, ...symlinkViolations],
      },
    },
  };
}

interface PathScopePolicyResult {
  allowed: boolean;
  checkedPaths: string[];
  violations: Array<{ path: string; reason: 'path_escape' }>;
}

function evaluatePreRunPolicy(plan: BuildroomArtifact): PathScopePolicyResult {
  const scope = scopePolicy(plan);
  const checkedPaths: string[] = [];
  const violations: Array<{ path: string; reason: 'path_escape' }> = [];

  for (const path of [...scope.allowedPaths, ...scope.blockedPaths]) {
    try {
      checkedPaths.push(normalizeRepoPath(path));
    } catch {
      violations.push({ path, reason: 'path_escape' });
    }
  }

  return {
    allowed: violations.length === 0,
    checkedPaths,
    violations,
  };
}

function prepareWorkingDirectory(
  projectRoot: string,
  workingDirectory: string,
  plan: BuildroomArtifact,
): void {
  const scope = scopePolicy(plan);
  for (const file of listProjectFiles(projectRoot)) {
    const policy = evaluatePathPolicy({
      paths: [file],
      allowedPaths: scope.allowedPaths,
      blockedPaths: scope.blockedPaths,
    });
    if (!policy.allowed) continue;

    const target = join(workingDirectory, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(projectRoot, file), target);
  }
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function snapshotDirectory(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  if (!existsSync(root)) return snapshot;
  for (const file of listFiles(root)) {
    const path = join(root, file);
    const stats = lstatSync(path);
    snapshot.set(
      file,
      stats.isSymbolicLink()
        ? `symlink:${readlinkSync(path)}`
        : readFileSync(path).toString('base64'),
    );
  }
  return snapshot;
}

function diffSnapshot(root: string, before: Map<string, string>): string[] {
  const changed = new Set<string>();
  const after = snapshotDirectory(root);

  for (const [file, hash] of after) {
    if (before.get(file) !== hash) changed.add(file);
  }
  for (const file of before.keys()) {
    if (!after.has(file)) changed.add(file);
  }

  return [...changed].sort();
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) return files;

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      files.push(entry);
      continue;
    }
    if (stats.isDirectory()) {
      for (const nested of listFiles(path)) files.push(join(entry, nested));
    } else if (stats.isFile()) {
      files.push(relative(root, path));
    }
  }

  return files;
}

function listSymlinks(root: string): string[] {
  const symlinks: string[] = [];
  if (!existsSync(root)) return symlinks;

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      symlinks.push(entry);
    } else if (stats.isDirectory()) {
      for (const nested of listSymlinks(path)) symlinks.push(join(entry, nested));
    }
  }

  return symlinks;
}

function listProjectFiles(root: string): string[] {
  return listFilesSkipping(root, root);
}

function listFilesSkipping(root: string, current: string): string[] {
  const files: string[] = [];
  if (!existsSync(current)) return files;

  for (const entry of readdirSync(current)) {
    if (SKIPPED_PROJECT_DIRS.has(entry)) continue;
    const path = join(current, entry);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      files.push(...listFilesSkipping(root, path));
    } else if (stats.isFile()) {
      files.push(relative(root, path));
    }
  }

  return files;
}

const SKIPPED_PROJECT_DIRS = new Set([
  '.anthroclaw',
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
]);

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

function buildPolicyErrorReceipt(opts: {
  plan: BuildroomArtifact;
  approval: BuildroomArtifact;
  policyResult: PathScopePolicyResult;
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
    runtimeRefs: [],
    traceId: opts.plan.traceId,
    redaction: opts.plan.redaction,
    contentHash: '',
    payload: {
      stage: 'builder',
      targetArtifactId: opts.plan.id,
      errorType: 'policy_violation',
      message: 'Build plan failed pre-run path policy validation',
      preRunPolicyResult: opts.policyResult,
      recoverable: false,
      retryAllowed: false,
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
