#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
  ArtifactHashMismatchError,
  FileArtifactStore,
} from '../auto-buildroom/artifacts/store.js';
import { executeBuildPlan } from '../auto-buildroom/build/execute.js';
import {
  type BuildroomConfig,
  BuildroomConfigValidationError,
} from '../auto-buildroom/config/model.js';
import {
  AuthorityPolicyError,
  createApprovalArtifact,
  createBuildPlanArtifact,
} from '../auto-buildroom/policy/authority.js';
import {
  BuildroomConfigExistsError,
  initializeBuildroomStorage,
  loadBuildroomRoomConfig,
  roomRoot,
  saveBuildroomRoomConfig,
} from '../auto-buildroom/storage/init.js';
import { formatBuildroomLifecycleNotification } from '../auto-buildroom/notifications/lifecycle.js';
import {
  createQaReportArtifact,
  createTrustReportArtifact,
  createVerificationDeltaArtifact,
} from '../auto-buildroom/qa/trust.js';
import { createRetentionReviewArtifact } from '../auto-buildroom/retention/retention.js';
import {
  createDeterministicIdeaContract,
  createDeterministicMainReview,
  createDeterministicResearchPacket,
} from '../auto-buildroom/workflow/deterministic.js';
import { NativeAgentRuntimeAdapter } from '../auto-buildroom/runtime/native-agent-adapter.js';
import { redactSecrets } from '../security/redact.js';
import type { BuildroomArtifact, BuildroomArtifactType } from '../auto-buildroom/artifacts/model.js';
import type { NativeBuilderRunResult } from '../auto-buildroom/runtime/native-agent-adapter.js';

interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface ParsedArgs {
  command?: string;
  root: string;
  room?: string;
  operator?: string;
  telegramCommandRoutes: string[];
  telegramApprovalRoutes: string[];
  telegramNotificationRoutes: string[];
  flags: Set<string>;
  positional: string[];
}

export interface BuildroomCliDependencies {
  builderAdapter?: {
    runBuilder(
      input: Parameters<NativeAgentRuntimeAdapter['runBuilder']>[0],
    ): Promise<NativeBuilderRunResult>;
  };
  notify?: (notification: { routes: string[]; text: string }) => Promise<void>;
  now?: () => string;
}

const defaultIO: CliIO = {
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
};

export async function runBuildroomCli(
  argv: string[],
  io: CliIO = defaultIO,
  deps: BuildroomCliDependencies = {},
): Promise<number> {
  const args = parseArgs(argv);
  const commandIO = commandOutputIO(args, io);
  if (!args.command || args.command === 'help' || args.command === '--help') {
    commandIO.stdout(helpText());
    return 0;
  }

  try {
    switch (args.command) {
      case 'init':
        return commandInit(args, commandIO);
      case 'status':
        return commandStatus(args, commandIO);
      case 'validate':
        return commandValidate(args, commandIO);
      case 'collect':
        return commandCollect(args, commandIO);
      case 'propose':
        return commandPropose(args, commandIO);
      case 'review':
        return commandReview(args, commandIO);
      case 'show':
        return commandShow(args, commandIO);
      case 'reject':
        return commandReject(args, commandIO);
      case 'approve':
        return commandApprove(args, commandIO);
      case 'build':
        return await commandBuild(args, commandIO, deps);
      case 'qa':
        return await commandQa(args, commandIO, deps);
      case 'trust':
        return await commandTrust(args, commandIO, deps);
      case 'report':
        return commandReport(args, commandIO);
      case 'retain':
        return await commandRetain(args, commandIO, deps);
      case 'pause':
        return commandPause(args, commandIO);
      case 'resume':
        return commandResume(args, commandIO);
      default:
        commandIO.stderr(`Unknown command: ${args.command}`);
        commandIO.stderr(helpText());
        return 2;
    }
  } catch (error) {
    return handleError(error, args, io);
  }
}

function commandInit(args: ParsedArgs, io: CliIO): number {
  const result = initializeBuildroomStorage({
    projectRoot: args.root,
    roomId: args.room ?? 'anthroclaw-core',
    operatorId: args.operator ?? 'cli:user:local-operator',
  });
  if (
    args.telegramCommandRoutes.length > 0 ||
    args.telegramApprovalRoutes.length > 0 ||
    args.telegramNotificationRoutes.length > 0
  ) {
    const operator = result.config.operators[0];
    operator.commandRoutes = uniqueRoutes([
      ...operator.commandRoutes,
      ...args.telegramCommandRoutes,
    ]);
    operator.approvalRoutes = uniqueRoutes([
      ...operator.approvalRoutes,
      ...args.telegramApprovalRoutes,
    ]);
    result.config.notifications.routes = uniqueRoutes([
      ...result.config.notifications.routes,
      ...args.telegramNotificationRoutes,
    ]);
    saveBuildroomRoomConfig(args.root, result.config);
  }

  io.stdout([
    'Buildroom initialized',
    '',
    `Room: ${result.config.roomId}`,
    `Root: ${result.roomRoot}`,
    `Mode: ${result.config.mode}`,
    `Session watching: ${result.config.watch.sessions.enabled ? 'on' : 'off'}`,
    `External side effects: ${result.config.external.sideEffects.default === 'deny' ? 'denied' : 'allowed'}`,
    '',
    'Next:',
    'anthroclaw buildroom collect',
  ].join('\n'));
  return 0;
}

