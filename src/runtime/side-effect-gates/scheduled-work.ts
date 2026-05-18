import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createManageCronTool } from '../../agent/tools/manage-cron.js';
import { loadAgentYml } from '../../config/loader.js';
import { DynamicCronStore } from '../../cron/dynamic-store.js';
import {
  validateRuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateValidation,
} from '../side-effect-gate.js';

export const SCHEDULED_WORK_GATE_ID = 'scheduled-work';
export const DEFAULT_SCHEDULED_WORK_CRON_ID = 'generic-scheduled-work-canary';
export const DEFAULT_SCHEDULED_WORK_SCHEDULE = '*/30 * * * *';

export interface ScheduledWorkGateInput {
  agentId: string;
  sourceAgentsDir: string;
  workspace: string;
  accountId: string;
  peerId: string;
  senderId: string;
  threadId?: string;
  cronId?: string;
  cronSchedule?: string;
  cronPrompt?: string;
}

export interface ScheduledWorkGateResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  gate: {
    id: typeof SCHEDULED_WORK_GATE_ID;
    spec: RuntimeSideEffectGateSpec;
    validation: RuntimeSideEffectGateValidation;
  };
  agentsDir: string;
  dataDir: string;
  target: {
    accountId: string;
    peerId: string;
    threadId?: string;
  };
  cron: {
    id: string;
    created: boolean;
    listed: boolean;
    toggledDisabled: boolean;
    deleted: boolean;
    remaining: number;
    updates: number;
    deliverToBound: boolean;
    createdByBound: boolean;
    ignoredModelSuppliedDeliverTo: boolean;
  };
  sourceConfigUnchanged: boolean;
  error?: string;
}

type NormalizedScheduledWorkGateInput = ScheduledWorkGateInput & {
  cronId: string;
  cronSchedule: string;
  cronPrompt: string;
};

export async function runScheduledWorkGate(
  input: ScheduledWorkGateInput,
): Promise<ScheduledWorkGateResult> {
  const normalized = normalizeScheduledWorkGateInput(input);
  const sourceAgentDir = join(resolve(normalized.sourceAgentsDir), normalized.agentId);
  const sourceAgentYmlPath = join(sourceAgentDir, 'agent.yml');
  const sourceAgentYmlBefore = readFileSync(sourceAgentYmlPath, 'utf8');
  const agentsDir = join(normalized.workspace, 'agents');
  const dataDir = join(normalized.workspace, 'data');
  const gate = buildScheduledWorkGateSpec(normalized);

  if (!gate.validation.ok) {
    throw new Error(`invalid scheduled work gate spec: ${gate.validation.errors.join('; ')}`);
  }

  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  cpSync(sourceAgentDir, join(agentsDir, normalized.agentId), { recursive: true });

  const config = loadAgentYml(join(agentsDir, normalized.agentId));
  const mcpTools = config.mcp_tools ?? [];
  if (!mcpTools.includes('manage_cron')) throw new Error(`${normalized.agentId} must expose manage_cron.`);

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
      ...(normalized.threadId ? { threadId: normalized.threadId } : {}),
    },
  );

  await assertToolOk(cronTool.handler({
    action: 'create',
    id: normalized.cronId,
    schedule: normalized.cronSchedule,
    prompt: normalized.cronPrompt,
    deliver_to: {
      channel: 'telegram',
      account_id: 'untrusted-model-account',
      peer_id: 'untrusted-model-target',
      thread_id: 'untrusted-model-thread',
    },
  }), 'manage_cron create failed');
  await assertToolOk(cronTool.handler({ action: 'list' }), 'manage_cron list failed');
  await assertToolOk(cronTool.handler({
    action: 'toggle',
    id: normalized.cronId,
    enabled: false,
  }), 'manage_cron toggle false failed');

  const [disabledJob] = cronStore.list(normalized.agentId);
  if (!disabledJob) throw new Error('manage_cron did not persist the temporary job.');
  if (disabledJob.enabled !== false) throw new Error('Temporary cron job was not toggled disabled.');
  if (disabledJob.deliverTo?.peer_id !== normalized.peerId || disabledJob.deliverTo.account_id !== normalized.accountId) {
    throw new Error('Temporary cron job did not bind delivery to the operator dispatch context.');
  }
  if ((disabledJob.deliverTo?.thread_id ?? undefined) !== (normalized.threadId ?? undefined)) {
    throw new Error('Temporary cron job did not bind the confirmed Telegram thread context.');
  }
  if (!disabledJob.createdBy) {
    throw new Error('Temporary cron job did not record creator metadata.');
  }
  if (
    disabledJob.createdBy.peer_id !== normalized.peerId
    || disabledJob.createdBy.account_id !== normalized.accountId
    || disabledJob.createdBy.sender_id !== normalized.senderId
  ) {
    throw new Error('Temporary cron job did not bind creator metadata to the operator dispatch context.');
  }

  await assertToolOk(cronTool.handler({
    action: 'delete',
    id: normalized.cronId,
  }), 'manage_cron cleanup failed');

  const sourceConfigUnchanged = readFileSync(sourceAgentYmlPath, 'utf8') === sourceAgentYmlBefore;
  if (!sourceConfigUnchanged) throw new Error('Source agent.yml changed during scheduled-work gate.');

  return {
    status: 'passed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate,
    agentsDir,
    dataDir,
    target: {
      accountId: normalized.accountId,
      peerId: normalized.peerId,
      ...(normalized.threadId ? { threadId: normalized.threadId } : {}),
    },
    cron: {
      id: normalized.cronId,
      created: true,
      listed: true,
      toggledDisabled: disabledJob.enabled === false,
      deleted: true,
      remaining: cronStore.list(normalized.agentId).length,
      updates: cronUpdates,
      deliverToBound: disabledJob.deliverTo?.peer_id === normalized.peerId
        && disabledJob.deliverTo.account_id === normalized.accountId
        && (disabledJob.deliverTo.thread_id ?? undefined) === (normalized.threadId ?? undefined),
      createdByBound: disabledJob.createdBy.peer_id === normalized.peerId
        && disabledJob.createdBy.account_id === normalized.accountId
        && disabledJob.createdBy.sender_id === normalized.senderId,
      ignoredModelSuppliedDeliverTo: disabledJob.deliverTo?.peer_id !== 'untrusted-model-target'
        && disabledJob.deliverTo?.account_id !== 'untrusted-model-account'
        && disabledJob.deliverTo?.thread_id !== 'untrusted-model-thread',
    },
    sourceConfigUnchanged,
  };
}

