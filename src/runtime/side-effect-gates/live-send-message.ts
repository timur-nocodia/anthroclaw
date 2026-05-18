import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createSendMessageTool } from '../../agent/tools/send-message.js';
import type { ChannelAdapter } from '../../channels/types.js';
import { TelegramChannel } from '../../channels/telegram.js';
import { loadAgentYml, loadGlobalConfig } from '../../config/loader.js';
import type { AgentYml, GlobalConfig } from '../../config/schema.js';
import { MetricsStore } from '../../metrics/store.js';
import { ApprovalBroker } from '../../security/approval-broker.js';
import { getProfile } from '../../security/profiles/index.js';
import { createCanUseTool } from '../../sdk/permissions.js';
import {
  validateRuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateValidation,
} from '../side-effect-gate.js';

export const LIVE_SEND_MESSAGE_GATE_ID = 'live-send-message';
export const DEFAULT_LIVE_SEND_MESSAGE_MARKER_PREFIX = 'LIVE_SEND_MESSAGE_OK';

export interface LiveSendMessageGateInput {
  agentId: string;
  configPath: string;
  agentsDir: string;
  dataDir: string;
  accountId: string;
  peerId: string;
  markerPrefix?: string;
  marker?: string;
  confirmLiveSend: boolean;
  dryRun: boolean;
  expectedPeerId?: string;
}

export interface LiveSendMessageGateDeps {
  now?: () => number;
  makeRunId?: () => string;
  makeChannel?: (input: {
    globalConfig: GlobalConfig;
    accountId: string;
    dataDir: string;
  }) => ChannelAdapter;
}

export interface LiveSendMessageGateResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  gate: {
    id: typeof LIVE_SEND_MESSAGE_GATE_ID;
    spec: RuntimeSideEffectGateSpec;
    validation: RuntimeSideEffectGateValidation;
  };
  live: boolean;
  dryRun: boolean;
  target: {
    channel: 'telegram';
    accountId: string;
    peerId: string;
  };
  markerPrefix: string;
  markerText: string;
  permission: {
    mcpToolPresent: boolean;
    privateAllowlistSinglePeer: boolean;
    routeBound: boolean;
    sendMessageAllowed: boolean;
  };
  delivery: {
    sent: boolean;
    via: 'send_message';
    realTelegramDelivery: boolean;
    messageId?: string;
  };
  metrics: {
    recorded: boolean;
    metricsDb: string;
    runId?: string;
    sessionKey?: string;
    toolStarted: boolean;
    toolCompleted: boolean;
  };
  safety: {
    operatorApproved: boolean;
    noBroadFanout: boolean;
    noMedia: boolean;
    noConfigMutation: boolean;
  };
  error?: string;
}

type NormalizedLiveSendMessageGateInput = LiveSendMessageGateInput & {
  markerPrefix: string;
  expectedPeerId: string;
};

