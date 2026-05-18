import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createAccessControlTool } from '../../agent/tools/access-control.js';
import { createManageHumanTakeoverTool } from '../../agent/tools/manage-human-takeover.js';
import { createManageOperatorConsoleTool } from '../../agent/tools/manage-operator-console.js';
import { createShowConfigTool } from '../../agent/tools/show-config.js';
import { createConfigAuditLog } from '../../config/audit.js';
import { loadAgentYml } from '../../config/loader.js';
import { createAgentConfigWriter } from '../../config/writer.js';
import { AccessControl } from '../../routing/access.js';
import {
  validateRuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateValidation,
} from '../side-effect-gate.js';

export const ADMIN_CONFIG_GATE_ID = 'admin-config';
export const DEFAULT_ADMIN_CONFIG_PENDING_SENDER_ID = 'admin-config-pending-sender';
export const DEFAULT_ADMIN_CONFIG_UNAUTHORIZED_TARGET_ID = 'unauthorized_agent';

export interface AdminConfigGateInput {
  agentId: string;
  sourceAgentsDir: string;
  workspace: string;
  peerId: string;
  sessionKey: string;
  pendingSenderId?: string;
  unauthorizedTargetId?: string;
}

export interface AdminConfigGateResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  gate: {
    id: typeof ADMIN_CONFIG_GATE_ID;
    spec: RuntimeSideEffectGateSpec;
    validation: RuntimeSideEffectGateValidation;
  };
  agentsDir: string;
  dataDir: string;
  peerId: string;
  permissions: {
    adminToolsPresent: boolean;
    privateAllowlistIncludesPeer: boolean;
    privateAllowlistSinglePeer: boolean;
    selfManageAllowed: boolean;
    crossAgentDenied: boolean;
  };
  config: {
    showConfigRead: boolean;
    operatorConsolePatched: boolean;
    humanTakeoverPatched: boolean;
    auditEntries: number;
    lastModifiedSeen: boolean;
    backupsCreated: number;
    tempOnly: boolean;
  };
  accessControl: {
    pendingListed: boolean;
    approved: boolean;
    approvedListed: boolean;
    revoked: boolean;
    approvedAfterRevoke: number;
    tempOnly: boolean;
  };
  error?: string;
}

type NormalizedAdminConfigGateInput = AdminConfigGateInput & {
  pendingSenderId: string;
  unauthorizedTargetId: string;
};