function commandStatus(args: ParsedArgs, io: CliIO): number {
  const config = loadBuildroomRoomConfig(args.root, args.room);
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const counts = deriveStatusCounts(store);
  const state = deriveRoomState(config, counts);
  const latestTrust = latestOptionalArtifact(store, 'trust_report');

  if (wantsJson(args)) {
    writeJson(io.stdout, {
      ok: true,
      command: 'status',
      roomId: config.roomId,
      state: statusJsonState(config, counts, state, latestTrust),
      artifacts: latestTrust ? [artifactSummary(latestTrust)] : [],
      nextActions: ['anthroclaw buildroom collect'],
    });
    return 0;
  }

  io.stdout([
    `Buildroom: ${config.roomId}`,
    `Mode: ${config.mode}`,
    `Paused: ${config.paused ? 'yes' : 'no'}`,
    `State: ${state}`,
    `Latest trust: ${String(latestTrust?.payload.trustState ?? 'none')}`,
    `Kill switch: ${config.killSwitchActive ? 'active' : 'inactive'}`,
    '',
    `Pending approvals: ${counts.pendingApprovals}`,
    `Approved not built: ${counts.approvedNotBuilt}`,
    `Active builds: ${counts.activeBuilds}`,
    `QA pending: ${counts.qaPending}`,
    `Unresolved errors: ${counts.unresolvedErrors}`,
    '',
    'Next:',
    'anthroclaw buildroom collect',
  ].join('\n'));
  return 0;
}

function commandValidate(args: ParsedArgs, io: CliIO): number {
  const config = loadBuildroomRoomConfig(args.root, args.room);
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const artifacts = store.listArtifacts();
  validateParentRefs(artifacts);
  validateOutputRefs(args.root, artifacts);

  io.stdout([
    'Buildroom validation: ok',
    `Room: ${config.roomId}`,
    `Artifacts checked: ${artifacts.length}`,
  ].join('\n'));
  return 0;
}

function validateParentRefs(artifacts: BuildroomArtifact[]): void {
  const ids = new Set(artifacts.map((artifact) => artifact.id));
  for (const artifact of artifacts) {
    for (const parentId of artifact.parentIds) {
      if (!ids.has(parentId)) throw new MissingArtifactParentError(artifact.id, parentId);
    }
  }
}

function validateOutputRefs(projectRoot: string, artifacts: BuildroomArtifact[]): void {
  for (const artifact of artifacts) {
    for (const ref of artifact.outputRefs) {
      if (ref.kind !== 'file' || !ref.hash) continue;
      const path = resolveOutputRefPath(projectRoot, artifact, ref.ref);
      if (!existsSync(path) || !lstatSync(path).isFile()) {
        throw new OutputRefHashMismatchError(artifact.id, ref.ref);
      }
      const actual = sha256(readFileSync(path));
      if (actual !== ref.hash) throw new OutputRefHashMismatchError(artifact.id, ref.ref);
    }
  }
}

function resolveOutputRefPath(
  projectRoot: string,
  artifact: BuildroomArtifact,
  ref: string,
): string {
  if (isAbsolute(ref)) return ref;
  const workingDirectory = artifact.payload.workingDirectory;
  if (typeof workingDirectory === 'string') return join(workingDirectory, ref);
  return join(projectRoot, ref);
}

function deriveStatusCounts(store: FileArtifactStore): {
  pendingApprovals: number;
  approvedNotBuilt: number;
  activeBuilds: number;
  qaPending: number;
  trustPending: number;
  unresolvedErrors: number;
  complete: number;
} {
  const reviews = store.listArtifacts('main_review');
  const approvals = store.listArtifacts('approval');
  const decisions = store.listArtifacts('operator_decision');
  const plans = store.listArtifacts('build_plan');
  const builds = store.listArtifacts('coder_receipt');
  const qaReports = store.listArtifacts('qa_report');
  const trustReports = store.listArtifacts('trust_report');
  const errors = store.listArtifacts('error_receipt');

  const approvedReviewIds = new Set(
    approvals.map((approval) => String(approval.payload.targetReviewId ?? '')),
  );
  const rejectedReviewIds = new Set(
    decisions
      .filter((decision) => decision.payload.decision === 'reject')
      .map((decision) => String(decision.payload.targetArtifactId ?? '')),
  );
  const plannedApprovalIds = new Set(
    plans.map((plan) => String(plan.payload.approvalId ?? '')),
  );
  const qaBuildIds = new Set(qaReports.flatMap((qa) => qa.parentIds));
  const trustBuildIds = new Set(trustReports.flatMap((trust) => trust.parentIds));

  return {
    pendingApprovals: reviews.filter(
      (review) =>
        review.payload.decision === 'approved_for_operator' &&
        !approvedReviewIds.has(review.id) &&
        !rejectedReviewIds.has(review.id),
    ).length,
    approvedNotBuilt: approvals.filter(
      (approval) =>
        approval.status === 'granted' &&
        !approval.payload.consumedAt &&
        !plannedApprovalIds.has(approval.id),
    ).length,
    activeBuilds: builds.filter((build) => build.payload.runtimeStatus === 'running').length,
    qaPending: builds.filter((build) => !qaBuildIds.has(build.id)).length,
    trustPending: builds.filter(
      (build) => qaBuildIds.has(build.id) && !trustBuildIds.has(build.id),
    ).length,
    unresolvedErrors: errors.filter((error) => error.status !== 'resolved').length,
    complete: trustReports.length,
  };
}

