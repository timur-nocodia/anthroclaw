import 'dotenv/config';
import { resolve } from 'node:path';
import {
  createFailedLiveNotificationGateResult,
  DEFAULT_LIVE_NOTIFICATION_EVENT,
  DEFAULT_LIVE_NOTIFICATION_ROUTE,
  runLiveNotificationGate,
  type LiveNotificationGateDeps,
  type LiveNotificationGateInput,
  type LiveNotificationGateResult,
} from '../runtime/side-effect-gates/live-notification.js';

const AGENT_ID = 'timur_agent';
const ACCOUNT_ID = 'default';
const DEFAULT_PEER_ID = '48705953';
const MARKER_PREFIX = 'TIMUR_AGENT_LIVE_NOTIFICATION_OK';

interface PiTimurAgentLiveNotificationArgs {
  configPath: string;
  agentsDir: string;
  dataDir: string;
  accountId: string;
  peerId: string;
  note?: string;
  confirmLiveNotification: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

type PiTimurAgentLiveNotificationDeps = LiveNotificationGateDeps & {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
};

type PiTimurAgentLiveNotificationResult = LiveNotificationGateResult;

export async function runPiTimurAgentLiveNotificationCli(
  argv: string[],
  deps: PiTimurAgentLiveNotificationDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  let args: PiTimurAgentLiveNotificationArgs;
  try {
    args = parsePiTimurAgentLiveNotificationArgs(argv);
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

  try {
    const result = await runPiTimurAgentLiveNotification(args, deps);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const note = args.note ?? `${MARKER_PREFIX} ${new Date((deps.now ?? Date.now)()).toISOString()}`;
    const result = createFailedLiveNotificationGateResult(toGateInput(args), note, errorMessage(err));
    writeResult(stderr, args.json, result);
    return 1;
  }
}

export async function runPiTimurAgentLiveNotification(
  input: PiTimurAgentLiveNotificationArgs,
  deps: LiveNotificationGateDeps = {},
): Promise<PiTimurAgentLiveNotificationResult> {
  return runLiveNotificationGate(toGateInput(input), deps);
}

export function parsePiTimurAgentLiveNotificationArgs(argv: string[]): PiTimurAgentLiveNotificationArgs {
  const args: PiTimurAgentLiveNotificationArgs = {
    configPath: process.env.OC_CONFIG ? resolve(process.env.OC_CONFIG) : resolve('config.yml'),
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    dataDir: process.env.OC_DATA_DIR ? resolve(process.env.OC_DATA_DIR) : resolve('data'),
    accountId: ACCOUNT_ID,
    peerId: DEFAULT_PEER_ID,
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

function toGateInput(args: PiTimurAgentLiveNotificationArgs): LiveNotificationGateInput {
  return {
    agentId: AGENT_ID,
    configPath: args.configPath,
    agentsDir: args.agentsDir,
    dataDir: args.dataDir,
    accountId: args.accountId,
    peerId: args.peerId,
    eventName: DEFAULT_LIVE_NOTIFICATION_EVENT,
    routeName: DEFAULT_LIVE_NOTIFICATION_ROUTE,
    markerPrefix: MARKER_PREFIX,
    note: args.note,
    confirmLiveNotification: args.confirmLiveNotification,
    dryRun: args.dryRun,
    expectedPeerId: DEFAULT_PEER_ID,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTimurAgentLiveNotificationResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      `Pi timur_agent live notification ${result.dryRun ? 'dry-run' : 'gate'} passed.`,
      `target: telegram/${result.target.accountId}/${result.target.peerId}`,
      `note: ${result.note}`,
      `delivery: ${JSON.stringify(result.delivery)}`,
      `metrics: ${JSON.stringify(result.metrics)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi timur_agent live notification gate failed: ${result.error ?? 'unknown error'}\n`);
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
    'Usage: pnpm runtime:pi-timur-agent-live-notification -- [options]',
    '',
    'Options:',
    '  --config <path>                 global config path (default: ./config.yml or OC_CONFIG)',
    '  --agents-dir <path>             agents directory containing timur_agent (default: ./agents or OC_AGENTS_DIR)',
    '  --data-dir <path>               data directory for metrics.sqlite (default: ./data or OC_DATA_DIR)',
    '  --account-id <id>               Telegram account id (default: default)',
    '  --peer-id <id>                  Telegram peer id (default: operator peer)',
    '  --note <text>                   escalation note (default: timestamped canary marker)',
    '  --confirm-live-notification     required for real Telegram notification delivery',
    '  --dry-run                       validate policy without sending or writing metrics',
    '  --json                          emit JSON',
    '  -h, --help                      show this help',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentLiveNotificationCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
