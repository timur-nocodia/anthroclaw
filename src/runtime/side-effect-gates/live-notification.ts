import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ChannelAdapter } from '../../channels/types.js';
import { TelegramChannel } from '../../channels/telegram.js';
import { loadAgentYml, loadGlobalConfig } from '../../config/loader.js';
import type { AgentYml, GlobalConfig } from '../../config/schema.js';
import { MetricsStore } from '../../metrics/store.js';
import { createNotificationsEmitter } from '../../notifications/emitter.js';
import type { NotificationEventName, NotificationRoute } from '../../notifications/types.js';
import {
  validateRuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateValidation,
} from '../side-effect-gate.js';

export const LIVE_NOTIFICATION_GATE_ID = 'live-notification';
export const DEFAULT_LIVE_NOTIFICATION_MARKER_PREFIX = 'LIVE_NOTIFICATION_OK';
export const DEFAULT_LIVE_NOTIFICATION_EVENT: NotificationEventName = 'escalation_needed';
export const DEFAULT_LIVE_NOTIFICATION_ROUTE = 'operator';

export interface LiveNotificationGateInput {
  agentId: string;
  configPath: string;
  agentsDir: string;
  dataDir: string;
  accountId: string;
  peerId: string;
  eventName?: NotificationEventName;
  routeName?: string;
  markerPrefix?: string;
  note?: string;
  confirmLiveNotification: boolean;
  dryRun: boolean;
  expectedPeerId?: string;
}

export interface LiveNotificationGateDeps {
  now?: () => number;
  makeRunId?: () => string;
  makeChannel?: (input: {
    globalConfig: GlobalConfig;
    accountId: string;
    dataDir: string;
  }) => ChannelAdapter;
}

export interface LiveNotificationGateResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  gate: {
    id: typeof LIVE_NOTIFICATION_GATE_ID;
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
  note: string;
  notification: {
    event: NotificationEventName;
    routeName: string;
    operatorRoutePresent: boolean;
    subscriptionPresent: boolean;
    notificationsEnabled: boolean;
    formattedTextIncludesMarker: boolean;
  };
  delivery: {
    sent: boolean;
    via: 'notifications.emit';
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
    noCronMutation: boolean;
    noConfigMutation: boolean;
  };
  error?: string;
}

type NormalizedLiveNotificationGateInput = LiveNotificationGateInput & {
  eventName: NotificationEventName;
  routeName: string;
  markerPrefix: string;
  expectedPeerId: string;
};

