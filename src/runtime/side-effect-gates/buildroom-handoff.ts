import { cpSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createBuildroomHandoffTool } from '../../agent/tools/buildroom-handoff.js';
import { createBuildroomSessionSummaryTool } from '../../agent/tools/buildroom-session-summary.js';
import type { BuildroomArtifact } from '../../auto-buildroom/artifacts/model.js';
import { FileArtifactStore } from '../../auto-buildroom/artifacts/store.js';
import { initializeBuildroomStorage } from '../../auto-buildroom/storage/init.js';
import { loadAgentYml } from '../../config/loader.js';
import { ApprovalBroker } from '../../security/approval-broker.js';
import { getProfile } from '../../security/profiles/index.js';
import { createCanUseTool } from '../../sdk/permissions.js';
import {
  validateRuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateValidation,
} from '../side-effect-gate.js';

export const BUILDROOM_HANDOFF_GATE_ID = 'buildroom-handoff';
export const DEFAULT_BUILDROOM_ROOM_ID = 'anthroclaw-core';
export const DEFAULT_BUILDROOM_REQUESTED_ACTION = 'research_only';
export const DEFAULT_BUILDROOM_SUMMARY_NOW = '2026-05-18T07:40:00.000Z';
export const DEFAULT_BUILDROOM_HANDOFF_NOW = '2026-05-18T07:41:00.000Z';

export interface BuildroomHandoffGateInput {
  agentId: string;
  sourceAgentsDir: string;
  workspace: string;
  accountId: string;
  peerId: string;
  senderId: string;
  roomId?: string;
  sourceSessionId?: string;
  requestedAction?: string;
  summaryNow?: string;
  handoffNow?: string;
}

export interface BuildroomHandoffGateResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  gate: {
    id: typeof BUILDROOM_HANDOFF_GATE_ID;
    spec: RuntimeSideEffectGateSpec;
    validation: RuntimeSideEffectGateValidation;
  };
  agentsDir: string;
  projectRoot: string;
  roomId: string;
  peerId: string;
  permissions: {
    buildroomToolsPresent: boolean;
    privateAllowlistIncludesPeer: boolean;
    privateAllowlistSinglePeer: boolean;
    sessionSummaryAllowed: boolean;
    handoffSignalAllowed: boolean;
  };
  summary: {
    submitted: boolean;
    artifactId: string | null;
    sanitized: boolean;
    noRawTranscript: boolean;
    cannotApproveWork: boolean;
    sourceSessionBound: boolean;
    candidateSignals: number;
  };
  handoff: {
    submitted: boolean;
    artifactId: string | null;
    parentLinked: boolean;
    sourceSessionBound: boolean;
    targetBuildroomBound: boolean;
    requestedAction: string | null;
    cannotApprove: boolean;
    cannotBuild: boolean;
  };
  safety: {
    tempOnly: boolean;
    uninitializedFailsClosed: boolean;
    artifactsWritten: number;
  };
  error?: string;
}

type NormalizedBuildroomHandoffGateInput = BuildroomHandoffGateInput & {
  roomId: string;
  sourceSessionId: string;
  requestedAction: string;
  summaryNow: string;
  handoffNow: string;
};

