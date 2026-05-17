import 'dotenv/config';
import { resolve } from 'node:path';
import { collectPiMonitorSnapshot } from './pi-monitor.js';
import { collectPiTelegramLabLiveCheck } from './pi-telegram-lab-live-check.js';

const DEFAULT_AGENT_ID = 'pi_telegram_lab';
const DEFAULT_PEER_ID = '48705953';

interface PiTelegramLabPostTurnArgs {
  dataDir: string;
  metricsDb?: string;
  agentId: string;
  peerId: string;
  accountId: string;
  sinceMinutes: number;
  staleMinutes: number;
  failOnPending: boolean;
  json: boolean;
  help: boolean;
}

interface PostTurnCheck {
  name: string;
  status: 'passed' | 'pending' | 'alert';
  summary: string;
  details: unknown;
}

interface PiTelegramLabPostTurnResult {
  status: 'passed' | 'pending' | 'alert';
  agentId: string;
  peerId: string;
  checks: PostTurnCheck[];
  nextStep: string;
}

interface PiTelegramLabPostTurnDeps {
  now?: () => number;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runPiTelegramLabPostTurnCli(
  argv: string[],
  deps: PiTelegramLabPostTurnDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTelegramLabPostTurnArgs;

  try {
    args = parsePiTelegramLabPostTurnArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const result = collectPiTelegramLabPostTurn(args, deps.now ?? Date.now);
  const target = result.status === 'alert' || (result.status === 'pending' && args.failOnPending)
    ? stderr
    : stdout;
  writeResult(target, args.json, result);
  if (result.status === 'alert') return 1;
  if (result.status === 'pending' && args.failOnPending) return 1;
  return 0;
}

export function parsePiTelegramLabPostTurnArgs(argv: string[]): PiTelegramLabPostTurnArgs {
  const args: PiTelegramLabPostTurnArgs = {
    dataDir: process.env.OC_DATA_DIR ? resolve(process.env.OC_DATA_DIR) : resolve('data'),
    agentId: DEFAULT_AGENT_ID,
    peerId: DEFAULT_PEER_ID,
    accountId: 'default',
    sinceMinutes: 60,
    staleMinutes: 10,
    failOnPending: false,
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
      case '--data-dir':
        args.dataDir = resolve(requireValue(argv, ++i, '--data-dir'));
        break;
      case '--metrics-db':
        args.metricsDb = resolve(requireValue(argv, ++i, '--metrics-db'));
        break;
      case '--agent':
        args.agentId = requireValue(argv, ++i, '--agent');
        break;
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
        break;
      case '--account-id':
        args.accountId = requireValue(argv, ++i, '--account-id');
        break;
      case '--since-minutes':
        args.sinceMinutes = positiveInteger(requireValue(argv, ++i, '--since-minutes'), '--since-minutes');
        break;
      case '--stale-minutes':
        args.staleMinutes = positiveInteger(requireValue(argv, ++i, '--stale-minutes'), '--stale-minutes');
        break;
      case '--fail-on-pending':
        args.failOnPending = true;
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

export function collectPiTelegramLabPostTurn(
  args: Pick<
    PiTelegramLabPostTurnArgs,
    'dataDir' | 'metricsDb' | 'agentId' | 'peerId' | 'accountId' | 'sinceMinutes' | 'staleMinutes'
  >,
  nowFn: () => number = Date.now,
): PiTelegramLabPostTurnResult {
  const liveCheck = collectPiTelegramLabLiveCheck(args, nowFn);
  const monitor = collectPiMonitorSnapshot(args, nowFn);
  const checks: PostTurnCheck[] = [
    {
      name: 'live-telegram-turn',
      status: liveCheck.status,
      summary: liveCheck.status === 'passed'
        ? `found ${liveCheck.runs.succeeded} successful live Telegram run(s)`
        : liveCheck.status === 'pending'
          ? 'no successful live Telegram run found in the window'
          : liveCheck.alerts.join('; ') || 'live Telegram check alerted',
      details: liveCheck,
    },
    {
      name: 'runtime-monitor',
      status: monitor.status === 'passed' ? 'passed' : 'alert',
      summary: monitor.status === 'passed'
        ? `monitor passed: alerts=${monitor.alerts.length}, warnings=${monitor.warnings.length}`
        : monitor.alerts.join('; ') || 'runtime monitor alerted',
      details: monitor,
    },
  ];

  const hasAlert = checks.some((check) => check.status === 'alert');
  const hasPending = checks.some((check) => check.status === 'pending');

  return {
    status: hasAlert ? 'alert' : hasPending ? 'pending' : 'passed',
    agentId: args.agentId,
    peerId: args.peerId,
    checks,
    nextStep: liveCheck.nextStep,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTelegramLabPostTurnResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stream.write(`Pi Telegram lab post-turn gate: ${result.status}\n`);
  for (const check of result.checks) {
    stream.write(`- ${check.status} ${check.name}: ${check.summary}\n`);
  }
  if (result.status === 'pending') {
    stream.write(`next: ${result.nextStep}\n`);
  }
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-telegram-lab-post-turn -- [--json] [--fail-on-pending]',
    '',
    'Options:',
    '  --data-dir <path>       live data directory containing metrics.sqlite (default: data)',
    '  --metrics-db <path>     explicit metrics.sqlite path',
    '  --agent <id>            agent id to check (default: pi_telegram_lab)',
    '  --peer-id <id>          Telegram peer id to check (default: 48705953)',
    '  --account-id <id>       Telegram account id to check (default: default)',
    '  --since-minutes <n>     post-turn search window (default: 60)',
    '  --stale-minutes <n>     stale running threshold (default: 10)',
    '  --fail-on-pending       exit 1 when no matching live Telegram turn has run yet',
    '  --json                  print structured post-turn result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTelegramLabPostTurnCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
