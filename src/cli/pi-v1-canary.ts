import 'dotenv/config';
import {
  RUNTIME_CANARY_SCENARIOS,
  type RuntimeCanaryScenario,
} from '../runtime/contract.js';
import { DEFAULT_PI_MODEL_ID } from '../runtime/pi-headless.js';
import { runPiAuthSmokeCli } from './pi-auth-smoke.js';
import { runPiGatewaySmokeCli } from './pi-gateway-smoke.js';
import { runPiSmokeSuiteCli } from './pi-smoke-suite.js';
import { runPiWorkspaceSmokeCli } from './pi-workspace-smoke.js';

type CanaryStatus = 'passed' | 'failed' | 'skipped' | 'incomplete';
type SmokeCliDeps = { stdout?: Pick<NodeJS.WriteStream, 'write'>; stderr?: Pick<NodeJS.WriteStream, 'write'> };
type SmokeCliRunner = (argv: string[], deps?: SmokeCliDeps) => Promise<number>;

interface PiV1CanaryArgs {
  model?: string;
  authPath?: string;
  modelsPath?: string;
  timeoutMs?: number;
  keepWorkspace: boolean;
  allowSkip: boolean;
  smokeOnly: boolean;
  list: boolean;
  json: boolean;
  help: boolean;
}