export async function runLiveSendMessageGate(
  input: LiveSendMessageGateInput,
  deps: LiveSendMessageGateDeps = {},
): Promise<LiveSendMessageGateResult> {
  const normalized = normalizeLiveSendMessageGateInput(input);
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const markerText = normalized.marker ?? `${normalized.markerPrefix} ${new Date(startedAt).toISOString()}`;
  const metricsDb = join(normalized.dataDir, 'metrics.sqlite');
  const sessionKey = `${normalized.agentId}:telegram:dm:${normalized.peerId}:live-send-message`;
  const runId = deps.makeRunId?.() ?? `pi-live-send-${randomUUID()}`;
  const gate = buildLiveSendMessageGateSpec(normalized);

  if (!gate.validation.ok) {
    throw new Error(`invalid live send_message gate spec: ${gate.validation.errors.join('; ')}`);
  }
  if (!normalized.dryRun && !normalized.confirmLiveSend) {
    throw new Error('live send_message gate requires explicit operator approval.');
  }

  const agentConfig = loadAgentYml(join(normalized.agentsDir, normalized.agentId));
  const permissionFacts = validateTarget(agentConfig, normalized);
  const serverName = `${normalized.agentId}-tools`;
  const canUseTool = createCanUseTool({
    agent: {
      id: normalized.agentId,
      config: agentConfig,
      safetyProfile: getProfile(agentConfig.safety_profile),
      workspacePath: resolve('.'),
    },
    approvalBroker: new ApprovalBroker(),
    sessionContext: {
      channel: 'telegram',
      peerId: normalized.peerId,
      senderId: normalized.peerId,
      accountId: normalized.accountId,
    },
  });
  const permission = await canUseTool(
    `mcp__${serverName}__send_message`,
    {
      channel: 'telegram',
      peer_id: normalized.peerId,
      account_id: normalized.accountId,
      text: markerText,
    },
    { signal: new AbortController().signal, toolUseID: `${LIVE_SEND_MESSAGE_GATE_ID}:${normalized.agentId}` } as any,
  );
  const sendMessageAllowed = permission.behavior === 'allow';
  if (!sendMessageAllowed) {
    throw new Error(`send_message permission denied: ${permission.message ?? permission.behavior}`);
  }

  if (normalized.dryRun) {
    return passedResult({
      input: normalized,
      gate,
      markerText,
      metricsDb,
      permissionFacts,
      sendMessageAllowed,
      live: false,
      deliverySent: false,
      realTelegramDelivery: false,
    });
  }

  const globalConfig = loadGlobalConfig(normalized.configPath);
  const telegramAccount = globalConfig.telegram?.accounts[normalized.accountId];
  if (!telegramAccount) throw new Error(`telegram account not configured: ${normalized.accountId}`);
  if (telegramAccount.token.trim().length === 0) {
    throw new Error(`telegram account token is empty: ${normalized.accountId}`);
  }

  const metrics = new MetricsStore(metricsDb);
  metrics.recordAgentRunStart({
    runId,
    startedAt,
    agentId: normalized.agentId,
    sessionKey,
    source: 'channel',
    channel: 'telegram',
    accountId: normalized.accountId,
    peerId: normalized.peerId,
    model: agentConfig.model,
  });
  metrics.recordToolEvent({
    timestamp: startedAt,
    agentId: normalized.agentId,
    sessionKey,
    toolName: 'send_message',
    status: 'started',
  });
  metrics.recordDiagnosticEvent({
    timestamp: startedAt,
    traceId: runId,
    runId,
    agentId: normalized.agentId,
    sessionKey,
    eventType: 'run.tool_started',
    detail: {
      toolName: 'send_message',
      channel: 'telegram',
      accountId: normalized.accountId,
      peerId: normalized.peerId,
      markerPrefix: normalized.markerPrefix,
      gateId: LIVE_SEND_MESSAGE_GATE_ID,
    },
  });

  const channel = deps.makeChannel?.({
    globalConfig,
    accountId: normalized.accountId,
    dataDir: normalized.dataDir,
  }) ?? new TelegramChannel({
    accounts: {
      [normalized.accountId]: {
        token: telegramAccount.token,
        webhook: telegramAccount.webhook,
      },
    },
    mediaDir: join(normalized.dataDir, 'telegram-media'),
  });
  const sendMessageTool = createSendMessageTool(
    (id) => id === 'telegram' ? channel : undefined,
    {
      agentId: normalized.agentId,
      dispatchContext: {
        channel: 'telegram',
        accountId: normalized.accountId,
      },
    },
  );

  try {
    const sentAt = now();
    const toolResult = await sendMessageTool.handler({
      channel: 'telegram',
      peer_id: normalized.peerId,
      account_id: normalized.accountId,
      text: markerText,
    });
    if (toolResult.isError) {
      throw new Error(toolResult.content.map((item) => item.text).join('\n'));
    }
    const completedAt = now();
    const messageId = extractMessageId(toolResult);
    metrics.recordToolEvent({
      timestamp: completedAt,
      agentId: normalized.agentId,
      sessionKey,
      toolName: 'send_message',
      status: 'completed',
      durationMs: Math.max(0, completedAt - sentAt),
    });
    metrics.recordDiagnosticEvent({
      timestamp: completedAt,
      traceId: runId,
      runId,
      agentId: normalized.agentId,
      sessionKey,
      eventType: 'run.tool_completed',
      detail: {
        toolName: 'send_message',
        messageId,
        gateId: LIVE_SEND_MESSAGE_GATE_ID,
      },
    });
    metrics.recordAgentRunFinish({
      runId,
      completedAt,
      status: 'succeeded',
      usage: {
        durationMs: Math.max(0, completedAt - startedAt),
        numTurns: 1,
      },
    });

    return passedResult({
      input: normalized,
      gate,
      markerText,
      metricsDb,
      permissionFacts,
      sendMessageAllowed,
      live: true,
      deliverySent: true,
      realTelegramDelivery: true,
      runId,
      sessionKey,
      messageId,
    });
  } catch (err) {
    const failedAt = now();
    const message = errorMessage(err);
    metrics.recordToolEvent({
      timestamp: failedAt,
      agentId: normalized.agentId,
      sessionKey,
      toolName: 'send_message',
      status: 'failed',
      durationMs: Math.max(0, failedAt - startedAt),
    });
    metrics.recordDiagnosticEvent({
      timestamp: failedAt,
      traceId: runId,
      runId,
      agentId: normalized.agentId,
      sessionKey,
      eventType: 'run.tool_failed',
      detail: {
        toolName: 'send_message',
        error: message,
        gateId: LIVE_SEND_MESSAGE_GATE_ID,
      },
    });
    metrics.recordAgentRunFinish({
      runId,
      completedAt: failedAt,
      status: 'failed',
      usage: {
        durationMs: Math.max(0, failedAt - startedAt),
        numTurns: 1,
      },
      error: message,
    });
    throw err;
  }
}

