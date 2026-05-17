import 'dotenv/config';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadAgentYml } from '../config/loader.js';
import { auditPiExpansionReadiness } from './pi-expansion-audit.js';
import { collectPiMonitorSnapshot } from './pi-monitor.js';
import { runPiTelegramLabSmoke } from './pi-telegram-lab-smoke.js';
import { RouteTable } from '../routing/table.js';

const AGENT_ID = 'pi_telegram_lab';
const EXAMPLE_AGENT_ID = 'example';
const DEFAULT_PEER_ID = '48705953';
const DEFAULT_EXPECT_TEXT = 'PI_TELEGRAM_LAB_OK';

interface PiTelegramLabReadinessArgs {
  agentsDir: string;
  dataDir: string;
  pluginsDir: string;
  peerId: string;
  senderId: string;
  expectText: string;
  timeoutMs: number;
  sinceMinutes: number;
  staleMinutes: number;
  allowSkip: boolean;
  json: boolean;
  help: boolean;
}

interface CheckResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  summary: string;
  details?: unknown;
}

interface PiTelegramLabReadinessResult {
  status: 'passed' | 'failed' | 'skipped';
  agentId: string;
  agentsDir: string;
  dataDir: string;
  pluginsDir: string;
  peerId: string;
  checks: CheckResult[];
  nextManualStep: string;
}

interface PiTelegramLabReadinessDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runPiTelegramLabReadinessCli(
  argv: string[],
  deps: PiTelegramLabReadinessDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTelegramLabReadinessArgs;

  try {
    args = parsePiTelegramLabReadinessArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const result = await runPiTelegramLabReadiness(args);
    writeResult(stdout, args.json, result);
    return result.status === 'failed' ? 1 : 0;
  } catch (err) {
    const result: PiTelegramLabReadinessResult = {
      status: 'failed',
      agentId: AGENT_ID,
      agentsDir: args.agentsDir,
      dataDir: args.dataDir,
      pluginsDir: args.pluginsDir,
      peerId: args.peerId,
      checks: [{
        name: 'readiness',
        status: 'failed',
        summary: errorMessage(err),
      }],
      nextManualStep: manualStep(args.expectText),
    };
    writeResult(stderr, args.json, result);
    return 1;
  }
}

export async function runPiTelegramLabReadiness(
  args: PiTelegramLabReadinessArgs,
): Promise<PiTelegramLabReadinessResult> {
  const checks: CheckResult[] = [];

  checks.push(runConfigAudit(args));
  checks.push(runRouteProof(args));
  checks.push(runMonitorCheck(args, 'monitor-before'));
  checks.push(await runSmokeCheck(args));
  checks.push(runMonitorCheck(args, 'monitor-after'));

  const failed = checks.some((check) => check.status === 'failed');
  const skipped = checks.some((check) => check.status === 'skipped');

  return {
    status: failed ? 'failed' : skipped ? 'skipped' : 'passed',
    agentId: AGENT_ID,
    agentsDir: args.agentsDir,
    dataDir: args.dataDir,
    pluginsDir: args.pluginsDir,
    peerId: args.peerId,
    checks,
    nextManualStep: manualStep(args.expectText),
  };
}