function deriveRoomState(
  config: { mode: string; paused?: boolean; killSwitchActive: boolean },
  counts: ReturnType<typeof deriveStatusCounts>,
): string {
  if (config.killSwitchActive) return 'blocked';
  if (counts.unresolvedErrors > 0) return 'blocked';
  if (config.paused) return 'paused';
  if (counts.activeBuilds > 0) return 'building';
  if (counts.qaPending > 0) return 'qa_pending';
  if (counts.trustPending > 0) return 'trust_pending';
  if (counts.approvedNotBuilt > 0) return 'approved';
  if (counts.pendingApprovals > 0) return 'awaiting_approval';
  if (counts.complete > 0) return 'complete';
  return config.mode === 'off' ? 'blocked' : 'idle';
}

function commandCollect(args: ParsedArgs, io: CliIO): number {
  const config = loadBuildroomRoomConfig(args.root, args.room);
  assertStageAllowed(config, 'collect');
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const research = store.writeArtifact(
    createDeterministicResearchPacket(config, new Date().toISOString()),
  );

  io.stdout([
    `Research packet: ${research.id}`,
    '',
    'Research observes. It does not decide.',
    '',
    'Next:',
    'anthroclaw buildroom propose',
  ].join('\n'));
  return 0;
}

function commandPropose(args: ParsedArgs, io: CliIO): number {
  const config = loadBuildroomRoomConfig(args.root, args.room);
  assertStageAllowed(config, 'propose');
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const research = latestArtifact(store, 'research_packet');
  const idea = store.writeArtifact(
    createDeterministicIdeaContract(research, new Date().toISOString()),
  );

  io.stdout([
    `Idea contract: ${idea.id}`,
    '',
    'Idea is not approval.',
    '',
    'Next:',
    `anthroclaw buildroom review ${idea.id}`,
  ].join('\n'));
  return 0;
}

function commandReview(args: ParsedArgs, io: CliIO): number {
  const id = requirePositional(args, 0, 'review');
  const config = loadBuildroomRoomConfig(args.root, args.room);
  assertStageAllowed(config, 'review');
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const idea = store.readArtifact(id);
  const review = store.writeArtifact(
    createDeterministicMainReview(idea, config, new Date().toISOString()),
  );

  io.stdout([
    `Main review: ${review.id}`,
    `Decision: ${String(review.payload.decision)}`,
    '',
    'Review locks scope. It does not approve or build.',
    '',
    'Next:',
    `anthroclaw buildroom approve ${review.id}`,
  ].join('\n'));
  return 0;
}

function commandShow(args: ParsedArgs, io: CliIO): number {
  const id = requirePositional(args, 0, 'show');
  const config = loadBuildroomRoomConfig(args.root, args.room);
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const artifact = store.readArtifact(id);

  if (wantsJson(args)) {
    writeJson(io.stdout, {
      ok: true,
      command: 'show',
      roomId: config.roomId,
      artifact,
    });
    return 0;
  }

  io.stdout([
    `Receipt: ${artifact.id}`,
    `Type: ${artifact.type}`,
    `Status: ${artifact.status}`,
    `Room: ${artifact.room.id}`,
    `Trace: ${artifact.traceId}`,
    `Parents: ${artifact.parentIds.length ? artifact.parentIds.join(', ') : 'none'}`,
  ].join('\n'));
  return 0;
}

function commandApprove(args: ParsedArgs, io: CliIO): number {
  const id = requirePositional(args, 0, 'approve');
  const config = loadBuildroomRoomConfig(args.root, args.room);
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const review = store.readArtifact(id);
  if (findRejectionForTarget(store, review.id)) {
    throw new AuthorityPolicyError('Artifact was rejected by operator');
  }
  const approval = store.writeArtifact(
    createApprovalArtifact({
      review,
      operator: { id: args.operator ?? firstOperator(config), route: 'cli:local' },
      now: new Date().toISOString(),
    }),
  );

  io.stdout([
    `Approval created: ${approval.id}`,
    '',
    'Approval grants authority. Build consumes authority.',
    'Approving a proposal does not execute it by itself in v0.1.',
    '',
    'Next:',
    `anthroclaw buildroom build ${approval.id}`,
  ].join('\n'));
  return 0;
}

