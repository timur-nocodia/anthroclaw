import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { TelegramChannel } from '../../channels/telegram.js';
import type { ChannelAdapter } from '../../channels/types.js';
import { loadAgentYml, loadGlobalConfig } from '../../config/loader.js';
import type { AgentYml, GlobalConfig } from '../../config/schema.js';
import { MetricsStore } from '../../metrics/store.js';
import {
  validateRuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateValidation,
} from '../side-effect-gate.js';

export const CONTROLLED_LIVE_TURN_GATE_ID = 'controlled-live-turn';
export const DEFAULT_CONTROLLED_LIVE_TURN_MARKER_PREFIX = 'CONTROLLED_LIVE_TURN_OK';

export interface ControlledLiveTurnGateInput {
  agentId: string;
  configPath: string;
  agentsDir: string;
  dataDir: string;
  accountId: string;
  peerId: string;
  threadId?: string;
  markerPrefix?: string;
  marker?: string;
  confirmControlledLiveTurn: boolean;
  dryRun: boolean;
  allowNonMentionOnly?: boolean;
}

export interface ControlledLiveTurnGateDeps {
  now?: () => number;
  makeRunId?: () => string;
  makeChannel?: (input: {
    globalConfig: GlobalConfig;
    accountId: string;
    dataDir: string;
  }) => ChannelAdapter;
}

export interface ControlledLiveTurnGateResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  gate: {
    id: typeof CONTROLLED_LIVE_TURN_GATE_ID;
    spec: RuntimeSideEffectGateSpec;
    validation: RuntimeSideEffectGateValidation;
  };
  live: boolean;
  dryRun: boolean;
  target: {
    channel: 'telegram';
    accountId: string;
    peerId: string;
    threadId?: string;
  };
  route: {
    bound: boolean;
    scope: 'group';
    mentionOnly: boolean;
    allowNonMentionOnly: boolean;
    topicBound: boolean;
  };
  markerPrefix: string;
  markerText: string;
  delivery: {
    sent: boolean;
    via: 'telegram_channel';
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
    routeBound: boolean;
  };
  monitorNext: string;
  error?: string;
}

type NormalizedControlledLiveTurnGateInput = ControlledLiveTurnGateInput & {
  markerPrefix: string;
  allowNonMentionOnly: boolean;
};

