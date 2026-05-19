import 'dotenv/config';
import { resolve } from 'node:path';
import { loadAgentYml } from '../config/loader.js';
import type { AgentYml } from '../config/schema.js';
import { redactSecrets } from '../security/redact.js';
import { auditPiExpansionReadiness } from './pi-expansion-audit.js';
import { collectPiMonitorSnapshot } from './pi-monitor.js';

interface PiTelegramGroupPreflightArgs {
  agentsDir: string;
  agentsDirs: string[];
  dataDir: string;
  agentId?: string;
  confirmPeer?: string;
  confirmTopics: string[];
  confirmAccount?: string;
  allowNonMentionOnly: boolean;
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

interface PiTelegramGroupPreflightResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  agentsDirs: string[];
  dataDir: string;
  checks: CheckResult[];
  nextStep: string;
}

interface PiTelegramGroupPreflightDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runPiTelegramGroupPreflightCli(
  argv: string[],
  deps: PiTelegramGroupPreflightDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTelegramGroupPreflightArgs;

  try {
    args = parsePiTelegramGroupPreflightArgs(argv);
  } catch (err) {
    stderr.write(`${redactSecrets(message(err))}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const result = runPiTelegramGroupPreflight(args);
  const stream = result.status === 'failed' ? stderr : stdout;
  writeResult(stream, args.json, result);
  return result.status === 'passed' ? 0 : 1;
}

export function runPiTelegramGroupPreflight(
  args: PiTelegramGroupPreflightArgs,
): PiTelegramGroupPreflightResult {
  const agentId = args.agentId ?? '';
  const checks: CheckResult[] = [];
  const auditCheck = runAuditCheck(args, agentId);
  checks.push(auditCheck);

  const auditedAgent = auditCheck.status === 'passed'
    ? (auditCheck.details as ReturnType<typeof auditPiExpansionReadiness>).agents.find((agent) => agent.id === agentId)
    : undefined;
  const agentDir = auditedAgent ? resolve(auditedAgent.agentsDir, agentId) : undefined;
  checks.push(runRouteConfirmationCheck(args, agentId, agentDir));
  checks.push(runMonitorCheck(args));

  const failed = checks.some((check) => check.status === 'failed');
  return {
    status: failed ? 'failed' : 'passed',
    runtime: 'pi',
    agentId,
    agentsDirs: args.agentsDirs,
    dataDir: args.dataDir,
    checks,
    nextStep: failed
      ? `Resolve failed checks before any ${agentId} live Telegram group turn.`
      : `Ready for an explicitly approved, controlled ${agentId} live Telegram group turn, followed immediately by runtime:pi-monitor.`,
  };
}

export function parsePiTelegramGroupPreflightArgs(argv: string[]): PiTelegramGroupPreflightArgs {
  const args: PiTelegramGroupPreflightArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    agentsDirs: [],
    dataDir: process.env.OC_DATA_DIR ? resolve(process.env.OC_DATA_DIR) : resolve('data'),
    confirmTopics: [],
    allowNonMentionOnly: false,
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
      case '--agent-id':
        args.agentId = requireValue(argv, ++i, '--agent-id');
        break;
      case '--confirm-peer':
        args.confirmPeer = requireValue(argv, ++i, '--confirm-peer');
        break;
      case '--confirm-topic':
        args.confirmTopics.push(requireValue(argv, ++i, '--confirm-topic'));
        break;
      case '--confirm-account':
        args.confirmAccount = requireValue(argv, ++i, '--confirm-account');
        break;
      case '--allow-non-mention-only':
        args.allowNonMentionOnly = true;
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
  if (!args.help && !args.agentId) throw new Error('--agent-id is required.');

  return args;
}

function runAuditCheck(args: PiTelegramGroupPreflightArgs, agentId: string): CheckResult {
  const audit = auditPiExpansionReadiness({
    agentsDir: args.agentsDir,
    agentsDirs: args.agentsDirs,
    agent: agentId,
    expectAgents: [agentId],
  });
  const agent = audit.agents.find((entry) => entry.id === agentId);
  const passed = !audit.coverageGap
    && audit.errors.length === 0
    && agent?.id === agentId
    && agent.routes.some((route) => route.startsWith('telegram:group'));

  return {
    name: 'expansion-audit',
    status: passed ? 'passed' : 'failed',
    summary: passed
      ? `${agentId} found with coverageGap=false and a Telegram group route`
      : `${agentId} audit did not find an eligible Telegram group route`,
    details: audit,
  };
}

function runRouteConfirmationCheck(
  args: PiTelegramGroupPreflightArgs,
  agentId: string,
  agentDir?: string,
): CheckResult {
  if (!agentDir) {
    return {
      name: 'route-confirmation',
      status: 'failed',
      summary: `${agentId} agent directory not available from audit`,
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
  const route = findConfirmedTelegramGroupRoute(yml, args);
  const routePeers = route?.peers ?? [];
  const routeTopics = route?.topics ?? [];
  const missingTopics = args.confirmTopics.filter((topic) => !routeTopics.includes(topic));
  const accountMatches = !args.confirmAccount || route?.account === args.confirmAccount;
  const mentionOnlyOk = args.allowNonMentionOnly || route?.mention_only === true;
  const passed = route?.channel === 'telegram'
    && route.scope === 'group'
    && routePeers.includes(args.confirmPeer)
    && missingTopics.length === 0
    && accountMatches
    && mentionOnlyOk;

  return {
    name: 'route-confirmation',
    status: passed ? 'passed' : 'failed',
    summary: passed
      ? 'operator-confirmed peer/topics match a configured Telegram group route'
      : 'operator-confirmed peer/topics do not match a configured Telegram group route',
    details: {
      agentDir,
      account: route?.account ?? null,
      scope: route?.scope ?? null,
      mentionOnly: route?.mention_only ?? null,
      confirmAccount: args.confirmAccount ?? null,
      confirmedPeer: args.confirmPeer,
      confirmedTopics: args.confirmTopics,
      routeHasConfirmedPeer: routePeers.includes(args.confirmPeer),
      missingTopics,
      accountMatches,
      mentionOnlyOk,
    },
  };
}

function runMonitorCheck(args: PiTelegramGroupPreflightArgs): CheckResult {
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

function findConfirmedTelegramGroupRoute(yml: AgentYml, args: PiTelegramGroupPreflightArgs) {
  return yml.routes.find((route) => route.channel === 'telegram'
    && route.scope === 'group'
    && (!args.confirmAccount || route.account === args.confirmAccount)
    && (route.peers ?? []).includes(args.confirmPeer ?? '')
    && args.confirmTopics.every((topic) => (route.topics ?? []).includes(topic)));
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTelegramGroupPreflightResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stream.write(`Pi Telegram group preflight for ${result.agentId}: ${result.status}\n`);
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
    'Usage: pnpm runtime:pi-telegram-group-preflight -- --agent-id <id> --agents-dir <root> --confirm-peer <id> --confirm-topic <id> [--json]',
    '',
    'Runs a generic pre-live Telegram group-route gate without real Telegram delivery.',
    '',
    'Options:',
    '  --agent-id <id>              agent id to verify',
    '  --agents-dir <path>          repeatable agents root; use both tracked and live-only roots when split',
    '  --data-dir <path>            live data directory for monitor checks (default: data)',
    '  --confirm-peer <id>          operator-confirmed Telegram group peer id from the live route',
    '  --confirm-topic <id>         operator-confirmed Telegram topic id; repeat for every approved topic',
    '  --confirm-account <id>       optional Telegram account id that must match the route',
    '  --allow-non-mention-only     allow a non-mention-only group route; default requires mention_only=true',
    '  --since-minutes <n>          monitor window (default: 60)',
    '  --stale-minutes <n>          stale running threshold (default: 10)',
    '  --json                       print structured preflight result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTelegramGroupPreflightCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