export async function runAdminConfigGate(input: AdminConfigGateInput): Promise<AdminConfigGateResult> {
  const normalized = normalizeAdminConfigGateInput(input);
  const agentsDir = join(normalized.workspace, 'agents');
  const dataDir = join(normalized.workspace, 'data');
  const auditDir = join(dataDir, 'config-audit');
  const gate = buildAdminConfigGateSpec(normalized);

  if (!gate.validation.ok) {
    throw new Error(`invalid admin/config gate spec: ${gate.validation.errors.join('; ')}`);
  }

  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  cpSync(join(resolve(normalized.sourceAgentsDir), normalized.agentId), join(agentsDir, normalized.agentId), {
    recursive: true,
  });

  const config = loadAgentYml(join(agentsDir, normalized.agentId));
  const adminTools = [
    'access_control',
    'show_config',
    'manage_human_takeover',
    'manage_operator_console',
  ];
  const adminToolsPresent = adminTools.every((toolName) => (config.mcp_tools ?? []).includes(toolName));
  if (!adminToolsPresent) throw new Error(`${normalized.agentId} must expose admin/config tools.`);

  const allowlist = config.allowlist?.telegram ?? [];
  const privateAllowlistIncludesPeer =
    config.safety_profile === 'private' && allowlist.includes(normalized.peerId);
  const privateAllowlistSinglePeer = privateAllowlistIncludesPeer && allowlist.length === 1;
  if (!privateAllowlistIncludesPeer) {
    throw new Error(`${normalized.agentId} must remain private and allowlisted to the confirmed operator Telegram peer.`);
  }

  const auditLog = createConfigAuditLog({ auditDir });
  const writer = createAgentConfigWriter({ agentsDir, auditLog, backupKeep: 5 });
  const canManage = (callerId: string, targetId: string) => callerId === targetId;

  const showConfigTool = createShowConfigTool({
    agentId: normalized.agentId,
    writer,
    auditLog,
    canManage,
  });
  const beforeConfig = parseToolJson(await showConfigTool.handler({
    sections: ['all'],
  }), 'show_config before failed');
  const showConfigRead = beforeConfig.agent_id === normalized.agentId &&
    Boolean(beforeConfig.sections?.notifications) &&
    Boolean(beforeConfig.sections?.human_takeover) &&
    Boolean(beforeConfig.sections?.operator_console);

  const operatorConsoleTool = createManageOperatorConsoleTool({
    agentId: normalized.agentId,
    writer,
    canManage,
    sessionKey: normalized.sessionKey,
  });
  const operatorPatch = parseToolJson(await operatorConsoleTool.handler({
    enabled: true,
    manages: '*',
    capabilities: ['peer_pause', 'delegate', 'escalate'],
  }), 'manage_operator_console patch failed');
  const operatorConsolePatched = operatorPatch.ok === true &&
    operatorPatch.value?.enabled === true &&
    operatorPatch.value?.manages === '*' &&
    Array.isArray(operatorPatch.value?.capabilities) &&
    operatorPatch.value.capabilities.includes('delegate');

  const unauthorized = await operatorConsoleTool.handler({
    target_agent_id: normalized.unauthorizedTargetId,
    enabled: true,
  });
  const crossAgentDenied = unauthorized.isError === true &&
    unauthorized.content.some((item) => item.text.includes('not authorized'));

  const humanTakeoverTool = createManageHumanTakeoverTool({
    agentId: normalized.agentId,
    writer,
    canManage,
    sessionKey: normalized.sessionKey,
  });
  const takeoverPatch = parseToolJson(await humanTakeoverTool.handler({
    enabled: true,
    pause_ttl_minutes: 31,
    channels: ['telegram'],
    notification_throttle_minutes: 3,
  }), 'manage_human_takeover patch failed');
  const humanTakeoverPatched = takeoverPatch.ok === true &&
    takeoverPatch.value?.enabled === true &&
    takeoverPatch.value?.pause_ttl_minutes === 31 &&
    Array.isArray(takeoverPatch.value?.channels) &&
    takeoverPatch.value.channels.includes('telegram');

  const afterConfig = parseToolJson(await showConfigTool.handler({
    sections: ['operator_console', 'human_takeover'],
  }), 'show_config after failed');
  const lastModifiedSeen = afterConfig.last_modified?.by === normalized.agentId &&
    afterConfig.last_modified?.source === 'chat' &&
    ['operator_console', 'human_takeover'].includes(String(afterConfig.last_modified?.section));
  const auditEntries = (await auditLog.readRecent(normalized.agentId, { limit: 10 })).length;
  const backupsCreated = countBackups(normalized.agentId, agentsDir);

  const accessControl = new AccessControl(dataDir);
  accessControl.check(normalized.agentId, normalized.pendingSenderId, 'telegram', { pairing: { mode: 'approve' } });
  const accessTool = createAccessControlTool(normalized.agentId, accessControl);
  const pendingList = await accessTool.handler({ action: 'list_pending' });
  const pendingListed = toolText(pendingList).includes(normalized.pendingSenderId);
  const approveResult = await accessTool.handler({ action: 'approve', sender_id: normalized.pendingSenderId });
  const approved = !approveResult.isError && toolText(approveResult).includes(`Approved: ${normalized.pendingSenderId}`);
  const approvedList = await accessTool.handler({ action: 'list_approved' });
  const approvedListed = toolText(approvedList).includes(normalized.pendingSenderId);
  const revokeResult = await accessTool.handler({ action: 'revoke', sender_id: normalized.pendingSenderId });
  const revoked = !revokeResult.isError && toolText(revokeResult).includes(`Revoked: ${normalized.pendingSenderId}`);
  const approvedAfterRevoke = accessControl.listApproved(normalized.agentId).length;

  const result: AdminConfigGateResult = {
    status: 'passed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate,
    agentsDir,
    dataDir,
    peerId: normalized.peerId,
    permissions: {
      adminToolsPresent,
      privateAllowlistIncludesPeer,
      privateAllowlistSinglePeer,
      selfManageAllowed: operatorConsolePatched && humanTakeoverPatched,
      crossAgentDenied,
    },
    config: {
      showConfigRead,
      operatorConsolePatched,
      humanTakeoverPatched,
      auditEntries,
      lastModifiedSeen,
      backupsCreated,
      tempOnly: true,
    },
    accessControl: {
      pendingListed,
      approved,
      approvedListed,
      revoked,
      approvedAfterRevoke,
      tempOnly: true,
    },
  };
  assertAdminConfigGateResult(result);
  return result;
}

export function createFailedAdminConfigGateResult(
  input: AdminConfigGateInput,
  error: string,
): AdminConfigGateResult {
  const normalized = normalizeAdminConfigGateInput(input);
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate: buildAdminConfigGateSpec(normalized),
    agentsDir: join(normalized.workspace, 'agents'),
    dataDir: join(normalized.workspace, 'data'),
    peerId: normalized.peerId,
    permissions: {
      adminToolsPresent: false,
      privateAllowlistIncludesPeer: false,
      privateAllowlistSinglePeer: false,
      selfManageAllowed: false,
      crossAgentDenied: false,
    },
    config: {
      showConfigRead: false,
      operatorConsolePatched: false,
      humanTakeoverPatched: false,
      auditEntries: 0,
      lastModifiedSeen: false,
      backupsCreated: 0,
      tempOnly: true,
    },
    accessControl: {
      pendingListed: false,
      approved: false,
      approvedListed: false,
      revoked: false,
      approvedAfterRevoke: -1,
      tempOnly: true,
    },
    error,
  };
}