function commandReject(args: ParsedArgs, io: CliIO): number {
  const id = requirePositional(args, 0, 'reject');
  const config = loadBuildroomRoomConfig(args.root, args.room);
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const target = store.readArtifact(id);
  const existing = findRejectionForTarget(store, target.id);
  const decision = existing ?? store.writeArtifact(
    createOperatorDecisionArtifact({
      target,
      operatorId: args.operator ?? firstOperator(config),
      route: 'cli:local',
      now: new Date().toISOString(),
    }),
  );

  io.stdout([
    `Rejected: ${target.id}`,
    `Receipt: ${decision.id}`,
    '',
    'Reject records an operator decision. It does not delete receipts.',
  ].join('\n'));
  return 0;
}

async function commandBuild(
  args: ParsedArgs,
  io: CliIO,
  deps: BuildroomCliDependencies,
): Promise<number> {
  const id = requirePositional(args, 0, 'build');
  const config = loadBuildroomRoomConfig(args.root, args.room);
  assertStageAllowed(config, 'build');
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const target = store.readArtifact(id);

  if (target.type === 'build_plan') {
    if (args.flags.has('execute')) {
      return executeAndReportBuildPlan(args, io, deps, config.roomId, target.id);
    }
    io.stdout([
      `Existing build plan: ${target.id}`,
      '',
      'Builder runtime not started.',
    ].join('\n'));
    return 0;
  }

  if (target.type !== 'approval') {
    throw new AuthorityPolicyError('Build requires an approval or build_plan artifact');
  }

  const existing = findBuildPlanForApproval(store, target.id);
  if (existing) {
    if (args.flags.has('execute')) {
      return executeAndReportBuildPlan(args, io, deps, config.roomId, existing.id);
    }
    io.stdout([
      `Existing build plan: ${existing.id}`,
      '',
      'Builder runtime not started.',
    ].join('\n'));
    return 0;
  }

  const reviewId = String(target.payload.targetReviewId ?? '');
  if (!reviewId) throw new AuthorityPolicyError('Approval is missing target review');
  const review = store.readArtifact(reviewId);
  const plan = store.writeArtifact(
    createBuildPlanArtifact({
      approval: target,
      review,
      now: nowIso(deps),
    }),
  );

  if (args.flags.has('execute')) {
    return executeAndReportBuildPlan(args, io, deps, config.roomId, plan.id);
  }

  io.stdout([
    `Build plan: ${plan.id}`,
    '',
    'Builder runtime not started.',
    'Approval is not consumed until the execution boundary.',
    '',
    'Next:',
    `anthroclaw buildroom show ${plan.id}`,
  ].join('\n'));
  return 0;
}

async function executeAndReportBuildPlan(
  args: ParsedArgs,
  io: CliIO,
  deps: BuildroomCliDependencies,
  roomId: string,
  planId: string,
): Promise<number> {
  const receipt = await executeBuildPlan({
    projectRoot: args.root,
    roomId,
    planId,
    adapter: deps.builderAdapter ?? new NativeAgentRuntimeAdapter(),
    now: nowIso(deps),
  });

  if (receipt.type === 'coder_receipt') {
    io.stdout([
      `Builder receipt: ${receipt.id}`,
      `Runtime: ${String(receipt.payload.runtimeStatus ?? 'completed')}`,
      '',
      'Build consumed approval at the execution boundary.',
      '',
      'Next:',
      `anthroclaw buildroom qa ${receipt.id}`,
    ].join('\n'));
    await notifyLifecycle(deps, args.root, roomId, receipt);
    return 0;
  }

  io.stdout([
    `Builder error: ${receipt.id}`,
    `Status: ${receipt.status}`,
    '',
    'Build consumed approval at the execution boundary.',
    '',
    'Next:',
    `anthroclaw buildroom show ${receipt.id}`,
  ].join('\n'));
  await notifyLifecycle(deps, args.root, roomId, receipt);
  return 6;
}

async function commandQa(
  args: ParsedArgs,
  io: CliIO,
  deps: BuildroomCliDependencies,
): Promise<number> {
  const id = requirePositional(args, 0, 'qa');
  const config = loadBuildroomRoomConfig(args.root, args.room);
  assertStageAllowed(config, 'qa');
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const build = store.readArtifact(id);
  if (build.type !== 'coder_receipt') {
    throw new AuthorityPolicyError('QA requires a coder_receipt artifact');
  }

  const existing = findChildArtifact(store, 'qa_report', build.id);
  const created = existing == null;
  const qa = existing ?? store.writeArtifact(
    createQaReportArtifact({
      build,
      now: new Date().toISOString(),
      evidence: builderClaims(build).map((claim) => ({ claim, status: 'confirmed' })),
    }),
  );

  io.stdout([
    `QA report: ${qa.id}`,
    `Status: ${String(qa.payload.qaStatus)}`,
    '',
    'QA evidence is not final trust.',
    '',
    'Next:',
    `anthroclaw buildroom trust ${build.id}`,
  ].join('\n'));
  if (created) await notifyLifecycle(deps, args.root, config.roomId, qa);
  return 0;
}

