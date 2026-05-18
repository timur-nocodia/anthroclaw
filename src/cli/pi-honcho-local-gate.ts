import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createFailedHonchoLocalGateResult,
  DEFAULT_HONCHO_EXPECTED_BASE_URL_HOST,
  DEFAULT_HONCHO_EXPECTED_ENVIRONMENT,
  DEFAULT_HONCHO_EXPECTED_MODE,
  runHonchoLocalGate,
  type HonchoLocalGateInput,
  type HonchoLocalGateResult,
} from '../runtime/side-effect-gates/honcho-local.js';

interface PiHonchoLocalGateArgs {
  agentId?: string;
  agentsDir: string;
  peerId?: string;
  sessionKey?: string;
  expectedMode: string;
  expectedEnvironment: string;
  expectedBaseUrlHost: string;
  expectedWorkspaceId?: string;
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiHonchoLocalGateDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runPiHonchoLocalGateCli(
  argv: string[],
  deps: PiHonchoLocalGateDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiHonchoLocalGateArgs;

  try {
    args = parsePiHonchoLocalGateArgs(argv);
    validateArgs(args);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-honcho-local-gate-'));
  const input = toGateInput(args, workspace);
  try {
    const result = await runHonchoLocalGate(input);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result = createFailedHonchoLocalGateResult(input, errorMessage(err));
    writeResult(stderr, args.json, result);
    return 1;
  } finally {
    if (!args.keepData) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export function parsePiHonchoLocalGateArgs(argv: string[]): PiHonchoLocalGateArgs {
  const args: PiHonchoLocalGateArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    expectedMode: DEFAULT_HONCHO_EXPECTED_MODE,
    expectedEnvironment: DEFAULT_HONCHO_EXPECTED_ENVIRONMENT,
    expectedBaseUrlHost: DEFAULT_HONCHO_EXPECTED_BASE_URL_HOST,
    keepData: false,
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
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
        break;
      case '--session-key':
        args.sessionKey = requireValue(argv, ++i, '--session-key');
        break;
      case '--expected-mode':
        args.expectedMode = requireValue(argv, ++i, '--expected-mode');
        break;
      case '--expected-environment':
        args.expectedEnvironment = requireValue(argv, ++i, '--expected-environment');
        break;
      case '--expected-base-url-host':
        args.expectedBaseUrlHost = requireValue(argv, ++i, '--expected-base-url-host');
        break;
      case '--expected-workspace-id':
        args.expectedWorkspaceId = requireValue(argv, ++i, '--expected-workspace-id');
        break;
      case '--dry-run':
        break;
      case '--keep-data':
        args.keepData = true;
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

function validateArgs(args: PiHonchoLocalGateArgs): void {
  if (args.help) return;
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
}

function toGateInput(args: PiHonchoLocalGateArgs, workspace: string): HonchoLocalGateInput {
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  return {
    agentId: args.agentId,
    sourceAgentsDir: args.agentsDir,
    workspace,
    peerId: args.peerId,
    sessionKey: args.sessionKey,
    expectedMode: args.expectedMode,
    expectedEnvironment: args.expectedEnvironment,
    expectedBaseUrlHost: args.expectedBaseUrlHost,
    expectedWorkspaceId: args.expectedWorkspaceId,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: HonchoLocalGateResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (result.status === 'passed') {
    stream.write([
      'Pi Honcho local gate passed.',
      `agent: ${result.agentId}`,
      `currentConfig: ${JSON.stringify(result.currentConfig)}`,
      `disabledGate: ${JSON.stringify(result.disabledGate)}`,
      `activationCandidate: ${JSON.stringify(result.activationCandidate)}`,
      `safety: ${JSON.stringify(result.safety)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }
  stream.write(`Pi Honcho local gate failed: ${result.error ?? 'unknown error'}\n`);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-honcho-local-gate -- --agent-id <id> --peer-id <peer> [options]',
    '',
    'Options:',
    '  --agent-id <id>                 agent directory id under --agents-dir',
    '  --agents-dir <path>             source agents directory (default: agents)',
    '  --peer-id <id>                  expected private Telegram peer id',
    '  --session-key <key>             dispatch session key',
    '  --expected-mode <mode>          expected Honcho mode (default: tools)',
    '  --expected-environment <env>    expected Honcho environment (default: local)',
    '  --expected-base-url-host <host> expected Honcho base_url host (default: localhost:8000)',
    '  --expected-workspace-id <id>    expected Honcho workspace_id',
    '  --dry-run                       accepted for gate CLI consistency; this gate is temp-only',
    '  --keep-data                     keep temp workspace for inspection',
    '  --json                          emit JSON',
  ].join('\n');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiHonchoLocalGateCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