export function createFailedLiveSendMessageGateResult(
  input: LiveSendMessageGateInput,
  markerText: string,
  error: string,
): LiveSendMessageGateResult {
  const normalized = normalizeLiveSendMessageGateInput(input);
  const gate = buildLiveSendMessageGateSpec(normalized);
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate,
    live: !normalized.dryRun,
    dryRun: normalized.dryRun,
    target: { channel: 'telegram', accountId: normalized.accountId, peerId: normalized.peerId },
    markerPrefix: normalized.markerPrefix,
    markerText,
    permission: {
      mcpToolPresent: false,
      privateAllowlistSinglePeer: false,
      routeBound: false,
      sendMessageAllowed: false,
    },
    delivery: {
      sent: false,
      via: 'send_message',
      realTelegramDelivery: false,
    },
    metrics: {
      recorded: false,
      metricsDb: join(normalized.dataDir, 'metrics.sqlite'),
      toolStarted: false,
      toolCompleted: false,
    },
    safety: safetyFacts(normalized),
    error,
  };
}

function normalizeLiveSendMessageGateInput(input: LiveSendMessageGateInput): NormalizedLiveSendMessageGateInput {
  const markerPrefix = input.markerPrefix ?? DEFAULT_LIVE_SEND_MESSAGE_MARKER_PREFIX;
  return {
    ...input,
    markerPrefix,
    expectedPeerId: input.expectedPeerId ?? input.peerId,
  };
}

function buildLiveSendMessageGateSpec(input: NormalizedLiveSendMessageGateInput): LiveSendMessageGateResult['gate'] {
  const spec: RuntimeSideEffectGateSpec = {
    gateId: LIVE_SEND_MESSAGE_GATE_ID,
    agentId: input.agentId,
    runtime: 'pi',
    risk: 'external_write',
    action: 'message.send',
    target: {
      channel: 'telegram',
      accountId: input.accountId,
      peerId: input.peerId,
    },
    markerPrefix: input.markerPrefix,
    dryRunSupported: true,
    approvalRequired: true,
    policyAssertions: [
      {
        id: 'tool-present',
        description: 'Agent exposes the send_message MCP tool.',
        required: true,
      },
      {
        id: 'private-single-peer-allowlist',
        description: 'Agent uses the private safety profile and a single Telegram peer allowlist matching the target.',
        required: true,
      },
      {
        id: 'route-bound-to-target-dm',
        description: 'Agent has one Telegram DM route for the target account and peer.',
        required: true,
      },
      {
        id: 'operator-approval',
        description: 'Live delivery requires explicit operator approval.',
        required: true,
      },
    ],
    expectedEffects: [
      {
        id: 'single-text-message',
        kind: 'message.send',
        description: 'Exactly one text message is delivered to the confirmed Telegram peer.',
        target: {
          channel: 'telegram',
          accountId: input.accountId,
          peerId: input.peerId,
        },
        maxCount: 1,
      },
    ],
    cleanupChecks: [
      {
        id: 'no-config-mutation',
        description: 'The gate does not mutate agent or global config.',
        required: true,
      },
      {
        id: 'no-media-created',
        description: 'The gate sends text only and creates no media artifact.',
        required: true,
      },
    ],
    metrics: {
      runStarted: true,
      runCompleted: true,
      toolStarted: ['send_message'],
      toolCompleted: ['send_message'],
      noFailedTools: true,
    },
  };

  return {
    id: LIVE_SEND_MESSAGE_GATE_ID,
    spec,
    validation: validateRuntimeSideEffectGateSpec(spec),
  };
}

