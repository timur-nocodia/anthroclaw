import 'dotenv/config';
import { resolve } from 'node:path';
import {
  createFailedLiveSendMediaGateResult,
  DEFAULT_LIVE_SEND_MEDIA_MARKER_PREFIX,
  runLiveSendMediaGate,
  type LiveSendMediaGateDeps,
  type LiveSendMediaGateInput,
  type LiveSendMediaGateResult,
} from '../runtime/side-effect-gates/live-send-media.js';

interface PiLiveSendMediaGateArgs {
  agentId?: string;
  configPath: string;
  agentsDir: string;
  dataDir: string;
  workspacePath: string;
  accountId: string;
  peerId?: string;
  expectedPeerId?: string;
  filePath?: string;
  allowedFileRoot?: string;
  markerPrefix: string;
  caption?: string;
  confirmLiveSendMedia: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

type PiLiveSendMediaGateDeps = LiveSendMediaGateDeps & {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
};

export async function runPiLiveSendMediaGateCli(
  argv: string[],
  deps: PiLiveSendMediaGateDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  let args: PiLiveSendMediaGateArgs;
  try {
    args = parsePiLiveSendMediaGateArgs(argv);
    validateArgs(args);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (!args.dryRun && !args.confirmLiveSendMedia) {
    stderr.write(`Refusing live media send: pass --confirm-live-send-media after explicit operator approval.\n${usage()}\n`);
    return 2;
  }

  const gateInput = toGateInput(args);
  try {
    const result = await runLiveSendMediaGate(gateInput, deps);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result = createFailedLiveSendMediaGateResult(gateInput, errorMessage(err));
    writeResult(stderr, args.json, result);
    return 1;
  }
}

export function parsePiLiveSendMediaGateArgs(argv: string[]): PiLiveSendMediaGateArgs {
  const args: PiLiveSendMediaGateArgs = {
    configPath: process.env.OC_CONFIG ? resolve(process.env.OC_CONFIG) : resolve('config.yml'),
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    dataDir: process.env.OC_DATA_DIR ? resolve(process.env.OC_DATA_DIR) : resolve('data'),
    workspacePath: process.env.OC_WORKSPACE_DIR ? resolve(process.env.OC_WORKSPACE_DIR) : resolve('.'),
    accountId: 'default',
    markerPrefix: DEFAULT_LIVE_SEND_MEDIA_MARKER_PREFIX,
    confirmLiveSendMedia: false,
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
      case '--workspace':
        args.workspacePath = resolve(requireValue(argv, ++i, '--workspace'));
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
      case '--file-path':
        args.filePath = requireValue(argv, ++i, '--file-path');
        break;
      case '--allowed-file-root':
        args.allowedFileRoot = requireValue(argv, ++i, '--allowed-file-root');
        break;
      case '--marker-prefix':
        args.markerPrefix = requireValue(argv, ++i, '--marker-prefix');
        break;
      case '--caption':
        args.caption = requireValue(argv, ++i, '--caption');
        break;
      case '--confirm-live-send-media':
        args.confirmLiveSendMedia = true;
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

function validateArgs(args: PiLiveSendMediaGateArgs): void {
  if (args.help) return;
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.filePath) throw new Error('--file-path is required.');
  if (!args.allowedFileRoot) throw new Error('--allowed-file-root is required.');
}

function toGateInput(args: PiLiveSendMediaGateArgs): LiveSendMediaGateInput {
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.filePath) throw new Error('--file-path is required.');
  if (!args.allowedFileRoot) throw new Error('--allowed-file-root is required.');
  return {
    agentId: args.agentId,
    configPath: args.configPath,
    agentsDir: args.agentsDir,
    dataDir: args.dataDir,
    workspacePath: args.workspacePath,
    accountId: args.accountId,
    peerId: args.peerId,
    filePath: args.filePath,
    allowedFileRoot: args.allowedFileRoot,
    mediaType: 'document',
    markerPrefix: args.markerPrefix,
    caption: args.caption,
    confirmLiveSendMedia: args.confirmLiveSendMedia,
    dryRun: args.dryRun,
    expectedPeerId: args.expectedPeerId,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: LiveSendMediaGateResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      `Pi live send_media ${result.dryRun ? 'dry-run' : 'gate'} passed.`,
      `agent: ${result.agentId}`,
      `target: telegram/${result.target.accountId}/${result.target.peerId}`,
      `file: ${result.media.filePath}`,
      `caption: ${result.media.caption}`,
      `delivery: ${JSON.stringify(result.delivery)}`,
      `metrics: ${JSON.stringify(result.metrics)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi live send_media gate failed: ${result.error ?? 'unknown error'}\n`);
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
    'Usage: pnpm runtime:pi-live-send-media-gate -- --agent-id <id> --peer-id <id> --file-path <path> --allowed-file-root <path> [options]',
    '',
    'Options:',
    '  --agent-id <id>              agent directory id under --agents-dir',
    '  --config <path>              global config path (default: ./config.yml or OC_CONFIG)',
    '  --agents-dir <path>          agents directory (default: ./agents or OC_AGENTS_DIR)',
    '  --data-dir <path>            data directory for metrics.sqlite (default: ./data or OC_DATA_DIR)',
    '  --workspace <path>           workspace root for media path resolution (default: . or OC_WORKSPACE_DIR)',
    '  --account-id <id>            Telegram account id (default: default)',
    '  --peer-id <id>               Telegram peer id',
    '  --expected-peer-id <id>      optional fanout guard peer id (default: --peer-id)',
    '  --file-path <path>           document path relative to workspace',
    '  --allowed-file-root <path>   allowed document root relative to workspace',
    '  --marker-prefix <text>       marker prefix (default: LIVE_SEND_MEDIA_OK)',
    '  --caption <text>             document caption (default: timestamped canary marker)',
    '  --confirm-live-send-media    required for real Telegram document delivery',
    '  --dry-run                    validate policy without sending or writing metrics',
    '  --json                       emit JSON',
    '  -h, --help                   show this help',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiLiveSendMediaGateCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
