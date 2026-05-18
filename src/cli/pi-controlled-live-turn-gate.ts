import 'dotenv/config';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { redactSecrets } from '../security/redact.js';
import {
  createFailedControlledLiveTurnGateResult,
  DEFAULT_CONTROLLED_LIVE_TURN_MARKER_PREFIX,
  runControlledLiveTurnGate,
  type ControlledLiveTurnGateDeps,
  type ControlledLiveTurnGateInput,
  type ControlledLiveTurnGateResult,
} from '../runtime/side-effect-gates/controlled-live-turn.js';

interface PiControlledLiveTurnGateArgs {
  agentId?: string;
  configPath: string;
  agentsDir: string;
  agentsDirs: string[];
  dataDir: string;
  accountId: string;
  peerId?: string;
  threadId?: string;
  markerPrefix: string;
  marker?: string;
  confirmControlledLiveTurn: boolean;
  dryRun: boolean;
  allowNonMentionOnly: boolean;
  json: boolean;
  help: boolean;
}

type PiControlledLiveTurnGateDeps = ControlledLiveTurnGateDeps & {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
};

export async function runPiControlledLiveTurnGateCli(
  argv: string[],
  deps: PiControlledLiveTurnGateDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  let args: PiControlledLiveTurnGateArgs;
  try {
    args = parsePiControlledLiveTurnGateArgs(argv);
    validateArgs(args);
  } catch (err) {
    stderr.write(`${redactSecrets(errorMessage(err))}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (!args.dryRun && !args.confirmControlledLiveTurn) {
    stderr.write(`Refusing controlled live turn: pass --confirm-controlled-live-turn after explicit operator approval.\n${usage()}\n`);
    return 2;
  }

  const gateInput = toGateInput(args);
  try {
    const result = await runControlledLiveTurnGate(gateInput, deps);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const markerText = args.marker ?? `${args.markerPrefix} ${new Date((deps.now ?? Date.now)()).toISOString()}`;
    const result = createFailedControlledLiveTurnGateResult(gateInput, markerText, redactSecrets(errorMessage(err)));
    writeResult(stderr, args.json, result);
    return 1;
  }
}

export function parsePiControlledLiveTurnGateArgs(argv: string[]): PiControlledLiveTurnGateArgs {
  const args: PiControlledLiveTurnGateArgs = {
    configPath: process.env.OC_CONFIG ? resolve(process.env.OC_CONFIG) : resolve('config.yml'),
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    agentsDirs: [],
    dataDir: process.env.OC_DATA_DIR ? resolve(process.env.OC_DATA_DIR) : resolve('data'),
    accountId: 'default',
    markerPrefix: DEFAULT_CONTROLLED_LIVE_TURN_MARKER_PREFIX,
    confirmControlledLiveTurn: false,
    dryRun: false,
    allowNonMentionOnly: false,
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
        args.agentsDirs.push(resolve(requireValue(argv, ++i, '--agents-dir')));
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
      case '--thread-id':
      case '--topic-id':
        args.threadId = requireValue(argv, ++i, arg);
        break;
      case '--marker-prefix':
        args.markerPrefix = requireValue(argv, ++i, '--marker-prefix');
        break;
      case '--marker':
        args.marker = requireValue(argv, ++i, '--marker');
        break;
      case '--confirm-controlled-live-turn':
        args.confirmControlledLiveTurn = true;
        break;
      case '--allow-non-mention-only':
        args.allowNonMentionOnly = true;
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

  if (args.agentsDirs.length === 0) {
    args.agentsDirs.push(args.agentsDir);
  } else {
    args.agentsDir = args.agentsDirs[0] ?? args.agentsDir;
  }

  return args;
}

function validateArgs(args: PiControlledLiveTurnGateArgs): void {
  if (args.help) return;
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.threadId) throw new Error('--thread-id is required for controlled Telegram group turns.');
}

function toGateInput(args: PiControlledLiveTurnGateArgs): ControlledLiveTurnGateInput {
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.threadId) throw new Error('--thread-id is required.');
  return {
    agentId: args.agentId,
    configPath: args.configPath,
    agentsDir: resolveAgentRoot(args),
    dataDir: args.dataDir,
    accountId: args.accountId,
    peerId: args.peerId,
    threadId: args.threadId,
    markerPrefix: args.markerPrefix,
    marker: args.marker,
    confirmControlledLiveTurn: args.confirmControlledLiveTurn,
    dryRun: args.dryRun,
    allowNonMentionOnly: args.allowNonMentionOnly,
  };
}

function resolveAgentRoot(args: PiControlledLiveTurnGateArgs): string {
  if (!args.agentId) throw new Error('--agent-id is required.');
  const matchingRoot = args.agentsDirs.find((root) => existsSync(join(root, args.agentId ?? '', 'agent.yml')));
  if (!matchingRoot) {
    throw new Error(`${args.agentId} was not found under any --agents-dir root.`);
  }
  return matchingRoot;
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: ControlledLiveTurnGateResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      `Pi controlled live turn ${result.dryRun ? 'dry-run' : 'gate'} passed.`,
      `agent: ${result.agentId}`,
      `target: telegram/${result.target.accountId}/${result.target.peerId}/${result.target.threadId ?? 'root'}`,
      `marker: ${result.markerText}`,
      `delivery: ${JSON.stringify(result.delivery)}`,
      `monitor next: ${result.monitorNext}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi controlled live turn gate failed: ${result.error ?? 'unknown error'}\n`);
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
    'Usage: pnpm runtime:pi-controlled-live-turn-gate -- --agent-id <id> --agents-dir <root> --peer-id <id> --thread-id <id> --dry-run [--json]',
    '',
    'Runs a generic controlled Telegram group live-turn gate for any configured agent.',
    '',
    'Options:',
    '  --agent-id <id>                    agent directory id under one of the --agents-dir roots',
    '  --config <path>                    global config path (default: ./config.yml or OC_CONFIG)',
    '  --agents-dir <path>                repeatable agents root; use tracked and live-only roots when split',
    '  --data-dir <path>                  data directory for metrics.sqlite (default: ./data or OC_DATA_DIR)',
    '  --account-id <id>                  Telegram account id (default: default)',
    '  --peer-id <id>                     Telegram group peer id',
    '  --thread-id, --topic-id <id>        Telegram forum topic id',
    '  --marker-prefix <text>             marker prefix (default: CONTROLLED_LIVE_TURN_OK)',
    '  --marker <text>                    exact text to send (default: timestamped canary marker)',
    '  --confirm-controlled-live-turn     required for real Telegram delivery',
    '  --allow-non-mention-only           allow a non-mention-only group route; default requires mention_only=true',
    '  --dry-run                          validate policy without sending or writing metrics',
    '  --json                             emit JSON',
    '  -h, --help                         show this help',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiControlledLiveTurnGateCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${redactSecrets(errorMessage(err))}\n`);
      process.exitCode = 1;
    });
}
