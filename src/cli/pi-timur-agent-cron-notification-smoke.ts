import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createFailedCronNotificationGateResult,
  DEFAULT_CRON_NOTIFICATION_EVENT,
  DEFAULT_CRON_NOTIFICATION_ROUTE,
  runCronNotificationGate,
  type CronNotificationGateInput,
  type CronNotificationGateResult,
} from '../runtime/side-effect-gates/cron-notification.js';

const AGENT_ID = 'timur_agent';
const ACCOUNT_ID = 'default';
const DEFAULT_PEER_ID = '48705953';
const DEFAULT_SENDER_ID = '48705953';
const STATIC_CRON_ID = 'timur-agent-lab-silent-check';
const DYNAMIC_CRON_ID = 'timur-agent-cron-notification-smoke';
const NOTIFICATION_MARKER = 'TIMUR_AGENT_NOTIFICATION_CANARY';

interface PiTimurAgentCronNotificationSmokeArgs {
  agentsDir: string;
  peerId: string;
  senderId: string;
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiTimurAgentCronNotificationSmokeDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

type PiTimurAgentCronNotificationSmokeResult = CronNotificationGateResult;

export async function runPiTimurAgentCronNotificationSmokeCli(
  argv: string[],
  deps: PiTimurAgentCronNotificationSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTimurAgentCronNotificationSmokeArgs;

  try {
    args = parsePiTimurAgentCronNotificationSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-timur-agent-cron-notification-'));
  const input = toGateInput(args, workspace);
  try {
    const result = await runCronNotificationGate(input);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result = createFailedCronNotificationGateResult(input, errorMessage(err));
    writeResult(stderr, args.json, result);
    return 1;
  } finally {
    if (!args.keepData) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export async function runPiTimurAgentCronNotificationSmoke(input: PiTimurAgentCronNotificationSmokeArgs & {
  workspace: string;
}): Promise<PiTimurAgentCronNotificationSmokeResult> {
  return runCronNotificationGate(toGateInput(input, input.workspace));
}

export function parsePiTimurAgentCronNotificationSmokeArgs(argv: string[]): PiTimurAgentCronNotificationSmokeArgs {
  const args: PiTimurAgentCronNotificationSmokeArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    peerId: DEFAULT_PEER_ID,
    senderId: DEFAULT_SENDER_ID,
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
      case '--agents-dir':
        args.agentsDir = resolve(requireValue(argv, ++i, '--agents-dir'));
        break;
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
        break;
      case '--sender-id':
        args.senderId = requireValue(argv, ++i, '--sender-id');
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

function toGateInput(args: PiTimurAgentCronNotificationSmokeArgs, workspace: string): CronNotificationGateInput {
  return {
    agentId: AGENT_ID,
    sourceAgentsDir: args.agentsDir,
    workspace,
    accountId: ACCOUNT_ID,
    peerId: args.peerId,
    senderId: args.senderId,
    staticCronId: STATIC_CRON_ID,
    dynamicCronId: DYNAMIC_CRON_ID,
    notificationRouteName: DEFAULT_CRON_NOTIFICATION_ROUTE,
    notificationEvent: DEFAULT_CRON_NOTIFICATION_EVENT,
    notificationMarker: NOTIFICATION_MARKER,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTimurAgentCronNotificationSmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi timur_agent cron/notification smoke passed.',
      `staticCron: ${JSON.stringify(result.staticCron)}`,
      `dynamicCron: ${JSON.stringify(result.dynamicCron)}`,
      `notifications: ${JSON.stringify(result.notifications)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi timur_agent cron/notification smoke failed: ${result.error ?? 'unknown error'}\n`);
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
    'Usage: pnpm runtime:pi-timur-agent-cron-notification-smoke -- [--json]',
    '',
    'Options:',
    '  --agents-dir <path>  source agents directory containing timur_agent (default: agents)',
    '  --peer-id <id>       fake Telegram peer id (default: operator peer)',
    '  --sender-id <id>     fake Telegram sender id (default: operator peer)',
    '  --keep-data          keep temp workspace for inspection',
    '  --json               emit JSON',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentCronNotificationSmokeCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
