import 'dotenv/config';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ApprovalRequest, ChannelAdapter, InboundMessage, SendOptions, OutboundMedia } from '../channels/types.js';
import { GlobalConfigSchema } from '../config/schema.js';
import { Gateway } from '../gateway.js';

const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';
const AGENT_ID = 'pi-gateway-smoke';
const CHANNEL_ID = 'telegram';
const ACCOUNT_ID = 'default';
const PEER_ID = 'pi-gateway-smoke-peer';
const SENDER_ID = 'pi-gateway-smoke-sender';
const MESSAGE_ID = 'pi-gateway-smoke-message';
const SMOKE_FILE = 'gateway-pi-smoke.txt';
const BEFORE_TEXT = 'before AnthroClaw Pi Gateway smoke\n';
const AFTER_TEXT = 'after AnthroClaw Pi Gateway smoke\n';

interface PiGatewaySmokeArgs {
  model?: string;
  timeoutMs: number;
  keepWorkspace: boolean;
  allowSkip: boolean;
  json: boolean;
  help: boolean;
}

interface PiGatewaySmokeDeps {
  GatewayCtor?: new () => Gateway;
  makeWorkspace?: () => string;
  preflightPiRuntime?: () => Promise<void>;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiGatewaySmokeResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  workspace: string;
  agentId: string;
  file: string;
  approvals: number;
  sentText: string[];
  sessionId?: string;
  error?: string;
}

export async function runPiGatewaySmokeCli(
  argv: string[],
  deps: PiGatewaySmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiGatewaySmokeArgs;

  try {
    args = parsePiGatewaySmokeArgs(argv);
  } catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    stderr.write(`${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-gateway-smoke-'));
  let shouldRemoveWorkspace = !args.keepWorkspace;
  try {
    await (deps.preflightPiRuntime ?? ensurePiRuntimeImportable)();
    const result = await runPiGatewaySmoke({
      GatewayCtor: deps.GatewayCtor,
      workspace,
      model: args.model,
      timeoutMs: args.timeoutMs,
    });
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const status = args.allowSkip && isSkippableSmokeError(error) ? 'skipped' : 'failed';
    const result: PiGatewaySmokeResult = {
      status,
      runtime: 'pi',
      workspace,
      agentId: AGENT_ID,
      file: join(workspace, 'agents', AGENT_ID, SMOKE_FILE),
      approvals: 0,
      sentText: [],
      error,
    };
    writeResult(status === 'failed' ? stderr : stdout, args.json, result);
    if (status === 'skipped') return 0;
    shouldRemoveWorkspace = false;
    return 1;
  } finally {
    if (shouldRemoveWorkspace) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export async function runPiGatewaySmoke(input: {
  GatewayCtor?: new () => Gateway;
  workspace: string;
  model?: string;
  timeoutMs: number;
}): Promise<PiGatewaySmokeResult> {
  const workspace = resolve(input.workspace);
  const agentsDir = join(workspace, 'agents');
  const dataDir = join(workspace, 'data');
  const pluginsDir = join(workspace, 'plugins');
  const agentDir = join(agentsDir, AGENT_ID);
  const smokePath = join(agentDir, SMOKE_FILE);
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(pluginsDir, { recursive: true });
  writeFileSync(smokePath, BEFORE_TEXT, 'utf8');
  writeFileSync(join(agentDir, 'agent.yml'), agentYml(input.model), 'utf8');

  const GatewayCtor = input.GatewayCtor ?? Gateway;
  const gateway = new GatewayCtor();
  const sentText: string[] = [];
  const approvals: ApprovalRequest[] = [];
  const channel = createSmokeChannel({
    sentText,
    approvals,
    approve: (request) => {
      setTimeout(() => {
        gateway.handleApprovalCallback(`approve:${request.id}`, SENDER_ID);
      }, 0);
    },
  });

  try {
    await gateway.start(smokeConfig(), agentsDir, dataDir, pluginsDir);
    gateway._setChannel(CHANNEL_ID, channel);
    const priorFailedRunIds = new Set(
      gateway.listAgentRuns({ agentId: AGENT_ID, status: 'failed', limit: 1000 }).map((run) => run.runId),
    );
    await withTimeout(gateway.dispatch(smokeMessage()), input.timeoutMs);
    const failedRun = gateway
      .listAgentRuns({ agentId: AGENT_ID, status: 'failed', limit: 10 })
      .find((run) => !priorFailedRunIds.has(run.runId));
    if (failedRun?.error) {
      throw new Error(`Pi Gateway runtime failed: ${failedRun.error}`);
    }

    const actual = readFileSync(smokePath, 'utf8');
    if (actual !== AFTER_TEXT) {
      throw new Error(`Pi Gateway smoke file mismatch. Expected ${JSON.stringify(AFTER_TEXT)}, got ${JSON.stringify(actual)}.`);
    }
    if (approvals.length < 1) {
      throw new Error('Pi Gateway smoke did not observe an AnthroClaw approval request.');
    }
    const sessions = await gateway.listAgentSessions(AGENT_ID);
    return {
      status: 'passed',
      runtime: 'pi',
      workspace,
      agentId: AGENT_ID,
      file: smokePath,
      approvals: approvals.length,
      sentText,
      sessionId: sessions[0]?.sessionId,
    };
  } finally {
    await gateway.stop().catch(() => undefined);
  }
}

export function parsePiGatewaySmokeArgs(argv: string[]): PiGatewaySmokeArgs {
  const args: PiGatewaySmokeArgs = {
    timeoutMs: 120_000,
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

async function ensurePiRuntimeImportable(): Promise<void> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
  try {
    await dynamicImport(PI_PACKAGE_NAME);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Pi Gateway smoke requires optional package ${PI_PACKAGE_NAME}. Original error: ${message}`);
  }
}