async function commandTrust(
  args: ParsedArgs,
  io: CliIO,
  deps: BuildroomCliDependencies,
): Promise<number> {
  const id = requirePositional(args, 0, 'trust');
  const config = loadBuildroomRoomConfig(args.root, args.room);
  assertStageAllowed(config, 'trust');
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const build = store.readArtifact(id);
  if (build.type !== 'coder_receipt') {
    throw new AuthorityPolicyError('Trust requires a coder_receipt artifact');
  }

  const qa = findChildArtifact(store, 'qa_report', build.id);
  if (!qa) throw new Error(`QA report not found for ${build.id}`);

  const existingTrust = findChildArtifact(store, 'trust_report', build.id);
  const created = existingTrust == null;
  const trust = existingTrust ?? createAndStoreTrustArtifacts(store, build, qa);

  io.stdout([
    `Trust report: ${trust.id}`,
    `Trust: ${String(trust.payload.trustState).toUpperCase()}`,
    '',
    'Trust tells the operator what is actually proven.',
  ].join('\n'));
  if (created) await notifyLifecycle(deps, args.root, config.roomId, trust);
  return 0;
}

function commandReport(args: ParsedArgs, io: CliIO): number {
  const config = loadBuildroomRoomConfig(args.root, args.room);
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const trust = latestArtifact(store, 'trust_report');
  const report = renderTrustReport(trust);
  let summary: BuildroomArtifact | undefined;

  if (args.flags.has('save')) {
    summary = store.writeArtifact(
      createOperatorSummaryArtifact({
        projectRoot: args.root,
        roomId: config.roomId,
        trust,
        report,
        now: new Date().toISOString(),
      }),
    );
    writeRenderedReport(summary, report);
  }

  if (wantsJson(args)) {
    writeJson(io.stdout, {
      ok: true,
      command: 'report',
      roomId: config.roomId,
      state: {
        trustState: String(trust.payload.trustState ?? 'blocked'),
      },
      artifacts: [
        artifactSummary(trust),
        ...(summary ? [artifactSummary(summary)] : []),
      ],
      report,
    });
    return 0;
  }

  io.stdout(report);
  return 0;
}

async function commandRetain(
  args: ParsedArgs,
  io: CliIO,
  deps: BuildroomCliDependencies,
): Promise<number> {
  const config = loadBuildroomRoomConfig(args.root, args.room);
  assertStageAllowed(config, 'retain');
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const trust = args.positional[0]
    ? store.readArtifact(args.positional[0])
    : latestArtifact(store, 'trust_report');
  if (trust.type !== 'trust_report') {
    throw new AuthorityPolicyError('Retention requires a trust_report artifact');
  }

  const existing = findChildArtifact(store, 'retention_review', trust.id);
  const created = existing == null;
  const retention = existing ?? store.writeArtifact(
    createRetentionReviewArtifact({
      trust,
      now: new Date().toISOString(),
    }),
  );

  io.stdout([
    `Retention review: ${retention.id}`,
    `Recommendation: ${String(retention.payload.recommendation)}`,
    `Follow-up needed: ${retention.payload.followUpNeeded === true ? 'yes' : 'no'}`,
    'Destructive cleanup: not allowed',
    '',
    'Retention recommends lifecycle treatment. It does not erase audit evidence.',
  ].join('\n'));
  if (created) await notifyLifecycle(deps, args.root, config.roomId, retention);
  return 0;
}

function commandPause(args: ParsedArgs, io: CliIO): number {
  const config = loadBuildroomRoomConfig(args.root, args.room);
  saveBuildroomRoomConfig(args.root, { ...config, paused: true });

  io.stdout([
    'Buildroom paused',
    `Room: ${config.roomId}`,
    '',
    'Paused blocks new stages. Status and receipt inspection remain available.',
  ].join('\n'));
  return 0;
}

function commandResume(args: ParsedArgs, io: CliIO): number {
  const config = loadBuildroomRoomConfig(args.root, args.room);
  saveBuildroomRoomConfig(args.root, { ...config, paused: false });

  io.stdout([
    'Buildroom resumed',
    `Room: ${config.roomId}`,
    '',
    'Resume does not start a build by itself.',
  ].join('\n'));
  return 0;
}

async function notifyLifecycle(
  deps: BuildroomCliDependencies,
  projectRoot: string,
  roomId: string,
  artifact: BuildroomArtifact,
): Promise<void> {
  if (!deps.notify) return;
  const config = loadBuildroomRoomConfig(projectRoot, roomId);
  if (config.notifications.routes.length === 0) return;
  const text = formatBuildroomLifecycleNotification(artifact);
  if (!text) return;
  try {
    await deps.notify({ routes: config.notifications.routes, text });
  } catch {
    // Notifications are not receipts and must not change command success.
  }
}

