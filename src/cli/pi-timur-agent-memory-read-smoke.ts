import 'dotenv/config';
import Database from 'better-sqlite3';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ApprovalRequest, ChannelAdapter, InboundMessage, OutboundMedia, SendOptions } from '../channels/types.js';
import { GlobalConfigSchema } from '../config/schema.js';
import { Gateway } from '../gateway.js';
import { FileSessionStore } from '../sdk/session-store.js';
import { DEFAULT_PI_MODEL_ID } from '../runtime/pi-headless.js';
import { normalizeTelegramText } from './pi-telegram-lab-smoke.js';

const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';
const AGENT_ID = 'timur_agent';
const CHANNEL_ID = 'telegram';
const ACCOUNT_ID = 'default';
const DEFAULT_PEER_ID = '48705953';
const DEFAULT_SENDER_ID = '48705953';
const MEMORY_SENTINEL = 'TIMUR_MEMORY_READ_SENTINEL';
const SESSION_SENTINEL = 'TIMUR_SESSION_READ_SENTINEL';
const LOCAL_NOTE_SENTINEL = 'TIMUR_LOCAL_NOTE_SENTINEL';
const EXPECTED_RESPONSE = 'TIMUR_AGENT_MEMORY_READ_OK';

const REQUIRED_TOOLS = ['memory_search', 'session_search', 'local_note_search'] as const;
const FORBIDDEN_TOOLS = [
  'memory_write',
  'memory_wiki',
  'local_note_propose',
  'send_message',
  'send_media',
  'manage_cron',
  'manage_notifications',
  'manage_human_takeover',
  'manage_operator_console',
  'manage_skills',
  'connect_mcp',
  'escalate',
  'buildroom_submit_signal',
  'buildroom_submit_session_summary',
] as const;

interface PiTimurAgentMemoryReadSmokeArgs {
  agentsDir: string;
  pluginsDir: string;
  model?: string;
  authPath?: string;
  modelsPath?: string;
  peerId: string;
  senderId: string;
  timeoutMs: number;
  keepData: boolean;
  allowSkip: boolean;
  json: boolean;
  help: boolean;
}

interface PiTimurAgentMemoryReadSmokeDeps {
  GatewayCtor?: new () => Gateway;
  makeWorkspace?: () => string;
  preflightPiRuntime?: () => Promise<void>;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface ToolEventRow {
  toolName: string;
  status: 'started' | 'completed' | 'failed';
  count: number;
}

interface ToolEvidence {
  required: Record<string, { started: number; completed: number; failed: number }>;
  forbidden: Record<string, { started: number; completed: number; failed: number }>;
  all: ToolEventRow[];
}

interface PiTimurAgentMemoryReadSmokeResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  agentId: string;
  agentsDir: string;
  pluginsDir: string;
  dataDir: string;
  peerId: string;
  sentText: string[];
  normalizedText?: string;
  approvals: number;
  sessionId?: string;
  toolEvidence?: ToolEvidence;
  error?: string;
}

