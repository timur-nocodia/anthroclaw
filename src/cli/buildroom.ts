#!/usr/bin/env tsx

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ArtifactHashMismatchError,
  FileArtifactStore,
} from '../auto-buildroom/artifacts/store.js';
import { BuildroomConfigValidationError } from '../auto-buildroom/config/model.js';
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
import {
  createQaReportArtifact,
  createTrustReportArtifact,
  createVerificationDeltaArtifact,
} from '../auto-buildroom/qa/trust.js';
import {
  createDeterministicIdeaContract,
  createDeterministicMainReview,
  createDeterministicResearchPacket,
} from '../auto-buildroom/workflow/deterministic.js';
import type { BuildroomArtifact, BuildroomArtifactType } from '../auto-buildroom/artifacts/model.js';

interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface ParsedArgs {
  command?: string;
  root: string;
  room?: string;
  operator?: string;
  flags: Set<string>;
  positional: string[];
}

const defaultIO: CliIO = {
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
};

export async function runBuildroomCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const args = parseArgs(argv);
  if (!args.command || args.command === 'help' || args.command === '--help') {
    io.stdout(helpText());
    return 0;
  }

  try {
    switch (args.command) {
      case 'init':
        return commandInit(args, io);
      case 'status':
        return commandStatus(args, io);
      case 'validate':
        return commandValidate(args, io);
      case 'collect':
        return commandCollect(args, io);
      case 'propose':
        return commandPropose(args, io);
      case 'review':
        return commandReview(args, io);
      case 'show':
        return commandShow(args, io);
      case 'reject':
        return commandReject(args, io);
      case 'approve':
        return commandApprove(args, io);
      case 'build':
        return commandBuild(args, io);
      case 'qa':
        return commandQa(args, io);
      case 'trust':
        return commandTrust(args, io);
      case 'report':
        return commandReport(args, io);
      case 'pause':
        return commandPause(args, io);
      case 'resume':
        return commandResume(args, io);
      default:
        io.stderr(`Unknown command: ${args.command}`);
        io.stderr(helpText());
        return 2;
    }
  } catch (error) {
    return handleError(error, io);
  }
}

function commandInit(args: ParsedArgs, io: CliIO): number {
  const result = initializeBuildroomStorage({
    projectRoot: args.root,
    roomId: args.room ?? 'anthroclaw-core',
    operatorId: args.operator ?? 'cli:user:local-operator',
  });

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

  io.stdout([
    'Buildroom validation: ok',
    `Room: ${config.roomId}`,
    `Artifacts checked: ${artifacts.length}`,
  ].join('\n'));
  return 0;
}

function deriveStatusCounts(store: FileArtifactStore): {
  pendingApprovals: number;
  approvedNotBuilt: number;
  activeBuilds: number;
  qaPending: number;
  trustPending: number;
  complete: number;
} {
  const reviews = store.listArtifacts('main_review');
  const approvals = store.listArtifacts('approval');
  const decisions = store.listArtifacts('operator_decision');
  const plans = store.listArtifacts('build_plan');
  const builds = store.listArtifacts('coder_receipt');
  const qaReports = store.listArtifacts('qa_report');
  const trustReports = store.listArtifacts('trust_report');

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
    complete: trustReports.length,
  };
}

function deriveRoomState(
  config: { mode: string; paused?: boolean; killSwitchActive: boolean },
  counts: ReturnType<typeof deriveStatusCounts>,
): string {
  if (config.killSwitchActive) return 'blocked';
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

function commandBuild(args: ParsedArgs, io: CliIO): number {
  const id = requirePositional(args, 0, 'build');
  const config = loadBuildroomRoomConfig(args.root, args.room);
  assertStageAllowed(config, 'build');
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const target = store.readArtifact(id);

  if (target.type === 'build_plan') {
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
      now: new Date().toISOString(),
    }),
  );

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

function commandQa(args: ParsedArgs, io: CliIO): number {
  const id = requirePositional(args, 0, 'qa');
  const config = loadBuildroomRoomConfig(args.root, args.room);
  assertStageAllowed(config, 'qa');
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const build = store.readArtifact(id);
  if (build.type !== 'coder_receipt') {
    throw new AuthorityPolicyError('QA requires a coder_receipt artifact');
  }

  const existing = findChildArtifact(store, 'qa_report', build.id);
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
  return 0;
}

function commandTrust(args: ParsedArgs, io: CliIO): number {
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
  const trust = existingTrust ?? createAndStoreTrustArtifacts(store, build, qa);

  io.stdout([
    `Trust report: ${trust.id}`,
    `Trust: ${String(trust.payload.trustState).toUpperCase()}`,
    '',
    'Trust tells the operator what is actually proven.',
  ].join('\n'));
  return 0;
}

function commandReport(args: ParsedArgs, io: CliIO): number {
  const config = loadBuildroomRoomConfig(args.root, args.room);
  const store = new FileArtifactStore({ projectRoot: args.root, roomId: config.roomId });
  const trust = latestArtifact(store, 'trust_report');
  const report = renderTrustReport(trust);

  if (args.flags.has('save')) {
    const summary = store.writeArtifact(
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

  io.stdout(report);
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

function assertStageAllowed(
  config: { mode: string; paused?: boolean; killSwitchActive: boolean },
  stage: 'collect' | 'propose' | 'review' | 'build' | 'qa' | 'trust',
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
    outputRefs: [{ kind: 'file', ref: renderedPath }],
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

function handleError(error: unknown, io: CliIO): number {
  if (error instanceof BuildroomConfigValidationError) {
    for (const issue of error.issues) {
      io.stderr(`${issue.path.join('.')}: ${issue.message}`);
    }
    return 3;
  }
  if (error instanceof BuildroomConfigExistsError) {
    io.stderr(error.message);
    return 3;
  }
  if (error instanceof AuthorityPolicyError) {
    io.stderr(error.message);
    return 4;
  }
  if (error instanceof CliUsageError) {
    io.stderr(error.message);
    return 2;
  }
  if (error instanceof BuildroomStageBlockedError) {
    io.stderr(error.message);
    return 8;
  }
  if (error instanceof ArtifactHashMismatchError) {
    io.stderr(error.message);
    return 4;
  }
  io.stderr(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.message.startsWith('Artifact not found:')) return 5;
  if (error instanceof Error && error.message.startsWith('QA report not found')) return 5;
  return 1;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const out: ParsedArgs = {
    command: undefined,
    root: process.cwd(),
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
      case '--save':
        out.flags.add('save');
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
    '  pause     Soft-pause new Buildroom stages',
    '  resume    Resume stage execution after pause',
    '',
    'Options:',
    '  --root <path>       Project root',
    '  --room <roomId>     Buildroom ID',
    '  --operator <id>     Operator identity for init',
    '  --save              Persist report rendering when supported',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBuildroomCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