function assertStageAllowed(
  config: { mode: string; paused?: boolean; killSwitchActive: boolean },
  stage: 'collect' | 'propose' | 'review' | 'build' | 'qa' | 'trust' | 'retain',
): void {
  if (config.mode === 'off') {
    throw new BuildroomStageBlockedError('Buildroom mode is off');
  }
  if (config.paused) {
    throw new BuildroomStageBlockedError('Buildroom is paused');
  }
  if (stage === 'build' && config.mode !== 'manual_approval') {
    throw new BuildroomStageBlockedError(`Buildroom mode does not allow build: ${config.mode}`);
  }
  if (config.killSwitchActive) {
    throw new BuildroomStageBlockedError('Kill switch is active');
  }
}

function latestArtifact(store: FileArtifactStore, type: BuildroomArtifactType): BuildroomArtifact {
  const artifacts = sortedArtifacts(store, type);
  const artifact = artifacts[0];
  if (!artifact) throw new Error(`Artifact not found: latest ${type}`);
  return artifact;
}

function latestOptionalArtifact(
  store: FileArtifactStore,
  type: BuildroomArtifactType,
): BuildroomArtifact | undefined {
  return sortedArtifacts(store, type)[0];
}

function sortedArtifacts(store: FileArtifactStore, type: BuildroomArtifactType): BuildroomArtifact[] {
  return store
    .listArtifacts(type)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function findBuildPlanForApproval(
  store: FileArtifactStore,
  approvalId: string,
): BuildroomArtifact | undefined {
  return store
    .listArtifacts('build_plan')
    .find((plan) => plan.payload.approvalId === approvalId);
}

function findChildArtifact(
  store: FileArtifactStore,
  type: BuildroomArtifactType,
  parentId: string,
): BuildroomArtifact | undefined {
  return store
    .listArtifacts(type)
    .find((artifact) => artifact.parentIds.includes(parentId));
}

function findRejectionForTarget(
  store: FileArtifactStore,
  targetId: string,
): BuildroomArtifact | undefined {
  return store
    .listArtifacts('operator_decision')
    .find((decision) =>
      decision.status === 'rejected' &&
      decision.payload.decision === 'reject' &&
      decision.payload.targetArtifactId === targetId);
}

function createAndStoreTrustArtifacts(
  store: FileArtifactStore,
  build: BuildroomArtifact,
  qa: BuildroomArtifact,
): BuildroomArtifact {
  const now = new Date().toISOString();
  const existingDelta = findChildArtifact(store, 'verification_delta', build.id);
  const delta = existingDelta ?? store.writeArtifact(
    createVerificationDeltaArtifact({ build, qa, now }),
  );
  return store.writeArtifact(createTrustReportArtifact({ build, qa, delta, now }));
}

function createOperatorSummaryArtifact(opts: {
  projectRoot: string;
  roomId: string;
  trust: BuildroomArtifact;
  report: string;
  now: string;
}): BuildroomArtifact {
  const suffix = artifactSuffix(opts.trust.id);
  const renderedPath = join(
    roomRoot(opts.projectRoot, opts.roomId),
    'buildroom',
    'operator',
    'reports',
    `summary_${suffix}.md`,
  );

  return {
    id: `summary_${suffix}`,
    type: 'operator_summary',
    schemaVersion: 'auto-buildroom/v1',
    status: 'generated',
    createdAt: opts.now,
    producer: {
      role: 'reporter',
      runId: `run_${opts.now.replace(/[^0-9]/g, '').slice(0, 14)}_reporter`,
    },
    room: { id: opts.roomId },
    parentIds: [opts.trust.id],
    inputRefs: [{ kind: 'artifact', ref: opts.trust.id }],
    outputRefs: [{ kind: 'file', ref: renderedPath, hash: sha256(`${opts.report}\n`) }],
    runtimeRefs: [],
    traceId: opts.trust.traceId,
    redaction: {
      rawTranscriptsIncluded: false,
      secretsRedacted: true,
      redactedFields: [],
    },
    contentHash: '',
    payload: {
      reportType: 'trust',
      format: 'markdown',
      renderedPath,
      renderedFromIds: [opts.trust.id],
      generatedBy: 'reporter',
      rendererVersion: 'auto-buildroom-reporter/v1',
      templateVersion: 'operator-summary/v1',
      trustStateAtRenderTime: opts.trust.payload.trustState,
    },
  };
}

function createOperatorDecisionArtifact(opts: {
  target: BuildroomArtifact;
  operatorId: string;
  route: string;
  now: string;
}): BuildroomArtifact {
  const suffix = artifactSuffix(opts.target.id);

  return {
    id: `decision_${suffix}`,
    type: 'operator_decision',
    schemaVersion: 'auto-buildroom/v1',
    status: 'rejected',
    createdAt: opts.now,
    producer: {
      role: 'operator',
      runId: `run_${opts.now.replace(/[^0-9]/g, '').slice(0, 14)}_operator`,
    },
    room: { id: opts.target.room.id },
    parentIds: [opts.target.id],
    inputRefs: [{ kind: 'artifact', ref: opts.target.id }],
    outputRefs: [],
    runtimeRefs: [],
    traceId: opts.target.traceId,
    redaction: {
      rawTranscriptsIncluded: false,
      secretsRedacted: true,
      redactedFields: [],
    },
    contentHash: '',
    payload: {
      decision: 'reject',
      targetArtifactId: opts.target.id,
      targetArtifactType: opts.target.type,
      decidedBy: opts.operatorId,
      decisionRoute: opts.route,
    },
  };
}

function writeRenderedReport(summary: BuildroomArtifact, report: string): void {
  const outputRef = summary.outputRefs.find((ref) => ref.kind === 'file');
  if (!outputRef) throw new Error(`Operator summary is missing rendered output ref: ${summary.id}`);
  mkdirSync(dirname(outputRef.ref), { recursive: true });
  writeFileSync(outputRef.ref, `${report}\n`, 'utf8');
}

function renderTrustReport(trust: BuildroomArtifact): string {
  const state = String(trust.payload.trustState ?? 'blocked');
  const reasons = Array.isArray(trust.payload.reasons)
    ? trust.payload.reasons.filter((reason): reason is string => typeof reason === 'string')
    : [];

  return [
    `Trust: ${state.toUpperCase()}`,
    `Receipt: ${trust.id}`,
    `Room: ${trust.room.id}`,
    `Trace: ${trust.traceId}`,
    '',
    'What to believe:',
    reasons.length ? reasons.map((reason) => `- ${reason}`).join('\n') : '- No trust reasons recorded.',
    '',
    'Builder claims are not proof. Trust is derived from QA and Verification Delta receipts.',
  ].join('\n');
}

function artifactSuffix(id: string): string {
  const separator = id.indexOf('_');
  return separator === -1 ? id : id.slice(separator + 1);
}

function builderClaims(build: BuildroomArtifact): string[] {
  return Array.isArray(build.payload.builderClaims)
    ? build.payload.builderClaims.filter((claim): claim is string => typeof claim === 'string')
    : [];
}

function handleError(error: unknown, args: ParsedArgs, io: CliIO): number {
  const classified = classifyCliError(error);
  if (wantsJson(args)) {
    writeJson(io.stderr, {
      ok: false,
      command: args.command ?? 'unknown',
      roomId: roomIdForError(args),
      error: {
        code: classified.code,
        message: classified.message,
        nextActions: nextActionsForError(classified.code),
      },
    });
    return classified.exitCode;
  }

  if (error instanceof BuildroomConfigValidationError) {
    for (const issue of error.issues) {
      io.stderr(redactSecrets(`${issue.path.join('.')}: ${issue.message}`));
    }
    return classified.exitCode;
  }
  io.stderr(classified.message);
  return classified.exitCode;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const out: ParsedArgs = {
    command: undefined,
    root: process.cwd(),
    telegramCommandRoutes: [],
    telegramApprovalRoutes: [],
    telegramNotificationRoutes: [],
    flags: new Set(),
    positional,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--root':
        out.root = argv[++i] ?? out.root;
        break;
      case '--room':
        out.room = argv[++i];
        break;
      case '--operator':
        out.operator = argv[++i];
        break;
      case '--telegram-command-route':
        out.telegramCommandRoutes.push(argv[++i]);
        break;
      case '--telegram-approval-route':
        out.telegramApprovalRoutes.push(argv[++i]);
        break;
      case '--telegram-notification-route':
        out.telegramNotificationRoutes.push(argv[++i]);
        break;
      case '--save':
        out.flags.add('save');
        break;
      case '--execute':
        out.flags.add('execute');
        break;
      case '--json':
        out.flags.add('json');
        break;
      case '--quiet':
        out.flags.add('quiet');
        break;
      default:
        if (!out.command) out.command = arg;
        else positional.push(arg);
    }
  }

  return out;
}

