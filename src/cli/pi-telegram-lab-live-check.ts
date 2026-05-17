import 'dotenv/config';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

const DEFAULT_AGENT_ID = 'pi_telegram_lab';
const DEFAULT_PEER_ID = '48705953';

interface PiTelegramLabLiveCheckArgs {
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

interface LiveRun {
  runId: string;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
  agentId: string;
  source: string;
  channel: string;
  accountId?: string;
  peerId?: string;
  messageId?: string;
  sessionKey: string;
  sdkSessionId?: string;
  status: string;
  model?: string;
  error?: string;
}

interface PiTelegramLabLiveCheckResult {
  status: 'passed' | 'pending' | 'alert';
  agentId: string;
  peerId: string;
  metricsDb: string;
  window: {
    sinceMinutes: number;
    staleMinutes: number;
    since: string;
    now: string;
  };
  runs: {
    total: number;
    succeeded: number;
    failed: number;
    interrupted: number;
    running: number;
    staleRunning: number;
    latest?: LiveRun;
    latestSucceeded?: LiveRun;
    recent: LiveRun[];
  };
  alerts: string[];
  warnings: string[];
  nextStep: string;
}

interface RunRow {
  run_id: string;
  started_at: number;
  updated_at: number;
  completed_at: number | null;
  agent_id: string;
  source: string;
  channel: string;
  account_id: string | null;
  peer_id: string | null;
  message_id: string | null;
  session_key: string;
  sdk_session_id: string | null;
  status: string;
  model: string | null;
  error: string | null;
}

interface PiTelegramLabLiveCheckDeps {
  now?: () => number;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runPiTelegramLabLiveCheckCli(
  argv: string[],
  deps: PiTelegramLabLiveCheckDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTelegramLabLiveCheckArgs;

  try {
    args = parsePiTelegramLabLiveCheckArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const result = collectPiTelegramLabLiveCheck(args, deps.now ?? Date.now);
  const target = result.status === 'alert' || (result.status === 'pending' && args.failOnPending)
    ? stderr
    : stdout;
  writeResult(target, args.json, result);
  if (result.status === 'alert') return 1;
  if (result.status === 'pending' && args.failOnPending) return 1;
  return 0;
}

export function parsePiTelegramLabLiveCheckArgs(argv: string[]): PiTelegramLabLiveCheckArgs {
  const args: PiTelegramLabLiveCheckArgs = {
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

export function collectPiTelegramLabLiveCheck(
  args: Pick<
    PiTelegramLabLiveCheckArgs,
    'dataDir' | 'metricsDb' | 'agentId' | 'peerId' | 'accountId' | 'sinceMinutes' | 'staleMinutes'
  >,
  nowFn: () => number = Date.now,
): PiTelegramLabLiveCheckResult {
  const now = nowFn();
  const since = now - args.sinceMinutes * 60_000;
  const staleBefore = now - args.staleMinutes * 60_000;
  const metricsDb = args.metricsDb ?? join(args.dataDir, 'metrics.sqlite');
  const base = {
    agentId: args.agentId,
    peerId: args.peerId,
    metricsDb,
    window: {
      sinceMinutes: args.sinceMinutes,
      staleMinutes: args.staleMinutes,
      since: new Date(since).toISOString(),
      now: new Date(now).toISOString(),
    },
    nextStep: `Send Telegram DM to the bot: Ответь ровно: PI_TELEGRAM_LAB_OK`,
  };

  if (!existsSync(metricsDb)) {
    return {
      ...base,
      status: 'alert',
      runs: emptyRuns(),
      alerts: [`metrics database not found: ${metricsDb}`],
      warnings: [],
    };
  }

  const db = new Database(metricsDb, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`
      SELECT
        run_id,
        started_at,
        updated_at,
        completed_at,
        agent_id,
        source,
        channel,
        account_id,
        peer_id,
        message_id,
        session_key,
        sdk_session_id,
        status,
        model,
        error
      FROM agent_runs
      WHERE started_at >= ?
        AND agent_id = ?
        AND source = 'channel'
        AND channel = 'telegram'
        AND coalesce(account_id, 'default') = ?
        AND peer_id = ?
      ORDER BY started_at DESC
      LIMIT 25
    `).all(since, args.agentId, args.accountId, args.peerId) as RunRow[];
    const runs = rows.map(mapRunRow);
    const succeeded = runs.filter((run) => run.status === 'succeeded');
    const failed = runs.filter((run) => run.status === 'failed');
    const interrupted = runs.filter((run) => run.status === 'interrupted');
    const running = runs.filter((run) => run.status === 'running');
    const staleRunning = rows.filter((row) => row.status === 'running' && row.started_at < staleBefore);
    const alerts: string[] = [];
    const warnings: string[] = [];

    if (staleRunning.length > 0) {
      alerts.push(`${staleRunning.length} stale running live Telegram lab run(s)`);
    }
    if (failed.length > 0 || interrupted.length > 0) {
      warnings.push(`${failed.length} failed and ${interrupted.length} interrupted live Telegram lab run(s) in window`);
    }

    const latest = runs[0];
    const latestSucceeded = succeeded[0];
    let status: PiTelegramLabLiveCheckResult['status'] = 'pending';
    if (alerts.length > 0) {
      status = 'alert';
    } else if (latestSucceeded) {
      status = 'passed';
    } else if (runs.some((run) => run.status === 'failed' || run.status === 'interrupted')) {
      status = 'alert';
      alerts.push('live Telegram lab turn exists but did not succeed');
    }

    return {
      ...base,
      status,
      runs: {
        total: runs.length,
        succeeded: succeeded.length,
        failed: failed.length,
        interrupted: interrupted.length,
        running: running.length,
        staleRunning: staleRunning.length,
        latest,
        latestSucceeded,
        recent: runs,
      },
      alerts,
      warnings,
    };
  } finally {
    db.close();
  }
}

function mapRunRow(row: RunRow): LiveRun {
  return {
    runId: row.run_id,
    startedAt: new Date(row.started_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
    agentId: row.agent_id,
    source: row.source,
    channel: row.channel,
    accountId: row.account_id ?? undefined,
    peerId: row.peer_id ?? undefined,
    messageId: row.message_id ?? undefined,
    sessionKey: row.session_key,
    sdkSessionId: row.sdk_session_id ?? undefined,
    status: row.status,
    model: row.model ?? undefined,
    error: row.error ?? undefined,
  };
}

function emptyRuns(): PiTelegramLabLiveCheckResult['runs'] {
  return {
    total: 0,
    succeeded: 0,
    failed: 0,
    interrupted: 0,
    running: 0,
    staleRunning: 0,
    recent: [],
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTelegramLabLiveCheckResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stream.write(`Pi Telegram lab live check: ${result.status}\n`);
  stream.write(`runs: total=${result.runs.total}, succeeded=${result.runs.succeeded}, failed=${result.runs.failed}, interrupted=${result.runs.interrupted}, running=${result.runs.running}\n`);
  if (result.runs.latestSucceeded) {
    stream.write(`latest succeeded: ${result.runs.latestSucceeded.startedAt} runId=${result.runs.latestSucceeded.runId}\n`);
  }
  for (const alert of result.alerts) {
    stream.write(`alert: ${alert}\n`);
  }
  for (const warning of result.warnings) {
    stream.write(`warning: ${warning}\n`);
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
    'Usage: pnpm runtime:pi-telegram-lab-live-check -- [--json] [--fail-on-pending]',
    '',
    'Options:',
    '  --data-dir <path>       live data directory containing metrics.sqlite (default: data)',
    '  --metrics-db <path>     explicit metrics.sqlite path',
    '  --agent <id>            agent id to check (default: pi_telegram_lab)',
    '  --peer-id <id>          Telegram peer id to check (default: 48705953)',
    '  --account-id <id>       Telegram account id to check (default: default)',
    '  --since-minutes <n>     live-turn search window (default: 60)',
    '  --stale-minutes <n>     stale running threshold (default: 10)',
    '  --fail-on-pending       exit 1 when no matching live Telegram turn has run yet',
    '  --json                  print structured live-check result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTelegramLabLiveCheckCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
