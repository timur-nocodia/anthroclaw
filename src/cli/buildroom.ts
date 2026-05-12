#!/usr/bin/env tsx

import { BuildroomConfigValidationError } from '../auto-buildroom/config/model.js';
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
  io.stderr(error instanceof Error ? error.message : String(error));
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

function helpText(): string {
  return [
    'Usage: anthroclaw buildroom <command>',
    '',
    'Commands:',
    '  init      Create project-local Buildroom config and storage',
    '  status    Show current Buildroom status',
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