interface PiV1CanaryDeps {
  runAuthCli?: SmokeCliRunner;
  runWorkspaceCli?: SmokeCliRunner;
  runGatewayCli?: SmokeCliRunner;
  runAggregateCli?: SmokeCliRunner;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface CanaryScenarioRun {
  id: string;
  kind: RuntimeCanaryScenario['kind'];
  title: string;
  status: CanaryStatus;
  coversFeatureContracts: string[];
  command?: string;
  code?: number;
  result?: Record<string, unknown>;
  error?: string;
}

interface PiV1CanaryResult {
  status: CanaryStatus;
  runtime: 'pi';
  mode: 'full' | 'smoke-only' | 'list';
  durationMs: number;
  scenarios: CanaryScenarioRun[];
}

const SMOKE_RUNNERS: Record<string, {
  runner: (deps: PiV1CanaryDeps) => SmokeCliRunner;
  args: (args: PiV1CanaryArgs) => string[];
}> = {
  'pi.auth-model-preflight': {
    runner: (deps) => deps.runAuthCli ?? runPiAuthSmokeCli,
    args: buildAuthProbeArgs,
  },
  'pi.workspace-tools-rewind': {
    runner: (deps) => deps.runWorkspaceCli ?? runPiWorkspaceSmokeCli,
    args: buildRuntimeProbeArgs,
  },
  'pi.gateway-channel-approval': {
    runner: (deps) => deps.runGatewayCli ?? runPiGatewaySmokeCli,
    args: buildRuntimeProbeArgs,
  },
  'pi.aggregate-real-auth': {
    runner: (deps) => deps.runAggregateCli ?? runPiSmokeSuiteCli,
    args: buildAggregateProbeArgs,
  },
};

export async function runPiV1CanaryCli(
  argv: string[],
  deps: PiV1CanaryDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiV1CanaryArgs;

  try {
    args = parsePiV1CanaryArgs(argv);
  } catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    stderr.write(`${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const startedAt = Date.now();
  if (args.list) {
    const result: PiV1CanaryResult = {
      status: 'passed',
      runtime: 'pi',
      mode: 'list',
      durationMs: Date.now() - startedAt,
      scenarios: RUNTIME_CANARY_SCENARIOS.map((scenario) => scenarioToRun(scenario, 'incomplete')),
    };
    writeResult(stdout, args.json, result);
    return 0;
  }

  const selected = args.smokeOnly
    ? RUNTIME_CANARY_SCENARIOS.filter((scenario) => scenario.kind === 'smoke')
    : RUNTIME_CANARY_SCENARIOS;
  const runs: CanaryScenarioRun[] = [];

  for (const scenario of selected) {
    const smoke = SMOKE_RUNNERS[scenario.id];
    if (!smoke) {
      runs.push(scenarioToRun(
        scenario,
        'incomplete',
        'Scenario is documented but does not have an automated runner yet.',
      ));
      continue;
    }
    runs.push(await runSmokeScenario(scenario, smoke.runner(deps), smoke.args(args)));
  }

  const result: PiV1CanaryResult = {
    status: aggregateStatus(runs),
    runtime: 'pi',
    mode: args.smokeOnly ? 'smoke-only' : 'full',
    durationMs: Date.now() - startedAt,
    scenarios: runs,
  };
  writeResult(result.status === 'failed' || result.status === 'incomplete' ? stderr : stdout, args.json, result);
  return result.status === 'passed' || result.status === 'skipped' ? 0 : 1;
}

export function parsePiV1CanaryArgs(argv: string[]): PiV1CanaryArgs {
  const args: PiV1CanaryArgs = {
    model: DEFAULT_PI_MODEL_ID,
    keepWorkspace: false,
    allowSkip: false,
    smokeOnly: false,
    list: false,
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
      case '--model':
        args.model = requireValue(argv, ++i, '--model');
        break;
      case '--auth-path':
        args.authPath = requireValue(argv, ++i, '--auth-path');
        break;
      case '--models-path':
        args.modelsPath = requireValue(argv, ++i, '--models-path');
        break;
      case '--timeout-ms':
        args.timeoutMs = parsePositiveInt(requireValue(argv, ++i, '--timeout-ms'), '--timeout-ms');
        break;
      case '--keep-workspace':
        args.keepWorkspace = true;
        break;
      case '--allow-skip':
        args.allowSkip = true;
        break;
      case '--smoke-only':
        args.smokeOnly = true;
        break;
      case '--list':
        args.list = true;
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

async function runSmokeScenario(
  scenario: RuntimeCanaryScenario,
  runner: SmokeCliRunner,
  argv: string[],
): Promise<CanaryScenarioRun> {
  const stdout = createWriter();
  const stderr = createWriter();
  let code = 1;

  try {
    code = await runner(argv, { stdout, stderr });
  } catch (err) {
    return scenarioToRun(
      scenario,
      'failed',
      err instanceof Error ? err.message : String(err),
      code,
    );
  }

  const parsed = parseProbeJson(stdout.text()) ?? parseProbeJson(stderr.text());
  if (!parsed) {
    return scenarioToRun(scenario, 'failed', 'Canary scenario did not emit JSON.', code);
  }

  const probeStatus = parsed.status === 'passed' || parsed.status === 'skipped' || parsed.status === 'failed'
    ? parsed.status
    : 'failed';
  return {
    ...scenarioToRun(
      scenario,
      code === 0 ? probeStatus : 'failed',
      code === 0 ? undefined : `Canary scenario exited with code ${code}.`,
      code,
    ),
    result: parsed,
  };
}

function scenarioToRun(
  scenario: RuntimeCanaryScenario,
  status: CanaryStatus,
  error?: string,
  code?: number,
): CanaryScenarioRun {
  return {
    id: scenario.id,
    kind: scenario.kind,
    title: scenario.title,
    status,
    coversFeatureContracts: [...scenario.coversFeatureContracts],
    command: scenario.evidenceCommand,
    ...(code === undefined ? {} : { code }),
    ...(error ? { error } : {}),
  };
}

function aggregateStatus(runs: CanaryScenarioRun[]): CanaryStatus {
  if (runs.some((run) => run.status === 'failed' || (run.code !== undefined && run.code !== 0))) return 'failed';
  if (runs.some((run) => run.status === 'incomplete')) return 'incomplete';
  if (runs.some((run) => run.status === 'skipped')) return 'skipped';
  return 'passed';
}

function buildAuthProbeArgs(args: PiV1CanaryArgs): string[] {
  const out = ['--json', '--model', args.model ?? DEFAULT_PI_MODEL_ID];
  if (args.authPath) out.push('--auth-path', args.authPath);
  if (args.modelsPath) out.push('--models-path', args.modelsPath);
  if (args.allowSkip) out.push('--allow-skip');
  return out;
}

function buildRuntimeProbeArgs(args: PiV1CanaryArgs): string[] {
  const out = ['--json', '--model', args.model ?? DEFAULT_PI_MODEL_ID];
  if (args.authPath) out.push('--auth-path', args.authPath);
  if (args.modelsPath) out.push('--models-path', args.modelsPath);
  if (args.timeoutMs) out.push('--timeout-ms', String(args.timeoutMs));
  if (args.keepWorkspace) out.push('--keep-workspace');
  if (args.allowSkip) out.push('--allow-skip');
  return out;
}

function buildAggregateProbeArgs(args: PiV1CanaryArgs): string[] {
  return buildRuntimeProbeArgs(args);
}

function parseProbeJson(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const line = trimmed.split('\n').reverse().find((candidate) => candidate.trim().startsWith('{'));
  if (!line) return undefined;
  try {
    const parsed = JSON.parse(line) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiV1CanaryResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stream.write([
    `Pi v1 canary ${result.status}.`,
    `mode: ${result.mode}`,
    `durationMs: ${result.durationMs}`,
    ...result.scenarios.map((scenario) => `${scenario.id}: ${scenario.status}`),
  ].join('\n'));
  stream.write('\n');
}

function createWriter() {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    text() {
      return chunks.join('');
    },
  };
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function usage(): string {
  return [
    'Usage: pnpm smoke:pi-v1-canary -- [--json] [--smoke-only] [--list]',
    '',
    'Runs or lists the runtime v1 Pi canary evidence map.',
    '',
    'Options:',
    `  --model <model>       model override forwarded to smoke probes (default: ${DEFAULT_PI_MODEL_ID})`,
    '  --auth-path <path>    optional Pi auth.json path forwarded to smoke probes',
    '  --models-path <path>  optional Pi models.json path forwarded to smoke probes',
    '  --timeout-ms <ms>     positive integer timeout forwarded to runtime probes',
    '  --keep-workspace      keep temporary smoke workspaces for inspection',
    '  --allow-skip          exit 0 when probes report missing optional Pi runtime/auth setup',
    '  --smoke-only          run only scenarios with automated smoke runners',
    '  --list                list the canary map without running probes',
    '  --json                print structured result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiV1CanaryCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
