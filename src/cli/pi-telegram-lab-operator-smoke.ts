import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_PI_MODEL_ID } from '../runtime/pi-headless.js';
import {
  normalizeTelegramText,
  runPiTelegramLabSmoke,
} from './pi-telegram-lab-smoke.js';

const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';
const AGENT_ID = 'pi_telegram_lab';
const DEFAULT_PEER_ID = '48705953';

type OperatorScenarioId = 'smoke' | 'help' | 'status' | 'scope' | 'memory' | 'handoff';

interface OperatorScenario {
  id: OperatorScenarioId;
  prompt: string;
  expectText?: string;
  expectIncludes?: string[];
}

const OPERATOR_SCENARIOS: OperatorScenario[] = [
  {
    id: 'smoke',
    prompt: '/smoke',
    expectText: 'PI_TELEGRAM_LAB_OK',
  },
  {
    id: 'help',
    prompt: '/help',
    expectIncludes: ['/status', '/scope', '/memory', '/smoke', '/handoff'],
  },
  {
    id: 'status',
    prompt: '/status',
    expectIncludes: [
      'pi_telegram_lab: ok',
      'runtime: pi',
      'scope: allowlisted Telegram DM only',
      'tools: memory_search, memory_write, list_skills',
      'learning: propose-only',
    ],
  },
  {
    id: 'scope',
    prompt: '/scope',
    expectIncludes: [
      'allowed: allowlisted Telegram DM',
      'allowed: memory_search, memory_write, list_skills',
      'blocked: group fanout',
      'blocked: media sending',
      'blocked: cron',
      'blocked: external MCP',
      'blocked: MCP onboarding',
    ],
  },
  {
    id: 'memory',
    prompt: '/memory',
    expectIncludes: ['memory_search', 'memory_write'],
  },
  {
    id: 'handoff',
    prompt: '/handoff',
    expectIncludes: [
      'pnpm runtime:pi-telegram-lab-readiness -- --json --allow-skip',
      'pnpm runtime:pi-telegram-lab-post-turn -- --json --fail-on-pending',
    ],
  },
];

interface PiTelegramLabOperatorSmokeArgs {
  agentsDir: string;
  pluginsDir: string;
  model?: string;
  authPath?: string;
  modelsPath?: string;
  peerId: string;
  senderId: string;
  scenarios: OperatorScenarioId[];
  timeoutMs: number;
  keepData: boolean;
  allowSkip: boolean;
  json: boolean;
  help: boolean;
}

interface OperatorCheckResult {
  name: OperatorScenarioId;
  status: 'passed' | 'failed' | 'skipped';
  prompt: string;
  sentText: string[];
  normalizedText?: string;
  expectedText?: string;
  expectedIncludes?: string[];
  error?: string;
}

interface PiTelegramLabOperatorSmokeResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  agentId: string;
  agentsDir: string;
  pluginsDir: string;
  dataRoot: string;
  peerId: string;
  checks: OperatorCheckResult[];
  error?: string;
}

