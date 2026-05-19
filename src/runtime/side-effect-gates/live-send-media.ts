import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createSendMediaTool } from '../../agent/tools/send-media.js';
import type { ApprovalRequest, ChannelAdapter, OutboundMedia } from '../../channels/types.js';
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

export const LIVE_SEND_MEDIA_GATE_ID = 'live-send-media';
export const DEFAULT_LIVE_SEND_MEDIA_MARKER_PREFIX = 'LIVE_SEND_MEDIA_OK';

export interface LiveSendMediaGateInput {
  agentId: string;
  configPath: string;
  agentsDir: string;
  dataDir: string;
  workspacePath: string;
  accountId: string;
  peerId: string;
  filePath: string;
  allowedFileRoot: string;
  mediaType?: 'document';
  markerPrefix?: string;
  caption?: string;
  confirmLiveSendMedia: boolean;
  dryRun: boolean;
  expectedPeerId?: string;
}

export interface LiveSendMediaGateDeps {
  now?: () => number;
  makeRunId?: () => string;
  makeChannel?: (input: {
    globalConfig: GlobalConfig;
    accountId: string;
    dataDir: string;
  }) => ChannelAdapter;
}

export interface LiveSendMediaGateResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  gate: {
    id: typeof LIVE_SEND_MEDIA_GATE_ID;
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
  media: {
    type: 'document';
    filePath: string;
    caption: string;
    allowedRoot: string;
    fileExists: boolean;
    fileRootBound: boolean;
  };
  markerPrefix: string;
  permission: {
    mcpToolPresent: boolean;
    privateAllowlistSinglePeer: boolean;
    routeBound: boolean;
    sendMediaApprovalRequested: boolean;
    sendMediaAllowed: boolean;
  };
  delivery: {
    sent: boolean;
    via: 'send_media';
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
    documentOnly: boolean;
    noConfigMutation: boolean;
  };
  error?: string;
}

type NormalizedLiveSendMediaGateInput = LiveSendMediaGateInput & {
  mediaType: 'document';
  markerPrefix: string;
  expectedPeerId: string;
};