function smokeConfig() {
  return GlobalConfigSchema.parse({
    defaults: {
      model: 'claude-sonnet-4-6',
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
      debounce_ms: 0,
    },
    runtime: {
      headless: {
        provider: 'pi',
      },
    },
  });
}

function agentYml(model?: string): string {
  return [
    'safety_profile: trusted',
    ...(model ? [`model: ${JSON.stringify(model)}`] : []),
    'routes:',
    '  - channel: telegram',
    '    scope: dm',
    'pairing:',
    '  mode: open',
    'sdk:',
    '  allowedTools:',
    '    - Read',
    '    - Write',
    '    - Edit',
    '  permissions:',
    '    allow_bash: false',
    '    allow_web: false',
    'display:',
    '  toolProgress: off',
    '',
  ].join('\n');
}

function smokeMessage(): InboundMessage {
  return {
    channel: CHANNEL_ID,
    accountId: ACCOUNT_ID,
    chatType: 'dm',
    peerId: PEER_ID,
    senderId: SENDER_ID,
    senderName: 'Pi Gateway Smoke User',
    text: [
      `Edit ${SMOKE_FILE} in your current workspace so it contains exactly:`,
      AFTER_TEXT.trimEnd(),
      'Use Write or Edit. Do not use Bash. Reply with SMOKE_GATEWAY_OK when the file is changed.',
    ].join('\n'),
    messageId: MESSAGE_ID,
    mentionedBot: true,
    raw: {},
  };
}

function createSmokeChannel(input: {
  sentText: string[];
  approvals: ApprovalRequest[];
  approve: (request: ApprovalRequest) => void;
}): ChannelAdapter {
  return {
    id: CHANNEL_ID,
    supportsApproval: true,
    onMessage() {},
    async start() {},
    async stop() {},
    async sendText(_peerId: string, text: string, _opts?: SendOptions) {
      input.sentText.push(text);
      return `smoke-message-${input.sentText.length}`;
    },
    async editText() {},
    async deleteText() {},
    async sendMedia(_peerId: string, _media: OutboundMedia, _opts?: SendOptions) {
      return 'smoke-media-1';
    },
    async sendTyping() {},
    async promptForApproval(request: ApprovalRequest) {
      input.approvals.push(request);
      input.approve(request);
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Pi Gateway smoke timeout after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiGatewaySmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi Gateway smoke passed.',
      `workspace: ${result.workspace}`,
      `sessionId: ${result.sessionId ?? '<none>'}`,
      `approvals: ${result.approvals}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi Gateway smoke ${result.status}: ${result.error ?? 'unknown error'}\n`);
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

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function usage(): string {
  return [
    'Usage: pnpm smoke:pi-gateway -- [--json] [--allow-skip]',
    '',
    'Options:',
    '  --model <model>       model override for the temporary smoke agent',
    '  --timeout-ms <ms>     positive integer dispatch timeout (default: 120000)',
    '  --keep-workspace      keep the temporary smoke workspace for inspection',
    '  --allow-skip          exit 0 for missing optional Pi runtime/auth setup',
    '  --json                print structured smoke result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiGatewaySmokeCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
