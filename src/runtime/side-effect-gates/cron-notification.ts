import { cpSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createManageCronTool } from '../../agent/tools/manage-cron.js';
import { createManageNotificationsTool } from '../../agent/tools/manage-notifications.js';
import { loadAgentYml } from '../../config/loader.js';
import { createAgentConfigWriter } from '../../config/writer.js';
import { DynamicCronStore } from '../../cron/dynamic-store.js';
import { createNotificationsEmitter } from '../../notifications/emitter.js';
import type { NotificationEventName, NotificationRoute } from '../../notifications/types.js';
import {
  validateRuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateValidation,
} from '../side-effect-gate.js';

export const CRON_NOTIFICATION_GATE_ID = 'cron-notification';
export const DEFAULT_CRON_NOTIFICATION_EVENT: NotificationEventName = 'escalation_needed';
export const DEFAULT_CRON_NOTIFICATION_ROUTE = 'operator';
export const DEFAULT_CRON_NOTIFICATION_MARKER = 'CRON_NOTIFICATION_CANARY';

export interface CronNotificationGateInput {
  agentId: string;
  sourceAgentsDir: string;
  workspace: string;
  accountId: string;
  peerId: string;
  senderId: string;
  staticCronId: string;
  dynamicCronId: string;
  dynamicCronSchedule?: string;
  dynamicCronPrompt?: string;
  notificationRouteName?: string;
  notificationEvent?: NotificationEventName;
  notificationMarker?: string;
}

export interface CronNotificationGateResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  gate: {
    id: typeof CRON_NOTIFICATION_GATE_ID;
    spec: RuntimeSideEffectGateSpec;
    validation: RuntimeSideEffectGateValidation;
  };
  agentsDir: string;
  dataDir: string;
  peerId: string;
  staticCron: {
    id: string;
    exists: boolean;
    enabled: boolean;
  };
  dynamicCron: {
    created: boolean;
    listed: boolean;
    toggledDisabled: boolean;
    deleted: boolean;
    remaining: number;
    updates: number;
    deliverToBound: boolean;
    ignoredModelSuppliedDeliverTo: boolean;
  };
  notifications: {
    routeName: string;
    event: NotificationEventName;
    operatorRoutePresent: boolean;
    subscriptions: number;
    manageToolTestDispatched: boolean;
    emitterSends: number;
    fakeOnly: boolean;
    markerSeen: boolean;
  };
  error?: string;
}

interface FakeNotificationSend {
  route: NotificationRoute;
  text: string;
  meta: { event: string; agentId: string };
}

type NormalizedCronNotificationGateInput = CronNotificationGateInput & {
  dynamicCronSchedule: string;
  dynamicCronPrompt: string;
  notificationRouteName: string;
  notificationEvent: NotificationEventName;
  notificationMarker: string;
};

