import 'dotenv/config';
import { resolve } from 'node:path';
import {
  createFailedLiveSendMessageGateResult,
  DEFAULT_LIVE_SEND_MESSAGE_MARKER_PREFIX,
  runLiveSendMessageGate,
  type LiveSendMessageGateDeps,
  type LiveSendMessageGateInput,
  type LiveSendMessageGateResult,
} from '../runtime/side-effect-gates/live-send-message.js';

interface PiLiveSendMessageGateArgs {
  agentId?: string;
  configPath: string;
  agentsDir: string;
  dataDir: string;
  accountId: string;
  peerId?: string;
  expectedPeerId?: string;
  markerPrefix: string;
  marker?: string;
  confirmLiveSend: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

type PiLiveSendMessageGateDeps = LiveSendMessageGateDeps & {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
};

export async function runPiLiveSendMessageGateCli(
  argv: string[],
  deps: PiLiveSendMessageGateDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  let args: PiLiveSendMessageGateArgs;
  try {
    args = parsePiLiveSendMessageGateArgs(argv);
    validateArgs(args);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (!args.dryRun && !args.confirmLiveSend) {
    stderr.write(`Refusing live send: pass --confirm-live-send after explicit operator approval.\n${usage()}\n`);
    return 2;
  }

  const gateInput = toGateInput(args);
  try {
    const result = await runLiveSendMessageGate(gateInput, deps);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const markerText = args.marker ?? `${args.markerPrefix} ${new Date((deps.now ?? Date.now)()).toISOString()}`;
    const result = createFailedLiveSendMessageGateResult(gateInput, markerText, errorMessage(err));
    writeResult(stderr, args.json, result);
    return 1;
  }
}

export function parsePiLiveSendMessageGateArgs(argv: string[]): PiLiveSendMessageGateArgs {
  const args: PiLiveSendMessageGateArgs = {
    configPath: process.env.OC_CONFIG ? resolve(process.env.OC_CONFIG) : resolve('config.yml'),
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    dataDir: process.env.OC_DATA_DIR ? resolve(process.env.OC_DATA_DIR) : resolve('data'),
    accountId: 'default',
    markerPrefix: DEFAULT_LIVE_SEND_MESSAGE_MARKER_PREFIX,
    confirmLiveSend: false,
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
      case '--marker-prefix':
        args.markerPrefix = requireValue(argv, ++i, '--marker-prefix');
        break;
      case '--marker':
        args.marker = requireValue(argv, ++i, '--marker');
        break;
      case '--confirm-live-send':
        args.confirmLiveSend = true;
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

function validateArgs(args: PiLiveSendMessageGateArgs): void {
  if (args.help) return;
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
}

function toGateInput(args: PiLiveSendMessageGateArgs): LiveSendMessageGateInput {
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  return {
    agentId: args.agentId,
    configPath: args.configPath,
    agentsDir: args.agentsDir,
    dataDir: args.dataDir,
    accountId: args.accountId,
    peerId: args.peerId,
    markerPrefix: args.markerPrefix,
    marker: args.marker,
    confirmLiveSend: args.confirmLiveSend,
    dryRun: args.dryRun,
    expectedPeerId: args.expectedPeerId,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: LiveSendMessageGateResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      `Pi live send_message ${result.dryRun ? 'dry-run' : 'gate'} passed.`,
      `agent: ${result.agentId}`,
      `target: telegram/${result.target.accountId}/${result.target.peerId}`,
      `marker: ${result.markerText}`,
      `delivery: ${JSON.stringify(result.delivery)}`,
      `metrics: ${JSON.stringify(result.metrics)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi live send_message gate failed: ${result.error ?? 'unknown error'}\n`);
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
    'Usage: pnpm runtime:pi-live-send-message-gate -- --agent-id <id> --peer-id <id> [options]',
    '',
    'Options:',
    '  --agent-id <id>          agent directory id under --agents-dir',
    '  --config <path>          global config path (default: ./config.yml or OC_CONFIG)',
    '  --agents-dir <path>      agents directory (default: ./agents or OC_AGENTS_DIR)',
    '  --data-dir <path>        data directory for metrics.sqlite (default: ./data or OC_DATA_DIR)',
    '  --account-id <id>        Telegram account id (default: default)',
    '  --peer-id <id>           Telegram peer id',
    '  --expected-peer-id <id>  optional fanout guard peer id (default: --peer-id)',
    '  --marker-prefix <text>   marker prefix (default: LIVE_SEND_MESSAGE_OK)',
    '  --marker <text>          exact text to send (default: timestamped canary marker)',
    '  --confirm-live-send      required for real Telegram delivery',
    '  --dry-run                validate policy without sending or writing metrics',
    '  --json                   emit JSON',
    '  -h, --help               show this help',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiLiveSendMessageGateCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
