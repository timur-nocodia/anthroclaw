import 'dotenv/config';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  ApprovalRequest,
  ChannelAdapter,
  InboundMessage,
  OutboundMedia,
  SendOptions,
} from '../channels/types.js';
import { GlobalConfigSchema } from '../config/schema.js';
import { Gateway } from '../gateway.js';
import { DEFAULT_PI_MODEL_ID } from '../runtime/pi-headless.js';

const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';
const AGENT_ID = 'pi_telegram_lab';
const CHANNEL_ID = 'telegram';
const ACCOUNT_ID = 'default';
const DEFAULT_PEER_ID = '48705953';
const DEFAULT_SENDER_ID = '48705953';
const DEFAULT_MESSAGE_ID = 'pi-telegram-lab-smoke-message';
const DEFAULT_PROMPT = 'Ответь ровно: PI_TELEGRAM_LAB_OK';
const DEFAULT_EXPECT_TEXT = 'PI_TELEGRAM_LAB_OK';

interface PiTelegramLabSmokeArgs {
  agentsDir: string;
  pluginsDir: string;
  model?: string;
  authPath?: string;
  modelsPath?: string;
  peerId: string;
  senderId: string;
  prompt: string;
  expectText: string;
  timeoutMs: number;
  keepData: boolean;
  allowSkip: boolean;
  json: boolean;
  help: boolean;
}

interface PiTelegramLabSmokeDeps {
  GatewayCtor?: new () => Gateway;
  makeWorkspace?: () => string;
  preflightPiRuntime?: () => Promise<void>;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiTelegramLabSmokeResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  agentId: string;
  agentsDir: string;
  dataDir: string;
  pluginsDir: string;
  peerId: string;
  sentText: string[];
  normalizedText?: string;
  approvals: number;
  sessionId?: string;
  error?: string;
}

