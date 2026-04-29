import type { MemoryProvider } from '../memory/provider.js';
import type { MemoryEntryRecord, MemoryProvenance, MemoryReviewStatus } from '../memory/store.js';
import { metrics } from '../metrics/collector.js';
import type { LearningActionRecord, LearningMode } from './types.js';

export type LearningApplierSafetyProfile = 'public' | 'trusted' | 'private';

export interface ApplyMemoryCandidateParams {
  memoryStore: MemoryProvider;
  action: LearningActionRecord;
  safetyProfile: LearningApplierSafetyProfile;
  mode: LearningMode;
  agentId: string;
  runId?: string;
  traceId?: string;
  sessionKey?: string;
  sdkSessionId?: string;
  channel?: string;
  peerHash?: string;
  highConfidenceThreshold?: number;
  reviewStatusOverride?: MemoryReviewStatus;
  now?: () => Date;
}

export interface ApplyMemoryCandidateResult {
  entry: MemoryEntryRecord;
  reviewStatus: MemoryReviewStatus;
  autoApproved: boolean;
}

export function applyMemoryCandidateAction(params: ApplyMemoryCandidateParams): ApplyMemoryCandidateResult {
  if (params.action.actionType !== 'memory_candidate') {
    throw new Error(`Cannot apply action type "${params.action.actionType}" as memory_candidate`);
  }

  const text = readPayloadString(params.action.payload, 'text');
  if (!text || text.trim().length < 8) {
    throw new Error('memory_candidate payload.text must be at least 8 characters');
  }

  const kind = sanitizePathPart(readPayloadString(params.action.payload, 'kind') ?? 'note');
  const confidence = typeof params.action.confidence === 'number'
    ? params.action.confidence
    : readPayloadNumber(params.action.payload, 'confidence') ?? 0;
  const threshold = params.highConfidenceThreshold ?? 0.85;
  const autoApproved = params.reviewStatusOverride === undefined
    && params.safetyProfile === 'private'
    && params.mode === 'auto_private'
    && confidence >= threshold;
  const reviewStatus: MemoryReviewStatus = params.reviewStatusOverride ?? (autoApproved ? 'approved' : 'pending');
  const now = params.now?.() ?? new Date();
  const runOrActionId = params.runId ?? params.action.id;
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const path = `memory/learning/${sanitizePathPart(runOrActionId)}/${stamp}-${kind}.md`;
  const reason = readPayloadString(params.action.payload, 'reason') ?? params.action.rationale;
  const content = [
    `# Learning Memory: ${kind}`,
    '',
    text.trim(),
    '',
    '---',
    `confidence: ${confidence}`,
    reason ? `reason: ${reason}` : undefined,
    `review_status: ${reviewStatus}`,
  ].filter(Boolean).join('\n');

  const provenance: MemoryProvenance = {
    source: 'learning_candidate',
    reviewStatus,
    runId: params.runId,
    traceId: params.traceId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    sdkSessionId: params.sdkSessionId,
    sourceChannel: params.channel,
    sourcePeerHash: params.peerHash,
    createdBy: 'learning.memory_applier',
    metadata: {
      actionId: params.action.id,
      actionType: params.action.actionType,
      kind,
      confidence,
      threshold,
      autoApproved,
      mode: params.mode,
      safetyProfile: params.safetyProfile,
      reason,
    },
  };

  const entry = params.memoryStore.indexFile(path, content, provenance);
  if (autoApproved) {
    metrics.increment('learning_actions_auto_applied');
  }
  return { entry, reviewStatus, autoApproved };
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

function readPayloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizePathPart(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'item';
}
