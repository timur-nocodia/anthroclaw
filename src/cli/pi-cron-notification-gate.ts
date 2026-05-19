import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createFailedCronNotificationGateResult,
  DEFAULT_CRON_NOTIFICATION_EVENT,
  DEFAULT_CRON_NOTIFICATION_MARKER,
  DEFAULT_CRON_NOTIFICATION_ROUTE,
  runCronNotificationGate,
  type CronNotificationGateInput,
  type CronNotificationGateResult,
} from '../runtime/side-effect-gates/cron-notification.js';
import type { NotificationEventName } from '../notifications/types.js';

interface PiCronNotificationGateArgs {
  agentId?: string;
  agentsDir: string;
  accountId: string;
  peerId?: string;
  senderId?: string;
  staticCronId?: string;
  dynamicCronId?: string;
  dynamicCronSchedule: string;
  dynamicCronPrompt?: string;
  notificationRouteName: string;
  notificationEvent: NotificationEventName;
  notificationMarker: string;
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiCronNotificationGateDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

const NOTIFICATION_EVENTS: readonly NotificationEventName[] = [
  'peer_pause_started',
  'peer_pause_ended',
  'peer_pause_intervened_during_generation',
  'peer_pause_summary_daily',
  'agent_error',
  'iteration_budget_exhausted',
  'escalation_needed',
];

export async function runPiCronNotificationGateCli(
  argv: string[],
  deps: PiCronNotificationGateDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiCronNotificationGateArgs;

  try {
    args = parsePiCronNotificationGateArgs(argv);
    validateArgs(args);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-cron-notification-gate-'));
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

export function parsePiCronNotificationGateArgs(argv: string[]): PiCronNotificationGateArgs {
  const args: PiCronNotificationGateArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    accountId: 'default',
    dynamicCronSchedule: '*/30 * * * *',
    notificationRouteName: DEFAULT_CRON_NOTIFICATION_ROUTE,
    notificationEvent: DEFAULT_CRON_NOTIFICATION_EVENT,
    notificationMarker: DEFAULT_CRON_NOTIFICATION_MARKER,
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
      case '--static-cron-id':
        args.staticCronId = requireValue(argv, ++i, '--static-cron-id');
        break;
      case '--dynamic-cron-id':
        args.dynamicCronId = requireValue(argv, ++i, '--dynamic-cron-id');
        break;
      case '--dynamic-cron-schedule':
        args.dynamicCronSchedule = requireValue(argv, ++i, '--dynamic-cron-schedule');
        break;
      case '--dynamic-cron-prompt':
        args.dynamicCronPrompt = requireValue(argv, ++i, '--dynamic-cron-prompt');
        break;
      case '--notification-route':
      case '--notification-route-name':
        args.notificationRouteName = requireValue(argv, ++i, arg);
        break;
      case '--notification-event':
        args.notificationEvent = parseNotificationEvent(requireValue(argv, ++i, '--notification-event'));
        break;
      case '--notification-marker':
        args.notificationMarker = requireValue(argv, ++i, '--notification-marker');
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

function validateArgs(args: PiCronNotificationGateArgs): void {
  if (args.help) return;
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.senderId) throw new Error('--sender-id is required.');
  if (!args.staticCronId) throw new Error('--static-cron-id is required.');
  if (!args.dynamicCronId) throw new Error('--dynamic-cron-id is required.');
}

function toGateInput(args: PiCronNotificationGateArgs, workspace: string): CronNotificationGateInput {
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.senderId) throw new Error('--sender-id is required.');
  if (!args.staticCronId) throw new Error('--static-cron-id is required.');
  if (!args.dynamicCronId) throw new Error('--dynamic-cron-id is required.');
  return {
    agentId: args.agentId,
    sourceAgentsDir: args.agentsDir,
    workspace,
    accountId: args.accountId,
    peerId: args.peerId,
    senderId: args.senderId,
    staticCronId: args.staticCronId,
    dynamicCronId: args.dynamicCronId,
    dynamicCronSchedule: args.dynamicCronSchedule,
    dynamicCronPrompt: args.dynamicCronPrompt,
    notificationRouteName: args.notificationRouteName,
    notificationEvent: args.notificationEvent,
    notificationMarker: args.notificationMarker,
  };
}

function parseNotificationEvent(value: string): NotificationEventName {
  if ((NOTIFICATION_EVENTS as readonly string[]).includes(value)) return value as NotificationEventName;
  throw new Error(`Unknown notification event: ${value}`);
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: CronNotificationGateResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi cron/notification gate passed.',
      `agent: ${result.agentId}`,
      `staticCron: ${JSON.stringify(result.staticCron)}`,
      `dynamicCron: ${JSON.stringify(result.dynamicCron)}`,
      `notifications: ${JSON.stringify(result.notifications)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi cron/notification gate failed: ${result.error ?? 'unknown error'}\n`);
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
    'Usage: pnpm runtime:pi-cron-notification-gate -- --agent-id <id> --peer-id <id> --sender-id <id> --static-cron-id <id> --dynamic-cron-id <id> [options]',
    '',
    'Options:',
    '  --agent-id <id>              agent directory id under --agents-dir',
    '  --agents-dir <path>          source agents directory (default: agents)',
    '  --account-id <id>            Telegram account id (default: default)',
    '  --peer-id <id>               fake Telegram peer id',
    '  --sender-id <id>             fake Telegram sender id',
    '  --static-cron-id <id>        disabled static cron id expected in agent config',
    '  --dynamic-cron-id <id>       temporary dynamic cron id',
    '  --dynamic-cron-schedule <s>  temporary dynamic cron schedule (default: */30 * * * *)',
    '  --dynamic-cron-prompt <text> temporary dynamic cron prompt',
    '  --notification-route <name>  notification route name (default: operator)',
    '  --notification-event <name>  notification event (default: escalation_needed)',
    '  --notification-marker <text> fake notification marker',
    '  --keep-data                  keep temp workspace for inspection',
    '  --json                       emit JSON',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiCronNotificationGateCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
