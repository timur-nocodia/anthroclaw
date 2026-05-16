import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

type CountMap = Record<string, number>;

interface PiMonitorArgs {
  dataDir: string;
  metricsDb?: string;
  sinceMinutes: number;
  staleMinutes: number;
  failOnAlert: boolean;
  json: boolean;
  help: boolean;
}

interface PiMonitorDeps {
  now?: () => number;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface RecentRun {
  startedAt: string;
  agentId: string;
  source: string;
  channel: string;
  status: string;
  model?: string;
  runId: string;
  error?: string;
}

interface PiMonitorResult {
  status: 'passed' | 'alert';
  runtime: 'pi';
  metricsDb: string;
  window: {
    sinceMinutes: number;
    staleMinutes: number;
    since: string;
    now: string;
  };
  runs: {
    total: number;
    byStatus: CountMap;
    failed: number;
    interrupted: number;
    staleRunning: number;
    recentFailures: RecentRun[];
  };
  diagnostics: {
    byType: CountMap;
    authOrModelErrors: number;
  };
  tools: {
    byStatus: CountMap;
    failedByTool: CountMap;
  };
  alerts: string[];
  warnings: string[];
}

interface CountRow {
  key: string | null;
  count: number;
}

interface RecentRunRow {
  started_at: number;
  agent_id: string;
  source: string;
  channel: string;
  status: string;
  model: string | null;
  run_id: string;
  error: string | null;
}

export async function runPiMonitorCli(
  argv: string[],
  deps: PiMonitorDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  let args: PiMonitorArgs;
  try {
    args = parsePiMonitorArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const result = collectPiMonitorSnapshot(args, deps.now ?? Date.now);
    const target = result.status === 'alert' && args.failOnAlert ? stderr : stdout;
    target.write(args.json ? `${JSON.stringify(result)}\n` : renderHuman(result));
    return result.status === 'alert' && args.failOnAlert ? 1 : 0;
  } catch (err) {
    const result = missingOrUnreadableResult(args, deps.now ?? Date.now, errorMessage(err));
    const target = args.failOnAlert ? stderr : stdout;
    target.write(args.json ? `${JSON.stringify(result)}\n` : renderHuman(result));
    return args.failOnAlert ? 1 : 0;
  }
}

export function parsePiMonitorArgs(argv: string[]): PiMonitorArgs {
  const args: PiMonitorArgs = {
    dataDir: process.env.OC_DATA_DIR ? resolve(process.env.OC_DATA_DIR) : resolve('data'),
    sinceMinutes: 60,
    staleMinutes: 10,
    failOnAlert: false,
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
      case '--since-minutes':
        args.sinceMinutes = positiveInteger(requireValue(argv, ++i, '--since-minutes'), '--since-minutes');
        break;
      case '--stale-minutes':
        args.staleMinutes = positiveInteger(requireValue(argv, ++i, '--stale-minutes'), '--stale-minutes');
        break;
      case '--fail-on-alert':
        args.failOnAlert = true;
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

export function collectPiMonitorSnapshot(
  args: Pick<PiMonitorArgs, 'dataDir' | 'metricsDb' | 'sinceMinutes' | 'staleMinutes'>,
  nowFn: () => number = Date.now,
): PiMonitorResult {
  const now = nowFn();
  const since = now - args.sinceMinutes * 60_000;
  const staleBefore = now - args.staleMinutes * 60_000;
  const metricsDb = args.metricsDb ?? join(args.dataDir, 'metrics.sqlite');

  if (!existsSync(metricsDb)) {
    return missingOrUnreadableResult(args, nowFn, `metrics database not found: ${metricsDb}`);
  }

  const db = new Database(metricsDb, { readonly: true, fileMustExist: true });
  try {
    const byStatus = countMap(db, `
      SELECT status AS key, count(*) AS count
      FROM agent_runs
      WHERE started_at >= ?
      GROUP BY status
    `, since);
    const totalRuns = sumCounts(byStatus);
    const failed = byStatus.failed ?? 0;
    const interrupted = byStatus.interrupted ?? 0;
    const staleRunning = scalarCount(db, `
      SELECT count(*)
      FROM agent_runs
      WHERE status = 'running' AND started_at < ?
    `, staleBefore);
    const recentFailures = recentFailureRows(db, since);
    const diagnosticsByType = countMap(db, `
      SELECT event_type AS key, count(*) AS count
      FROM diagnostic_events
      WHERE ts >= ?
      GROUP BY event_type
    `, since);
    const authOrModelErrors = scalarCount(db, `
      SELECT count(*)
      FROM diagnostic_events
      WHERE ts >= ?
        AND (
          lower(event_type) LIKE '%auth%'
          OR lower(event_type) LIKE '%model%'
          OR lower(detail_json) LIKE '%auth%'
          OR lower(detail_json) LIKE '%credential%'
          OR lower(detail_json) LIKE '%model not%'
          OR lower(detail_json) LIKE '%model unavailable%'
          OR lower(detail_json) LIKE '%model_registry%'
        )
    `, since);
    const toolByStatus = countMap(db, `
      SELECT status AS key, count(*) AS count
      FROM tool_events
      WHERE ts >= ?
      GROUP BY status
    `, since);
    const failedByTool = countMap(db, `
      SELECT tool_name AS key, count(*) AS count
      FROM tool_events
      WHERE ts >= ? AND status = 'failed'
      GROUP BY tool_name
    `, since);

    const alerts: string[] = [];
    if (failed > 0) alerts.push(`${failed} failed run(s) in monitoring window`);
    if (interrupted > 0) alerts.push(`${interrupted} interrupted run(s) in monitoring window`);
    if (staleRunning > 0) alerts.push(`${staleRunning} stale running run(s) older than ${args.staleMinutes} minute(s)`);
    if (authOrModelErrors > 0) alerts.push(`${authOrModelErrors} auth/model diagnostic event(s) in monitoring window`);

    const warnings: string[] = [];
    const failedTools = sumCounts(failedByTool);
    if (failedTools > 0) warnings.push(`${failedTools} failed tool event(s) in monitoring window`);

    return {
      status: alerts.length > 0 ? 'alert' : 'passed',
      runtime: 'pi',
      metricsDb,
      window: {
        sinceMinutes: args.sinceMinutes,
        staleMinutes: args.staleMinutes,
        since: new Date(since).toISOString(),
        now: new Date(now).toISOString(),
      },
      runs: {
        total: totalRuns,
        byStatus,
        failed,
        interrupted,
        staleRunning,
        recentFailures,
      },
      diagnostics: {
        byType: diagnosticsByType,
        authOrModelErrors,
      },
      tools: {
        byStatus: toolByStatus,
        failedByTool,
      },
      alerts,
      warnings,
    };
  } finally {
    db.close();
  }
}

function countMap(db: Database.Database, sql: string, ...params: unknown[]): CountMap {
  const rows = db.prepare(sql).all(...params) as CountRow[];
  const result: CountMap = {};
  for (const row of rows) {
    if (!row.key) continue;
    result[row.key] = row.count;
  }
  return result;
}

function scalarCount(db: Database.Database, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as Record<string, number> | undefined;
  if (!row) return 0;
  return Number(Object.values(row)[0] ?? 0);
}

function recentFailureRows(db: Database.Database, since: number): RecentRun[] {
  const rows = db.prepare(`
    SELECT started_at, agent_id, source, channel, status, model, run_id, error
    FROM agent_runs
    WHERE started_at >= ? AND status <> 'succeeded'
    ORDER BY started_at DESC
    LIMIT 10
  `).all(since) as RecentRunRow[];

  return rows.map((row) => ({
    startedAt: new Date(row.started_at).toISOString(),
    agentId: row.agent_id,
    source: row.source,
    channel: row.channel,
    status: row.status,
    model: row.model ?? undefined,
    runId: row.run_id,
    error: row.error ? truncate(row.error, 180) : undefined,
  }));
}

function missingOrUnreadableResult(
  args: Pick<PiMonitorArgs, 'dataDir' | 'metricsDb' | 'sinceMinutes' | 'staleMinutes'>,
  nowFn: () => number,
  message: string,
): PiMonitorResult {
  const now = nowFn();
  const since = now - args.sinceMinutes * 60_000;
  return {
    status: 'alert',
    runtime: 'pi',
    metricsDb: args.metricsDb ?? join(args.dataDir, 'metrics.sqlite'),
    window: {
      sinceMinutes: args.sinceMinutes,
      staleMinutes: args.staleMinutes,
      since: new Date(since).toISOString(),
      now: new Date(now).toISOString(),
    },
    runs: {
      total: 0,
      byStatus: {},
      failed: 0,
      interrupted: 0,
      staleRunning: 0,
      recentFailures: [],
    },
    diagnostics: {
      byType: {},
      authOrModelErrors: 0,
    },
    tools: {
      byStatus: {},
      failedByTool: {},
    },
    alerts: [message],
    warnings: [],
  };
}

function renderHuman(result: PiMonitorResult): string {
  const lines = [
    `Pi runtime monitor: ${result.status}`,
    `metrics: ${result.metricsDb}`,
    `window: ${result.window.since} .. ${result.window.now}`,
    `runs: total=${result.runs.total} succeeded=${result.runs.byStatus.succeeded ?? 0} failed=${result.runs.failed} interrupted=${result.runs.interrupted} stale_running=${result.runs.staleRunning}`,
    `diagnostics: ${formatMap(result.diagnostics.byType)} auth_or_model_errors=${result.diagnostics.authOrModelErrors}`,
    `tools: ${formatMap(result.tools.byStatus)} failed_by_tool=${formatMap(result.tools.failedByTool)}`,
  ];
  if (result.alerts.length > 0) lines.push(`alerts: ${result.alerts.join('; ')}`);
  if (result.warnings.length > 0) lines.push(`warnings: ${result.warnings.join('; ')}`);
  if (result.runs.recentFailures.length > 0) {
    lines.push('recent failures:');
    for (const run of result.runs.recentFailures) {
      lines.push(`- ${run.startedAt} ${run.agentId} ${run.source}/${run.channel} ${run.status} ${run.runId}${run.error ? ` ${run.error}` : ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function formatMap(map: CountMap): string {
  const entries = Object.entries(map);
  if (entries.length === 0) return '{}';
  return entries.map(([key, count]) => `${key}=${count}`).join(',');
}

function sumCounts(map: CountMap): number {
  return Object.values(map).reduce((sum, count) => sum + count, 0);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-monitor -- [options]',
    '',
    'Options:',
    '  --data-dir <path>        Data directory containing metrics.sqlite (default: ./data or OC_DATA_DIR)',
    '  --metrics-db <path>      Explicit metrics.sqlite path',
    '  --since-minutes <n>      Monitoring window in minutes (default: 60)',
    '  --stale-minutes <n>      Running runs older than this are alerts (default: 10)',
    '  --fail-on-alert         Exit 1 when stop-condition alerts are present',
    '  --json                  Emit machine-readable JSON',
    '  -h, --help              Show this help',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiMonitorCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