function requirePositional(args: ParsedArgs, index: number, command: string): string {
  const value = args.positional[index];
  if (!value) {
    throw new CliUsageError(`Missing required argument for ${command}`);
  }
  return value;
}

function firstOperator(config: { operators: { id: string }[] }): string {
  return config.operators[0]?.id ?? 'cli:user:local-operator';
}

function uniqueRoutes(routes: string[]): string[] {
  return [...new Set(routes.filter(Boolean))];
}

function nowIso(deps: BuildroomCliDependencies): string {
  return deps.now?.() ?? new Date().toISOString();
}

function wantsJson(args: ParsedArgs): boolean {
  return args.flags.has('json');
}

function commandOutputIO(args: ParsedArgs, io: CliIO): CliIO {
  if (!args.flags.has('quiet') || wantsJson(args)) return io;
  return {
    stdout: () => undefined,
    stderr: io.stderr,
  };
}

function writeJson(write: (text: string) => void, value: unknown): void {
  write(redactSecrets(JSON.stringify(value, null, 2)));
}

function statusJsonState(
  config: BuildroomConfig,
  counts: ReturnType<typeof deriveStatusCounts>,
  roomState: string,
  latestTrust: BuildroomArtifact | undefined,
): Record<string, unknown> {
  return {
    roomState,
    mode: config.mode,
    paused: config.paused,
    killSwitchActive: config.killSwitchActive,
    latestTrust: String(latestTrust?.payload.trustState ?? 'none'),
    counts,
  };
}