function normalizeAdminConfigGateInput(input: AdminConfigGateInput): NormalizedAdminConfigGateInput {
  return {
    ...input,
    pendingSenderId: input.pendingSenderId ?? DEFAULT_ADMIN_CONFIG_PENDING_SENDER_ID,
    unauthorizedTargetId: input.unauthorizedTargetId ?? DEFAULT_ADMIN_CONFIG_UNAUTHORIZED_TARGET_ID,
  };
}

function buildAdminConfigGateSpec(input: NormalizedAdminConfigGateInput): AdminConfigGateResult['gate'] {
  const spec: RuntimeSideEffectGateSpec = {
    gateId: ADMIN_CONFIG_GATE_ID,
    agentId: input.agentId,
    runtime: 'pi',
    risk: 'operator_only',
    action: 'config.mutate',
    target: {
      channel: 'telegram',
      peerId: input.peerId,
    },
    dryRunSupported: true,
    approvalRequired: true,
    policyAssertions: [
      {
        id: 'admin-tools-present',
        description: 'Agent exposes the admin/config tools required by the gate.',
        required: true,
      },
      {
        id: 'private-allowlist-includes-peer',
        description: 'The source agent is private and allowlisted to the confirmed operator peer.',
        required: true,
      },
      {
        id: 'self-manage-only',
        description: 'Self config mutation is allowed, while cross-agent mutation is denied.',
        required: true,
      },
      {
        id: 'temp-only',
        description: 'Config, audit, backup, and access-control writes happen only in a temporary workspace.',
        required: true,
      },
    ],
    expectedEffects: [
      {
        id: 'operator-console-patch',
        kind: 'config.mutate',
        description: 'Operator-console settings are patched on the temporary agent config.',
        target: { channel: 'none' },
        maxCount: 1,
      },
      {
        id: 'human-takeover-patch',
        kind: 'config.mutate',
        description: 'Human-takeover settings are patched on the temporary agent config.',
        target: { channel: 'none' },
        maxCount: 1,
      },
      {
        id: 'access-control-lifecycle',
        kind: 'config.mutate',
        description: 'A pending sender is approved, listed, and revoked in temporary access-control storage.',
        target: { channel: 'none' },
        maxCount: 1,
      },
    ],
    cleanupChecks: [
      {
        id: 'source-config-unchanged',
        description: 'The gate copies agent config before mutation and never writes to the source agents directory.',
        required: true,
      },
      {
        id: 'access-revoked',
        description: 'Temporary access-control approval is revoked before the gate returns.',
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
    id: ADMIN_CONFIG_GATE_ID,
    spec,
    validation: validateRuntimeSideEffectGateSpec(spec),
  };
}

function parseToolJson(
  result: { isError?: boolean; content: Array<{ type: string; text: string }> },
  message: string,
): Record<string, any> {
  if (result.isError) {
    throw new Error(`${message}: ${toolText(result)}`);
  }
  try {
    return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, any>;
  } catch (err) {
    throw new Error(`${message}: invalid JSON: ${errorMessage(err)}`);
  }
}

function toolText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map((item) => item.text).join('\n');
}

function countBackups(agentId: string, agentsDir: string): number {
  const dir = join(agentsDir, agentId);
  try {
    return readdirSync(dir).filter((name) => name.startsWith('agent.yml.bak-')).length;
  } catch {
    return 0;
  }
}

function assertAdminConfigGateResult(result: AdminConfigGateResult): void {
  for (const [section, values] of Object.entries({
    permissions: result.permissions,
    config: result.config,
    accessControl: result.accessControl,
  })) {
    for (const [key, value] of Object.entries(values)) {
      if (
        key === 'auditEntries' ||
        key === 'backupsCreated' ||
        key === 'privateAllowlistSinglePeer' ||
        key === 'approvedAfterRevoke'
      ) {
        continue;
      }
      if (value !== true) {
        throw new Error(`admin/config gate assertion failed: ${section}.${key}`);
      }
    }
  }
  if (result.config.auditEntries < 2) throw new Error('Expected at least two config audit entries.');
  if (result.config.backupsCreated < 2) throw new Error('Expected config backups for controlled patches.');
  if (result.accessControl.approvedAfterRevoke !== 0) {
    throw new Error('Access control revoke did not clear approved sender.');
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
