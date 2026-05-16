import 'dotenv/config';
import { resolve } from 'node:path';
import {
  AgentConfigNotFoundError,
  createAgentConfigWriter,
} from '../config/writer.js';

type CanaryRuntimeProvider = 'claude-agent-sdk' | 'pi';

interface CanaryAgentCliArgs {
  agentsDir: string;
  agentId?: string;
  provider?: CanaryRuntimeProvider;
  apply: boolean;
  json: boolean;
  help: boolean;
}

interface CanaryAgentCliDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface CanaryAgentResult {
  agentId: string;
  agentsDir: string;
  currentProvider: CanaryRuntimeProvider;
  desiredProvider: CanaryRuntimeProvider | null;
  applied: boolean;
  changed: boolean;
  backupPath: string | null;
  message: string;
}

export async function runPiProductionCanaryAgentCli(
  argv: string[],
  deps: CanaryAgentCliDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  let args: CanaryAgentCliArgs;
  try {
    args = parsePiProductionCanaryAgentArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (!args.agentId) {
    stderr.write(`--agent requires a value.\n${usage()}\n`);
    return 2;
  }

  try {
    const result = await runCanaryAgentRuntimeChange(args);
    stdout.write(args.json ? `${JSON.stringify(result)}\n` : renderHuman(result));
    return 0;
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n`);
    return err instanceof AgentConfigNotFoundError ? 2 : 1;
  }
}

export function parsePiProductionCanaryAgentArgs(argv: string[]): CanaryAgentCliArgs {
  const args: CanaryAgentCliArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    apply: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--':
        break;
      case '--agents-dir':
        args.agentsDir = resolve(requireValue(argv, ++i, '--agents-dir'));
        break;
      case '--agent':
        args.agentId = requireValue(argv, ++i, '--agent');
        break;
      case '--provider':
        args.provider = parseProvider(requireValue(argv, ++i, '--provider'));
        break;
      case '--enable-pi':
        args.provider = 'pi';
        break;
      case '--rollback':
        args.provider = 'claude-agent-sdk';
        break;
      case '--apply':
        args.apply = true;
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

async function runCanaryAgentRuntimeChange(args: CanaryAgentCliArgs): Promise<CanaryAgentResult> {
  if (!args.agentId) throw new Error('--agent requires a value.');

  const writer = createAgentConfigWriter({ agentsDir: args.agentsDir });
  const currentConfig = writer.readFullConfig(args.agentId);
  const currentProvider = providerFromConfig(currentConfig);
  const desiredProvider = args.provider ?? null;

  if (!desiredProvider) {
    return {
      agentId: args.agentId,
      agentsDir: args.agentsDir,
      currentProvider,
      desiredProvider,
      applied: false,
      changed: false,
      backupPath: null,
      message: 'status only; no runtime provider change requested',
    };
  }

  const changed = currentProvider !== desiredProvider;
  if (!changed) {
    return {
      agentId: args.agentId,
      agentsDir: args.agentsDir,
      currentProvider,
      desiredProvider,
      applied: false,
      changed: false,
      backupPath: null,
      message: `agent already resolves to ${desiredProvider}`,
    };
  }

  if (!args.apply) {
    return {
      agentId: args.agentId,
      agentsDir: args.agentsDir,
      currentProvider,
      desiredProvider,
      applied: false,
      changed: true,
      backupPath: null,
      message: 'dry-run only; rerun with --apply to write agent.yml',
    };
  }

  const writeResult = await writer.patchSection(
    args.agentId,
    'runtime',
    (current) => runtimeWithProvider(current, desiredProvider),
    { source: 'system', action: 'set_canary_runtime_provider' },
  );

  return {
    agentId: args.agentId,
    agentsDir: args.agentsDir,
    currentProvider,
    desiredProvider,
    applied: true,
    changed: true,
    backupPath: writeResult.backupPath,
    message: `agent runtime provider set to ${desiredProvider}`,
  };
}

function providerFromConfig(config: unknown): CanaryRuntimeProvider {
  const provider = asRecord(asRecord(asRecord(config).runtime).headless).provider;
  return provider === 'pi' ? 'pi' : 'claude-agent-sdk';
}

function runtimeWithProvider(current: unknown, provider: CanaryRuntimeProvider): Record<string, unknown> {
  const runtime = { ...asRecord(current) };
  const headless = { ...asRecord(runtime.headless) };
  headless.provider = provider;
  runtime.headless = headless;
  return runtime;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function renderHuman(result: CanaryAgentResult): string {
  const lines = [
    `Agent: ${result.agentId}`,
    `Agents dir: ${result.agentsDir}`,
    `Current provider: ${result.currentProvider}`,
  ];
  if (result.desiredProvider) lines.push(`Desired provider: ${result.desiredProvider}`);
  lines.push(`Applied: ${result.applied ? 'yes' : 'no'}`);
  lines.push(`Changed: ${result.changed ? 'yes' : 'no'}`);
  if (result.backupPath) lines.push(`Backup: ${result.backupPath}`);
  lines.push(result.message);
  return `${lines.join('\n')}\n`;
}

function parseProvider(value: string): CanaryRuntimeProvider {
  if (value === 'claude-agent-sdk' || value === 'pi') return value;
  throw new Error(`Unknown provider: ${value}`);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-canary-agent -- --agent <id> [--enable-pi|--rollback|--provider claude-agent-sdk|pi] [--apply]',
    '',
    'Options:',
    '  --agents-dir <dir>       agents root (default: OC_AGENTS_DIR or ./agents)',
    '  --agent <id>             target agent id',
    '  --enable-pi              set runtime.headless.provider=pi',
    '  --rollback               set runtime.headless.provider=claude-agent-sdk',
    '  --provider <provider>    explicit provider: claude-agent-sdk or pi',
    '  --apply                  write agent.yml and create a backup; omitted means dry-run',
    '  --json                   print machine-readable result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiProductionCanaryAgentCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
