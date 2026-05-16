import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { Agent } from '../agent/agent.js';
import { logger } from '../logger.js';
import { DecisionStore } from '../decisions/store.js';
import type { DecisionChannel, DecisionRecord } from '../decisions/types.js';
import { runHeadlessReview } from '../sdk/headless-review.js';
import type { HeadlessReviewRuntimeConfig } from '../sdk/headless-runtime-config.js';
import type { LearningReviewJob } from './queue.js';
import { exportLearningArtifacts } from './artifacts.js';
import { applyMemoryCandidateAction } from './memory-applier.js';
import { parseLearningReviewOutput, persistLearningReviewResult } from './reviewer.js';
import { buildRubricLearningReviewPrompt } from './rubric.js';
import { expandActiveSkillArtifactFiles } from './skill-artifacts.js';
import { applySkillAction } from './skill-applier.js';
import { LearningStore } from './store.js';
import type { LearningActionRecord } from './types.js';

const MEMORY_AUTO_APPLY_CONFIDENCE = 0.85;
const SKILL_AUTO_APPLY_CONFIDENCE = 0.9;

export interface RunLearningReviewParams {
  job: LearningReviewJob;
  agent: Agent;
  dataDir: string;
  store: LearningStore;
  decisionStore?: DecisionStore;
  defaultModel?: string;
  headlessRuntime?: HeadlessReviewRuntimeConfig;
}

export interface RunLearningReviewResult {
  actions: LearningActionRecord[];
  decisions: DecisionRecord[];
}

export async function runLearningReview(params: RunLearningReviewParams): Promise<RunLearningReviewResult | undefined> {
  const { agent, dataDir, job, store } = params;
  const config = agent.config.learning;
  if (!config.enabled || config.mode === 'off') return;

  const runId = job.runId ?? job.id;
  const createdAt = Date.now();
  const artifacts = exportLearningArtifacts({
    dataDir,
    workspacePath: agent.workspacePath,
    agentId: agent.id,
    runId,
    files: [
      { path: 'agent.yml', reason: 'agent config and learning rollout mode' },
      { path: '.claude/skills/anthroclaw-learning/SKILL.md', reason: 'native learning skill guidance if present' },
      ...expandActiveSkillArtifactFiles({
        workspacePath: agent.workspacePath,
        activeSkills: readMetadataStringArray(job.metadata, 'activeSkills'),
      }),
    ],
    snippets: buildReviewSnippets(job),
    limits: {
      maxFiles: config.artifacts.max_files,
      maxFileBytes: config.artifacts.max_file_bytes,
      maxTotalBytes: config.artifacts.max_total_bytes,
      maxPromptChars: config.artifacts.max_prompt_chars,
      maxSnippetChars: config.artifacts.max_snippet_chars,
    },
    createdAt,
  });

  const review = store.createReview({
    agentId: agent.id,
    sessionKey: job.sessionKey,
    runId,
    traceId: job.traceId,
    sdkSessionId: job.sdkSessionId,
    trigger: job.triggers[0] ?? 'manual',
    mode: config.mode,
    model: agent.config.model ?? params.defaultModel,
    startedAt: createdAt,
    input: {
      triggers: job.triggers,
      manifestPath: toDataRelativePath(dataDir, artifacts.manifestPath),
      coalescedCount: job.coalescedCount,
    },
    metadata: job.metadata,
  });

  persistArtifactManifest(store, {
    reviewId: review.id,
    agentId: agent.id,
    runId,
    dataDir,
    manifestPath: artifacts.manifestPath,
    manifest: artifacts.manifest,
    createdAt,
  });

  try {
    const prompt = buildRubricLearningReviewPrompt({
      agentId: agent.id,
      safetyProfile: agent.config.safety_profile,
      mode: config.mode,
      triggers: job.triggers,
      coalescedCount: job.coalescedCount,
      metadata: job.metadata,
      manifest: artifacts.manifest,
      maxActions: config.max_actions_per_review,
      maxInputChars: config.max_input_chars,
    });
    const raw = await runHeadlessReview({
      prompt,
      model: agent.config.model ?? params.defaultModel ?? 'claude-sonnet-4-6',
      cwd: agent.workspacePath,
      ...params.headlessRuntime,
      runtimeDefaults: {
        model: agent.config.model ?? params.defaultModel,
        cwd: agent.workspacePath,
      },
      purpose: 'learning review',
      toolDenyMessage: 'Tools disabled for learning review.',
    });
    const parsed = parseLearningReviewOutput(raw, {
      maxActions: config.max_actions_per_review,
      maxPayloadChars: config.max_input_chars,
    });
    const actions = persistLearningReviewResult({
      store,
      reviewId: review.id,
      agentId: agent.id,
      result: parsed,
      completedAt: Date.now(),
    });
    const decisions = createLearningActionDecisions({
      decisionStore: params.decisionStore,
      agent,
      actions,
      job,
    });
    autoApplyPrivateActions({
      agent,
      store,
      actions,
      job,
      runId,
    });
    return { actions, decisions };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.completeReview(review.id, {
      status: 'failed',
      completedAt: Date.now(),
      error: message,
    });
    throw err;
  }
}

