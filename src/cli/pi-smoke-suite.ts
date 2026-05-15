import 'dotenv/config';
import { runPiAuthSmokeCli } from './pi-auth-smoke.js';
import { runPiGatewaySmokeCli } from './pi-gateway-smoke.js';
import { runPiWorkspaceSmokeCli } from './pi-workspace-smoke.js';
import { DEFAULT_PI_MODEL_ID } from '../runtime/pi-headless.js';

type SmokeStatus = 'passed' | 'failed' | 'skipped';
type SmokeCliDeps = { stdout?: Pick<NodeJS.WriteStream, 'write'>; stderr?: Pick<NodeJS.WriteStream, 'write'> };
type SmokeCliRunner = (argv: string[], deps?: SmokeCliDeps) => Promise<number>;

interface PiSmokeSuiteArgs {
  model?: string;
  timeoutMs?: number;
  keepWorkspace: boolean;
  allowSkip: boolean;
  json: boolean;
  help: boolean;
}

interface PiSmokeSuiteDeps {
  runAuthCli?: SmokeCliRunner;
  runWorkspaceCli?: SmokeCliRunner;
  runGatewayCli?: SmokeCliRunner;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface ProbeRunResult {
  name: 'auth' | 'workspace' | 'gateway';
  code: number;
  status: SmokeStatus;
  stdout?: string;
  stderr?: string;
  result?: Record<string, unknown>;
  error?: string;
}

interface PiSmokeSuiteResult {
  status: SmokeStatus;
  runtime: 'pi';
  durationMs: number;
  probes: {
    auth: ProbeRunResult;
    workspace: ProbeRunResult;
    gateway: ProbeRunResult;
  };
}

export async function runPiSmokeSuiteCli(
  argv: string[],
  deps: PiSmokeSuiteDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiSmokeSuiteArgs;

  try {
    args = parsePiSmokeSuiteArgs(argv);
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
  const auth = await runProbe(
    'auth',
    deps.runAuthCli ?? runPiAuthSmokeCli,
    buildAuthProbeArgs(args),
  );
  const shouldRunRuntimeProbes = auth.status === 'passed' && auth.code === 0;
  const workspace = shouldRunRuntimeProbes
    ? await runProbe(
        'workspace',
        deps.runWorkspaceCli ?? runPiWorkspaceSmokeCli,
        buildRuntimeProbeArgs(args),
      )
    : skippedDueToAuth('workspace');
  const gateway = shouldRunRuntimeProbes
    ? await runProbe(
        'gateway',
        deps.runGatewayCli ?? runPiGatewaySmokeCli,
        buildRuntimeProbeArgs(args),
      )
    : skippedDueToAuth('gateway');
  const result: PiSmokeSuiteResult = {
    status: aggregateStatus([auth, workspace, gateway]),
    runtime: 'pi',
    durationMs: Date.now() - startedAt,
    probes: {
      auth,
      workspace,
      gateway,
    },
  };

  writeResult(result.status === 'failed' ? stderr : stdout, args.json, result);
  return result.status === 'failed' ? 1 : 0;
}

export function parsePiSmokeSuiteArgs(argv: string[]): PiSmokeSuiteArgs {
  const args: PiSmokeSuiteArgs = {
    model: DEFAULT_PI_MODEL_ID,
    keepWorkspace: false,
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
      case '--model':
        args.model = requireValue(argv, ++i, '--model');
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
      case '--json':
        args.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function runProbe(
  name: ProbeRunResult['name'],
  runner: SmokeCliRunner,
  argv: string[],
): Promise<ProbeRunResult> {
  const stdout = createWriter();
  const stderr = createWriter();
  let code = 1;

  try {
    code = await runner(argv, { stdout, stderr });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      name,
      code,
      status: 'failed',
      stdout: stdout.text(),
      stderr: stderr.text(),
      error,
    };
  }

  const stdoutText = stdout.text();
  const stderrText = stderr.text();
  const parsed = parseProbeJson(stdoutText) ?? parseProbeJson(stderrText);
  if (!parsed) {
    return {
      name,
      code,
      status: code === 0 ? 'failed' : 'failed',
      stdout: stdoutText,
      stderr: stderrText,
      error: 'Smoke probe did not emit a JSON result.',
    };
  }

  const parsedStatus = parsed.status;
  const status: SmokeStatus = parsedStatus === 'passed' || parsedStatus === 'skipped' || parsedStatus === 'failed'
    ? parsedStatus
    : 'failed';
  return {
    name,
    code,
    status: code === 0 ? status : 'failed',
    result: parsed,
    ...(code === 0 ? {} : { error: `Smoke probe exited with code ${code}.` }),
  };
}

function buildAuthProbeArgs(args: PiSmokeSuiteArgs): string[] {
  const out = ['--json'];
  out.push('--model', args.model ?? DEFAULT_PI_MODEL_ID);
  if (args.allowSkip) out.push('--allow-skip');
  return out;
}

function buildRuntimeProbeArgs(args: PiSmokeSuiteArgs): string[] {
  const out = ['--json'];
  out.push('--model', args.model ?? DEFAULT_PI_MODEL_ID);
  if (args.timeoutMs) out.push('--timeout-ms', String(args.timeoutMs));
  if (args.keepWorkspace) out.push('--keep-workspace');
  if (args.allowSkip) out.push('--allow-skip');
  return out;
}

function skippedDueToAuth(name: 'workspace' | 'gateway'): ProbeRunResult {
  return {
    name,
    code: 0,
    status: 'skipped',
    error: 'Skipped because Pi auth preflight did not pass.',
  };
}

function aggregateStatus(probes: ProbeRunResult[]): SmokeStatus {
  if (probes.some((probe) => probe.status === 'failed' || probe.code !== 0)) return 'failed';
  if (probes.some((probe) => probe.status === 'skipped')) return 'skipped';
  return 'passed';
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
  result: PiSmokeSuiteResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stream.write([
    `Pi smoke suite ${result.status}.`,
    `durationMs: ${result.durationMs}`,
    `auth: ${result.probes.auth.status}`,
    `workspace: ${result.probes.workspace.status}`,
    `gateway: ${result.probes.gateway.status}`,
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
    'Usage: pnpm smoke:pi-all -- [--json] [--allow-skip]',
    '',
    'Runs Pi smoke probes in sequence:',
    '  1. auth/model preflight',
    '  2. workspace edit + rewind smoke',
    '  3. Gateway channel dispatch + approval smoke',
    '',
    'Options:',
    `  --model <model>       model override forwarded to all probes (default: ${DEFAULT_PI_MODEL_ID})`,
    '  --timeout-ms <ms>     positive integer timeout forwarded to both probes',
    '  --keep-workspace      keep temporary smoke workspaces for inspection',
    '  --allow-skip          exit 0 when probes report missing optional Pi runtime/auth setup',
    '  --json                print structured suite result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiSmokeSuiteCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