export async function runLiveNotificationGate(
  input: LiveNotificationGateInput,
  deps: LiveNotificationGateDeps = {},
): Promise<LiveNotificationGateResult> {
  const normalized = normalizeLiveNotificationGateInput(input);
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const note = normalized.note ?? `${normalized.markerPrefix} ${new Date(startedAt).toISOString()}`;
  const metricsDb = join(normalized.dataDir, 'metrics.sqlite');
  const sessionKey = `${normalized.agentId}:telegram:dm:${normalized.peerId}:live-notification`;
  const runId = deps.makeRunId?.() ?? `pi-live-notification-${randomUUID()}`;
  const gate = buildLiveNotificationGateSpec(normalized);

  if (!gate.validation.ok) {
    throw new Error(`invalid live notification gate spec: ${gate.validation.errors.join('; ')}`);
  }
  if (!normalized.dryRun && !normalized.confirmLiveNotification) {
    throw new Error('live notification gate requires explicit operator approval.');
  }

  const agentConfig = loadAgentYml(join(normalized.agentsDir, normalized.agentId));
  const notificationFacts = validateNotificationTarget(agentConfig, normalized);

  if (normalized.dryRun) {
    return passedResult({
      input: normalized,
      gate,
      note,
      notificationFacts,
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
    toolName: 'notifications.emit',
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
      toolName: 'notifications.emit',
      event: normalized.eventName,
      channel: 'telegram',
      accountId: normalized.accountId,
      peerId: normalized.peerId,
      markerPrefix: normalized.markerPrefix,
      gateId: LIVE_NOTIFICATION_GATE_ID,
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

  const sends: Array<{ route: NotificationRoute; text: string; messageId: string }> = [];
  const emitter = createNotificationsEmitter({
    sendMessage: async (route, text) => {
      if (route.channel !== 'telegram') throw new Error(`unsupported notification channel: ${route.channel}`);
      const messageId = await channel.sendText(route.peer_id, text, { accountId: route.account_id });
      sends.push({ route, text, messageId: String(messageId) });
      return messageId;
    },
  });
  emitter.subscribeAgent(normalized.agentId, agentConfig.notifications);

  try {
    const sentAt = now();
    await emitter.emit(normalized.eventName, {
      agentId: normalized.agentId,
      peerKey: `telegram:${normalized.accountId}:${normalized.peerId}`,
      note,
    });
    const completedAt = now();
    if (sends.length !== 1) {
      throw new Error(`expected exactly one notification send, got ${sends.length}`);
    }
    const send = sends[0]!;
    if (send.route.account_id !== normalized.accountId || send.route.peer_id !== normalized.peerId) {
      throw new Error('notification delivery target drifted away from the configured route');
    }
    if (!send.text.includes(note)) {
      throw new Error('formatted notification text did not include the marker note');
    }

    metrics.recordToolEvent({
      timestamp: completedAt,
      agentId: normalized.agentId,
      sessionKey,
      toolName: 'notifications.emit',
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
        toolName: 'notifications.emit',
        event: normalized.eventName,
        messageId: send.messageId,
        gateId: LIVE_NOTIFICATION_GATE_ID,
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
      note,
      notificationFacts,
      metricsDb,
      live: true,
      deliverySent: true,
      realTelegramDelivery: true,
      runId,
      sessionKey,
      messageId: send.messageId,
    });
  } catch (err) {
    const failedAt = now();
    const message = errorMessage(err);
    metrics.recordToolEvent({
      timestamp: failedAt,
      agentId: normalized.agentId,
      sessionKey,
      toolName: 'notifications.emit',
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
        toolName: 'notifications.emit',
        event: normalized.eventName,
        error: message,
        gateId: LIVE_NOTIFICATION_GATE_ID,
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

export function createFailedLiveNotificationGateResult(
  input: LiveNotificationGateInput,
  note: string,
  error: string,
): LiveNotificationGateResult {
  const normalized = normalizeLiveNotificationGateInput(input);
  const gate = buildLiveNotificationGateSpec(normalized);
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate,
    live: !normalized.dryRun,
    dryRun: normalized.dryRun,
    target: { channel: 'telegram', accountId: normalized.accountId, peerId: normalized.peerId },
    markerPrefix: normalized.markerPrefix,
    note,
    notification: {
      event: normalized.eventName,
      routeName: normalized.routeName,
      operatorRoutePresent: false,
      subscriptionPresent: false,
      notificationsEnabled: false,
      formattedTextIncludesMarker: false,
    },
    delivery: {
      sent: false,
      via: 'notifications.emit',
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

function normalizeLiveNotificationGateInput(input: LiveNotificationGateInput): NormalizedLiveNotificationGateInput {
  return {
    ...input,
    eventName: input.eventName ?? DEFAULT_LIVE_NOTIFICATION_EVENT,
    routeName: input.routeName ?? DEFAULT_LIVE_NOTIFICATION_ROUTE,
    markerPrefix: input.markerPrefix ?? DEFAULT_LIVE_NOTIFICATION_MARKER_PREFIX,
    expectedPeerId: input.expectedPeerId ?? input.peerId,
  };
}

function buildLiveNotificationGateSpec(input: NormalizedLiveNotificationGateInput): LiveNotificationGateResult['gate'] {
  const spec: RuntimeSideEffectGateSpec = {
    gateId: LIVE_NOTIFICATION_GATE_ID,
    agentId: input.agentId,
    runtime: 'pi',
    risk: 'external_write',
    action: 'notification.emit',
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
        id: 'notifications-enabled',
        description: 'Agent notifications are enabled.',
        required: true,
      },
      {
        id: 'route-bound-to-target',
        description: 'Named notification route targets the confirmed Telegram peer.',
        required: true,
      },
      {
        id: 'subscription-present',
        description: 'Agent subscribes the requested event to the named route.',
        required: true,
      },
      {
        id: 'operator-approval',
        description: 'Live notification delivery requires explicit operator approval.',
        required: true,
      },
    ],
    expectedEffects: [
      {
        id: 'single-notification-message',
        kind: 'notification.emit',
        description: 'Exactly one formatted notification is delivered to the confirmed Telegram peer.',
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
        id: 'no-cron-mutation',
        description: 'The gate emits a notification directly and does not create or update cron jobs.',
        required: true,
      },
    ],
    metrics: {
      runStarted: true,
      runCompleted: true,
      toolStarted: ['notifications.emit'],
      toolCompleted: ['notifications.emit'],
      noFailedTools: true,
    },
  };

  return {
    id: LIVE_NOTIFICATION_GATE_ID,
    spec,
    validation: validateRuntimeSideEffectGateSpec(spec),
  };
}

function validateNotificationTarget(
  config: AgentYml,
  input: NormalizedLiveNotificationGateInput,
): Pick<LiveNotificationGateResult['notification'], 'operatorRoutePresent' | 'subscriptionPresent' | 'notificationsEnabled'> {
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
  const notifications = config.notifications;
  const notificationsEnabled = notifications?.enabled === true;
  const notificationRoute = notifications?.routes?.[input.routeName];
  const operatorRoutePresent =
    notificationRoute?.channel === 'telegram' &&
    notificationRoute.account_id === input.accountId &&
    notificationRoute.peer_id === input.peerId;
  const subscriptionPresent = (notifications?.subscriptions ?? []).some((subscription) =>
    subscription.event === input.eventName && subscription.route === input.routeName
  );

  if (!privateAllowlistSinglePeer) {
    throw new Error(`${input.agentId} must remain private and allowlisted to exactly one Telegram peer.`);
  }
  if (!routeBound) {
    throw new Error(`${input.agentId} must route only the target Telegram DM for this live gate.`);
  }
  if (!notificationsEnabled) throw new Error(`${input.agentId} notifications must be enabled.`);
  if (!operatorRoutePresent) {
    throw new Error(`${input.agentId} notifications.${input.routeName} route must target telegram/${input.accountId}/${input.peerId}.`);
  }
  if (!subscriptionPresent) {
    throw new Error(`${input.agentId} must subscribe ${input.eventName} to the ${input.routeName} route.`);
  }

  return { operatorRoutePresent, subscriptionPresent, notificationsEnabled };
}

function safetyFacts(input: NormalizedLiveNotificationGateInput): LiveNotificationGateResult['safety'] {
  return {
    operatorApproved: input.confirmLiveNotification || input.dryRun,
    noBroadFanout: input.peerId === input.expectedPeerId,
    noCronMutation: true,
    noConfigMutation: true,
  };
}

function passedResult(input: {
  input: NormalizedLiveNotificationGateInput;
  gate: LiveNotificationGateResult['gate'];
  note: string;
  notificationFacts: Pick<LiveNotificationGateResult['notification'], 'operatorRoutePresent' | 'subscriptionPresent' | 'notificationsEnabled'>;
  metricsDb: string;
  live: boolean;
  deliverySent: boolean;
  realTelegramDelivery: boolean;
  runId?: string;
  sessionKey?: string;
  messageId?: string;
}): LiveNotificationGateResult {
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
    note: input.note,
    notification: {
      event: input.input.eventName,
      routeName: input.input.routeName,
      ...input.notificationFacts,
      formattedTextIncludesMarker: true,
    },
    delivery: {
      sent: input.deliverySent,
      via: 'notifications.emit',
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
