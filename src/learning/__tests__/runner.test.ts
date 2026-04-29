import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../../memory/store.js';
import { LearningStore } from '../store.js';
import { runLearningReview } from '../runner.js';
import type { LearningReviewJob } from '../queue.js';

vi.mock('../../sdk/headless-review.js', () => ({
  runHeadlessReview: vi.fn(),
}));

import { runHeadlessReview } from '../../sdk/headless-review.js';

const mockedRunHeadlessReview = runHeadlessReview as unknown as ReturnType<typeof vi.fn>;

describe('runLearningReview', () => {
  let root: string;
  let dataDir: string;
  let workspacePath: string;
  let learningStore: LearningStore;
  let memoryStore: MemoryStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-learning-runner-'));
    dataDir = join(root, 'data');
    workspacePath = join(root, 'agents', 'agent-a');
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(dataDir, 'memory-db'), { recursive: true });
    writeFileSync(join(workspacePath, 'agent.yml'), [
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    peers: ["1"]',
      'learning:',
      '  enabled: true',
      '  mode: propose',
    ].join('\n'));
    learningStore = new LearningStore(join(dataDir, 'learning.sqlite'));
    memoryStore = new MemoryStore(join(dataDir, 'memory-db', 'agent-a.sqlite'));
    mockedRunHeadlessReview.mockReset();
  });

  afterEach(() => {
    learningStore?.close();
    memoryStore?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('persists review actions and artifact records from a headless SDK reviewer result', async () => {
    mockedRunHeadlessReview.mockResolvedValue(JSON.stringify({
      actions: [{
        type: 'memory_candidate',
        confidence: 0.7,
        title: 'Remember concise summaries',
        rationale: 'User corrected the assistant preference.',
        payload: {
          kind: 'preference',
          text: 'The user prefers concise implementation summaries.',
          reason: 'Explicit correction in the latest turn.',
        },
      }],
    }));

    await runLearningReview({
      job: makeJob({
        triggers: ['user_correction'],
        metadata: {
          userText: 'Я говорил, что финал должен быть коротким.',
          assistantText: 'I will provide a detailed summary.',
          channel: 'telegram',
        },
      }),
      agent: makeAgent({ learningMode: 'propose' }),
      dataDir,
      store: learningStore,
      defaultModel: 'claude-sonnet-4-6',
    });

    const reviews = learningStore.listReviews({ agentId: 'agent-a' });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      status: 'completed',
      trigger: 'user_correction',
      mode: 'propose',
    });
    expect(learningStore.listActions({ agentId: 'agent-a' })).toEqual([
      expect.objectContaining({
        actionType: 'memory_candidate',
        status: 'proposed',
        title: 'Remember concise summaries',
      }),
    ]);
    expect(learningStore.listArtifacts({ reviewId: reviews[0].id }).map((artifact) => artifact.kind))
      .toEqual(expect.arrayContaining(['manifest', 'file', 'snippet']));
    expect(mockedRunHeadlessReview).toHaveBeenCalledWith(expect.objectContaining({
      cwd: workspacePath,
      purpose: 'learning review',
      toolDenyMessage: 'Tools disabled for learning review.',
    }));
  });

  it('auto-applies high-confidence private memory actions in auto_private mode', async () => {
    mockedRunHeadlessReview.mockResolvedValue(JSON.stringify({
      actions: [{
        type: 'memory_candidate',
        confidence: 0.95,
        payload: {
          kind: 'constraint',
          text: 'The user requires local plan and checklist files to remain untracked.',
          reason: 'Repeated durable correction.',
        },
      }],
    }));

    await runLearningReview({
      job: makeJob({ triggers: ['user_correction'] }),
      agent: makeAgent({ learningMode: 'auto_private' }),
      dataDir,
      store: learningStore,
    });

    const [action] = learningStore.listActions({ agentId: 'agent-a' });
    expect(action).toMatchObject({
      actionType: 'memory_candidate',
      status: 'applied',
    });
    expect(memoryStore.textSearch('local plan checklist untracked', 5)).toHaveLength(1);
  });

  function makeAgent(input: { learningMode: 'propose' | 'auto_private' }) {
    return {
      id: 'agent-a',
      workspacePath,
      memoryStore,
      config: {
        model: 'claude-sonnet-4-6',
        safety_profile: 'private',
        learning: {
          enabled: true,
          mode: input.learningMode,
          review_interval_turns: 10,
          skill_review_min_tool_calls: 8,
          max_actions_per_review: 8,
          max_input_chars: 24_000,
          artifacts: {
            max_files: 32,
            max_file_bytes: 65_536,
            max_total_bytes: 262_144,
            max_prompt_chars: 24_000,
            max_snippet_chars: 4_000,
          },
        },
      },
    } as any;
  }
});

function makeJob(overrides: Partial<LearningReviewJob> = {}): LearningReviewJob {
  return {
    id: 'job-1',
    agentId: 'agent-a',
    sessionKey: 'telegram:dm:1',
    runId: 'run-1',
    sdkSessionId: 'sdk-1',
    triggers: ['user_correction'],
    createdAt: 1,
    updatedAt: 1,
    coalescedCount: 0,
    metadata: {
      userText: 'Запомни это.',
      assistantText: 'Done.',
      channel: 'telegram',
      peerHash: 'peer-hash',
    },
    ...overrides,
  };
}