export function parsePiTelegramLabReadinessArgs(argv: string[]): PiTelegramLabReadinessArgs {
  const args: PiTelegramLabReadinessArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    dataDir: process.env.OC_DATA_DIR ? resolve(process.env.OC_DATA_DIR) : resolve('data'),
    pluginsDir: process.env.OC_PLUGINS_DIR ? resolve(process.env.OC_PLUGINS_DIR) : resolve('plugins'),
    peerId: DEFAULT_PEER_ID,
    senderId: DEFAULT_PEER_ID,
    expectText: DEFAULT_EXPECT_TEXT,
    timeoutMs: 120_000,
    sinceMinutes: 60,
    staleMinutes: 10,
    allowSkip: false,
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
        args.agentsDir = resolve(requireValue(argv, ++i, '--agents-dir'));
        break;
      case '--data-dir':
        args.dataDir = resolve(requireValue(argv, ++i, '--data-dir'));
        break;
      case '--plugins-dir':
        args.pluginsDir = resolve(requireValue(argv, ++i, '--plugins-dir'));
        break;
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
        break;
      case '--sender-id':
        args.senderId = requireValue(argv, ++i, '--sender-id');
        break;
      case '--expect-text':
        args.expectText = requireValue(argv, ++i, '--expect-text');
        break;
      case '--timeout-ms':
        args.timeoutMs = positiveInteger(requireValue(argv, ++i, '--timeout-ms'), '--timeout-ms');
        break;
      case '--since-minutes':
        args.sinceMinutes = positiveInteger(requireValue(argv, ++i, '--since-minutes'), '--since-minutes');
        break;
      case '--stale-minutes':
        args.staleMinutes = positiveInteger(requireValue(argv, ++i, '--stale-minutes'), '--stale-minutes');
        break;
      case '--allow-skip':
        args.allowSkip = true;
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

function runConfigAudit(args: PiTelegramLabReadinessArgs): CheckResult {
  const audit = auditPiExpansionReadiness({
    agentsDir: args.agentsDir,
    agent: AGENT_ID,
    expectAgents: [AGENT_ID],
    maxRisk: 'low',
  });
  const agent = audit.agents.find((entry) => entry.id === AGENT_ID);
  const passed = audit.status === 'passed'
    && !audit.riskBudgetExceeded
    && !audit.coverageGap
    && audit.errors.length === 0
    && agent?.risk === 'low';

  return {
    name: 'config-audit',
    status: passed ? 'passed' : 'failed',
    summary: passed
      ? `${AGENT_ID} audits low risk with coverageGap=false`
      : `${AGENT_ID} audit requires attention`,
    details: audit,
  };
}

function runRouteProof(args: PiTelegramLabReadinessArgs): CheckResult {
  const labDir = resolve(args.agentsDir, AGENT_ID);
  const exampleDir = resolve(args.agentsDir, EXAMPLE_AGENT_ID);
  if (!existsSync(labDir)) {
    return {
      name: 'route-proof',
      status: 'failed',
      summary: `${AGENT_ID} directory not found: ${labDir}`,
    };
  }
  if (!existsSync(exampleDir)) {
    return {
      name: 'route-proof',
      status: 'skipped',
      summary: `${EXAMPLE_AGENT_ID} fallback agent not present; lab route still exists`,
    };
  }

  const table = RouteTable.build([
    { id: EXAMPLE_AGENT_ID, config: loadAgentYml(exampleDir) },
    { id: AGENT_ID, config: loadAgentYml(labDir) },
  ]);
  const labRoute = table.resolve('telegram', 'default', 'dm', args.peerId);
  const fallbackRoute = table.resolve('telegram', 'default', 'dm', 'not-the-lab-peer');
  const passed = labRoute?.agentId === AGENT_ID && fallbackRoute?.agentId === EXAMPLE_AGENT_ID;

  return {
    name: 'route-proof',
    status: passed ? 'passed' : 'failed',
    summary: passed
      ? `${args.peerId} resolves to ${AGENT_ID}; broad DM fallback remains ${EXAMPLE_AGENT_ID}`
      : `unexpected route resolution for ${args.peerId}`,
    details: {
      peerRoute: labRoute?.agentId ?? null,
      fallbackRoute: fallbackRoute?.agentId ?? null,
    },
  };
}

async function runSmokeCheck(args: PiTelegramLabReadinessArgs): Promise<CheckResult> {
  const workspace = mkdtempSync(join(tmpdir(), 'anthroclaw-pi-telegram-lab-readiness-'));
  try {
    const smoke = await runPiTelegramLabSmoke({
      agentsDir: args.agentsDir,
      dataDir: join(workspace, 'data'),
      pluginsDir: args.pluginsDir,
      peerId: args.peerId,
      senderId: args.senderId,
      prompt: `Ответь ровно: ${args.expectText}`,
      expectText: args.expectText,
      timeoutMs: args.timeoutMs,
    });
    return {
      name: 'direct-pi-smoke',
      status: smoke.status,
      summary: `${AGENT_ID} fake Telegram DM returned ${smoke.normalizedText ?? '<empty>'}`,
      details: smoke,
    };
  } catch (err) {
    const message = errorMessage(err);
    if (args.allowSkip && isSkippableSmokeError(message)) {
      return {
        name: 'direct-pi-smoke',
        status: 'skipped',
        summary: message,
      };
    }
    return {
      name: 'direct-pi-smoke',
      status: 'failed',
      summary: message,
    };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function runMonitorCheck(args: PiTelegramLabReadinessArgs, name: string): CheckResult {
  const monitor = collectPiMonitorSnapshot({
    dataDir: args.dataDir,
    sinceMinutes: args.sinceMinutes,
    staleMinutes: args.staleMinutes,
  });

  return {
    name,
    status: monitor.status === 'passed' ? 'passed' : 'failed',
    summary: monitor.status === 'passed'
      ? `monitor passed: alerts=${monitor.alerts.length}, warnings=${monitor.warnings.length}`
      : `monitor alert: ${monitor.alerts.join('; ') || 'unknown alert'}`,
    details: monitor,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTelegramLabReadinessResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stream.write(`Pi Telegram lab readiness: ${result.status}\n`);
  for (const check of result.checks) {
    stream.write(`- ${check.status} ${check.name}: ${check.summary}\n`);
  }
  stream.write(`Next manual step: ${result.nextManualStep}\n`);
}

function manualStep(expectText: string): string {
  return `Send Telegram DM to the bot: Ответь ровно: ${expectText}`;
}

function isSkippableSmokeError(message: string): boolean {
  return /@earendil-works\/pi-coding-agent|optional package|api key|auth|oauth|credential|model registry/i
    .test(message);
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
    'Usage: pnpm runtime:pi-telegram-lab-readiness -- [--json] [--allow-skip]',
    '',
    'Options:',
    '  --agents-dir <path>    agents directory containing pi_telegram_lab (default: agents)',
    '  --data-dir <path>      live data directory for monitor checks (default: data)',
    '  --plugins-dir <path>   plugin directory loaded by Gateway (default: plugins)',
    '  --peer-id <id>         Telegram peer id to simulate (default: 48705953)',
    '  --sender-id <id>       Telegram sender id to simulate (default: peer id)',
    '  --expect-text <text>   expected marker text (default: PI_TELEGRAM_LAB_OK)',
    '  --timeout-ms <ms>      direct smoke timeout (default: 120000)',
    '  --since-minutes <n>    monitor window (default: 60)',
    '  --stale-minutes <n>    stale running threshold (default: 10)',
    '  --allow-skip           skip direct smoke if Pi runtime/auth is unavailable',
    '  --json                 print structured readiness result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTelegramLabReadinessCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