function validateTarget(
  config: AgentYml,
  input: NormalizedLiveSendMessageGateInput,
): LiveSendMessageGateResult['permission'] {
  const mcpToolPresent = (config.mcp_tools ?? []).includes('send_message');
  const privateAllowlistSinglePeer =
    config.safety_profile === 'private' &&
    config.allowlist?.telegram?.length === 1 &&
    config.allowlist.telegram[0] === input.peerId;
  const routeBound = (config.routes ?? []).some((route) =>
    route.channel === 'telegram' &&
    route.scope === 'dm' &&
    (route.account === undefined || route.account === input.accountId) &&
    (route.peers ?? []).length === 1 &&
    (route.peers ?? [])[0] === input.peerId
  );

  if (!mcpToolPresent) throw new Error(`${input.agentId} must expose send_message.`);
  if (!privateAllowlistSinglePeer) {
    throw new Error(`${input.agentId} must remain private and allowlisted to exactly one Telegram peer.`);
  }
  if (!routeBound) {
    throw new Error(`${input.agentId} must route only the target Telegram DM for this live gate.`);
  }

  return {
    mcpToolPresent,
    privateAllowlistSinglePeer,
    routeBound,
    sendMessageAllowed: false,
  };
}

function safetyFacts(input: NormalizedLiveSendMessageGateInput): LiveSendMessageGateResult['safety'] {
  return {
    operatorApproved: input.confirmLiveSend || input.dryRun,
    noBroadFanout: input.peerId === input.expectedPeerId,
    noMedia: true,
    noConfigMutation: true,
  };
}

function passedResult(input: {
  input: NormalizedLiveSendMessageGateInput;
  gate: LiveSendMessageGateResult['gate'];
  markerText: string;
  metricsDb: string;
  permissionFacts: Omit<LiveSendMessageGateResult['permission'], 'sendMessageAllowed'> & { sendMessageAllowed: boolean };
  sendMessageAllowed: boolean;
  live: boolean;
  deliverySent: boolean;
  realTelegramDelivery: boolean;
  runId?: string;
  sessionKey?: string;
  messageId?: string;
}): LiveSendMessageGateResult {
  return {
    status: 'passed',
    runtime: 'pi',
    agentId: input.input.agentId,
    gate: input.gate,
    live: input.live,
    dryRun: input.input.dryRun,
    target: {
      channel: 'telegram',
      accountId: input.input.accountId,
      peerId: input.input.peerId,
    },
    markerPrefix: input.input.markerPrefix,
    markerText: input.markerText,
    permission: {
      ...input.permissionFacts,
      sendMessageAllowed: input.sendMessageAllowed,
    },
    delivery: {
      sent: input.deliverySent,
      via: 'send_message',
      realTelegramDelivery: input.realTelegramDelivery,
      ...(input.messageId ? { messageId: input.messageId } : {}),
    },
    metrics: {
      recorded: input.live,
      metricsDb: input.metricsDb,
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
      toolStarted: input.live,
      toolCompleted: input.live,
    },
    safety: safetyFacts(input.input),
  };
}

function extractMessageId(result: { content: Array<{ type: string; text: string }> }): string | undefined {
  const text = result.content.map((item) => item.text).join('\n');
  const match = text.match(/ID:\s*(.+)\s*$/);
  return match?.[1]?.trim();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