export async function runBuildroomHandoffGate(
  input: BuildroomHandoffGateInput,
): Promise<BuildroomHandoffGateResult> {
  const normalized = normalizeBuildroomHandoffGateInput(input);
  const agentsDir = join(normalized.workspace, 'agents');
  const projectRoot = join(normalized.workspace, 'buildroom-project');
  const uninitializedRoot = join(normalized.workspace, 'uninitialized-buildroom-project');
  const gate = buildBuildroomHandoffGateSpec(normalized);

  if (!gate.validation.ok) {
    throw new Error(`invalid Buildroom handoff gate spec: ${gate.validation.errors.join('; ')}`);
  }

  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(uninitializedRoot, { recursive: true });
  cpSync(join(resolve(normalized.sourceAgentsDir), normalized.agentId), join(agentsDir, normalized.agentId), {
    recursive: true,
  });
  initializeBuildroomStorage({
    projectRoot,
    roomId: normalized.roomId,
    operatorId: `telegram:${normalized.accountId}:${normalized.peerId}`,
  });

  const config = loadAgentYml(join(agentsDir, normalized.agentId));
  const buildroomToolsPresent = [
    'buildroom_submit_session_summary',
    'buildroom_submit_signal',
  ].every((toolName) => (config.mcp_tools ?? []).includes(toolName));
  if (!buildroomToolsPresent) throw new Error(`${normalized.agentId} must expose Buildroom handoff tools.`);

  const allowlist = config.allowlist?.telegram ?? [];
  const privateAllowlistIncludesPeer =
    config.safety_profile === 'private' && allowlist.includes(normalized.peerId);
  const privateAllowlistSinglePeer = privateAllowlistIncludesPeer && allowlist.length === 1;
  if (!privateAllowlistIncludesPeer) {
    throw new Error(`${normalized.agentId} must remain private and allowlisted to the confirmed operator Telegram peer.`);
  }

  const serverName = `${normalized.agentId}-tools`;
  const canUseTool = createCanUseTool({
    agent: {
      id: normalized.agentId,
      config,
      safetyProfile: getProfile(config.safety_profile),
      workspacePath: projectRoot,
    },
    approvalBroker: new ApprovalBroker(),
    sessionContext: {
      channel: 'telegram',
      accountId: normalized.accountId,
      peerId: normalized.peerId,
      senderId: normalized.senderId,
    },
  });
  const sessionSummaryPermission = await canUseTool(
    `mcp__${serverName}__buildroom_submit_session_summary`,
    { user_intent: 'Summarize sanitized operator-lab friction.' },
    { signal: new AbortController().signal, toolUseID: `${normalized.agentId}-buildroom-summary` } as any,
  );
  const handoffPermission = await canUseTool(
    `mcp__${serverName}__buildroom_submit_signal`,
    { signal_type: 'friction', summary: 'Route friction', evidence_summary_id: 'placeholder' },
    { signal: new AbortController().signal, toolUseID: `${normalized.agentId}-buildroom-handoff` } as any,
  );
  if (sessionSummaryPermission.behavior !== 'allow') throw new Error('Buildroom session summary permission was not allowed.');
  if (handoffPermission.behavior !== 'allow') throw new Error('Buildroom handoff signal permission was not allowed.');

  const uninitializedTool = createBuildroomSessionSummaryTool({
    projectRoot: uninitializedRoot,
    roomId: normalized.roomId,
    sourceAgentId: normalized.agentId,
    sourceSessionId: normalized.sourceSessionId,
    now: () => normalized.summaryNow,
  });
  const uninitializedResult = await uninitializedTool.handler({
    user_intent: 'This should fail because Buildroom is not initialized.',
  });
  const uninitializedFailsClosed = uninitializedResult.isError === true &&
    toolText(uninitializedResult).includes('buildroom.yml');

  const summaryTool = createBuildroomSessionSummaryTool({
    projectRoot,
    roomId: normalized.roomId,
    sourceAgentId: normalized.agentId,
    sourceSessionId: normalized.sourceSessionId,
    now: () => normalized.summaryNow,
  });
  const summaryResult = await summaryTool.handler({
    user_intent: `Operator is validating whether ${normalized.agentId} can hand sanitized runtime signals to Buildroom.`,
    observed_friction: [
      'Operator needs a repeatable handoff artifact without granting build authority.',
      'Runtime migration evidence must stay sanitized and linkable.',
    ],
    candidate_signals: [{
      type: 'friction',
      text: 'Buildroom handoff needs explicit no-approval/no-build authority flags.',
      confidence: 'high',
    }],
    evidence_excerpt: `Sanitized excerpt: ${normalized.agentId} Buildroom handoff gate.`,
  });
  assertToolOk(summaryResult, 'Buildroom session summary failed');
  const summaryId = extractArtifactId(toolText(summaryResult), 'Buildroom session summary submitted: ');
  const store = new FileArtifactStore({ projectRoot, roomId: normalized.roomId });
  const summaryArtifact = store.readArtifact(summaryId);

  const handoffTool = createBuildroomHandoffTool({
    projectRoot,
    roomId: normalized.roomId,
    sourceAgentId: normalized.agentId,
    sourceSessionId: normalized.sourceSessionId,
    now: () => normalized.handoffNow,
  });
  const handoffResult = await handoffTool.handler({
    signal_type: 'friction',
    summary: `${normalized.agentId} can submit sanitized Buildroom handoff signals without authority escalation.`,
    evidence_summary_id: summaryId,
    confidence: 'high',
    requested_action: normalized.requestedAction,
  });
  assertToolOk(handoffResult, 'Buildroom handoff signal failed');
  const handoffId = extractArtifactId(toolText(handoffResult), 'Buildroom handoff submitted: ');
  const handoffArtifact = store.readArtifact(handoffId);

  const result: BuildroomHandoffGateResult = {
    status: 'passed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate,
    agentsDir,
    projectRoot,
    roomId: normalized.roomId,
    peerId: normalized.peerId,
    permissions: {
      buildroomToolsPresent,
      privateAllowlistIncludesPeer,
      privateAllowlistSinglePeer,
      sessionSummaryAllowed: sessionSummaryPermission.behavior === 'allow',
      handoffSignalAllowed: handoffPermission.behavior === 'allow',
    },
    summary: {
      submitted: summaryArtifact.type === 'session_summary' && summaryArtifact.status === 'sanitized',
      artifactId: summaryArtifact.id,
      sanitized: summaryArtifact.redaction.rawTranscriptsIncluded === false &&
        summaryArtifact.redaction.secretsRedacted === true,
      noRawTranscript: getNestedBoolean(summaryArtifact, ['payload', 'privacy', 'rawTranscriptIncluded']) === false,
      cannotApproveWork: getNestedBoolean(summaryArtifact, ['payload', 'allowedUse', 'canApproveWork']) === false,
      sourceSessionBound: summaryArtifact.payload.sourceSessionId === normalized.sourceSessionId,
      candidateSignals: getNestedArrayLength(summaryArtifact, ['payload', 'summary', 'candidateSignals']),
    },
    handoff: {
      submitted: handoffArtifact.type === 'handoff_signal' && handoffArtifact.status === 'submitted',
      artifactId: handoffArtifact.id,
      parentLinked: handoffArtifact.parentIds.includes(summaryArtifact.id),
      sourceSessionBound: handoffArtifact.payload.sourceSessionId === normalized.sourceSessionId,
      targetBuildroomBound: handoffArtifact.payload.targetBuildroom === normalized.roomId,
      requestedAction: typeof handoffArtifact.payload.requestedAction === 'string'
        ? handoffArtifact.payload.requestedAction
        : null,
      cannotApprove: getNestedBoolean(handoffArtifact, ['payload', 'authority', 'canApprove']) === false,
      cannotBuild: getNestedBoolean(handoffArtifact, ['payload', 'authority', 'canBuild']) === false,
    },
    safety: {
      tempOnly: true,
      uninitializedFailsClosed,
      artifactsWritten: store.listArtifacts('session_summary').length + store.listArtifacts('handoff_signal').length,
    },
  };
  assertBuildroomHandoffGateResult(result, normalized);
  return result;
}

