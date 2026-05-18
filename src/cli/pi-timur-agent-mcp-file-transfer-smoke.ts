import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createFailedMcpFileTransferGateResult,
  DEFAULT_MCP_FILE_TRANSFER_SERVER_URL,
  runMcpFileTransferGate,
  type McpFileTransferGateInput,
  type McpFileTransferGateResult,
} from '../runtime/side-effect-gates/mcp-file-transfer.js';

const AGENT_ID = 'timur_agent';
const DEFAULT_PEER_ID = '48705953';
const DEFAULT_SENDER_ID = '48705953';
const SESSION_KEY = `${AGENT_ID}:telegram:dm:${DEFAULT_PEER_ID}:mcp-file-transfer-smoke`;
const PENDING_ID = 'pnd_timur_mcp_smoke';
const FAKE_SERVER_NAME = 'timur-mcp-smoke';
const SEED_TEXT = 'timur agent file-transfer seed';
const WRITE_TEXT = 'written by timur_agent MCP/file-transfer smoke';
const EXPECTED_ROOTS = ['agents/timur_agent/lab-files', 'research'];

interface PiTimurAgentMcpFileTransferSmokeArgs {
  agentsDir: string;
  peerId: string;
  senderId: string;
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiTimurAgentMcpFileTransferSmokeDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

type PiTimurAgentMcpFileTransferSmokeResult = McpFileTransferGateResult;

export async function runPiTimurAgentMcpFileTransferSmokeCli(
  argv: string[],
  deps: PiTimurAgentMcpFileTransferSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTimurAgentMcpFileTransferSmokeArgs;

  try {
    args = parsePiTimurAgentMcpFileTransferSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-timur-agent-mcp-file-transfer-'));
  const input = toGateInput(args, workspace);
  try {
    const result = await runMcpFileTransferGate(input);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result = createFailedMcpFileTransferGateResult(input, errorMessage(err));
    writeResult(stderr, args.json, result);
    return 1;
  } finally {
    if (!args.keepData) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export async function runPiTimurAgentMcpFileTransferSmoke(input: PiTimurAgentMcpFileTransferSmokeArgs & {
  workspace: string;
}): Promise<PiTimurAgentMcpFileTransferSmokeResult> {
  return runMcpFileTransferGate(toGateInput(input, input.workspace));
}

export function parsePiTimurAgentMcpFileTransferSmokeArgs(argv: string[]): PiTimurAgentMcpFileTransferSmokeArgs {
  const args: PiTimurAgentMcpFileTransferSmokeArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    peerId: DEFAULT_PEER_ID,
    senderId: DEFAULT_SENDER_ID,
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
      case '--sender-id':
        args.senderId = requireValue(argv, ++i, '--sender-id');
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

function toGateInput(args: PiTimurAgentMcpFileTransferSmokeArgs, workspace: string): McpFileTransferGateInput {
  return {
    agentId: AGENT_ID,
    sourceAgentsDir: args.agentsDir,
    workspace,
    peerId: args.peerId,
    senderId: args.senderId,
    sessionKey: SESSION_KEY,
    serverUrl: DEFAULT_MCP_FILE_TRANSFER_SERVER_URL,
    pendingId: PENDING_ID,
    fakeServerName: FAKE_SERVER_NAME,
    expectedConfiguredRoots: EXPECTED_ROOTS,
    seedText: SEED_TEXT,
    writeText: WRITE_TEXT,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTimurAgentMcpFileTransferSmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (result.status === 'passed') {
    stream.write('TIMUR_AGENT_MCP_FILE_TRANSFER_SMOKE_OK\n');
    return;
  }
  stream.write(`TIMUR_AGENT_MCP_FILE_TRANSFER_SMOKE_FAILED: ${result.error ?? 'unknown error'}\n`);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-timur-agent-mcp-file-transfer-smoke -- [--json]',
    '',
    'Options:',
    '  --agents-dir <path>  Agents directory to copy from (default: agents)',
    '  --peer-id <id>       Expected allowlisted Telegram peer (default: 48705953)',
    '  --sender-id <id>     Dispatch sender id (default: 48705953)',
    '  --keep-data          Keep temp workspace for inspection',
    '  --json               Emit machine-readable JSON',
  ].join('\n');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentMcpFileTransferSmokeCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
