import Database from 'better-sqlite3';
import { cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Agent } from '../../agent/agent.js';
import { DecisionStore } from '../../decisions/store.js';
import { LearningStore } from '../../learning/store.js';
import { runLearningReview, type RunLearningReviewParams, type RunLearningReviewResult } from '../../learning/runner.js';
import type { LearningActionRecord } from '../../learning/types.js';
import {
  validateRuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateValidation,
} from '../side-effect-gate.js';

export const LEARNING_PROPOSE_GATE_ID = 'learning-propose';

export interface LearningProposeGateInput {
  agentId: string;
  sourceAgentsDir: string;
  workspace: string;
  dataRoot?: string;
  model?: string;
  authPath?: string;
  modelsPath?: string;
  peerId: string;
  senderId: string;
  sessionKey?: string;
  runId?: string;
  jobId?: string;
  traceId?: string;
  sdkSessionId?: string;
  userText?: string;
  assistantText?: string;
  originMessageId?: string;
  peerHash?: string;
  reviewRunner?: (params: RunLearningReviewParams) => Promise<RunLearningReviewResult | undefined>;
}

export interface LearningActionSummary {
  id: string;
  type: string;
  status: string;
  confidence?: number;
  title: string;
  appliedAt?: number;
}

export interface LearningProposeGateResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  gate: {
    id: typeof LEARNING_PROPOSE_GATE_ID;
    spec: RuntimeSideEffectGateSpec;
    validation: RuntimeSideEffectGateValidation;
  };
  agentsDir: string;
  dataDir: string;
  peerId: string;
  review?: {
    id: string;
    status: string;
    mode: string;
    trigger: string;
    actionCount: number;
  };
  actions: LearningActionSummary[];
  decisions: {
    total: number;
    pending: number;
    approved: number;
    applied: number;
  };
  artifacts: {
    total: number;
    kinds: Record<string, number>;
  };
  memoryWrites: number;
  skillSnapshots: number;
  error?: string;
}

type NormalizedLearningProposeGateInput = LearningProposeGateInput & {
  sessionKey: string;
  runId: string;
  jobId: string;
  traceId: string;
  sdkSessionId: string;
  userText: string;
  assistantText: string;
  originMessageId: string;
  peerHash: string;
  reviewRunner: (params: RunLearningReviewParams) => Promise<RunLearningReviewResult | undefined>;
};