function createLearningActionDecisions(params: {
  decisionStore?: DecisionStore;
  agent: Agent;
  actions: LearningActionRecord[];
  job: LearningReviewJob;
}): DecisionRecord[] {
  if (!params.decisionStore) return [];
  if (params.agent.config.learning.mode !== 'propose') return [];

  const originChannel = readMetadataString(params.job.metadata, 'originChannel')
    ?? readMetadataString(params.job.metadata, 'channel');
  const originAccountId = readMetadataString(params.job.metadata, 'originAccountId');
  const originPeerId = readMetadataString(params.job.metadata, 'originPeerId');
  const originSenderId = readMetadataString(params.job.metadata, 'originSenderId');
  const originThreadId = readMetadataString(params.job.metadata, 'originThreadId');
  const originMessageId = readMetadataString(params.job.metadata, 'originMessageId');
  const decisions: DecisionRecord[] = [];

  for (const action of params.actions) {
    if (action.actionType === 'none') continue;
    const userScopedMemory = action.actionType === 'memory_candidate'
      && Boolean(originChannel && originAccountId && originPeerId && originSenderId);
    decisions.push(params.decisionStore.createDecision({
      kind: action.actionType === 'memory_candidate' ? 'learning_memory' : 'learning_skill',
      scope: userScopedMemory ? 'user' : 'agent',
      actor: userScopedMemory ? 'originating_user' : 'admin',
      agentId: params.agent.id,
      learningActionId: action.id,
      reviewId: action.reviewId,
      subject: action.title,
      body: action.rationale || summarizeActionPayload(action.payload),
      risk: action.actionType === 'memory_candidate' ? 'low' : 'medium',
      payload: {
        ...action.payload,
        actionType: action.actionType,
        confidence: action.confidence,
      },
      originChannel: userScopedMemory ? originChannel as DecisionChannel : undefined,
      originAccountId: userScopedMemory ? originAccountId : undefined,
      originPeerId: userScopedMemory ? originPeerId : undefined,
      originSenderId: userScopedMemory ? originSenderId : undefined,
      originThreadId: userScopedMemory ? originThreadId : undefined,
      originMessageId: userScopedMemory ? originMessageId : undefined,
      expiresAt: userScopedMemory ? Date.now() + 24 * 60 * 60 * 1000 : undefined,
      createdAt: action.createdAt,
    }));
  }
  return decisions;
}

function buildReviewSnippets(job: LearningReviewJob) {
  const userText = readMetadataString(job.metadata, 'userText');
  const assistantText = readMetadataString(job.metadata, 'assistantText');
  const snippets = [
    userText
      ? {
          id: 'latest-user-message',
          title: 'Latest user message',
          text: userText,
          reason: 'detect durable user corrections, preferences, constraints, or reusable workflow gaps',
        }
      : null,
    assistantText
      ? {
          id: 'latest-assistant-response',
          title: 'Latest assistant response',
          text: assistantText,
          reason: 'compare assistant behavior against user correction and reusable workflow signals',
        }
      : null,
    {
      id: 'learning-job-metadata',
      title: 'Learning job metadata',
      text: JSON.stringify({
        triggers: job.triggers,
        coalescedCount: job.coalescedCount,
        toolCalls: job.metadata.toolCalls,
        recoveredToolErrors: job.metadata.recoveredToolErrors,
        skillOrMemoryActivity: job.metadata.skillOrMemoryActivity,
        compressionOrLcmActivity: job.metadata.compressionOrLcmActivity,
        channel: job.metadata.channel,
      }, null, 2),
      reason: 'explain why this background learning review was triggered',
    },
  ];
  return snippets.filter((snippet): snippet is NonNullable<typeof snippet> => Boolean(snippet));
}

