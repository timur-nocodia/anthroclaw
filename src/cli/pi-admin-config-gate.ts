import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createFailedAdminConfigGateResult,
  DEFAULT_ADMIN_CONFIG_PENDING_SENDER_ID,
  DEFAULT_ADMIN_CONFIG_UNAUTHORIZED_TARGET_ID,
  runAdminConfigGate,
  type AdminConfigGateInput,
  type AdminConfigGateResult,
} from '../runtime/side-effect-gates/admin-config.js';

interface PiAdminConfigGateArgs {
  agentId?: string;
  agentsDir: string;
  peerId?: string;
  sessionKey?: string;
  pendingSenderId: string;
  unauthorizedTargetId: string;
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiAdminConfigGateDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runPiAdminConfigGateCli(
  argv: string[],
  deps: PiAdminConfigGateDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiAdminConfigGateArgs;

  try {
    args = parsePiAdminConfigGateArgs(argv);
    validateArgs(args);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-admin-config-gate-'));
  const input = toGateInput(args, workspace);
  try {
    const result = await runAdminConfigGate(input);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result = createFailedAdminConfigGateResult(input, errorMessage(err));
    writeResult(stderr, args.json, result);
    return 1;
  } finally {
    if (!args.keepData) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export function parsePiAdminConfigGateArgs(argv: string[]): PiAdminConfigGateArgs {
  const args: PiAdminConfigGateArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    pendingSenderId: DEFAULT_ADMIN_CONFIG_PENDING_SENDER_ID,
    unauthorizedTargetId: DEFAULT_ADMIN_CONFIG_UNAUTHORIZED_TARGET_ID,
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
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
        break;
      case '--session-key':
        args.sessionKey = requireValue(argv, ++i, '--session-key');
        break;
      case '--pending-sender-id':
        args.pendingSenderId = requireValue(argv, ++i, '--pending-sender-id');
        break;
      case '--unauthorized-target-id':
        args.unauthorizedTargetId = requireValue(argv, ++i, '--unauthorized-target-id');
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

function validateArgs(args: PiAdminConfigGateArgs): void {
  if (args.help) return;
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.sessionKey) throw new Error('--session-key is required.');
}

function toGateInput(args: PiAdminConfigGateArgs, workspace: string): AdminConfigGateInput {
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.sessionKey) throw new Error('--session-key is required.');
  return {
    agentId: args.agentId,
    sourceAgentsDir: args.agentsDir,
    workspace,
    peerId: args.peerId,
    sessionKey: args.sessionKey,
    pendingSenderId: args.pendingSenderId,
    unauthorizedTargetId: args.unauthorizedTargetId,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: AdminConfigGateResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi admin/config gate passed.',
      `agent: ${result.agentId}`,
      `permissions: ${JSON.stringify(result.permissions)}`,
      `config: ${JSON.stringify(result.config)}`,
      `accessControl: ${JSON.stringify(result.accessControl)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi admin/config gate failed: ${result.error ?? 'unknown error'}\n`);
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
    'Usage: pnpm runtime:pi-admin-config-gate -- --agent-id <id> --peer-id <id> --session-key <key> [options]',
    '',
    'Options:',
    '  --agent-id <id>               agent directory id under --agents-dir',
    '  --agents-dir <path>           source agents directory (default: agents)',
    '  --peer-id <id>                expected private Telegram peer id',
    '  --session-key <key>           fake operator session key for audit attribution',
    '  --pending-sender-id <id>      temporary pending sender id',
    '  --unauthorized-target-id <id> cross-agent target expected to be denied',
    '  --dry-run                     accepted for gate CLI consistency; this gate is temp-only',
    '  --keep-data                   keep temp workspace for inspection',
    '  --json                        emit JSON',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiAdminConfigGateCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
