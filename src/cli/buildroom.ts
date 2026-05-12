#!/usr/bin/env tsx

import { FileArtifactStore } from '../auto-buildroom/artifacts/store.js';
import { BuildroomConfigValidationError } from '../auto-buildroom/config/model.js';
import {
  AuthorityPolicyError,
  createApprovalArtifact,
} from '../auto-buildroom/policy/authority.js';
import {
  BuildroomConfigExistsError,
  initializeBuildroomStorage,
  loadBuildroomRoomConfig,
} from '../auto-buildroom/storage/init.js';
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
      case 'collect':
        return commandCollect(args, io);
      case 'propose':
        return commandPropose(args, io);
      case 'review':
        return commandReview(args, io);
      case 'show':
        return commandShow(args, io);
      case 'approve':
        return commandApprove(args, io);
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
  io.stdout([
    `Buildroom: ${config.roomId}`,
    `Mode: ${config.mode}`,
    'State: idle',
    'Latest trust: none',
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

function deriveStatusCounts(store: FileArtifactStore): {
  pendingApprovals: number;
  approvedNotBuilt: number;
  activeBuilds: number;
  qaPending: number;
} {
  const reviews = store.listArtifacts('main_review');
  const approvals = store.listArtifacts('approval');
  const plans = store.listArtifacts('build_plan');
  const builds = store.listArtifacts('coder_receipt');
  const qaReports = store.listArtifacts('qa_report');

  const approvedReviewIds = new Set(
    approvals.map((approval) => String(approval.payload.targetReviewId ?? '')),
  );
  const plannedApprovalIds = new Set(
    plans.map((plan) => String(plan.payload.approvalId ?? '')),
  );
  const qaBuildIds = new Set(qaReports.flatMap((qa) => qa.parentIds));

  return {
    pendingApprovals: reviews.filter(
      (review) =>
        review.payload.decision === 'approved_for_operator' &&
        !approvedReviewIds.has(review.id),
    ).length,
    approvedNotBuilt: approvals.filter(
      (approval) =>
        approval.status === 'granted' &&
        !approval.payload.consumedAt &&
        !plannedApprovalIds.has(approval.id),
    ).length,
    activeBuilds: builds.filter((build) => build.payload.runtimeStatus === 'running').length,
    qaPending: builds.filter((build) => !qaBuildIds.has(build.id)).length,
  };
}

function commandCollect(args: ParsedArgs, io: CliIO): number {
  const config = loadBuildroomRoomConfig(args.root, args.room);
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

function latestArtifact(store: FileArtifactStore, type: BuildroomArtifactType): BuildroomArtifact {
  const artifacts = store
    .listArtifacts(type)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const artifact = artifacts[0];
  if (!artifact) throw new Error(`Artifact not found: latest ${type}`);
  return artifact;
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
  io.stderr(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.message.startsWith('Artifact not found:')) return 5;
  return 1;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const out: ParsedArgs = {
    command: undefined,
    root: process.cwd(),
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

function helpText(): string {
  return [
    'Usage: anthroclaw buildroom <command>',
    '',
    'Commands:',
    '  init      Create project-local Buildroom config and storage',
    '  status    Show current Buildroom status',
    '  collect   Create deterministic research packet',
    '  propose   Create deterministic idea from latest research',
    '  review    Create deterministic Main Review for an idea',
    '  show      Show a Buildroom receipt',
    '  approve   Create approval for a locked Main Review',
    '',
    'Options:',
    '  --root <path>       Project root',
    '  --room <roomId>     Buildroom ID',
    '  --operator <id>     Operator identity for init',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBuildroomCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