export async function runPiTelegramLabSmokeCli(
  argv: string[],
  deps: PiTelegramLabSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTelegramLabSmokeArgs;

  try {
    args = parsePiTelegramLabSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-telegram-lab-'));
  const dataDir = join(workspace, 'data');
  let shouldRemoveWorkspace = !args.keepData;

  try {
    await (deps.preflightPiRuntime ?? ensurePiRuntimeImportable)();
    const result = await runPiTelegramLabSmoke({
      GatewayCtor: deps.GatewayCtor,
      agentsDir: args.agentsDir,
      dataDir,
      pluginsDir: args.pluginsDir,
      model: args.model,
      authPath: args.authPath,
      modelsPath: args.modelsPath,
      peerId: args.peerId,
      senderId: args.senderId,
      prompt: args.prompt,
      expectText: args.expectText,
      timeoutMs: args.timeoutMs,
    });
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const error = errorMessage(err);
    const status = args.allowSkip && isSkippableSmokeError(error) ? 'skipped' : 'failed';
    const result: PiTelegramLabSmokeResult = {
      status,
      runtime: 'pi',
      agentId: AGENT_ID,
      agentsDir: args.agentsDir,
      dataDir,
      pluginsDir: args.pluginsDir,
      peerId: args.peerId,
      sentText: [],
      approvals: 0,
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

export async function runPiTelegramLabSmoke(input: {
  GatewayCtor?: new () => Gateway;
  agentsDir: string;
  dataDir: string;
  pluginsDir: string;
  model?: string;
  authPath?: string;
  modelsPath?: string;
  peerId: string;
  senderId: string;
  prompt: string;
  expectText: string;
  expectIncludes?: string[];
  timeoutMs: number;
}): Promise<PiTelegramLabSmokeResult> {
  const agentsDir = resolve(input.agentsDir);
  const dataDir = resolve(input.dataDir);
  const pluginsDir = resolve(input.pluginsDir);
  mkdirSync(dataDir, { recursive: true });

  const GatewayCtor = input.GatewayCtor ?? Gateway;
  const gateway = new GatewayCtor();
  const sentText: string[] = [];
  const approvals: ApprovalRequest[] = [];
  const channel = createLabSmokeChannel({
    sentText,
    approvals,
    approve: (request) => {
      setTimeout(() => {
        gateway.handleApprovalCallback(`approve:${request.id}`, input.senderId);
      }, 0);
    },
  });

  try {
    await gateway.start(labSmokeConfig({
      model: input.model,
      authPath: input.authPath,
      modelsPath: input.modelsPath,
    }), agentsDir, dataDir, pluginsDir);
    gateway._setChannel(CHANNEL_ID, channel);

    const priorFailedRunIds = new Set(
      gateway.listAgentRuns({ agentId: AGENT_ID, status: 'failed', limit: 1000 }).map((run) => run.runId),
    );
    await withTimeout(gateway.dispatch(labSmokeMessage(input)), input.timeoutMs);

    const failedRun = gateway
      .listAgentRuns({ agentId: AGENT_ID, status: 'failed', limit: 10 })
      .find((run) => !priorFailedRunIds.has(run.runId));
    if (failedRun?.error) {
      throw new Error(`Pi Telegram lab runtime failed: ${failedRun.error}`);
    }

    const lastText = sentText.at(-1)?.trim() ?? '';
    const normalizedText = normalizeTelegramText(lastText);
    const expectedIncludes = input.expectIncludes ?? [];
    if (expectedIncludes.length > 0) {
      const missing = expectedIncludes.filter((expected) => {
        return !normalizedText.includes(normalizeTelegramText(expected));
      });
      if (missing.length > 0) {
        throw new Error(
          [
            'Pi Telegram lab response missing expected text.',
            `Missing ${JSON.stringify(missing)},`,
            `got ${JSON.stringify(lastText)} (${JSON.stringify(normalizedText)} normalized).`,
          ].join(' '),
        );
      }
    }

    const normalizedExpected = normalizeTelegramText(input.expectText);
    if (expectedIncludes.length === 0 && normalizedText !== normalizedExpected) {
      throw new Error(
        [
          'Pi Telegram lab response mismatch.',
          `Expected ${JSON.stringify(input.expectText)} (${JSON.stringify(normalizedExpected)} normalized),`,
          `got ${JSON.stringify(lastText)} (${JSON.stringify(normalizedText)} normalized).`,
        ].join(' '),
      );
    }

    const sessions = await gateway.listAgentSessions(AGENT_ID);
    return {
      status: 'passed',
      runtime: 'pi',
      agentId: AGENT_ID,
      agentsDir,
      dataDir,
      pluginsDir,
      peerId: input.peerId,
      sentText,
      normalizedText,
      approvals: approvals.length,
      sessionId: sessions[0]?.sessionId,
    };
  } finally {
    await gateway.stop().catch(() => undefined);
  }
}

export function parsePiTelegramLabSmokeArgs(argv: string[]): PiTelegramLabSmokeArgs {
  const args: PiTelegramLabSmokeArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    pluginsDir: process.env.OC_PLUGINS_DIR ? resolve(process.env.OC_PLUGINS_DIR) : resolve('plugins'),
    peerId: DEFAULT_PEER_ID,
    senderId: DEFAULT_SENDER_ID,
    prompt: DEFAULT_PROMPT,
    expectText: DEFAULT_EXPECT_TEXT,
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
      case '--prompt':
        args.prompt = requireValue(argv, ++i, '--prompt');
        break;
      case '--expect-text':
        args.expectText = requireValue(argv, ++i, '--expect-text');
        break;
      case '--timeout-ms':
        args.timeoutMs = parsePositiveInt(requireValue(argv, ++i, '--timeout-ms'), '--timeout-ms');
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

async function ensurePiRuntimeImportable(): Promise<void> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
  try {
    await dynamicImport(PI_PACKAGE_NAME);
  } catch (err) {
    throw new Error(`Pi Telegram lab smoke requires optional package ${PI_PACKAGE_NAME}. Original error: ${errorMessage(err)}`);
  }
}

function labSmokeConfig(input: { model?: string; authPath?: string; modelsPath?: string } = {}) {
  return GlobalConfigSchema.parse({
    defaults: {
      model: input.model ?? DEFAULT_PI_MODEL_ID,
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
      debounce_ms: 0,
    },
    runtime: {
      headless: {
        provider: 'pi',
        pi: {
          ...(input.authPath ? { auth_path: input.authPath } : {}),
          ...(input.modelsPath ? { models_path: input.modelsPath } : {}),
        },
      },
    },
  });
}

function labSmokeMessage(input: {
  peerId: string;
  senderId: string;
  prompt: string;
}): InboundMessage {
  return {
    channel: CHANNEL_ID,
    accountId: ACCOUNT_ID,
    chatType: 'dm',
    peerId: input.peerId,
    senderId: input.senderId,
    senderName: 'Pi Telegram Lab Smoke User',
    text: input.prompt,
    messageId: DEFAULT_MESSAGE_ID,
    mentionedBot: true,
    raw: {},
  };
}

function createLabSmokeChannel(input: {
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
      return `pi-telegram-lab-smoke-message-${input.sentText.length}`;
    },
    async editText() {},
    async deleteText() {},
    async sendMedia(_peerId: string, _media: OutboundMedia, _opts?: SendOptions) {
      return 'pi-telegram-lab-smoke-media-1';
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
          reject(new Error(`Pi Telegram lab smoke timeout after ${timeoutMs}ms.`));
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
  result: PiTelegramLabSmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi Telegram lab smoke passed.',
      `agentId: ${result.agentId}`,
      `sessionId: ${result.sessionId ?? '<none>'}`,
      `sentText: ${JSON.stringify(result.sentText)}`,
      `approvals: ${result.approvals}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi Telegram lab smoke ${result.status}: ${result.error ?? 'unknown error'}\n`);
}

export function normalizeTelegramText(value: string): string {
  const unescaped = value.trim().replace(/\\([_*\[\]()~`>#+\-=|{}.!])/g, '$1');
  return unescaped.replace(/`/g, '');
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-telegram-lab-smoke -- [--json] [--allow-skip]',
    '',
    'Options:',
    '  --agents-dir <path>   agents directory containing pi_telegram_lab (default: agents)',
    '  --plugins-dir <path>  plugin directory loaded by Gateway (default: plugins)',
    '  --model <model>       model override for the smoke run',
    '  --auth-path <path>    optional Pi auth.json path',
    '  --models-path <path>  optional Pi models.json path',
    '  --peer-id <id>        Telegram peer id to simulate (default: 48705953)',
    '  --sender-id <id>      Telegram sender id to simulate (default: 48705953)',
    '  --prompt <text>       marker prompt to dispatch',
    '  --expect-text <text>  final outbound text expected after Telegram escape normalization',
    '  --timeout-ms <ms>     positive integer dispatch timeout (default: 120000)',
    '  --keep-data           keep temporary data directory for inspection',
    '  --allow-skip          exit 0 for missing optional Pi runtime/auth setup',
    '  --json                print structured smoke result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTelegramLabSmokeCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
