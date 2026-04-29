import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../../memory/store.js';
import type { LearningActionRecord } from '../types.js';
import { applyMemoryCandidateAction } from '../memory-applier.js';

describe('applyMemoryCandidateAction', () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'anthroclaw-memory-applier-'));
    store = new MemoryStore(join(dir, 'memory.sqlite'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('saves memory candidates as pending by default and preserves provenance', () => {
    const result = applyMemoryCandidateAction({
      memoryStore: store,
      action: makeAction({
        id: 'action-1',
        confidence: 0.7,
        payload: {
          kind: 'preference',
          text: 'The user prefers short implementation summaries.',
          reason: 'Corrected the assistant about final answers.',
        },
      }),
      safetyProfile: 'trusted',
      mode: 'propose',
      agentId: 'agent-a',
      runId: 'run-1',
      traceId: 'trace-1',
      sessionKey: 'telegram:dm:1',
      sdkSessionId: 'sdk-1',
      channel: 'telegram',
      peerHash: 'peer-hash',
      now: () => new Date('2026-04-29T12:00:00.000Z'),
    });

    expect(result).toMatchObject({
      reviewStatus: 'pending',
      autoApproved: false,
    });
    expect(result.entry).toMatchObject({
      source: 'learning_candidate',
      reviewStatus: 'pending',
      provenance: expect.objectContaining({
        runId: 'run-1',
        traceId: 'trace-1',
        sessionKey: 'telegram:dm:1',
        agentId: 'agent-a',
        sdkSessionId: 'sdk-1',
        sourceChannel: 'telegram',
        sourcePeerHash: 'peer-hash',
        metadata: expect.objectContaining({
          actionId: 'action-1',
          kind: 'preference',
          confidence: 0.7,
          mode: 'propose',
          safetyProfile: 'trusted',
        }),
      }),
    });
  });

  it('does not expose pending learning entries to memory search', () => {
    applyMemoryCandidateAction({
      memoryStore: store,
      action: makeAction({
        confidence: 0.7,
        payload: { text: 'UniquePendingLearningNeedle should not be searchable yet.' },
      }),
      safetyProfile: 'private',
      mode: 'propose',
      agentId: 'agent-a',
    });

    expect(store.listMemoryEntries({ reviewStatus: 'pending' })).toHaveLength(1);
    expect(store.textSearch('UniquePendingLearningNeedle', 5)).toHaveLength(0);
  });

  it('auto-approves only high-confidence private auto_private candidates', () => {
    const publicResult = applyMemoryCandidateAction({
      memoryStore: store,
      action: makeAction({
        id: 'public-action',
        confidence: 0.99,
        payload: { text: 'Public agents still need manual memory review.' },
      }),
      safetyProfile: 'public',
      mode: 'auto_private',
      agentId: 'agent-a',
      runId: 'public-run',
    });
    const lowConfidencePrivate = applyMemoryCandidateAction({
      memoryStore: store,
      action: makeAction({
        id: 'low-action',
        confidence: 0.5,
        payload: { text: 'Low confidence private memories stay pending.' },
      }),
      safetyProfile: 'private',
      mode: 'auto_private',
      agentId: 'agent-a',
      runId: 'low-run',
    });
    const highConfidencePrivate = applyMemoryCandidateAction({
      memoryStore: store,
      action: makeAction({
        id: 'high-action',
        confidence: 0.95,
        payload: { text: 'High confidence private memory can be approved.' },
      }),
      safetyProfile: 'private',
      mode: 'auto_private',
      agentId: 'agent-a',
      runId: 'high-run',
    });

    expect(publicResult.reviewStatus).toBe('pending');
    expect(lowConfidencePrivate.reviewStatus).toBe('pending');
    expect(highConfidencePrivate.reviewStatus).toBe('approved');
    expect(store.textSearch('confidence private memory', 5)).toHaveLength(1);
  });
});

function makeAction(overrides: Partial<LearningActionRecord> = {}): LearningActionRecord {
  const now = Date.now();
  return {
    id: 'action',
    reviewId: 'review',
    agentId: 'agent-a',
    actionType: 'memory_candidate',
    status: 'proposed',
    title: 'Memory candidate',
    rationale: '',
    payload: { text: 'Remember this durable learning candidate.' },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
