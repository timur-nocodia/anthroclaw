import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createFailedBuildroomHandoffGateResult,
  DEFAULT_BUILDROOM_REQUESTED_ACTION,
  DEFAULT_BUILDROOM_ROOM_ID,
  runBuildroomHandoffGate,
  type BuildroomHandoffGateInput,
  type BuildroomHandoffGateResult,
} from '../runtime/side-effect-gates/buildroom-handoff.js';

interface PiBuildroomHandoffGateArgs {
  agentId?: string;
  agentsDir: string;
  accountId: string;
  peerId?: string;
  senderId?: string;
  roomId: string;
  sourceSessionId?: string;
  requestedAction: string;
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiBuildroomHandoffGateDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runPiBuildroomHandoffGateCli(
  argv: string[],
  deps: PiBuildroomHandoffGateDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiBuildroomHandoffGateArgs;

  try {
    args = parsePiBuildroomHandoffGateArgs(argv);
    validateArgs(args);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-buildroom-handoff-gate-'));
  const input = toGateInput(args, workspace);
  try {
    const result = await runBuildroomHandoffGate(input);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result = createFailedBuildroomHandoffGateResult(input, errorMessage(err));
    writeResult(stderr, args.json, result);
    return 1;
  } finally {
    if (!args.keepData) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export function parsePiBuildroomHandoffGateArgs(argv: string[]): PiBuildroomHandoffGateArgs {
  const args: PiBuildroomHandoffGateArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    accountId: 'default',
    roomId: DEFAULT_BUILDROOM_ROOM_ID,
    requestedAction: DEFAULT_BUILDROOM_REQUESTED_ACTION,
    keepData: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--':
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--agent':
      case '--agent-id':
        args.agentId = requireValue(argv, ++i, arg);
        break;
      case '--agents-dir':
        args.agentsDir = resolve(requireValue(argv, ++i, '--agents-dir'));
        break;
      case '--account-id':
        args.accountId = requireValue(argv, ++i, '--account-id');
        break;
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
        break;
      case '--sender-id':
        args.senderId = requireValue(argv, ++i, '--sender-id');
        break;
      case '--room-id':
        args.roomId = requireValue(argv, ++i, '--room-id');
        break;
      case '--source-session-id':
        args.sourceSessionId = requireValue(argv, ++i, '--source-session-id');
        break;
      case '--requested-action':
        args.requestedAction = requireValue(argv, ++i, '--requested-action');
        break;
      case '--dry-run':
        break;
      case '--keep-data':
        args.keepData = true;
        break;
      case '--json':
        args.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function validateArgs(args: PiBuildroomHandoffGateArgs): void {
  if (args.help) return;
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.senderId) throw new Error('--sender-id is required.');
}

function toGateInput(args: PiBuildroomHandoffGateArgs, workspace: string): BuildroomHandoffGateInput {
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.senderId) throw new Error('--sender-id is required.');
  return {
    agentId: args.agentId,
    sourceAgentsDir: args.agentsDir,
    workspace,
    accountId: args.accountId,
    peerId: args.peerId,
    senderId: args.senderId,
    roomId: args.roomId,
    sourceSessionId: args.sourceSessionId,
    requestedAction: args.requestedAction,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: BuildroomHandoffGateResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi Buildroom handoff gate passed.',
      `agent: ${result.agentId}`,
      `permissions: ${JSON.stringify(result.permissions)}`,
      `summary: ${JSON.stringify(result.summary)}`,
      `handoff: ${JSON.stringify(result.handoff)}`,
      `safety: ${JSON.stringify(result.safety)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi Buildroom handoff gate failed: ${result.error ?? 'unknown error'}\n`);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-buildroom-handoff-gate -- --agent-id <id> --peer-id <id> --sender-id <id> [options]',
    '',
    'Options:',
    '  --agent-id <id>          agent directory id under --agents-dir',
    '  --agents-dir <path>      source agents directory (default: agents)',
    '  --account-id <id>        Telegram account id (default: default)',
    '  --peer-id <id>           fake Telegram peer id',
    '  --sender-id <id>         fake Telegram sender id',
    '  --room-id <id>           Buildroom room id (default: anthroclaw-core)',
    '  --source-session-id <id> source session id to bind in artifacts',
    '  --requested-action <id>  handoff requested action (default: research_only)',
    '  --dry-run                accepted for gate CLI consistency; this gate is temp-only',
    '  --keep-data              keep temp workspace for inspection',
    '  --json                   emit JSON',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiBuildroomHandoffGateCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