export async function runPiTimurAgentMemoryReadSmokeCli(
  argv: string[],
  deps: PiTimurAgentMemoryReadSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTimurAgentMemoryReadSmokeArgs;

  try {
    args = parsePiTimurAgentMemoryReadSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-timur-agent-memory-read-'));
  let shouldRemoveWorkspace = !args.keepData;

  try {
    await (deps.preflightPiRuntime ?? ensurePiRuntimeImportable)();
    const result = await runPiTimurAgentMemoryReadSmoke({
      GatewayCtor: deps.GatewayCtor,
      sourceAgentsDir: args.agentsDir,
      workspace,
      pluginsDir: args.pluginsDir,
      model: args.model,
      authPath: args.authPath,
      modelsPath: args.modelsPath,
      peerId: args.peerId,
      senderId: args.senderId,
      timeoutMs: args.timeoutMs,
    });
    writeResult(stdout, args.json, result);
    return result.status === 'failed' ? 1 : 0;
  } catch (err) {
    const error = errorMessage(err);
    const status = args.allowSkip && isSkippableSmokeError(error) ? 'skipped' : 'failed';
    const result: PiTimurAgentMemoryReadSmokeResult = {
      status,
      runtime: 'pi',
      agentId: AGENT_ID,
      agentsDir: join(workspace, 'agents'),
      pluginsDir: args.pluginsDir,
      dataDir: join(workspace, 'data'),
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

export async function runPiTimurAgentMemoryReadSmoke(input: {
  GatewayCtor?: new () => Gateway;
  sourceAgentsDir: string;
  workspace: string;
  pluginsDir: string;
  model?: string;
  authPath?: string;
  modelsPath?: string;
  peerId: string;
  senderId: string;
  timeoutMs: number;
}): Promise<PiTimurAgentMemoryReadSmokeResult> {
  const agentsDir = join(input.workspace, 'agents');
  const dataDir = join(input.workspace, 'data');
  const pluginsDir = resolve(input.pluginsDir);
  const agentDir = join(agentsDir, AGENT_ID);
  await prepareAgentWorkspace({
    sourceAgentDir: join(resolve(input.sourceAgentsDir), AGENT_ID),
    targetAgentDir: agentDir,
    dataDir,
  });

  const GatewayCtor = input.GatewayCtor ?? Gateway;
  const gateway = new GatewayCtor();
  const sentText: string[] = [];
  const approvals: ApprovalRequest[] = [];
  const channel = createMemoryReadSmokeChannel({
    sentText,
    approvals,
    approve: (request) => {
      setTimeout(() => {
        gateway.handleApprovalCallback(`approve:${request.id}`, input.senderId);
      }, 0);
    },
  });

  try {
    await gateway.start(memoryReadConfig({
      model: input.model,
      authPath: input.authPath,
      modelsPath: input.modelsPath,
    }), agentsDir, dataDir, pluginsDir);
    gateway._setChannel(CHANNEL_ID, channel);

    const agent = gateway.getAgent(AGENT_ID);
    if (!agent) throw new Error('timur_agent did not load in memory-read smoke workspace.');
    agent.memoryStore.indexFile(
      'memory/read-smoke/timur-agent-memory.md',
      `${MEMORY_SENTINEL}: durable memory search should recall this seeded read-only fact.`,
      { source: 'index', agentId: AGENT_ID },
    );

    const priorFailedRunIds = new Set(
      gateway.listAgentRuns({ agentId: AGENT_ID, status: 'failed', limit: 1000 }).map((run) => run.runId),
    );
    await withTimeout(gateway.dispatch(memoryReadMessage(input)), input.timeoutMs);

    const failedRun = gateway
      .listAgentRuns({ agentId: AGENT_ID, status: 'failed', limit: 10 })
      .find((run) => !priorFailedRunIds.has(run.runId));
    if (failedRun?.error) {
      throw new Error(`Pi timur_agent memory-read smoke runtime failed: ${failedRun.error}`);
    }

    const lastText = sentText.at(-1)?.trim() ?? '';
    const normalizedText = normalizeTelegramText(lastText);
    if (!normalizedText.includes(EXPECTED_RESPONSE)) {
      throw new Error(
        [
          'Pi timur_agent memory-read response mismatch.',
          `Expected response to include ${JSON.stringify(EXPECTED_RESPONSE)},`,
          `got ${JSON.stringify(lastText)} (${JSON.stringify(normalizedText)} normalized).`,
        ].join(' '),
      );
    }

    const toolEvidence = analyzeToolEvents(readToolEvents(join(dataDir, 'metrics.sqlite'), AGENT_ID));
    assertToolEvidence(toolEvidence);
    if (approvals.length > 0) {
      throw new Error(`Memory-read smoke unexpectedly requested ${approvals.length} approval(s).`);
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
      toolEvidence,
    };
  } finally {
    await gateway.stop().catch(() => undefined);
  }
}

export function parsePiTimurAgentMemoryReadSmokeArgs(argv: string[]): PiTimurAgentMemoryReadSmokeArgs {
  const args: PiTimurAgentMemoryReadSmokeArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    pluginsDir: process.env.OC_PLUGINS_DIR ? resolve(process.env.OC_PLUGINS_DIR) : resolve('plugins'),
    model: DEFAULT_PI_MODEL_ID,
    peerId: DEFAULT_PEER_ID,
    senderId: DEFAULT_SENDER_ID,
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

export function analyzeToolEvents(events: ToolEventRow[]): ToolEvidence {
  const required = Object.fromEntries(REQUIRED_TOOLS.map((tool) => [tool, emptyCounts()]));
  const forbidden = Object.fromEntries(FORBIDDEN_TOOLS.map((tool) => [tool, emptyCounts()]));

  for (const event of events) {
    const normalized = normalizeToolName(event.toolName);
    const target = required[normalized] ?? forbidden[normalized];
    if (!target) continue;
    target[event.status] += event.count;
  }

  return { required, forbidden, all: events };
}

async function prepareAgentWorkspace(input: {
  sourceAgentDir: string;
  targetAgentDir: string;
  dataDir: string;
}): Promise<void> {
  cpSync(input.sourceAgentDir, input.targetAgentDir, { recursive: true });
  mkdirSync(join(input.targetAgentDir, 'notes'), { recursive: true });
  writeFileSync(
    join(input.targetAgentDir, 'notes', 'memory-read-smoke.md'),
    [
      '# timur_agent memory read smoke',
      '',
      `${LOCAL_NOTE_SENTINEL}: local note search should find this seeded read-only note.`,
    ].join('\n'),
    'utf8',
  );
  mkdirSync(join(input.dataDir, 'sdk-sessions'), { recursive: true });
  const sessionStore = new FileSessionStore(join(input.dataDir, 'sdk-sessions'));
  await sessionStore.append({ projectKey: input.targetAgentDir, sessionId: 'timur-agent-read-smoke-session' }, [
    {
      type: 'user',
      uuid: 'timur-agent-read-smoke-user',
      timestamp: '2026-05-17T09:45:00.000Z',
      message: {
        content: [{
          type: 'text',
          text: `${SESSION_SENTINEL}: prior session search should find this seeded transcript entry.`,
        }],
      },
    },
    {
      type: 'assistant',
      uuid: 'timur-agent-read-smoke-assistant',
      timestamp: '2026-05-17T09:45:01.000Z',
      message: {
        content: [{
          type: 'text',
          text: 'Seeded transcript is read-only evidence for timur_agent session recall.',
        }],
      },
    },
  ]);
}

function memoryReadConfig(input: { model?: string; authPath?: string; modelsPath?: string } = {}) {
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

function memoryReadMessage(input: {
  peerId: string;
  senderId: string;
}): InboundMessage {
  return {
    channel: CHANNEL_ID,
    accountId: ACCOUNT_ID,
    chatType: 'dm',
    peerId: input.peerId,
    senderId: input.senderId,
    senderName: 'Timur Agent Memory Read Smoke User',
    text: [
      'Runtime parity read-only memory smoke.',
      `Call memory_search with query "${MEMORY_SENTINEL}".`,
      `Call session_search with query "${SESSION_SENTINEL}".`,
      `Call local_note_search with query "${LOCAL_NOTE_SENTINEL}".`,
      'Do not call write, delivery, cron, notification, config, escalation, Buildroom, MCP onboarding, or file-transfer tools.',
      `After those read-only tool calls, reply exactly: ${EXPECTED_RESPONSE}`,
    ].join('\n'),
    messageId: 'timur-agent-memory-read-smoke-message',
    mentionedBot: true,
    raw: {},
  };
}

function createMemoryReadSmokeChannel(input: {
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
      return `timur-agent-memory-read-smoke-message-${input.sentText.length}`;
    },
    async editText() {},
    async deleteText() {},
    async sendMedia(_peerId: string, _media: OutboundMedia, _opts?: SendOptions) {
      return 'timur-agent-memory-read-smoke-media-1';
    },
    async sendTyping() {},
    async promptForApproval(request: ApprovalRequest) {
      input.approvals.push(request);
      input.approve(request);
    },
  };
}

function readToolEvents(metricsDb: string, agentId: string): ToolEventRow[] {
  const db = new Database(metricsDb, { readonly: true });
  try {
    return db.prepare(`
      SELECT tool_name as toolName, status, COUNT(*) as count
      FROM tool_events
      WHERE agent_id = ?
      GROUP BY tool_name, status
      ORDER BY tool_name, status
    `).all(agentId) as ToolEventRow[];
  } finally {
    db.close();
  }
}

function assertToolEvidence(evidence: ToolEvidence): void {
  const missing = Object.entries(evidence.required)
    .filter(([, counts]) => counts.started < 1 || counts.completed < 1 || counts.failed > 0)
    .map(([tool, counts]) => `${tool}=${JSON.stringify(counts)}`);
  if (missing.length > 0) {
    throw new Error(`Memory-read smoke missing required read-only tool evidence: ${missing.join(', ')}`);
  }

  const forbidden = Object.entries(evidence.forbidden)
    .filter(([, counts]) => counts.started > 0 || counts.completed > 0 || counts.failed > 0)
    .map(([tool, counts]) => `${tool}=${JSON.stringify(counts)}`);
  if (forbidden.length > 0) {
    throw new Error(`Memory-read smoke called forbidden side-effect tool(s): ${forbidden.join(', ')}`);
  }
}

function normalizeToolName(toolName: string): string {
  if (toolName.startsWith('mcp__')) return toolName.split('__').at(-1) ?? toolName;
  return toolName;
}

function emptyCounts(): { started: number; completed: number; failed: number } {
  return { started: 0, completed: 0, failed: 0 };
}

async function ensurePiRuntimeImportable(): Promise<void> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
  try {
    await dynamicImport(PI_PACKAGE_NAME);
  } catch (err) {
    throw new Error(`Pi timur_agent memory-read smoke requires optional package ${PI_PACKAGE_NAME}. Original error: ${errorMessage(err)}`);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Pi timur_agent memory-read smoke timeout after ${timeoutMs}ms.`));
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
  result: PiTimurAgentMemoryReadSmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi timur_agent memory-read smoke passed.',
      `sessionId: ${result.sessionId ?? '<none>'}`,
      `sentText: ${JSON.stringify(result.sentText)}`,
      `approvals: ${result.approvals}`,
      `requiredTools: ${JSON.stringify(result.toolEvidence?.required ?? {})}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi timur_agent memory-read smoke ${result.status}: ${result.error ?? 'unknown error'}\n`);
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

function isSkippableSmokeError(error: string): boolean {
  return error.includes(PI_PACKAGE_NAME)
    || error.includes('Provider') && error.includes('credentials')
    || error.includes('auth');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-timur-agent-memory-read-smoke -- [--json] [--allow-skip]',
    '',
    'Options:',
    '  --agents-dir <path>   source agents directory containing timur_agent (default: agents)',
    '  --plugins-dir <path>  plugins directory (default: plugins)',
    '  --model <id>          Pi model id (default: runtime default)',
    '  --auth-path <path>    Pi auth storage path',
    '  --models-path <path>  Pi model registry storage path',
    '  --peer-id <id>        fake Telegram peer id (default: operator peer)',
    '  --sender-id <id>      fake Telegram sender id (default: operator peer)',
    '  --timeout-ms <n>      dispatch timeout in ms (default: 120000)',
    '  --keep-data           keep temp workspace for inspection',
    '  --allow-skip          return success when optional Pi setup is unavailable',
    '  --json                emit JSON',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentMemoryReadSmokeCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