export async function runLearningProposeGate(
  input: LearningProposeGateInput,
): Promise<LearningProposeGateResult> {
  const normalized = normalizeLearningProposeGateInput(input);
  const agentsDir = join(normalized.workspace, 'agents');
  const dataDir = normalized.dataRoot ? resolve(normalized.dataRoot) : join(normalized.workspace, 'data');
  const sourceAgentDir = join(resolve(normalized.sourceAgentsDir), normalized.agentId);
  const targetAgentDir = join(agentsDir, normalized.agentId);
  const gate = buildLearningProposeGateSpec(normalized);

  if (!gate.validation.ok) {
    throw new Error(`invalid learning propose gate spec: ${gate.validation.errors.join('; ')}`);
  }

  cpSync(sourceAgentDir, targetAgentDir, { recursive: true });

  const learningStore = new LearningStore(join(dataDir, 'learning.sqlite'));
  const decisionStore = new DecisionStore(join(dataDir, 'decision-center.sqlite'));
  const agent = await Agent.load(targetAgentDir, dataDir);

  try {
    if (!agent.config.learning.enabled || agent.config.learning.mode !== 'propose') {
      throw new Error(
        `${normalized.agentId} learning must remain enabled in propose mode, got enabled=${agent.config.learning.enabled} mode=${agent.config.learning.mode}.`,
      );
    }

    await normalized.reviewRunner({
      job: {
        id: normalized.jobId,
        agentId: normalized.agentId,
        sessionKey: normalized.sessionKey,
        runId: normalized.runId,
        traceId: normalized.traceId,
        sdkSessionId: normalized.sdkSessionId,
        triggers: ['user_correction'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        coalescedCount: 0,
        metadata: {
          userText: normalized.userText,
          assistantText: normalized.assistantText,
          channel: 'telegram',
          originChannel: 'telegram',
          originAccountId: 'default',
          originPeerId: normalized.peerId,
          originSenderId: normalized.senderId,
          originMessageId: normalized.originMessageId,
          peerHash: normalized.peerHash,
          toolCalls: 0,
          recoveredToolErrors: 0,
          skillOrMemoryActivity: false,
          compressionOrLcmActivity: false,
        },
      },
      agent,
      dataDir,
      store: learningStore,
      decisionStore,
      defaultModel: normalized.model,
      headlessRuntime: {
        runtime: 'pi',
        runtimeOptions: {
          pi: {
            ...(normalized.authPath ? { authStoragePath: normalized.authPath } : {}),
            ...(normalized.modelsPath ? { modelsPath: normalized.modelsPath } : {}),
          },
        },
      },
    });

    const reviews = learningStore.listReviews({ agentId: normalized.agentId, runId: normalized.runId });
    const review = reviews[0];
    if (!review) throw new Error('Learning propose gate did not persist a review.');
    if (review.status !== 'completed') throw new Error(`Learning propose gate review status is ${review.status}, expected completed.`);
    if (review.mode !== 'propose') throw new Error(`Learning propose gate review mode is ${review.mode}, expected propose.`);

    const actions = learningStore.listActions({ agentId: normalized.agentId });
    assertProposedActions(actions);

    const decisions = decisionStore.listDecisions({ agentId: normalized.agentId });
    assertDecisionStatuses(decisions);

    const artifacts = learningStore.listArtifacts({ reviewId: review.id });
    if (artifacts.length === 0) throw new Error('Learning propose gate did not persist learning artifacts.');

    const memoryWrites = countMemoryEntries(join(dataDir, 'memory-db', `${normalized.agentId}.sqlite`));
    const skillSnapshots = learningStore.listSkillSnapshots({ agentId: normalized.agentId }).length;
    if (memoryWrites !== 0) {
      throw new Error(`Learning propose gate wrote ${memoryWrites} memory entr${memoryWrites === 1 ? 'y' : 'ies'} without approval.`);
    }
    if (skillSnapshots !== 0) {
      throw new Error(`Learning propose gate created ${skillSnapshots} skill snapshot(s) without approval.`);
    }

    return {
      status: 'passed',
      runtime: 'pi',
      agentId: normalized.agentId,
      gate,
      agentsDir,
      dataDir,
      peerId: normalized.peerId,
      review: {
        id: review.id,
        status: review.status,
        mode: review.mode,
        trigger: review.trigger,
        actionCount: actions.length,
      },
      actions: summarizeActions(actions),
      decisions: {
        total: decisions.length,
        pending: decisions.filter((decision) => decision.status === 'pending').length,
        approved: decisions.filter((decision) => decision.status === 'approved').length,
        applied: decisions.filter((decision) => decision.status === 'applied').length,
      },
      artifacts: {
        total: artifacts.length,
        kinds: countBy(artifacts.map((artifact) => artifact.kind)),
      },
      memoryWrites,
      skillSnapshots,
    };
  } finally {
    agent.memoryStore.close();
    learningStore.close();
    decisionStore.close();
  }
}

export function createFailedLearningProposeGateResult(
  input: LearningProposeGateInput,
  error: string,
): LearningProposeGateResult {
  const normalized = normalizeLearningProposeGateInput(input);
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate: buildLearningProposeGateSpec(normalized),
    agentsDir: join(normalized.workspace, 'agents'),
    dataDir: normalized.dataRoot ? resolve(normalized.dataRoot) : join(normalized.workspace, 'data'),
    peerId: normalized.peerId,
    actions: [],
    decisions: { total: 0, pending: 0, approved: 0, applied: 0 },
    artifacts: { total: 0, kinds: {} },
    memoryWrites: 0,
    skillSnapshots: 0,
    error,
  };
}

