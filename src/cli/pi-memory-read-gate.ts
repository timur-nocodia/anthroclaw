import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_PI_MODEL_ID } from '../runtime/pi-headless.js';
import {
  createFailedMemoryReadGateResult,
  runMemoryReadGate,
  type MemoryReadGateInput,
  type MemoryReadGateResult,
} from '../runtime/side-effect-gates/memory-read.js';

const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';

interface PiMemoryReadGateArgs {
  agentId?: string;
  agentsDir: string;
  pluginsDir: string;
  model?: string;
  authPath?: string;
  modelsPath?: string;
  peerId?: string;
  senderId?: string;
  timeoutMs: number;
  keepData: boolean;
  allowSkip: boolean;
  json: boolean;
  help: boolean;
}

interface PiMemoryReadGateDeps {
  makeWorkspace?: () => string;
  preflightPiRuntime?: () => Promise<void>;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

type PiMemoryReadGateCliResult = MemoryReadGateResult | (Omit<MemoryReadGateResult, 'status'> & {
  status: 'skipped';
});

export async function runPiMemoryReadGateCli(
  argv: string[],
  deps: PiMemoryReadGateDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiMemoryReadGateArgs;

  try {
    args = parsePiMemoryReadGateArgs(argv);
    validateArgs(args);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-memory-read-gate-'));
  let shouldRemoveWorkspace = !args.keepData;
  const input = toGateInput(args, workspace);

  try {
    await (deps.preflightPiRuntime ?? ensurePiRuntimeImportable)();
    const result = await runMemoryReadGate(input);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const error = errorMessage(err);
    const status = args.allowSkip && isSkippableGateError(error) ? 'skipped' : 'failed';
    const result = {
      ...createFailedMemoryReadGateResult(input, error),
      status,
    } satisfies PiMemoryReadGateCliResult;
    writeResult(status === 'failed' ? stderr : stdout, args.json, result);
    if (status === 'failed') shouldRemoveWorkspace = false;
    return status === 'skipped' ? 0 : 1;
  } finally {
    if (shouldRemoveWorkspace) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export function parsePiMemoryReadGateArgs(argv: string[]): PiMemoryReadGateArgs {
  const args: PiMemoryReadGateArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    pluginsDir: process.env.OC_PLUGINS_DIR ? resolve(process.env.OC_PLUGINS_DIR) : resolve('plugins'),
    model: DEFAULT_PI_MODEL_ID,
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
      case '--agent':
      case '--agent-id':
        args.agentId = requireValue(argv, ++i, arg);
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

function validateArgs(args: PiMemoryReadGateArgs): void {
  if (args.help) return;
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.senderId) throw new Error('--sender-id is required.');
}

function toGateInput(args: PiMemoryReadGateArgs, workspace: string): MemoryReadGateInput {
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.senderId) throw new Error('--sender-id is required.');
  return {
    agentId: args.agentId,
    sourceAgentsDir: args.agentsDir,
    workspace,
    pluginsDir: args.pluginsDir,
    model: args.model,
    authPath: args.authPath,
    modelsPath: args.modelsPath,
    peerId: args.peerId,
    senderId: args.senderId,
    timeoutMs: args.timeoutMs,
  };
}

async function ensurePiRuntimeImportable(): Promise<void> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
  try {
    await dynamicImport(PI_PACKAGE_NAME);
  } catch (err) {
    throw new Error(`Pi memory-read gate requires optional package ${PI_PACKAGE_NAME}. Original error: ${errorMessage(err)}`);
  }
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiMemoryReadGateCliResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi memory-read gate passed.',
      `agent: ${result.agentId}`,
      `sessionId: ${result.sessionId ?? '<none>'}`,
      `sentText: ${JSON.stringify(result.sentText)}`,
      `approvals: ${result.approvals}`,
      `requiredTools: ${JSON.stringify(result.toolEvidence?.required ?? {})}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi memory-read gate ${result.status}: ${result.error ?? 'unknown error'}\n`);
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function isSkippableGateError(error: string): boolean {
  return error.includes(PI_PACKAGE_NAME)
    || error.includes('Provider') && error.includes('credentials')
    || error.includes('auth');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-memory-read-gate -- --agent-id <id> --peer-id <peer> --sender-id <sender> [--json] [--allow-skip]',
    '',
    'Options:',
    '  --agent-id <id>      agent directory id under --agents-dir',
    '  --agents-dir <path>  source agents directory (default: agents)',
    '  --plugins-dir <path> plugins directory (default: plugins)',
    '  --model <id>         Pi model id (default: runtime default)',
    '  --auth-path <path>   Pi auth storage path',
    '  --models-path <path> Pi model registry storage path',
    '  --peer-id <id>       fake Telegram peer id',
    '  --sender-id <id>     fake Telegram sender id',
    '  --timeout-ms <n>     dispatch timeout in ms (default: 120000)',
    '  --keep-data          keep temp workspace for inspection',
    '  --allow-skip         return success when optional Pi setup is unavailable',
    '  --json               emit JSON',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiMemoryReadGateCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