export async function runLiveSendMediaGate(
  input: LiveSendMediaGateInput,
  deps: LiveSendMediaGateDeps = {},
): Promise<LiveSendMediaGateResult> {
  const normalized = normalizeLiveSendMediaGateInput(input);
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const caption = normalized.caption ?? `${normalized.markerPrefix} ${new Date(startedAt).toISOString()}`;
  const metricsDb = join(normalized.dataDir, 'metrics.sqlite');
  const sessionKey = `${normalized.agentId}:telegram:dm:${normalized.peerId}:live-send-media`;
  const runId = deps.makeRunId?.() ?? `pi-live-media-${randomUUID()}`;
  const gate = buildLiveSendMediaGateSpec(normalized);

  if (!gate.validation.ok) {
    throw new Error(`invalid live send_media gate spec: ${gate.validation.errors.join('; ')}`);
  }
  if (!normalized.dryRun && !normalized.confirmLiveSendMedia) {
    throw new Error('live send_media gate requires explicit operator approval.');
  }

  const agentConfig = loadAgentYml(join(normalized.agentsDir, normalized.agentId));
  const permissionFacts = validateTarget(agentConfig, normalized);
  const mediaFacts = validateMediaFile(normalized, caption);

  const approvalBroker = new ApprovalBroker();
  const approvalChannel = createAutoApprovalChannel(approvalBroker, normalized.peerId);
  const serverName = `${normalized.agentId}-tools`;
  const canUseTool = createCanUseTool({
    agent: {
      id: normalized.agentId,
      config: agentConfig,
      safetyProfile: getProfile(agentConfig.safety_profile),
      workspacePath: normalized.workspacePath,
    },
    approvalBroker,
    channel: approvalChannel,
    sessionContext: {
      channel: 'telegram',
      peerId: normalized.peerId,
      senderId: normalized.peerId,
      accountId: normalized.accountId,
    },
  });
  const permission = await canUseTool(
    `mcp__${serverName}__send_media`,
    {
      channel: 'telegram',
      peer_id: normalized.peerId,
      account_id: normalized.accountId,
      file_path: normalized.filePath,
      type: normalized.mediaType,
      caption,
    },
    { signal: new AbortController().signal, toolUseID: `${LIVE_SEND_MEDIA_GATE_ID}:${normalized.agentId}` } as any,
  );
  const sendMediaAllowed = permission.behavior === 'allow';
  if (!sendMediaAllowed) {
    throw new Error(`send_media permission denied: ${permission.message ?? permission.behavior}`);
  }

  if (normalized.dryRun) {
    return passedResult({
      input: normalized,
      gate,
      mediaFacts,
      metricsDb,
      permissionFacts,
      sendMediaApprovalRequested: approvalChannel.approvalRequests.length === 1,
      sendMediaAllowed,
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
    toolName: 'send_media',
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
      toolName: 'send_media',
      channel: 'telegram',
      accountId: normalized.accountId,
      peerId: normalized.peerId,
      filePath: normalized.filePath,
      markerPrefix: normalized.markerPrefix,
      gateId: LIVE_SEND_MEDIA_GATE_ID,
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
  const sendMediaTool = createSendMediaTool(
    normalized.workspacePath,
    (id) => id === 'telegram' ? channel : undefined,
    {
      dispatchContext: {
        channel: 'telegram',
        accountId: normalized.accountId,
      },
    },
  );

  try {
    const sentAt = now();
    const toolResult = await sendMediaTool.handler({
      channel: 'telegram',
      peer_id: normalized.peerId,
      account_id: normalized.accountId,
      file_path: normalized.filePath,
      type: normalized.mediaType,
      caption,
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
      toolName: 'send_media',
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
        toolName: 'send_media',
        messageId,
        gateId: LIVE_SEND_MEDIA_GATE_ID,
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
      mediaFacts,
      metricsDb,
      permissionFacts,
      sendMediaApprovalRequested: approvalChannel.approvalRequests.length === 1,
      sendMediaAllowed,
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
      toolName: 'send_media',
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
        toolName: 'send_media',
        error: message,
        gateId: LIVE_SEND_MEDIA_GATE_ID,
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

export function createFailedLiveSendMediaGateResult(
  input: LiveSendMediaGateInput,
  error: string,
): LiveSendMediaGateResult {
  const normalized = normalizeLiveSendMediaGateInput(input);
  const gate = buildLiveSendMediaGateSpec(normalized);
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate,
    live: !normalized.dryRun,
    dryRun: normalized.dryRun,
    target: { channel: 'telegram', accountId: normalized.accountId, peerId: normalized.peerId },
    media: {
      type: normalized.mediaType,
      filePath: normalized.filePath,
      caption: normalized.caption ?? '',
      allowedRoot: normalized.allowedFileRoot,
      fileExists: false,
      fileRootBound: false,
    },
    markerPrefix: normalized.markerPrefix,
    permission: {
      mcpToolPresent: false,
      privateAllowlistSinglePeer: false,
      routeBound: false,
      sendMediaApprovalRequested: false,
      sendMediaAllowed: false,
    },
    delivery: {
      sent: false,
      via: 'send_media',
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

function normalizeLiveSendMediaGateInput(input: LiveSendMediaGateInput): NormalizedLiveSendMediaGateInput {
  return {
    ...input,
    mediaType: input.mediaType ?? 'document',
    markerPrefix: input.markerPrefix ?? DEFAULT_LIVE_SEND_MEDIA_MARKER_PREFIX,
    expectedPeerId: input.expectedPeerId ?? input.peerId,
  };
}

function buildLiveSendMediaGateSpec(input: NormalizedLiveSendMediaGateInput): LiveSendMediaGateResult['gate'] {
  const spec: RuntimeSideEffectGateSpec = {
    gateId: LIVE_SEND_MEDIA_GATE_ID,
    agentId: input.agentId,
    runtime: 'pi',
    risk: 'external_write',
    action: 'media.send',
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
        description: 'Agent exposes the send_media MCP tool.',
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
        id: 'file-root-bound',
        description: 'Media file path is confined to the configured allowed root.',
        required: true,
      },
      {
        id: 'operator-approval',
        description: 'Live delivery requires explicit operator approval and a tool approval decision.',
        required: true,
      },
    ],
    expectedEffects: [
      {
        id: 'single-document-media',
        kind: 'media.send',
        description: 'Exactly one document media item is delivered to the confirmed Telegram peer.',
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
        id: 'source-file-retained',
        description: 'The gate reads an existing source file and does not move or delete it.',
        required: true,
      },
    ],
    metrics: {
      runStarted: true,
      runCompleted: true,
      toolStarted: ['send_media'],
      toolCompleted: ['send_media'],
      noFailedTools: true,
    },
  };

  return {
    id: LIVE_SEND_MEDIA_GATE_ID,
    spec,
    validation: validateRuntimeSideEffectGateSpec(spec),
  };
}

function validateTarget(
  config: AgentYml,
  input: NormalizedLiveSendMediaGateInput,
): Pick<LiveSendMediaGateResult['permission'], 'mcpToolPresent' | 'privateAllowlistSinglePeer' | 'routeBound'> {
  const mcpToolPresent = (config.mcp_tools ?? []).includes('send_media');
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

  if (!mcpToolPresent) throw new Error(`${input.agentId} must expose send_media.`);
  if (!privateAllowlistSinglePeer) {
    throw new Error(`${input.agentId} must remain private and allowlisted to exactly one Telegram peer.`);
  }
  if (!routeBound) {
    throw new Error(`${input.agentId} must route only the target Telegram DM for this live gate.`);
  }

  return { mcpToolPresent, privateAllowlistSinglePeer, routeBound };
}

function validateMediaFile(
  input: NormalizedLiveSendMediaGateInput,
  caption: string,
): LiveSendMediaGateResult['media'] {
  const resolvedWorkspace = resolve(input.workspacePath);
  const resolvedFile = resolve(resolvedWorkspace, input.filePath);
  const resolvedAllowedRoot = resolve(resolvedWorkspace, input.allowedFileRoot);
  const relToRoot = relative(resolvedAllowedRoot, resolvedFile);
  const fileRootBound = relToRoot !== '' && !relToRoot.startsWith('..') && !relToRoot.startsWith('/');
  const fileExists = existsSync(resolvedFile) && statSync(resolvedFile).isFile();

  if (!fileRootBound) {
    throw new Error(`media file must stay under ${input.allowedFileRoot}`);
  }
  if (!fileExists) {
    throw new Error(`media file not found: ${input.filePath}`);
  }

  return {
    type: input.mediaType,
    filePath: input.filePath,
    caption,
    allowedRoot: input.allowedFileRoot,
    fileExists,
    fileRootBound,
  };
}

function createAutoApprovalChannel(
  approvalBroker: ApprovalBroker,
  senderId: string,
): ChannelAdapter & { approvalRequests: ApprovalRequest[] } {
  const approvalRequests: ApprovalRequest[] = [];
  return {
    id: 'telegram',
    supportsApproval: true,
    start: async () => {},
    stop: async () => {},
    onMessage: () => {},
    sendTyping: async () => {},
    editText: async () => {},
    deleteText: async () => {},
    promptForApproval: async (req: ApprovalRequest) => {
      approvalRequests.push(req);
      setTimeout(() => {
        approvalBroker.resolveBySender(req.id, senderId, 'allow');
      }, 0);
    },
    sendText: async () => 'approval-only-text-id',
    sendMedia: async () => 'approval-only-media-id',
    approvalRequests,
  };
}

function safetyFacts(input: NormalizedLiveSendMediaGateInput): LiveSendMediaGateResult['safety'] {
  return {
    operatorApproved: input.confirmLiveSendMedia || input.dryRun,
    noBroadFanout: input.peerId === input.expectedPeerId,
    documentOnly: input.mediaType === 'document',
    noConfigMutation: true,
  };
}

function passedResult(input: {
  input: NormalizedLiveSendMediaGateInput;
  gate: LiveSendMediaGateResult['gate'];
  mediaFacts: LiveSendMediaGateResult['media'];
  metricsDb: string;
  permissionFacts: Pick<LiveSendMediaGateResult['permission'], 'mcpToolPresent' | 'privateAllowlistSinglePeer' | 'routeBound'>;
  sendMediaApprovalRequested: boolean;
  sendMediaAllowed: boolean;
  live: boolean;
  deliverySent: boolean;
  realTelegramDelivery: boolean;
  runId?: string;
  sessionKey?: string;
  messageId?: string;
}): LiveSendMediaGateResult {
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
    media: input.mediaFacts,
    markerPrefix: input.input.markerPrefix,
    permission: {
      ...input.permissionFacts,
      sendMediaApprovalRequested: input.sendMediaApprovalRequested,
      sendMediaAllowed: input.sendMediaAllowed,
    },
    delivery: {
      sent: input.deliverySent,
      via: 'send_media',
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
