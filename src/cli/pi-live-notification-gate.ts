import 'dotenv/config';
import { resolve } from 'node:path';
import {
  createFailedLiveNotificationGateResult,
  DEFAULT_LIVE_NOTIFICATION_EVENT,
  DEFAULT_LIVE_NOTIFICATION_MARKER_PREFIX,
  DEFAULT_LIVE_NOTIFICATION_ROUTE,
  runLiveNotificationGate,
  type LiveNotificationGateDeps,
  type LiveNotificationGateInput,
  type LiveNotificationGateResult,
} from '../runtime/side-effect-gates/live-notification.js';
import type { NotificationEventName } from '../notifications/types.js';

interface PiLiveNotificationGateArgs {
  agentId?: string;
  configPath: string;
  agentsDir: string;
  dataDir: string;
  accountId: string;
  peerId?: string;
  expectedPeerId?: string;
  eventName: NotificationEventName;
  routeName: string;
  markerPrefix: string;
  note?: string;
  confirmLiveNotification: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

type PiLiveNotificationGateDeps = LiveNotificationGateDeps & {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
};

const NOTIFICATION_EVENTS: readonly NotificationEventName[] = [
  'peer_pause_started',
  'peer_pause_ended',
  'peer_pause_intervened_during_generation',
  'peer_pause_summary_daily',
  'agent_error',
  'iteration_budget_exhausted',
  'escalation_needed',
];

export async function runPiLiveNotificationGateCli(
  argv: string[],
  deps: PiLiveNotificationGateDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  let args: PiLiveNotificationGateArgs;
  try {
    args = parsePiLiveNotificationGateArgs(argv);
    validateArgs(args);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (!args.dryRun && !args.confirmLiveNotification) {
    stderr.write(`Refusing live notification: pass --confirm-live-notification after explicit operator approval.\n${usage()}\n`);
    return 2;
  }

  const gateInput = toGateInput(args);
  try {
    const result = await runLiveNotificationGate(gateInput, deps);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const note = args.note ?? `${args.markerPrefix} ${new Date((deps.now ?? Date.now)()).toISOString()}`;
    const result = createFailedLiveNotificationGateResult(gateInput, note, errorMessage(err));
    writeResult(stderr, args.json, result);
    return 1;
  }
}

export function parsePiLiveNotificationGateArgs(argv: string[]): PiLiveNotificationGateArgs {
  const args: PiLiveNotificationGateArgs = {
    configPath: process.env.OC_CONFIG ? resolve(process.env.OC_CONFIG) : resolve('config.yml'),
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    dataDir: process.env.OC_DATA_DIR ? resolve(process.env.OC_DATA_DIR) : resolve('data'),
    accountId: 'default',
    eventName: DEFAULT_LIVE_NOTIFICATION_EVENT,
    routeName: DEFAULT_LIVE_NOTIFICATION_ROUTE,
    markerPrefix: DEFAULT_LIVE_NOTIFICATION_MARKER_PREFIX,
    confirmLiveNotification: false,
    dryRun: false,
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
      case '--config':
        args.configPath = resolve(requireValue(argv, ++i, '--config'));
        break;
      case '--agents-dir':
        args.agentsDir = resolve(requireValue(argv, ++i, '--agents-dir'));
        break;
      case '--data-dir':
        args.dataDir = resolve(requireValue(argv, ++i, '--data-dir'));
        break;
      case '--account-id':
        args.accountId = requireValue(argv, ++i, '--account-id');
        break;
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
        break;
      case '--expected-peer-id':
        args.expectedPeerId = requireValue(argv, ++i, '--expected-peer-id');
        break;
      case '--event':
      case '--event-name':
        args.eventName = parseNotificationEvent(requireValue(argv, ++i, arg));
        break;
      case '--route':
      case '--route-name':
        args.routeName = requireValue(argv, ++i, arg);
        break;
      case '--marker-prefix':
        args.markerPrefix = requireValue(argv, ++i, '--marker-prefix');
        break;
      case '--note':
        args.note = requireValue(argv, ++i, '--note');
        break;
      case '--confirm-live-notification':
        args.confirmLiveNotification = true;
        break;
      case '--dry-run':
        args.dryRun = true;
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

function validateArgs(args: PiLiveNotificationGateArgs): void {
  if (args.help) return;
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
}

function toGateInput(args: PiLiveNotificationGateArgs): LiveNotificationGateInput {
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  return {
    agentId: args.agentId,
    configPath: args.configPath,
    agentsDir: args.agentsDir,
    dataDir: args.dataDir,
    accountId: args.accountId,
    peerId: args.peerId,
    eventName: args.eventName,
    routeName: args.routeName,
    markerPrefix: args.markerPrefix,
    note: args.note,
    confirmLiveNotification: args.confirmLiveNotification,
    dryRun: args.dryRun,
    expectedPeerId: args.expectedPeerId,
  };
}

function parseNotificationEvent(value: string): NotificationEventName {
  if ((NOTIFICATION_EVENTS as readonly string[]).includes(value)) return value as NotificationEventName;
  throw new Error(`Unknown notification event: ${value}`);
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: LiveNotificationGateResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      `Pi live notification ${result.dryRun ? 'dry-run' : 'gate'} passed.`,
      `agent: ${result.agentId}`,
      `target: telegram/${result.target.accountId}/${result.target.peerId}`,
      `event: ${result.notification.event}`,
      `route: ${result.notification.routeName}`,
      `note: ${result.note}`,
      `delivery: ${JSON.stringify(result.delivery)}`,
      `metrics: ${JSON.stringify(result.metrics)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi live notification gate failed: ${result.error ?? 'unknown error'}\n`);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-live-notification-gate -- --agent-id <id> --peer-id <id> [options]',
    '',
    'Options:',
    '  --agent-id <id>              agent directory id under --agents-dir',
    '  --config <path>              global config path (default: ./config.yml or OC_CONFIG)',
    '  --agents-dir <path>          agents directory (default: ./agents or OC_AGENTS_DIR)',
    '  --data-dir <path>            data directory for metrics.sqlite (default: ./data or OC_DATA_DIR)',
    '  --account-id <id>            Telegram account id (default: default)',
    '  --peer-id <id>               Telegram peer id',
    '  --expected-peer-id <id>      optional fanout guard peer id (default: --peer-id)',
    '  --event-name <event>         notification event (default: escalation_needed)',
    '  --route-name <name>          notification route name (default: operator)',
    '  --marker-prefix <text>       marker prefix (default: LIVE_NOTIFICATION_OK)',
    '  --note <text>                event note (default: timestamped canary marker)',
    '  --confirm-live-notification  required for real Telegram notification delivery',
    '  --dry-run                    validate policy without sending or writing metrics',
    '  --json                       emit JSON',
    '  -h, --help                   show this help',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiLiveNotificationGateCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
