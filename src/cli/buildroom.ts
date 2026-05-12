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
  io.stdout([
    `Buildroom: ${config.roomId}`,
    `Mode: ${config.mode}`,
    'State: idle',
    'Latest trust: none',
    `Kill switch: ${config.killSwitchActive ? 'active' : 'inactive'}`,
    '',
    'Pending approvals: 0',
    'Approved not built: 0',
    'Active builds: 0',
    'QA pending: 0',
    '',
    'Next:',
    'anthroclaw buildroom collect',
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