export async function runCronNotificationGate(
  input: CronNotificationGateInput,
): Promise<CronNotificationGateResult> {
  const normalized = normalizeCronNotificationGateInput(input);
  const agentsDir = join(normalized.workspace, 'agents');
  const dataDir = join(normalized.workspace, 'data');
  const gate = buildCronNotificationGateSpec(normalized);

  if (!gate.validation.ok) {
    throw new Error(`invalid cron notification gate spec: ${gate.validation.errors.join('; ')}`);
  }

  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  cpSync(join(resolve(normalized.sourceAgentsDir), normalized.agentId), join(agentsDir, normalized.agentId), {
    recursive: true,
  });

  const config = loadAgentYml(join(agentsDir, normalized.agentId));
  const mcpTools = config.mcp_tools ?? [];
  if (!mcpTools.includes('manage_cron')) throw new Error(`${normalized.agentId} must expose manage_cron.`);
  if (!mcpTools.includes('manage_notifications')) throw new Error(`${normalized.agentId} must expose manage_notifications.`);

  const staticJob = (config.cron ?? []).find((job) => job.id === normalized.staticCronId);
  if (!staticJob) throw new Error(`Static cron job ${normalized.staticCronId} is missing.`);
  if (staticJob.enabled !== false) {
    throw new Error(`Static cron job ${normalized.staticCronId} must remain disabled by default.`);
  }

  const cronStore = new DynamicCronStore(join(dataDir, 'dynamic-cron.json'));
  let cronUpdates = 0;
  const cronTool = createManageCronTool(
    normalized.agentId,
    cronStore,
    () => {
      cronUpdates += 1;
    },
    {
      agentId: normalized.agentId,
      channel: 'telegram',
      accountId: normalized.accountId,
      peerId: normalized.peerId,
      senderId: normalized.senderId,
    },
  );

  await assertToolOk(cronTool.handler({
    action: 'create',
    id: normalized.dynamicCronId,
    schedule: normalized.dynamicCronSchedule,
    prompt: normalized.dynamicCronPrompt,
    deliver_to: { channel: 'telegram', peer_id: 'untrusted-model-target' },
  }), 'manage_cron create failed');
  await assertToolOk(cronTool.handler({ action: 'list' }), 'manage_cron list failed');
  await assertToolOk(cronTool.handler({
    action: 'toggle',
    id: normalized.dynamicCronId,
    enabled: false,
  }), 'manage_cron toggle false failed');

  const [disabledJob] = cronStore.list(normalized.agentId);
  if (!disabledJob) throw new Error('manage_cron did not persist the temporary job.');
  if (disabledJob.enabled !== false) throw new Error('Temporary cron job was not toggled disabled.');
  if (disabledJob.deliverTo?.peer_id !== normalized.peerId || disabledJob.deliverTo.account_id !== normalized.accountId) {
    throw new Error('Temporary cron job did not bind delivery to the operator dispatch context.');
  }

  await assertToolOk(cronTool.handler({
    action: 'delete',
    id: normalized.dynamicCronId,
  }), 'manage_cron cleanup failed');

  const writer = createAgentConfigWriter({ agentsDir, backupKeep: 2 });
  const notifications = config.notifications;
  if (!notifications) throw new Error(`${normalized.agentId} notifications block is missing.`);
  const notificationRoute = notifications.routes?.[normalized.notificationRouteName];
  if (notifications.enabled !== true) {
    throw new Error(`${normalized.agentId} notifications must remain enabled for route canaries.`);
  }
  if (!notificationRoute) {
    throw new Error(`${normalized.agentId} notifications.${normalized.notificationRouteName} route is missing.`);
  }
  if (notificationRoute.account_id !== normalized.accountId || notificationRoute.peer_id !== normalized.peerId) {
    throw new Error(`${normalized.agentId} notifications.${normalized.notificationRouteName} route does not target telegram/${normalized.accountId}/${normalized.peerId}.`);
  }

  const manageToolTestDispatches: Array<{ agentId: string; routeName: string; route: NotificationRoute }> = [];
  const notificationsTool = createManageNotificationsTool({
    agentId: normalized.agentId,
    writer,
    canManage: (callerId, targetId) => callerId === targetId,
    dispatchTest: (dispatch) => {
      manageToolTestDispatches.push(dispatch);
    },
    sessionKey: `${normalized.agentId}:telegram:dm:${normalized.peerId}`,
  });
  await assertToolOk(notificationsTool.handler({
    action: { kind: 'list_routes' },
  }), 'manage_notifications list_routes failed');
  await assertToolOk(notificationsTool.handler({
    action: { kind: 'list_subscriptions' },
  }), 'manage_notifications list_subscriptions failed');
  await assertToolOk(notificationsTool.handler({
    action: { kind: 'test', route_name: normalized.notificationRouteName },
  }), 'manage_notifications test dispatch failed');
  if (manageToolTestDispatches.length !== 1) {
    throw new Error(`manage_notifications test dispatched ${manageToolTestDispatches.length} times, expected 1.`);
  }

  const fakeSends: FakeNotificationSend[] = [];
  const emitter = createNotificationsEmitter({
    sendMessage: (route, text, meta) => {
      fakeSends.push({ route, text, meta });
    },
  });
  emitter.subscribeAgent(normalized.agentId, notifications);
  await emitter.emit(normalized.notificationEvent, {
    agentId: normalized.agentId,
    peerKey: `telegram:${normalized.accountId}:${normalized.peerId}`,
    note: normalized.notificationMarker,
  });
  if (fakeSends.length !== 1) throw new Error(`Expected one fake proactive notification send, got ${fakeSends.length}.`);
  const fakeSend = fakeSends[0]!;
  if (fakeSend.route.account_id !== normalized.accountId || fakeSend.route.peer_id !== normalized.peerId) {
    throw new Error('Fake proactive notification did not target the configured route.');
  }
  if (!fakeSend.text.includes(normalized.notificationMarker)) {
    throw new Error('Fake proactive notification did not include the canary marker.');
  }

  return {
    status: 'passed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate,
    agentsDir,
    dataDir,
    peerId: normalized.peerId,
    staticCron: {
      id: normalized.staticCronId,
      exists: true,
      enabled: false,
    },
    dynamicCron: {
      created: true,
      listed: true,
      toggledDisabled: disabledJob.enabled === false,
      deleted: true,
      remaining: cronStore.list(normalized.agentId).length,
      updates: cronUpdates,
      deliverToBound: disabledJob.deliverTo?.peer_id === normalized.peerId && disabledJob.deliverTo.account_id === normalized.accountId,
      ignoredModelSuppliedDeliverTo: disabledJob.deliverTo?.peer_id !== 'untrusted-model-target',
    },
    notifications: {
      routeName: normalized.notificationRouteName,
      event: normalized.notificationEvent,
      operatorRoutePresent: true,
      subscriptions: notifications.subscriptions?.length ?? 0,
      manageToolTestDispatched: manageToolTestDispatches.length === 1,
      emitterSends: fakeSends.length,
      fakeOnly: true,
      markerSeen: fakeSend.text.includes(normalized.notificationMarker),
    },
  };
}

