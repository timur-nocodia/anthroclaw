import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createFailedHonchoLocalGateResult,
  runHonchoLocalGate,
  type HonchoLocalGateInput,
  type HonchoLocalGateResult,
} from '../runtime/side-effect-gates/honcho-local.js';

const AGENT_ID = 'timur_agent';
const DEFAULT_PEER_ID = '48705953';
const SESSION_KEY = `${AGENT_ID}:telegram:dm:${DEFAULT_PEER_ID}:honcho-local-smoke`;
const EXPECTED_WORKSPACE_ID = 'anthroclaw-timur-agent-lab';

interface PiTimurAgentHonchoLocalSmokeArgs {
  agentsDir: string;
  peerId: string;
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiTimurAgentHonchoLocalSmokeDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

type PiTimurAgentHonchoLocalSmokeResult = HonchoLocalGateResult;

export async function runPiTimurAgentHonchoLocalSmokeCli(
  argv: string[],
  deps: PiTimurAgentHonchoLocalSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTimurAgentHonchoLocalSmokeArgs;

  try {
    args = parsePiTimurAgentHonchoLocalSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-timur-agent-honcho-local-'));
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

export async function runPiTimurAgentHonchoLocalSmoke(input: PiTimurAgentHonchoLocalSmokeArgs & {
  workspace: string;
}): Promise<PiTimurAgentHonchoLocalSmokeResult> {
  return runHonchoLocalGate(toGateInput(input, input.workspace));
}

export function parsePiTimurAgentHonchoLocalSmokeArgs(argv: string[]): PiTimurAgentHonchoLocalSmokeArgs {
  const args: PiTimurAgentHonchoLocalSmokeArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    peerId: DEFAULT_PEER_ID,
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
      case '--agents-dir':
        args.agentsDir = resolve(requireValue(argv, ++i, '--agents-dir'));
        break;
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
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

function toGateInput(args: PiTimurAgentHonchoLocalSmokeArgs, workspace: string): HonchoLocalGateInput {
  return {
    agentId: AGENT_ID,
    sourceAgentsDir: args.agentsDir,
    workspace,
    peerId: args.peerId,
    sessionKey: SESSION_KEY,
    expectedWorkspaceId: EXPECTED_WORKSPACE_ID,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTimurAgentHonchoLocalSmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (result.status === 'passed') {
    stream.write('TIMUR_AGENT_HONCHO_LOCAL_SMOKE_OK\n');
    return;
  }
  stream.write(`TIMUR_AGENT_HONCHO_LOCAL_SMOKE_FAILED: ${result.error ?? 'unknown error'}\n`);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-timur-agent-honcho-local-smoke -- [--json]',
    '',
    'Options:',
    '  --agents-dir <path>  Agents directory to copy from (default: agents)',
    '  --peer-id <id>       Expected allowlisted Telegram peer (default: 48705953)',
    '  --keep-data          Keep temp workspace for inspection',
    '  --json               Emit machine-readable JSON',
  ].join('\n');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentHonchoLocalSmokeCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