function normalizeLearningProposeGateInput(input: LearningProposeGateInput): NormalizedLearningProposeGateInput {
  const sessionKey = input.sessionKey ?? `${input.agentId}:telegram:dm:${input.peerId}`;
  const runId = input.runId ?? `${input.agentId}:learning-propose-gate-run`;
  return {
    ...input,
    sessionKey,
    runId,
    jobId: input.jobId ?? `${input.agentId}:learning-propose-gate-job`,
    traceId: input.traceId ?? `${input.agentId}:learning-propose-gate-trace`,
    sdkSessionId: input.sdkSessionId ?? `${input.agentId}:learning-propose-gate-sdk-session`,
    userText: input.userText ?? [
      `Record a durable operator preference for ${input.agentId}.`,
      'Final engineering answers should stay concise: what changed, how it was checked, and the next gate.',
      'This is a standing preference, not a one-off request.',
    ].join('\n'),
    assistantText: input.assistantText ?? 'Acknowledged. Future summaries will stay concise and include verification plus the next gate.',
    originMessageId: input.originMessageId ?? `${input.agentId}:learning-propose-gate-message`,
    peerHash: input.peerHash ?? `${input.agentId}:learning-propose-gate-peer-hash`,
    reviewRunner: input.reviewRunner ?? runLearningReview,
  };
}

function buildLearningProposeGateSpec(input: NormalizedLearningProposeGateInput): LearningProposeGateResult['gate'] {
  const spec: RuntimeSideEffectGateSpec = {
    gateId: LEARNING_PROPOSE_GATE_ID,
    agentId: input.agentId,
    runtime: 'pi',
    risk: 'operator_only',
    action: 'memory.write',
    target: {
      channel: 'telegram',
      peerId: input.peerId,
    },
    dryRunSupported: true,
    approvalRequired: true,
    policyAssertions: [
      {
        id: 'propose-mode',
        description: 'Learning is enabled in propose mode, so learning actions require review before application.',
        required: true,
      },
      {
        id: 'pending-decisions-only',
        description: 'Generated learning decisions remain pending and are not approved or applied automatically.',
        required: true,
      },
      {
        id: 'no-unapproved-memory-write',
        description: 'The gate must not write durable memory entries without operator approval.',
        required: true,
      },
      {
        id: 'no-unapproved-skill-snapshot',
        description: 'The gate must not create skill snapshots without operator approval.',
        required: true,
      },
    ],
    expectedEffects: [
      {
        id: 'learning-review',
        kind: 'memory.write',
        description: 'A learning review record and artifacts are persisted for operator review.',
        target: { channel: 'none' },
        maxCount: 1,
      },
      {
        id: 'pending-decision',
        kind: 'memory.write',
        description: 'Proposed learning actions create pending decisions only.',
        target: { channel: 'none' },
      },
    ],
    cleanupChecks: [
      {
        id: 'no-memory-entries',
        description: 'No durable memory entries are applied by the propose-only gate.',
        required: true,
      },
      {
        id: 'no-skill-snapshots',
        description: 'No skill snapshots are applied by the propose-only gate.',
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
    id: LEARNING_PROPOSE_GATE_ID,
    spec,
    validation: validateRuntimeSideEffectGateSpec(spec),
  };
}

function assertProposedActions(actions: LearningActionRecord[]): void {
  if (actions.length === 0) {
    throw new Error('Learning propose gate persisted no learning actions.');
  }
  const unsafe = actions
    .filter((action) => action.status !== 'proposed' || action.appliedAt !== undefined)
    .map((action) => `${action.id}:${action.actionType}:${action.status}:appliedAt=${action.appliedAt ?? 'null'}`);
  if (unsafe.length > 0) {
    throw new Error(`Learning propose gate found non-proposed/applied action(s): ${unsafe.join(', ')}`);
  }
}

function assertDecisionStatuses(decisions: Array<{ id: string; status: string }>): void {
  const unsafe = decisions
    .filter((decision) => decision.status !== 'pending')
    .map((decision) => `${decision.id}:${decision.status}`);
  if (unsafe.length > 0) {
    throw new Error(`Learning propose gate found non-pending decision(s): ${unsafe.join(', ')}`);
  }
}

function summarizeActions(actions: LearningActionRecord[]): LearningActionSummary[] {
  return actions.map((action) => ({
    id: action.id,
    type: action.actionType,
    status: action.status,
    confidence: action.confidence,
    title: action.title,
    appliedAt: action.appliedAt,
  }));
}

function countMemoryEntries(memoryDbPath: string): number {
  const db = new Database(memoryDbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM memory_entries').get() as { count: number };
    return row.count;
  } finally {
    db.close();
  }
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}