export function createFailedCronNotificationGateResult(
  input: CronNotificationGateInput,
  error: string,
): CronNotificationGateResult {
  const normalized = normalizeCronNotificationGateInput(input);
  const agentsDir = join(normalized.workspace, 'agents');
  const dataDir = join(normalized.workspace, 'data');
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate: buildCronNotificationGateSpec(normalized),
    agentsDir,
    dataDir,
    peerId: normalized.peerId,
    staticCron: { id: normalized.staticCronId, exists: false, enabled: false },
    dynamicCron: {
      created: false,
      listed: false,
      toggledDisabled: false,
      deleted: false,
      remaining: -1,
      updates: 0,
      deliverToBound: false,
      ignoredModelSuppliedDeliverTo: false,
    },
    notifications: {
      routeName: normalized.notificationRouteName,
      event: normalized.notificationEvent,
      operatorRoutePresent: false,
      subscriptions: 0,
      manageToolTestDispatched: false,
      emitterSends: 0,
      fakeOnly: true,
      markerSeen: false,
    },
    error,
  };
}

function normalizeCronNotificationGateInput(input: CronNotificationGateInput): NormalizedCronNotificationGateInput {
  return {
    ...input,
    dynamicCronSchedule: input.dynamicCronSchedule ?? '*/30 * * * *',
    dynamicCronPrompt: input.dynamicCronPrompt ?? `Run a disabled ${input.agentId} cron smoke. Reply [SILENT] if healthy.`,
    notificationRouteName: input.notificationRouteName ?? DEFAULT_CRON_NOTIFICATION_ROUTE,
    notificationEvent: input.notificationEvent ?? DEFAULT_CRON_NOTIFICATION_EVENT,
    notificationMarker: input.notificationMarker ?? DEFAULT_CRON_NOTIFICATION_MARKER,
  };
}

function buildCronNotificationGateSpec(
  input: NormalizedCronNotificationGateInput,
): CronNotificationGateResult['gate'] {
  const spec: RuntimeSideEffectGateSpec = {
    gateId: CRON_NOTIFICATION_GATE_ID,
    agentId: input.agentId,
    runtime: 'pi',
    risk: 'operator_only',
    action: 'cron.schedule',
    target: {
      channel: 'telegram',
      accountId: input.accountId,
      peerId: input.peerId,
    },
    markerPrefix: input.notificationMarker,
    dryRunSupported: true,
    approvalRequired: true,
    policyAssertions: [
      {
        id: 'static-cron-disabled',
        description: 'Configured static cron canary exists and is disabled by default.',
        required: true,
      },
      {
        id: 'dispatch-bound-delivery',
        description: 'Dynamic cron creation binds delivery to the active dispatch context, not model-supplied targets.',
        required: true,
      },
      {
        id: 'notification-route-bound',
        description: 'Notification route targets the confirmed Telegram account and peer.',
        required: true,
      },
      {
        id: 'fake-only',
        description: 'The gate uses a temporary workspace and fake notification delivery only.',
        required: true,
      },
    ],
    expectedEffects: [
      {
        id: 'temporary-dynamic-cron',
        kind: 'cron.schedule',
        description: 'A temporary dynamic cron is created, listed, disabled, and deleted in an isolated store.',
        target: {
          channel: 'none',
        },
        maxCount: 1,
      },
      {
        id: 'fake-notification-dispatch',
        kind: 'notification.emit',
        description: 'Exactly one fake notification dispatch reaches the configured route.',
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
        id: 'dynamic-cron-deleted',
        description: 'The temporary dynamic cron is deleted before the gate returns.',
        required: true,
      },
      {
        id: 'no-source-config-mutation',
        description: 'The gate copies agent config into a temporary workspace before exercising tools.',
        required: true,
      },
    ],
    metrics: {
      runStarted: true,
      runCompleted: true,
      noFailedTools: true,
    },
  };

  return {
    id: CRON_NOTIFICATION_GATE_ID,
    spec,
    validation: validateRuntimeSideEffectGateSpec(spec),
  };
}

async function assertToolOk(
  resultPromise: Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }>,
  message: string,
): Promise<void> {
  const result = await resultPromise;
  if (result.isError) {
    const text = result.content.map((item) => item.text).join('\n');
    throw new Error(`${message}: ${text}`);
  }
}