function artifactSummary(artifact: BuildroomArtifact): Record<string, unknown> {
  return {
    id: artifact.id,
    type: artifact.type,
    status: artifact.status,
    parentIds: artifact.parentIds,
  };
}

function classifyCliError(error: unknown): {
  code: string;
  exitCode: number;
  message: string;
} {
  const message = redactSecrets(error instanceof Error ? error.message : String(error));

  if (error instanceof BuildroomConfigValidationError) {
    return { code: 'invalid_config', exitCode: 3, message };
  }
  if (error instanceof BuildroomConfigExistsError) {
    return { code: 'invalid_config', exitCode: 3, message };
  }
  if (error instanceof AuthorityPolicyError) {
    return { code: 'policy_blocked', exitCode: 4, message };
  }
  if (error instanceof CliUsageError) {
    return { code: 'invalid_usage', exitCode: 2, message };
  }
  if (error instanceof BuildroomStageBlockedError) {
    return { code: 'stage_blocked', exitCode: 8, message };
  }
  if (error instanceof ArtifactHashMismatchError) {
    return { code: 'artifact_integrity_failed', exitCode: 4, message };
  }
  if (error instanceof OutputRefHashMismatchError) {
    return { code: 'artifact_integrity_failed', exitCode: 4, message };
  }
  if (error instanceof MissingArtifactParentError) {
    return { code: 'artifact_integrity_failed', exitCode: 4, message };
  }
  if (error instanceof Error && error.message.startsWith('Artifact not found:')) {
    return { code: 'missing_artifact', exitCode: 5, message };
  }
  if (error instanceof Error && error.message.startsWith('QA report not found')) {
    return { code: 'missing_artifact', exitCode: 5, message };
  }

  return { code: 'general_failure', exitCode: 1, message };
}

function nextActionsForError(code: string): string[] {
  switch (code) {
    case 'invalid_config':
      return ['anthroclaw buildroom validate'];
    case 'missing_artifact':
      return ['anthroclaw buildroom status'];
    case 'policy_blocked':
    case 'artifact_integrity_failed':
    case 'stage_blocked':
      return ['anthroclaw buildroom status', 'anthroclaw buildroom show <id>'];
    case 'invalid_usage':
      return ['anthroclaw buildroom help'];
    default:
      return ['anthroclaw buildroom status'];
  }
}

function roomIdForError(args: ParsedArgs): string {
  try {
    return loadBuildroomRoomConfig(args.root, args.room).roomId;
  } catch {
    return args.room ?? 'anthroclaw-core';
  }
}

function sha256(content: string | Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

class BuildroomStageBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildroomStageBlockedError';
  }
}

class OutputRefHashMismatchError extends Error {
  constructor(artifactId: string, ref: string) {
    super(`Output ref hash mismatch: ${artifactId} ${ref}`);
    this.name = 'OutputRefHashMismatchError';
  }
}

class MissingArtifactParentError extends Error {
  constructor(artifactId: string, parentId: string) {
    super(`Missing parent artifact: ${parentId} for ${artifactId}`);
    this.name = 'MissingArtifactParentError';
  }
}

function helpText(): string {
  return [
    'Usage: anthroclaw buildroom <command>',
    '',
    'Commands:',
    '  init      Create project-local Buildroom config and storage',
    '  status    Show current Buildroom status',
    '  validate  Validate config and artifact hashes',
    '  collect   Create deterministic research packet',
    '  propose   Create deterministic idea from latest research',
    '  review    Create deterministic Main Review for an idea',
    '  show      Show a Buildroom receipt',
    '  reject    Create an operator rejection receipt',
    '  approve   Create approval for a locked Main Review',
    '  build     Create or show a Buildroom build plan',
    '  qa        Create deterministic QA evidence for a build receipt',
    '  trust     Create verification delta and trust report',
    '  report    Render latest trust report; use --save for operator_summary',
    '  retain    Create retention recommendation for a trust report',
    '  pause     Soft-pause new Buildroom stages',
    '  resume    Resume stage execution after pause',
    '',
    'Options:',
    '  --root <path>       Project root',
    '  --room <roomId>     Buildroom ID',
    '  --operator <id>     Operator identity for init',
    '  --telegram-command-route <route>       Add Telegram command route during init',
    '  --telegram-approval-route <route>      Add Telegram approval route during init',
    '  --telegram-notification-route <route>  Add Telegram notification route during init',
    '  --save              Persist report rendering when supported',
    '  --execute           Explicitly run Builder for build plan/approval',
    '  --json              Emit machine-readable JSON for supported commands and errors',
    '  --quiet             Suppress non-error text where supported',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBuildroomCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