export function createFailedBuildroomHandoffGateResult(
  input: BuildroomHandoffGateInput,
  error: string,
): BuildroomHandoffGateResult {
  const normalized = normalizeBuildroomHandoffGateInput(input);
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate: buildBuildroomHandoffGateSpec(normalized),
    agentsDir: join(normalized.workspace, 'agents'),
    projectRoot: join(normalized.workspace, 'buildroom-project'),
    roomId: normalized.roomId,
    peerId: normalized.peerId,
    permissions: {
      buildroomToolsPresent: false,
      privateAllowlistIncludesPeer: false,
      privateAllowlistSinglePeer: false,
      sessionSummaryAllowed: false,
      handoffSignalAllowed: false,
    },
    summary: {
      submitted: false,
      artifactId: null,
      sanitized: false,
      noRawTranscript: false,
      cannotApproveWork: false,
      sourceSessionBound: false,
      candidateSignals: 0,
    },
    handoff: {
      submitted: false,
      artifactId: null,
      parentLinked: false,
      sourceSessionBound: false,
      targetBuildroomBound: false,
      requestedAction: null,
      cannotApprove: false,
      cannotBuild: false,
    },
    safety: {
      tempOnly: true,
      uninitializedFailsClosed: false,
      artifactsWritten: 0,
    },
    error,
  };
}

function normalizeBuildroomHandoffGateInput(
  input: BuildroomHandoffGateInput,
): NormalizedBuildroomHandoffGateInput {
  return {
    ...input,
    roomId: input.roomId ?? DEFAULT_BUILDROOM_ROOM_ID,
    sourceSessionId: input.sourceSessionId ??
      `${input.agentId}:telegram:${input.accountId}:${input.peerId}:buildroom-handoff`,
    requestedAction: input.requestedAction ?? DEFAULT_BUILDROOM_REQUESTED_ACTION,
    summaryNow: input.summaryNow ?? DEFAULT_BUILDROOM_SUMMARY_NOW,
    handoffNow: input.handoffNow ?? DEFAULT_BUILDROOM_HANDOFF_NOW,
  };
}

