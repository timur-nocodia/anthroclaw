import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadAgentYml } from '../config/loader.js';
import type { AgentYml } from '../config/schema.js';
import { auditPiExpansionReadiness } from './pi-expansion-audit.js';
import { runContentSmDryRun } from './pi-content-sm-dry-run.js';
import { collectPiMonitorSnapshot } from './pi-monitor.js';

const AGENT_ID = 'content_sm_building';

interface PiContentSmPreflightArgs {
  agentsDir: string;
  agentsDirs: string[];
  dataDir: string;
  confirmPeer?: string;
  confirmTopics: string[];
  sinceMinutes: number;
  staleMinutes: number;
  json: boolean;
  help: boolean;
}

interface CheckResult {
  name: string;
  status: 'passed' | 'failed';
  summary: string;
  details?: unknown;
}

interface PiContentSmPreflightResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: typeof AGENT_ID;
  agentsDirs: string[];
  dataDir: string;
  checks: CheckResult[];
  nextStep: string;
}

interface PiContentSmPreflightDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runPiContentSmPreflightCli(
  argv: string[],
  deps: PiContentSmPreflightDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiContentSmPreflightArgs;

  try {
    args = parsePiContentSmPreflightArgs(argv);
  } catch (err) {
    stderr.write(`${message(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const result = await runPiContentSmPreflight(args);
  const stream = result.status === 'failed' ? stderr : stdout;
  writeResult(stream, args.json, result);
  return result.status === 'passed' ? 0 : 1;
}

export async function runPiContentSmPreflight(
  args: PiContentSmPreflightArgs,
): Promise<PiContentSmPreflightResult> {
  const checks: CheckResult[] = [];
  const auditCheck = runAuditCheck(args);
  checks.push(auditCheck);

  const auditedAgent = auditCheck.status === 'passed'
    ? (auditCheck.details as ReturnType<typeof auditPiExpansionReadiness>).agents.find((agent) => agent.id === AGENT_ID)
    : undefined;
  const agentDir = auditedAgent ? resolve(auditedAgent.agentsDir, AGENT_ID) : undefined;
  checks.push(runRouteConfirmationCheck(args, agentDir));
  checks.push(await runDryRunCheck());
  checks.push(runMonitorCheck(args));

  const failed = checks.some((check) => check.status === 'failed');
  return {
    status: failed ? 'failed' : 'passed',
    runtime: 'pi',
    agentId: AGENT_ID,
    agentsDirs: args.agentsDirs,
    dataDir: args.dataDir,
    checks,
    nextStep: failed
      ? 'Resolve failed checks before any content_sm_building live group turn.'
      : 'Ready for an explicitly approved, controlled content_sm_building live group turn, followed immediately by runtime:pi-monitor.',
  };
}

export function parsePiContentSmPreflightArgs(argv: string[]): PiContentSmPreflightArgs {
  const args: PiContentSmPreflightArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    agentsDirs: [],
    dataDir: process.env.OC_DATA_DIR ? resolve(process.env.OC_DATA_DIR) : resolve('data'),
    confirmTopics: [],
    sinceMinutes: 60,
    staleMinutes: 10,
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
        args.agentsDirs.push(resolve(requireValue(argv, ++i, '--agents-dir')));
        break;
      case '--data-dir':
        args.dataDir = resolve(requireValue(argv, ++i, '--data-dir'));
        break;
      case '--confirm-peer':
        args.confirmPeer = requireValue(argv, ++i, '--confirm-peer');
        break;
      case '--confirm-topic':
        args.confirmTopics.push(requireValue(argv, ++i, '--confirm-topic'));
        break;
      case '--since-minutes':
        args.sinceMinutes = positiveInteger(requireValue(argv, ++i, '--since-minutes'), '--since-minutes');
        break;
      case '--stale-minutes':
        args.staleMinutes = positiveInteger(requireValue(argv, ++i, '--stale-minutes'), '--stale-minutes');
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

function runAuditCheck(args: PiContentSmPreflightArgs): CheckResult {
  const audit = auditPiExpansionReadiness({
    agentsDir: args.agentsDir,
    agentsDirs: args.agentsDirs,
    agent: AGENT_ID,
    expectAgents: [AGENT_ID],
  });
  const agent = audit.agents.find((entry) => entry.id === AGENT_ID);
  const passed = !audit.coverageGap
    && audit.errors.length === 0
    && agent?.id === AGENT_ID
    && agent.risk === 'high'
    && agent.recommendedRing === 'ring4';

  return {
    name: 'expansion-audit',
    status: passed ? 'passed' : 'failed',
    summary: passed
      ? `${AGENT_ID} found as high/ring4 with coverageGap=false`
      : `${AGENT_ID} audit did not match expected high/ring4 live inventory`,
    details: audit,
  };
}

function runRouteConfirmationCheck(args: PiContentSmPreflightArgs, agentDir?: string): CheckResult {
  if (!agentDir) {
    return {
      name: 'route-confirmation',
      status: 'failed',
      summary: `${AGENT_ID} agent directory not available from audit`,
    };
  }
  if (!args.confirmPeer || args.confirmTopics.length === 0) {
    return {
      name: 'route-confirmation',
      status: 'failed',
      summary: 'explicit --confirm-peer and at least one --confirm-topic are required',
    };
  }

  const yml = loadAgentYml(agentDir);
  const route = findTelegramGroupRoute(yml);
  const routePeers = route?.peers ?? [];
  const routeTopics = route?.topics ?? [];
  const missingTopics = args.confirmTopics.filter((topic) => !routeTopics.includes(topic));
  const passed = route?.channel === 'telegram'
    && route.scope === 'group'
    && route.account === 'content_sm'
    && route.mention_only === true
    && routePeers.includes(args.confirmPeer)
    && missingTopics.length === 0;

  return {
    name: 'route-confirmation',
    status: passed ? 'passed' : 'failed',
    summary: passed
      ? 'operator-confirmed peer/topics match the configured mention-only Telegram group route'
      : 'operator-confirmed peer/topics do not match the configured mention-only Telegram group route',
    details: {
      agentDir,
      account: route?.account ?? null,
      scope: route?.scope ?? null,
      mentionOnly: route?.mention_only ?? null,
      confirmedPeer: args.confirmPeer,
      confirmedTopics: args.confirmTopics,
      routeHasConfirmedPeer: routePeers.includes(args.confirmPeer),
      missingTopics,
    },
  };
}

async function runDryRunCheck(): Promise<CheckResult> {
  const workspace = mkdtempSync(join(tmpdir(), 'pi-content-sm-preflight-'));
  try {
    const assertions = await runContentSmDryRun(workspace);
    const passed = assertions.fakeChannelOnly === true
      && assertions.noRealTelegramDelivery === true
      && assertions.sendMessageFakeSends === 1
      && assertions.sendMediaFakeSends === 1
      && assertions.tempCronJobsRemaining === 0
      && assertions.tempCronIgnoredModelSuppliedDeliverTo === true;
    return {
      name: 'safe-dry-run',
      status: passed ? 'passed' : 'failed',
      summary: passed
        ? 'send_message, send_media, and manage_cron dry-run used fake delivery and cleaned up temp cron'
        : 'safe dry-run assertions failed',
      details: assertions,
    };
  } catch (err) {
    return {
      name: 'safe-dry-run',
      status: 'failed',
      summary: message(err),
    };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function runMonitorCheck(args: PiContentSmPreflightArgs): CheckResult {
  const monitor = collectPiMonitorSnapshot({
    dataDir: args.dataDir,
    sinceMinutes: args.sinceMinutes,
    staleMinutes: args.staleMinutes,
  });
  return {
    name: 'runtime-monitor',
    status: monitor.status === 'passed' ? 'passed' : 'failed',
    summary: monitor.status === 'passed'
      ? `monitor passed: alerts=${monitor.alerts.length}, warnings=${monitor.warnings.length}`
      : `monitor alert: ${monitor.alerts.join('; ') || 'unknown alert'}`,
    details: monitor,
  };
}

function findTelegramGroupRoute(yml: AgentYml) {
  return yml.routes.find((route) => route.channel === 'telegram' && route.scope === 'group');
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiContentSmPreflightResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stream.write(`Pi content_sm_building preflight: ${result.status}\n`);
  for (const check of result.checks) {
    stream.write(`- ${check.status} ${check.name}: ${check.summary}\n`);
  }
  stream.write(`Next step: ${result.nextStep}\n`);
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

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-content-sm-preflight -- --agents-dir <root> --confirm-peer <id> --confirm-topic <id> [--json]',
    '',
    'Runs the content_sm_building pre-live-turn gate without real Telegram delivery.',
    '',
    'Options:',
    '  --agents-dir <path>    repeatable agents root; use both tracked and live-only roots when split',
    '  --data-dir <path>      live data directory for monitor checks (default: data)',
    '  --confirm-peer <id>    operator-confirmed Telegram group peer id from the live route',
    '  --confirm-topic <id>   operator-confirmed Telegram topic id; repeat for every approved topic',
    '  --since-minutes <n>    monitor window (default: 60)',
    '  --stale-minutes <n>    stale running threshold (default: 10)',
    '  --json                 print structured preflight result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiContentSmPreflightCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
