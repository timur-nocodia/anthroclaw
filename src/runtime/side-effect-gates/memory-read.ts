import Database from 'better-sqlite3';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ApprovalRequest, ChannelAdapter, InboundMessage, OutboundMedia, SendOptions } from '../../channels/types.js';
import { GlobalConfigSchema } from '../../config/schema.js';
import { Gateway } from '../../gateway.js';
import { FileSessionStore } from '../../sdk/session-store.js';
import { DEFAULT_PI_MODEL_ID } from '../pi-headless.js';
import {
  validateRuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateValidation,
} from '../side-effect-gate.js';

export const MEMORY_READ_GATE_ID = 'memory-read';
export const DEFAULT_MEMORY_READ_CHANNEL_ID = 'telegram';
export const DEFAULT_MEMORY_READ_ACCOUNT_ID = 'default';
export const DEFAULT_MEMORY_READ_REQUIRED_TOOLS = ['memory_search', 'session_search', 'local_note_search'] as const;
export const DEFAULT_MEMORY_READ_FORBIDDEN_TOOLS = [
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

export interface ToolEventRow {
  toolName: string;
  status: 'started' | 'completed' | 'failed';
  count: number;
}

export interface ToolEvidence {
  required: Record<string, { started: number; completed: number; failed: number }>;
  forbidden: Record<string, { started: number; completed: number; failed: number }>;
  all: ToolEventRow[];
}

export interface MemoryReadGateInput {
  GatewayCtor?: new () => Gateway;
  agentId: string;
  sourceAgentsDir: string;
  workspace: string;
  pluginsDir: string;
  model?: string;
  authPath?: string;
  modelsPath?: string;
  peerId: string;
  senderId: string;
  channelId?: InboundMessage['channel'];
  accountId?: string;
  timeoutMs: number;
  memorySentinel?: string;
  sessionSentinel?: string;
  localNoteSentinel?: string;
  expectedResponse?: string;
  sessionId?: string;
  sessionUserUuid?: string;
  sessionAssistantUuid?: string;
  inboundMessageId?: string;
  senderName?: string;
  noteFileName?: string;
  memorySeedPath?: string;
  requiredTools?: readonly string[];
  forbiddenTools?: readonly string[];
}

export interface MemoryReadGateResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  gate: {
    id: typeof MEMORY_READ_GATE_ID;
    spec: RuntimeSideEffectGateSpec;
    validation: RuntimeSideEffectGateValidation;
  };
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

type NormalizedMemoryReadGateInput = MemoryReadGateInput & {
  channelId: InboundMessage['channel'];
  accountId: string;
  memorySentinel: string;
  sessionSentinel: string;
  localNoteSentinel: string;
  expectedResponse: string;
  sessionId: string;
  sessionUserUuid: string;
  sessionAssistantUuid: string;
  inboundMessageId: string;
  senderName: string;
  noteFileName: string;
  memorySeedPath: string;
  requiredTools: readonly string[];
  forbiddenTools: readonly string[];
};

export async function runMemoryReadGate(input: MemoryReadGateInput): Promise<MemoryReadGateResult> {
  const normalized = normalizeMemoryReadGateInput(input);
  const agentsDir = join(normalized.workspace, 'agents');
  const dataDir = join(normalized.workspace, 'data');
  const pluginsDir = resolve(normalized.pluginsDir);
  const agentDir = join(agentsDir, normalized.agentId);
  const gate = buildMemoryReadGateSpec(normalized);

  if (!gate.validation.ok) {
    throw new Error(`invalid memory read gate spec: ${gate.validation.errors.join('; ')}`);
  }

  await prepareAgentWorkspace({
    input: normalized,
    sourceAgentDir: join(resolve(normalized.sourceAgentsDir), normalized.agentId),
    targetAgentDir: agentDir,
    dataDir,
  });

  const GatewayCtor = normalized.GatewayCtor ?? Gateway;
  const gateway = new GatewayCtor();
  const sentText: string[] = [];
  const approvals: ApprovalRequest[] = [];
  const channel = createMemoryReadGateChannel({
    channelId: normalized.channelId,
    sentText,
    approvals,
    approve: (request) => {
      setTimeout(() => {
        gateway.handleApprovalCallback(`approve:${request.id}`, normalized.senderId);
      }, 0);
    },
  });

  try {
    await gateway.start(memoryReadConfig({
      model: normalized.model,
      authPath: normalized.authPath,
      modelsPath: normalized.modelsPath,
    }), agentsDir, dataDir, pluginsDir);
    gateway._setChannel(normalized.channelId, channel);

    const agent = gateway.getAgent(normalized.agentId);
    if (!agent) throw new Error(`${normalized.agentId} did not load in memory-read gate workspace.`);
    agent.memoryStore.indexFile(
      normalized.memorySeedPath,
      `${normalized.memorySentinel}: durable memory search should recall this seeded read-only fact.`,
      { source: 'index', agentId: normalized.agentId },
    );

    const priorFailedRunIds = new Set(
      gateway.listAgentRuns({ agentId: normalized.agentId, status: 'failed', limit: 1000 }).map((run) => run.runId),
    );
    await withTimeout(gateway.dispatch(memoryReadMessage(normalized)), normalized.timeoutMs);

    const failedRun = gateway
      .listAgentRuns({ agentId: normalized.agentId, status: 'failed', limit: 10 })
      .find((run) => !priorFailedRunIds.has(run.runId));
    if (failedRun?.error) {
      throw new Error(`Pi ${normalized.agentId} memory-read gate runtime failed: ${failedRun.error}`);
    }

    const lastText = sentText.at(-1)?.trim() ?? '';
    const normalizedText = normalizeTelegramText(lastText);
    if (!normalizedText.includes(normalized.expectedResponse)) {
      throw new Error(
        [
          `Pi ${normalized.agentId} memory-read response mismatch.`,
          `Expected response to include ${JSON.stringify(normalized.expectedResponse)},`,
          `got ${JSON.stringify(lastText)} (${JSON.stringify(normalizedText)} normalized).`,
        ].join(' '),
      );
    }

    const toolEvidence = analyzeToolEvents(
      readToolEvents(join(dataDir, 'metrics.sqlite'), normalized.agentId),
      {
        requiredTools: normalized.requiredTools,
        forbiddenTools: normalized.forbiddenTools,
      },
    );
    assertToolEvidence(toolEvidence);
    if (approvals.length > 0) {
      throw new Error(`Memory-read gate unexpectedly requested ${approvals.length} approval(s).`);
    }

    const sessions = await gateway.listAgentSessions(normalized.agentId);
    return {
      status: 'passed',
      runtime: 'pi',
      agentId: normalized.agentId,
      gate,
      agentsDir,
      dataDir,
      pluginsDir,
      peerId: normalized.peerId,
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

export function createFailedMemoryReadGateResult(
  input: MemoryReadGateInput,
  error: string,
): MemoryReadGateResult {
  const normalized = normalizeMemoryReadGateInput(input);
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate: buildMemoryReadGateSpec(normalized),
    agentsDir: join(normalized.workspace, 'agents'),
    pluginsDir: resolve(normalized.pluginsDir),
    dataDir: join(normalized.workspace, 'data'),
    peerId: normalized.peerId,
    sentText: [],
    approvals: 0,
    error,
  };
}

export function analyzeToolEvents(
  events: ToolEventRow[],
  input: {
    requiredTools?: readonly string[];
    forbiddenTools?: readonly string[];
  } = {},
): ToolEvidence {
  const requiredTools = input.requiredTools ?? DEFAULT_MEMORY_READ_REQUIRED_TOOLS;
  const forbiddenTools = input.forbiddenTools ?? DEFAULT_MEMORY_READ_FORBIDDEN_TOOLS;
  const required = Object.fromEntries(requiredTools.map((tool) => [tool, emptyCounts()]));
  const forbidden = Object.fromEntries(forbiddenTools.map((tool) => [tool, emptyCounts()]));

  for (const event of events) {
    const normalized = normalizeToolName(event.toolName);
    const target = required[normalized] ?? forbidden[normalized];
    if (!target) continue;
    target[event.status] += event.count;
  }

  return { required, forbidden, all: events };
}

function normalizeMemoryReadGateInput(input: MemoryReadGateInput): NormalizedMemoryReadGateInput {
  const normalizedAgentId = input.agentId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return {
    ...input,
    channelId: input.channelId ?? DEFAULT_MEMORY_READ_CHANNEL_ID,
    accountId: input.accountId ?? DEFAULT_MEMORY_READ_ACCOUNT_ID,
    memorySentinel: input.memorySentinel ?? `${normalizedAgentId}_MEMORY_READ_SENTINEL`,
    sessionSentinel: input.sessionSentinel ?? `${normalizedAgentId}_SESSION_READ_SENTINEL`,
    localNoteSentinel: input.localNoteSentinel ?? `${normalizedAgentId}_LOCAL_NOTE_SENTINEL`,
    expectedResponse: input.expectedResponse ?? `${normalizedAgentId}_MEMORY_READ_OK`,
    sessionId: input.sessionId ?? `${input.agentId}:memory-read-gate-session`,
    sessionUserUuid: input.sessionUserUuid ?? `${input.agentId}:memory-read-gate-user`,
    sessionAssistantUuid: input.sessionAssistantUuid ?? `${input.agentId}:memory-read-gate-assistant`,
    inboundMessageId: input.inboundMessageId ?? `${input.agentId}:memory-read-gate-message`,
    senderName: input.senderName ?? 'Memory Read Gate User',
    noteFileName: input.noteFileName ?? 'memory-read-gate.md',
    memorySeedPath: input.memorySeedPath ?? `memory/read-gate/${input.agentId}.md`,
    requiredTools: input.requiredTools ?? DEFAULT_MEMORY_READ_REQUIRED_TOOLS,
    forbiddenTools: input.forbiddenTools ?? DEFAULT_MEMORY_READ_FORBIDDEN_TOOLS,
  };
}

function buildMemoryReadGateSpec(input: NormalizedMemoryReadGateInput): MemoryReadGateResult['gate'] {
  const spec: RuntimeSideEffectGateSpec = {
    gateId: MEMORY_READ_GATE_ID,
    agentId: input.agentId,
    runtime: 'pi',
    risk: 'read_only',
    action: 'mcp.call',
    target: {
      channel: input.channelId,
      accountId: input.accountId,
      peerId: input.peerId,
    },
    dryRunSupported: true,
    approvalRequired: false,
    policyAssertions: [
      {
        id: 'required-read-tools',
        description: 'The run must exercise memory_search, session_search, and local_note_search.',
        required: true,
      },
      {
        id: 'forbidden-side-effect-tools',
        description: 'The run must not call write, delivery, cron, notification, config, escalation, Buildroom, or MCP onboarding tools.',
        required: true,
      },
      {
        id: 'no-approval-prompts',
        description: 'Read-only memory recall must not request operator approval.',
        required: true,
      },
    ],
    expectedEffects: [
      {
        id: 'read-only-tool-calls',
        kind: 'mcp.call',
        description: 'Required read-only memory/session/local-note tools are called and completed.',
        target: { channel: 'none' },
      },
    ],
    cleanupChecks: [
      {
        id: 'temp-workspace-only',
        description: 'Seeded memory, session, and note data are written only into the temp workspace.',
        required: true,
      },
      {
        id: 'no-approval-requests',
        description: 'The gate records zero approval requests.',
        required: true,
      },
    ],
    metrics: {
      runStarted: true,
      runCompleted: true,
      toolStarted: [...input.requiredTools],
      toolCompleted: [...input.requiredTools],
      noFailedTools: true,
    },
  };

  return {
    id: MEMORY_READ_GATE_ID,
    spec,
    validation: validateRuntimeSideEffectGateSpec(spec),
  };
}

async function prepareAgentWorkspace(input: {
  input: NormalizedMemoryReadGateInput;
  sourceAgentDir: string;
  targetAgentDir: string;
  dataDir: string;
}): Promise<void> {
  cpSync(input.sourceAgentDir, input.targetAgentDir, { recursive: true });
  mkdirSync(join(input.targetAgentDir, 'notes'), { recursive: true });
  writeFileSync(
    join(input.targetAgentDir, 'notes', input.input.noteFileName),
    [
      `# ${input.input.agentId} memory read gate`,
      '',
      `${input.input.localNoteSentinel}: local note search should find this seeded read-only note.`,
    ].join('\n'),
    'utf8',
  );
  mkdirSync(join(input.dataDir, 'sdk-sessions'), { recursive: true });
  const sessionStore = new FileSessionStore(join(input.dataDir, 'sdk-sessions'));
  await sessionStore.append({ projectKey: input.targetAgentDir, sessionId: input.input.sessionId }, [
    {
      type: 'user',
      uuid: input.input.sessionUserUuid,
      timestamp: '2026-05-17T09:45:00.000Z',
      message: {
        content: [{
          type: 'text',
          text: `${input.input.sessionSentinel}: prior session search should find this seeded transcript entry.`,
        }],
      },
    },
    {
      type: 'assistant',
      uuid: input.input.sessionAssistantUuid,
      timestamp: '2026-05-17T09:45:01.000Z',
      message: {
        content: [{
          type: 'text',
          text: `Seeded transcript is read-only evidence for ${input.input.agentId} session recall.`,
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

function memoryReadMessage(input: NormalizedMemoryReadGateInput): InboundMessage {
  return {
    channel: input.channelId,
    accountId: input.accountId,
    chatType: 'dm',
    peerId: input.peerId,
    senderId: input.senderId,
    senderName: input.senderName,
    text: [
      'Runtime parity read-only memory gate.',
      `Call memory_search with query "${input.memorySentinel}".`,
      `Call session_search with query "${input.sessionSentinel}".`,
      `Call local_note_search with query "${input.localNoteSentinel}".`,
      'Do not call write, delivery, cron, notification, config, escalation, Buildroom, MCP onboarding, or file-transfer tools.',
      `After those read-only tool calls, reply exactly: ${input.expectedResponse}`,
    ].join('\n'),
    messageId: input.inboundMessageId,
    mentionedBot: true,
    raw: {},
  };
}

function createMemoryReadGateChannel(input: {
  channelId: InboundMessage['channel'];
  sentText: string[];
  approvals: ApprovalRequest[];
  approve: (request: ApprovalRequest) => void;
}): ChannelAdapter {
  return {
    id: input.channelId,
    supportsApproval: true,
    onMessage() {},
    async start() {},
    async stop() {},
    async sendText(_peerId: string, text: string, _opts?: SendOptions) {
      input.sentText.push(text);
      return `${input.channelId}:memory-read-gate-message-${input.sentText.length}`;
    },
    async editText() {},
    async deleteText() {},
    async sendMedia(_peerId: string, _media: OutboundMedia, _opts?: SendOptions) {
      return `${input.channelId}:memory-read-gate-media-1`;
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
    throw new Error(`Memory-read gate missing required read-only tool evidence: ${missing.join(', ')}`);
  }

  const forbidden = Object.entries(evidence.forbidden)
    .filter(([, counts]) => counts.started > 0 || counts.completed > 0 || counts.failed > 0)
    .map(([tool, counts]) => `${tool}=${JSON.stringify(counts)}`);
  if (forbidden.length > 0) {
    throw new Error(`Memory-read gate called forbidden side-effect tool(s): ${forbidden.join(', ')}`);
  }
}

function normalizeToolName(toolName: string): string {
  if (toolName.startsWith('mcp__')) return toolName.split('__').at(-1) ?? toolName;
  return toolName;
}

function emptyCounts(): { started: number; completed: number; failed: number } {
  return { started: 0, completed: 0, failed: 0 };
}

function normalizeTelegramText(value: string): string {
  const unescaped = value.trim().replace(/\\([_*\[\]()~`>#+\-=|{}.!])/g, '$1');
  return unescaped.replace(/`/g, '');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Pi memory-read gate timeout after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