function buildBuildroomHandoffGateSpec(
  input: NormalizedBuildroomHandoffGateInput,
): BuildroomHandoffGateResult['gate'] {
  const spec: RuntimeSideEffectGateSpec = {
    gateId: BUILDROOM_HANDOFF_GATE_ID,
    agentId: input.agentId,
    runtime: 'pi',
    risk: 'operator_only',
    action: 'buildroom.handoff',
    target: {
      channel: 'telegram',
      accountId: input.accountId,
      peerId: input.peerId,
    },
    dryRunSupported: true,
    approvalRequired: true,
    policyAssertions: [
      {
        id: 'buildroom-tools-present',
        description: 'Agent exposes only the Buildroom session summary and handoff tools needed for the gate.',
        required: true,
      },
      {
        id: 'private-allowlist-includes-peer',
        description: 'The source agent is private and allowlisted to the confirmed operator peer.',
        required: true,
      },
      {
        id: 'handoff-is-not-authority',
        description: 'Submitted handoff artifacts cannot approve or build work.',
        required: true,
      },
      {
        id: 'sanitized-summary',
        description: 'Session summary artifact is sanitized and excludes raw transcripts.',
        required: true,
      },
    ],
    expectedEffects: [
      {
        id: 'session-summary-artifact',
        kind: 'buildroom.handoff',
        description: 'A sanitized session_summary artifact is written to temporary Buildroom storage.',
        target: {
          channel: 'none',
        },
        maxCount: 1,
      },
      {
        id: 'handoff-signal-artifact',
        kind: 'buildroom.handoff',
        description: 'A handoff_signal artifact is written to temporary Buildroom storage and linked to the summary.',
        target: {
          channel: 'none',
        },
        maxCount: 1,
      },
    ],
    cleanupChecks: [
      {
        id: 'temp-only-storage',
        description: 'The gate writes artifacts only inside the temporary Buildroom project root.',
        required: true,
      },
      {
        id: 'uninitialized-fails-closed',
        description: 'Buildroom tools fail closed when storage is not initialized.',
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
    id: BUILDROOM_HANDOFF_GATE_ID,
    spec,
    validation: validateRuntimeSideEffectGateSpec(spec),
  };
}

function assertToolOk(
  result: { isError?: boolean; content: Array<{ type: string; text: string }> },
  message: string,
): void {
  if (result.isError) {
    throw new Error(`${message}: ${toolText(result)}`);
  }
}

function toolText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map((item) => item.text).join('\n');
}

function extractArtifactId(text: string, prefix: string): string {
  const line = text.split('\n').find((item) => item.startsWith(prefix));
  const id = line?.slice(prefix.length).trim();
  if (!id) throw new Error(`Could not extract artifact id from tool response: ${text}`);
  return id;
}

function getNestedBoolean(artifact: BuildroomArtifact, path: string[]): boolean | undefined {
  let current: unknown = artifact;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'boolean' ? current : undefined;
}

function getNestedArrayLength(artifact: BuildroomArtifact, path: string[]): number {
  let current: unknown = artifact;
  for (const key of path) {
    if (!current || typeof current !== 'object') return 0;
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current.length : 0;
}

function assertBuildroomHandoffGateResult(
  result: BuildroomHandoffGateResult,
  input: NormalizedBuildroomHandoffGateInput,
): void {
  for (const [section, values] of Object.entries({
    permissions: result.permissions,
    summary: result.summary,
    handoff: result.handoff,
    safety: result.safety,
  })) {
    for (const [key, value] of Object.entries(values)) {
      if (
        key === 'artifactId' ||
        key === 'candidateSignals' ||
        key === 'privateAllowlistSinglePeer' ||
        key === 'requestedAction' ||
        key === 'artifactsWritten'
      ) {
        continue;
      }
      if (value !== true) {
        throw new Error(`Buildroom handoff gate assertion failed: ${section}.${key}`);
      }
    }
  }
  if (!result.summary.artifactId) throw new Error('Missing session summary artifact id.');
  if (!result.handoff.artifactId) throw new Error('Missing handoff artifact id.');
  if (result.summary.candidateSignals !== 1) throw new Error('Expected exactly one candidate signal.');
  if (result.handoff.requestedAction !== input.requestedAction) {
    throw new Error(`Handoff requested action must remain ${input.requestedAction}.`);
  }
  if (result.safety.artifactsWritten !== 2) {
    throw new Error('Expected exactly two Buildroom artifacts in temp storage.');
  }
}