export async function runControlledLiveTurnGate(
  input: ControlledLiveTurnGateInput,
  deps: ControlledLiveTurnGateDeps = {},
): Promise<ControlledLiveTurnGateResult> {
  const normalized = normalizeControlledLiveTurnGateInput(input);
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const gate = buildControlledLiveTurnGateSpec(normalized);
  const markerText = normalized.marker ?? `${normalized.markerPrefix} ${new Date(startedAt).toISOString()}`;
  const metricsDb = join(normalized.dataDir, 'metrics.sqlite');
  const sessionKey = `${normalized.agentId}:telegram:group:${normalized.peerId}:${normalized.threadId ?? 'root'}:controlled-live-turn`;
  const runId = deps.makeRunId?.() ?? `pi-controlled-live-turn-${randomUUID()}`;

  if (!gate.validation.ok) {
    throw new Error(`invalid controlled live turn gate spec: ${gate.validation.errors.join('; ')}`);
  }
  if (!normalized.dryRun && !normalized.confirmControlledLiveTurn) {
    throw new Error('controlled live turn requires explicit operator approval.');
  }

  const agentConfig = loadAgentYml(join(normalized.agentsDir, normalized.agentId));
  const route = validateControlledGroupRoute(agentConfig, normalized);

  if (normalized.dryRun) {
    return passedResult({
      input: normalized,
      gate,
      route,
      markerText,
      metricsDb,
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
    toolName: 'controlled_live_turn',
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
      toolName: 'controlled_live_turn',
      channel: 'telegram',
      accountId: normalized.accountId,
      peerId: normalized.peerId,
      ...(normalized.threadId ? { threadId: normalized.threadId } : {}),
      markerPrefix: normalized.markerPrefix,
      gateId: CONTROLLED_LIVE_TURN_GATE_ID,
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

  try {
    const sentAt = now();
    const messageId = await channel.sendText(normalized.peerId, markerText, {
      accountId: normalized.accountId,
      ...(normalized.threadId ? { threadId: normalized.threadId } : {}),
    });
    const completedAt = now();
    metrics.recordToolEvent({
      timestamp: completedAt,
      agentId: normalized.agentId,
      sessionKey,
      toolName: 'controlled_live_turn',
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
        toolName: 'controlled_live_turn',
        messageId,
        gateId: CONTROLLED_LIVE_TURN_GATE_ID,
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
      route,
      markerText,
      metricsDb,
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
      toolName: 'controlled_live_turn',
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
        toolName: 'controlled_live_turn',
        error: message,
        gateId: CONTROLLED_LIVE_TURN_GATE_ID,
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

export function createFailedControlledLiveTurnGateResult(
  input: ControlledLiveTurnGateInput,
  markerText: string,
  error: string,
): ControlledLiveTurnGateResult {
  const normalized = normalizeControlledLiveTurnGateInput(input);
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate: buildControlledLiveTurnGateSpec(normalized),
    live: !normalized.dryRun,
    dryRun: normalized.dryRun,
    target: target(normalized),
    route: {
      bound: false,
      scope: 'group',
      mentionOnly: false,
      allowNonMentionOnly: normalized.allowNonMentionOnly,
      topicBound: false,
    },
    markerPrefix: normalized.markerPrefix,
    markerText,
    delivery: {
      sent: false,
      via: 'telegram_channel',
      realTelegramDelivery: false,
    },
    metrics: {
      recorded: false,
      metricsDb: join(normalized.dataDir, 'metrics.sqlite'),
      toolStarted: false,
      toolCompleted: false,
    },
    safety: safetyFacts(normalized, false),
    monitorNext: monitorNext(),
    error,
  };
}

function normalizeControlledLiveTurnGateInput(
  input: ControlledLiveTurnGateInput,
): NormalizedControlledLiveTurnGateInput {
  return {
    ...input,
    markerPrefix: input.markerPrefix ?? DEFAULT_CONTROLLED_LIVE_TURN_MARKER_PREFIX,
    allowNonMentionOnly: input.allowNonMentionOnly ?? false,
  };
}

function buildControlledLiveTurnGateSpec(
  input: NormalizedControlledLiveTurnGateInput,
): ControlledLiveTurnGateResult['gate'] {
  const spec: RuntimeSideEffectGateSpec = {
    gateId: CONTROLLED_LIVE_TURN_GATE_ID,
    agentId: input.agentId,
    runtime: 'pi',
    risk: 'external_write',
    action: 'message.controlled_live_turn',
    target: target(input),
    markerPrefix: input.markerPrefix,
    dryRunSupported: true,
    approvalRequired: true,
    policyAssertions: [
      {
        id: 'telegram-group-route-bound',
        description: 'Agent config contains a Telegram group route for the confirmed account, peer, and topic.',
        required: true,
      },
      {
        id: 'mention-only-by-default',
        description: 'Group routes remain mention-only unless the operator explicitly allows otherwise.',
        required: !input.allowNonMentionOnly,
      },
      {
        id: 'single-marker-message',
        description: 'The controlled live action is reduced to one marker text message through the configured Telegram channel.',
        required: true,
      },
      {
        id: 'operator-approval',
        description: 'Non-dry-run delivery requires explicit operator approval.',
        required: true,
      },
    ],
    expectedEffects: [
      {
        id: 'single-controlled-text-message',
        kind: 'message.controlled_live_turn',
        description: 'Exactly one marker text message is sent to the confirmed Telegram group topic.',
        target: target(input),
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
      toolStarted: ['controlled_live_turn'],
      toolCompleted: ['controlled_live_turn'],
      noFailedTools: true,
    },
  };

  return {
    id: CONTROLLED_LIVE_TURN_GATE_ID,
    spec,
    validation: validateRuntimeSideEffectGateSpec(spec),
  };
}

function validateControlledGroupRoute(
  config: AgentYml,
  input: NormalizedControlledLiveTurnGateInput,
): ControlledLiveTurnGateResult['route'] {
  const route = (config.routes ?? []).find((candidate) => {
    if (candidate.channel !== 'telegram') return false;
    if (candidate.scope !== 'group') return false;
    if (candidate.account !== undefined && candidate.account !== input.accountId) return false;
    if (!(candidate.peers ?? []).includes(input.peerId)) return false;
    if (!input.threadId) return true;
    return (candidate.topics ?? []).includes(input.threadId);
  });

  if (!route) {
    throw new Error(`${input.agentId} must have a Telegram group route bound to the confirmed target.`);
  }
  if (!input.allowNonMentionOnly && route.mention_only !== true) {
    throw new Error(`${input.agentId} Telegram group route must be mention_only for a controlled live turn.`);
  }

  return {
    bound: true,
    scope: 'group',
    mentionOnly: route.mention_only === true,
    allowNonMentionOnly: input.allowNonMentionOnly,
    topicBound: input.threadId ? (route.topics ?? []).includes(input.threadId) : true,
  };
}

function passedResult(input: {
  input: NormalizedControlledLiveTurnGateInput;
  gate: ControlledLiveTurnGateResult['gate'];
  route: ControlledLiveTurnGateResult['route'];
  markerText: string;
  metricsDb: string;
  live: boolean;
  deliverySent: boolean;
  realTelegramDelivery: boolean;
  runId?: string;
  sessionKey?: string;
  messageId?: string;
}): ControlledLiveTurnGateResult {
  return {
    status: 'passed',
    runtime: 'pi',
    agentId: input.input.agentId,
    gate: input.gate,
    live: input.live,
    dryRun: input.input.dryRun,
    target: target(input.input),
    route: input.route,
    markerPrefix: input.input.markerPrefix,
    markerText: input.markerText,
    delivery: {
      sent: input.deliverySent,
      via: 'telegram_channel',
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
    safety: safetyFacts(input.input, input.route.bound),
    monitorNext: monitorNext(),
  };
}

function safetyFacts(
  input: NormalizedControlledLiveTurnGateInput,
  routeBound: boolean,
): ControlledLiveTurnGateResult['safety'] {
  return {
    operatorApproved: input.confirmControlledLiveTurn || input.dryRun,
    noBroadFanout: true,
    noMedia: true,
    noConfigMutation: true,
    routeBound,
  };
}

function target(input: NormalizedControlledLiveTurnGateInput): ControlledLiveTurnGateResult['target'] {
  return {
    channel: 'telegram',
    accountId: input.accountId,
    peerId: input.peerId,
    ...(input.threadId ? { threadId: input.threadId } : {}),
  };
}

function monitorNext(): string {
  return `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
