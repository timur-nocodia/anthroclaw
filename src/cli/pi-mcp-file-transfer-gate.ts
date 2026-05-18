import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createFailedMcpFileTransferGateResult,
  DEFAULT_MCP_FILE_TRANSFER_PENDING_ID,
  DEFAULT_MCP_FILE_TRANSFER_SERVER_NAME,
  DEFAULT_MCP_FILE_TRANSFER_SERVER_URL,
  runMcpFileTransferGate,
  type McpFileTransferGateInput,
  type McpFileTransferGateResult,
} from '../runtime/side-effect-gates/mcp-file-transfer.js';

interface PiMcpFileTransferGateArgs {
  agentId?: string;
  agentsDir: string;
  peerId?: string;
  senderId?: string;
  sessionKey?: string;
  serverUrl: string;
  pendingId: string;
  fakeServerName: string;
  expectedConfiguredRoots: string[];
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiMcpFileTransferGateDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runPiMcpFileTransferGateCli(
  argv: string[],
  deps: PiMcpFileTransferGateDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiMcpFileTransferGateArgs;

  try {
    args = parsePiMcpFileTransferGateArgs(argv);
    validateArgs(args);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-mcp-file-transfer-gate-'));
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

export function parsePiMcpFileTransferGateArgs(argv: string[]): PiMcpFileTransferGateArgs {
  const args: PiMcpFileTransferGateArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    serverUrl: DEFAULT_MCP_FILE_TRANSFER_SERVER_URL,
    pendingId: DEFAULT_MCP_FILE_TRANSFER_PENDING_ID,
    fakeServerName: DEFAULT_MCP_FILE_TRANSFER_SERVER_NAME,
    expectedConfiguredRoots: [],
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
      case '--sender-id':
        args.senderId = requireValue(argv, ++i, '--sender-id');
        break;
      case '--session-key':
        args.sessionKey = requireValue(argv, ++i, '--session-key');
        break;
      case '--server-url':
        args.serverUrl = requireValue(argv, ++i, '--server-url');
        break;
      case '--pending-id':
        args.pendingId = requireValue(argv, ++i, '--pending-id');
        break;
      case '--fake-server-name':
        args.fakeServerName = requireValue(argv, ++i, '--fake-server-name');
        break;
      case '--expect-root':
      case '--expected-root':
        args.expectedConfiguredRoots.push(requireValue(argv, ++i, arg));
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

function validateArgs(args: PiMcpFileTransferGateArgs): void {
  if (args.help) return;
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.senderId) throw new Error('--sender-id is required.');
}

function toGateInput(args: PiMcpFileTransferGateArgs, workspace: string): McpFileTransferGateInput {
  if (!args.agentId) throw new Error('--agent-id is required.');
  if (!args.peerId) throw new Error('--peer-id is required.');
  if (!args.senderId) throw new Error('--sender-id is required.');
  return {
    agentId: args.agentId,
    sourceAgentsDir: args.agentsDir,
    workspace,
    peerId: args.peerId,
    senderId: args.senderId,
    sessionKey: args.sessionKey,
    serverUrl: args.serverUrl,
    pendingId: args.pendingId,
    fakeServerName: args.fakeServerName,
    expectedConfiguredRoots: args.expectedConfiguredRoots,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: McpFileTransferGateResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (result.status === 'passed') {
    stream.write([
      'Pi MCP/file-transfer gate passed.',
      `agent: ${result.agentId}`,
      `mcp: ${JSON.stringify(result.mcp)}`,
      `fileTransfer: ${JSON.stringify(result.fileTransfer)}`,
      `safety: ${JSON.stringify(result.safety)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }
  stream.write(`Pi MCP/file-transfer gate failed: ${result.error ?? 'unknown error'}\n`);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-mcp-file-transfer-gate -- --agent-id <id> --peer-id <id> --sender-id <id> [options]',
    '',
    'Options:',
    '  --agent-id <id>          agent directory id under --agents-dir',
    '  --agents-dir <path>      source agents directory (default: agents)',
    '  --peer-id <id>           expected private Telegram peer id',
    '  --sender-id <id>         fake Telegram sender id',
    '  --session-key <key>      dispatch session key',
    '  --server-url <url>       fake MCP server URL',
    '  --pending-id <id>        fake pending id',
    '  --fake-server-name <id>  fake MCP server name',
    '  --expect-root <path>     configured file-transfer root expected in agent config; repeatable',
    '  --dry-run                accepted for gate CLI consistency; this gate is temp-only',
    '  --keep-data              keep temp workspace for inspection',
    '  --json                   emit JSON',
  ].join('\n');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiMcpFileTransferGateCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
