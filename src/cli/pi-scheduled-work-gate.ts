import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  DEFAULT_SCHEDULED_WORK_CRON_ID,
  DEFAULT_SCHEDULED_WORK_SCHEDULE,
  createFailedScheduledWorkGateResult,
  runScheduledWorkGate,
  type ScheduledWorkGateInput,
  type ScheduledWorkGateResult,
} from '../runtime/side-effect-gates/scheduled-work.js';

interface PiScheduledWorkGateArgs {
  agentId?: string;
  agentsDir: string;
  accountId: string;
  peerId?: string;
  senderId?: string;
  threadId?: string;
  cronId: string;
  cronSchedule: string;
  cronPrompt?: string;
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiScheduledWorkGateDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runPiScheduledWorkGateCli(
  argv: string[],
  deps: PiScheduledWorkGateDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiScheduledWorkGateArgs;

  try {
    args = parsePiScheduledWorkGateArgs(argv);
    validateArgs(args);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-scheduled-work-gate-'));
  const input = toGateInput(args, workspace);
  try {
    const result = await runScheduledWorkGate(input);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result = createFailedScheduledWorkGateResult(input, errorMessage(err));
    writeResult(stderr, args.json, result);
    return 1;
  } finally {
    if (!args.keepData) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export function parsePiScheduledWorkGateArgs(argv: string[]): PiScheduledWorkGateArgs {
  const args: PiScheduledWorkGateArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    accountId: 'default',
    cronId: DEFAULT_SCHEDULED_WORK_CRON_ID,
    cronSchedule: DEFAULT_SCHEDULED_WORK_SCHEDULE,
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
      case '--thread-id':
        args.threadId = requireValue(argv, ++i, '--thread-id');
        break;
      case '--cron-id':
        args.cronId = requireValue(argv, ++i, '--cron-id');
        break;
      case '--cron-schedule':
        args.cronSchedule = requireValue(argv, ++i, '--cron-schedule');
        break;
      case '--cron-prompt':
        args.cronPrompt = requireValue(argv, ++i, '--cron-prompt');
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

function validateArgs(args: PiScheduledWorkGateArgs): void {
  if (args.help) return;
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.senderId) throw new Error('--sender-id is required.');
}

function toGateInput(args: PiScheduledWorkGateArgs, workspace: string): ScheduledWorkGateInput {
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
    threadId: args.threadId,
    cronId: args.cronId,
    cronSchedule: args.cronSchedule,
    cronPrompt: args.cronPrompt,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: ScheduledWorkGateResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi scheduled-work gate passed.',
      `agent: ${result.agentId}`,
      `target: ${JSON.stringify(result.target)}`,
      `cron: ${JSON.stringify(result.cron)}`,
      `sourceConfigUnchanged: ${result.sourceConfigUnchanged}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi scheduled-work gate failed: ${result.error ?? 'unknown error'}\n`);
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
    'Usage: pnpm runtime:pi-scheduled-work-gate -- --agent-id <id> --peer-id <id> --sender-id <id> [options]',
    '',
    'Options:',
    '  --agent-id <id>          agent directory id under --agents-dir',
    '  --agents-dir <path>      source agents directory (default: agents)',
    '  --account-id <id>        Telegram account id (default: default)',
    '  --peer-id <id>           confirmed Telegram peer id',
    '  --sender-id <id>         confirmed Telegram sender id',
    '  --thread-id <id>         optional confirmed Telegram thread/topic id',
    '  --cron-id <id>           temporary dynamic cron id',
    '  --cron-schedule <s>      temporary dynamic cron schedule (default: */30 * * * *)',
    '  --cron-prompt <text>     temporary dynamic cron prompt',
    '  --keep-data              keep temp workspace for inspection',
    '  --json                   emit JSON',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiScheduledWorkGateCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