interface PiTelegramLabOperatorSmokeDeps {
  makeWorkspace?: () => string;
  preflightPiRuntime?: () => Promise<void>;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runPiTelegramLabOperatorSmokeCli(
  argv: string[],
  deps: PiTelegramLabOperatorSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTelegramLabOperatorSmokeArgs;

  try {
    args = parsePiTelegramLabOperatorSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-telegram-lab-operator-'));
  let shouldRemoveWorkspace = !args.keepData;

  try {
    await (deps.preflightPiRuntime ?? ensurePiRuntimeImportable)();
    const result = await runPiTelegramLabOperatorSmoke({
      ...args,
      dataRoot: join(workspace, 'data'),
    });
    writeResult(stdout, args.json, result);
    return result.status === 'failed' ? 1 : 0;
  } catch (err) {
    const error = errorMessage(err);
    const status = args.allowSkip && isSkippableSmokeError(error) ? 'skipped' : 'failed';
    const result: PiTelegramLabOperatorSmokeResult = {
      status,
      runtime: 'pi',
      agentId: AGENT_ID,
      agentsDir: args.agentsDir,
      pluginsDir: args.pluginsDir,
      dataRoot: join(workspace, 'data'),
      peerId: args.peerId,
      checks: [],
      error,
    };
    writeResult(status === 'failed' ? stderr : stdout, args.json, result);
    if (status === 'failed') shouldRemoveWorkspace = false;
    return status === 'skipped' ? 0 : 1;
  } finally {
    if (shouldRemoveWorkspace) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export async function runPiTelegramLabOperatorSmoke(input: PiTelegramLabOperatorSmokeArgs & {
  dataRoot: string;
}): Promise<PiTelegramLabOperatorSmokeResult> {
  const scenarios = input.scenarios.map((id) => scenarioById(id));
  const checks: OperatorCheckResult[] = [];

  for (const scenario of scenarios) {
    const dataDir = join(input.dataRoot, scenario.id);
    try {
      const smoke = await runPiTelegramLabSmoke({
        agentsDir: input.agentsDir,
        dataDir,
        pluginsDir: input.pluginsDir,
        model: input.model,
        authPath: input.authPath,
        modelsPath: input.modelsPath,
        peerId: input.peerId,
        senderId: input.senderId,
        prompt: scenario.prompt,
        expectText: scenario.expectText ?? '',
        expectIncludes: scenario.expectIncludes,
        timeoutMs: input.timeoutMs,
      });
      checks.push({
        name: scenario.id,
        status: 'passed',
        prompt: scenario.prompt,
        sentText: smoke.sentText,
        normalizedText: smoke.normalizedText,
        expectedText: scenario.expectText,
        expectedIncludes: scenario.expectIncludes,
      });
    } catch (err) {
      checks.push({
        name: scenario.id,
        status: 'failed',
        prompt: scenario.prompt,
        sentText: [],
        expectedText: scenario.expectText,
        expectedIncludes: scenario.expectIncludes,
        error: errorMessage(err),
      });
      break;
    }
  }

  const failed = checks.some((check) => check.status === 'failed');
  return {
    status: failed ? 'failed' : 'passed',
    runtime: 'pi',
    agentId: AGENT_ID,
    agentsDir: resolve(input.agentsDir),
    pluginsDir: resolve(input.pluginsDir),
    dataRoot: resolve(input.dataRoot),
    peerId: input.peerId,
    checks,
  };
}

export function parsePiTelegramLabOperatorSmokeArgs(argv: string[]): PiTelegramLabOperatorSmokeArgs {
  const args: PiTelegramLabOperatorSmokeArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    pluginsDir: process.env.OC_PLUGINS_DIR ? resolve(process.env.OC_PLUGINS_DIR) : resolve('plugins'),
    model: DEFAULT_PI_MODEL_ID,
    peerId: DEFAULT_PEER_ID,
    senderId: DEFAULT_PEER_ID,
    scenarios: ['smoke', 'help', 'status', 'scope', 'memory', 'handoff'],
    timeoutMs: 120_000,
    keepData: false,
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
      case '--plugins-dir':
        args.pluginsDir = resolve(requireValue(argv, ++i, '--plugins-dir'));
        break;
      case '--model':
        args.model = requireValue(argv, ++i, '--model');
        break;
      case '--auth-path':
        args.authPath = requireValue(argv, ++i, '--auth-path');
        break;
      case '--models-path':
        args.modelsPath = requireValue(argv, ++i, '--models-path');
        break;
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
        break;
      case '--sender-id':
        args.senderId = requireValue(argv, ++i, '--sender-id');
        break;
      case '--scenario':
        args.scenarios = parseScenarioList(requireValue(argv, ++i, '--scenario'));
        break;
      case '--timeout-ms':
        args.timeoutMs = positiveInteger(requireValue(argv, ++i, '--timeout-ms'), '--timeout-ms');
        break;
      case '--keep-data':
        args.keepData = true;
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

export function listPiTelegramLabOperatorScenarios(): OperatorScenario[] {
  return OPERATOR_SCENARIOS.map((scenario) => ({ ...scenario }));
}

async function ensurePiRuntimeImportable(): Promise<void> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
  try {
    await dynamicImport(PI_PACKAGE_NAME);
  } catch (err) {
    throw new Error(`Pi Telegram lab operator smoke requires optional package ${PI_PACKAGE_NAME}. Original error: ${errorMessage(err)}`);
  }
}

function scenarioById(id: OperatorScenarioId): OperatorScenario {
  const scenario = OPERATOR_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown Pi Telegram lab operator scenario: ${id}`);
  return scenario;
}

function parseScenarioList(value: string): OperatorScenarioId[] {
  const scenarios = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (scenarios.length === 0) {
    throw new Error('--scenario requires at least one scenario id.');
  }
  for (const scenario of scenarios) {
    scenarioById(scenario as OperatorScenarioId);
  }
  return scenarios as OperatorScenarioId[];
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTelegramLabOperatorSmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stream.write(`Pi Telegram lab operator smoke: ${result.status}\n`);
  for (const check of result.checks) {
    const suffix = check.status === 'passed'
      ? normalizeTelegramText(check.normalizedText ?? check.sentText.at(-1) ?? '')
      : check.error ?? 'unknown error';
    stream.write(`- ${check.status} ${check.name}: ${suffix}\n`);
  }
  if (result.error) {
    stream.write(`Error: ${result.error}\n`);
  }
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
    'Usage: pnpm runtime:pi-telegram-lab-operator-smoke -- [--json] [--allow-skip]',
    '',
    'Options:',
    '  --agents-dir <path>   agents directory containing pi_telegram_lab (default: agents)',
    '  --plugins-dir <path>  plugin directory loaded by Gateway (default: plugins)',
    '  --model <model>       model override for the smoke run',
    '  --auth-path <path>    optional Pi auth.json path',
    '  --models-path <path>  optional Pi models.json path',
    '  --peer-id <id>        Telegram peer id to simulate (default: 48705953)',
    '  --sender-id <id>      Telegram sender id to simulate (default: peer id)',
    '  --scenario <ids>      comma-separated scenarios: smoke,help,status,scope,memory,handoff',
    '  --timeout-ms <ms>     positive integer dispatch timeout per scenario (default: 120000)',
    '  --keep-data           keep temporary data directory for inspection',
    '  --allow-skip          exit 0 for missing optional Pi runtime/auth setup',
    '  --json                print structured smoke result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTelegramLabOperatorSmokeCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