export function createFailedScheduledWorkGateResult(
  input: ScheduledWorkGateInput,
  error: string,
): ScheduledWorkGateResult {
  const normalized = normalizeScheduledWorkGateInput(input);
  const agentsDir = join(normalized.workspace, 'agents');
  const dataDir = join(normalized.workspace, 'data');
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate: buildScheduledWorkGateSpec(normalized),
    agentsDir,
    dataDir,
    target: {
      accountId: normalized.accountId,
      peerId: normalized.peerId,
      ...(normalized.threadId ? { threadId: normalized.threadId } : {}),
    },
    cron: {
      id: normalized.cronId,
      created: false,
      listed: false,
      toggledDisabled: false,
      deleted: false,
      remaining: -1,
      updates: 0,
      deliverToBound: false,
      createdByBound: false,
      ignoredModelSuppliedDeliverTo: false,
    },
    sourceConfigUnchanged: false,
    error,
  };
}

function normalizeScheduledWorkGateInput(input: ScheduledWorkGateInput): NormalizedScheduledWorkGateInput {
  return {
    ...input,
    cronId: input.cronId ?? DEFAULT_SCHEDULED_WORK_CRON_ID,
    cronSchedule: input.cronSchedule ?? DEFAULT_SCHEDULED_WORK_SCHEDULE,
    cronPrompt: input.cronPrompt ?? `Run a disabled ${input.agentId} scheduled-work smoke. Reply [SILENT] if healthy.`,
  };
}

function buildScheduledWorkGateSpec(
  input: NormalizedScheduledWorkGateInput,
): ScheduledWorkGateResult['gate'] {
  const spec: RuntimeSideEffectGateSpec = {
    gateId: SCHEDULED_WORK_GATE_ID,
    agentId: input.agentId,
    runtime: 'pi',
    risk: 'operator_only',
    action: 'cron.schedule',
    target: {
      channel: 'telegram',
      accountId: input.accountId,
      peerId: input.peerId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
    },
    markerPrefix: input.cronId,
    dryRunSupported: true,
    approvalRequired: true,
    policyAssertions: [
      {
        id: 'manage-cron-exposed',
        description: 'Agent exposes manage_cron before scheduled-work evidence is accepted.',
        required: true,
      },
      {
        id: 'dispatch-bound-delivery',
        description: 'Dynamic cron creation binds delivery to the active dispatch context, not model-supplied targets.',
        required: true,
      },
      {
        id: 'temp-workspace-only',
        description: 'The gate copies agent config into a temporary workspace and uses an isolated dynamic cron store.',
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
    ],
    cleanupChecks: [
      {
        id: 'dynamic-cron-deleted',
        description: 'The temporary dynamic cron is deleted before the gate returns.',
        required: true,
      },
      {
        id: 'source-config-unchanged',
        description: 'The source agent.yml remains byte-for-byte unchanged.',
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
    id: SCHEDULED_WORK_GATE_ID,
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