function summarizeActionPayload(payload: Record<string, unknown>): string {
  const text = payload.text;
  if (typeof text === 'string' && text.trim()) return text.trim();
  return JSON.stringify(payload).slice(0, 1000);
}

function autoApplyPrivateActions(params: {
  agent: Agent;
  store: LearningStore;
  actions: LearningActionRecord[];
  job: LearningReviewJob;
  runId: string;
}): void {
  if (params.agent.config.safety_profile !== 'private' || params.agent.config.learning.mode !== 'auto_private') {
    return;
  }

  for (const action of params.actions) {
    if (action.actionType === 'memory_candidate' && (action.confidence ?? 0) >= MEMORY_AUTO_APPLY_CONFIDENCE) {
      try {
        const result = applyMemoryCandidateAction({
          memoryStore: params.agent.memoryStore,
          action,
          safetyProfile: params.agent.config.safety_profile,
          mode: params.agent.config.learning.mode,
          agentId: params.agent.id,
          runId: params.runId,
          traceId: params.job.traceId,
          sessionKey: params.job.sessionKey,
          sdkSessionId: params.job.sdkSessionId,
          channel: readMetadataString(params.job.metadata, 'channel'),
          peerHash: readMetadataString(params.job.metadata, 'peerHash'),
        });
        if (result.autoApproved) {
          params.store.updateActionStatus(action.id, 'applied', { appliedAt: Date.now() });
        }
      } catch (err) {
        params.store.updateActionStatus(action.id, 'failed', {
          updatedAt: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }

    if (
      (action.actionType === 'skill_patch' || action.actionType === 'skill_create' || action.actionType === 'skill_update_full')
      && (action.confidence ?? 0) >= SKILL_AUTO_APPLY_CONFIDENCE
    ) {
      try {
        applySkillAction({
          workspacePath: params.agent.workspacePath,
          learningStore: params.store,
          action,
          safetyProfile: params.agent.config.safety_profile,
          mode: params.agent.config.learning.mode,
          agentId: params.agent.id,
          autoApply: true,
        });
      } catch (err) {
        params.store.updateActionStatus(action.id, 'failed', {
          updatedAt: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
        logger.warn({ err, actionId: action.id, agentId: params.agent.id }, 'Learning auto-apply failed');
      }
    }
  }
}

function persistArtifactManifest(
  store: LearningStore,
  params: {
    reviewId: string;
    agentId: string;
    runId: string;
    dataDir: string;
    manifestPath: string;
    manifest: {
      files: Array<{ artifactPath: string; contentHash: string; sizeBytes: number; reason: string }>;
      snippets: Array<{ artifactPath: string; contentHash: string; sizeBytes: number; reason: string }>;
    };
    createdAt: number;
  },
): void {
  const manifestBody = readFileSync(params.manifestPath, 'utf8');
  store.addArtifact({
    reviewId: params.reviewId,
    agentId: params.agentId,
    runId: params.runId,
    kind: 'manifest',
    path: toDataRelativePath(params.dataDir, params.manifestPath),
    contentHash: sha256(manifestBody),
    sizeBytes: Buffer.byteLength(manifestBody),
    reason: 'learning artifact manifest',
    createdAt: params.createdAt,
  });

  for (const file of params.manifest.files) {
    store.addArtifact({
      reviewId: params.reviewId,
      agentId: params.agentId,
      runId: params.runId,
      kind: 'file',
      path: file.artifactPath,
      contentHash: file.contentHash,
      sizeBytes: file.sizeBytes,
      reason: file.reason,
      createdAt: params.createdAt,
    });
  }

  for (const snippet of params.manifest.snippets) {
    store.addArtifact({
      reviewId: params.reviewId,
      agentId: params.agentId,
      runId: params.runId,
      kind: 'snippet',
      path: snippet.artifactPath,
      contentHash: snippet.contentHash,
      sizeBytes: snippet.sizeBytes,
      reason: snippet.reason,
      createdAt: params.createdAt,
    });
  }
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' ? value : undefined;
}

function readMetadataStringArray(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toDataRelativePath(dataDir: string, path: string): string {
  return relative(dataDir, path).split('\\').join('/');
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
