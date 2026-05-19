import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunLearningReviewParams, RunLearningReviewResult } from '../../learning/runner.js';
import { runLearningProposeGate } from '../side-effect-gates/learning-propose.js';

describe('learning propose side-effect gate', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-learning-propose-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('exercises propose-only learning controls for an arbitrary agent in an isolated workspace', async () => {
    const agentId = 'custom_learning_agent';
    const peerId = 'peer-learning-42';
    const sourceAgentsDir = join(root, 'source-agents');
    const sourceAgentDir = join(sourceAgentsDir, agentId);
    const workspace = join(root, 'workspace');
    mkdirSync(sourceAgentDir, { recursive: true });
    writeFileSync(join(sourceAgentDir, 'agent.yml'), [
      'model: test-model',
      'runtime:',
      '  headless:',
      '    provider: pi',
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      '    peers: [ "peer-learning-42" ]',
      'allowlist:',
      '  telegram: [ "peer-learning-42" ]',
      'learning:',
      '  enabled: true',
      '  mode: propose',
    ].join('\n'), 'utf8');

    const result = await runLearningProposeGate({
      agentId,
      sourceAgentsDir,
      workspace,
      peerId,
      senderId: 'sender-learning-42',
      sessionKey: `${agentId}:telegram:dm:${peerId}`,
      runId: 'custom-learning-propose-gate-run',
      reviewRunner: fakeLearningReviewRunner,
    });

    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId,
      gate: {
        id: 'learning-propose',
        spec: {
          gateId: 'learning-propose',
          agentId,
          action: 'memory.write',
          target: {
            channel: 'telegram',
            peerId,
          },
        },
        validation: {
          ok: true,
          errors: [],
          warnings: [],
        },
      },
      review: {
        status: 'completed',
        mode: 'propose',
        trigger: 'user_correction',
        actionCount: 1,
      },
      actions: [{
        type: 'memory_candidate',
        status: 'proposed',
        confidence: 0.7,
        title: 'Remember concise final summaries',
      }],
      decisions: {
        total: 1,
        pending: 1,
        approved: 0,
        applied: 0,
      },
      artifacts: {
        total: 1,
        kinds: {
          snippet: 1,
        },
      },
      memoryWrites: 0,
      skillSnapshots: 0,
    });
  });
});

async function fakeLearningReviewRunner(params: RunLearningReviewParams): Promise<RunLearningReviewResult> {
  const review = params.store.createReview({
    agentId: params.agent.id,
    sessionKey: params.job.sessionKey,
    runId: params.job.runId,
    traceId: params.job.traceId,
    sdkSessionId: params.job.sdkSessionId,
    trigger: params.job.triggers[0] ?? 'manual',
    mode: params.agent.config.learning.mode,
    model: params.agent.config.model ?? params.defaultModel,
    input: { triggers: params.job.triggers },
    metadata: params.job.metadata,
  });
  params.store.addArtifact({
    reviewId: review.id,
    agentId: params.agent.id,
    runId: params.job.runId,
    kind: 'snippet',
    path: 'learning-propose-gate-snippet.txt',
    contentHash: 'learning-propose-gate-hash',
    sizeBytes: 42,
    reason: 'fake arbitrary-agent learning gate artifact',
  });
  const action = params.store.addAction({
    reviewId: review.id,
    agentId: params.agent.id,
    actionType: 'memory_candidate',
    status: 'proposed',
    confidence: 0.7,
    title: 'Remember concise final summaries',
    rationale: 'Operator asked for concise final summaries.',
    payload: { text: 'Keep final summaries concise.' },
  });
  params.store.completeReview(review.id, {
    status: 'completed',
    output: { actions: 1 },
  });
  const decision = params.decisionStore?.createDecision({
    kind: 'learning_memory',
    scope: 'user',
    actor: 'originating_user',
    agentId: params.agent.id,
    learningActionId: action.id,
    reviewId: review.id,
    subject: action.title,
    body: action.rationale,
    risk: 'low',
    payload: action.payload,
    originChannel: 'telegram',
    originAccountId: 'default',
    originPeerId: String(params.job.metadata.originPeerId ?? ''),
    originSenderId: String(params.job.metadata.originSenderId ?? ''),
    originMessageId: String(params.job.metadata.originMessageId ?? ''),
  });
  return {
    actions: [action],
    decisions: decision ? [decision] : [],
  };
}
