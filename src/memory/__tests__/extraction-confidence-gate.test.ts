import { describe, expect, it } from 'vitest';
import { storePostRunMemoryCandidates, type ExtractedMemoryCandidate } from '../extraction.js';
import type { MemoryProvider } from '../provider.js';
import type { MemoryEntryRecord, MemoryProvenance } from '../store.js';

/**
 * v1.1.7 introduced confidence-gated auto-approve for post_run_candidate to
 * fix the "pending purgatory" bug where extracted memories accumulated
 * forever and never surfaced in search (textSearch filters
 * review_status='approved'). These tests pin the gate behaviour so future
 * refactors don't silently re-introduce the bug.
 */
function makeFakeProvider(): MemoryProvider & {
  calls: Array<{ path: string; content: string; provenance: MemoryProvenance }>;
} {
  const calls: Array<{ path: string; content: string; provenance: MemoryProvenance }> = [];
  return {
    calls,
    indexFile(path, content, provenance = {}) {
      calls.push({ path, content, provenance });
      const entry: MemoryEntryRecord = {
        id: `entry:${path}`,
        path,
        contentHash: 'fake',
        source: provenance.source ?? 'index',
        reviewStatus: provenance.reviewStatus ?? 'approved',
        provenance,
        createdAt: 0,
        updatedAt: 0,
      };
      return entry;
    },
    getChunks: () => [],
    getAllChunks: () => [],
    removeFile() {},
    textSearch: () => [],
    setEmbedding() {},
    vectorSearch: () => [],
    getMemoryEntry: () => null,
    getMemoryEntryByPath: () => null,
    listMemoryEntries: () => [],
    updateMemoryEntryReview: () => true,
    listTables: () => [],
    close() {},
  } satisfies MemoryProvider & {
    calls: Array<{ path: string; content: string; provenance: MemoryProvenance }>;
  };
}

const baseInput = {
  agentId: 'test-agent',
  runId: 'run-1',
  sessionKey: 'sess:1',
  userText: 'u',
  assistantText: 'a',
};

describe('storePostRunMemoryCandidates — confidence gate', () => {
  it('marks candidates above threshold as approved (searchable immediately)', () => {
    const provider = makeFakeProvider();
    const candidates: ExtractedMemoryCandidate[] = [
      { kind: 'fact', text: 'high-confidence fact', confidence: 0.9 },
    ];

    const result = storePostRunMemoryCandidates(provider, baseInput, candidates, {
      minConfidence: 0.6,
    });

    expect(result.candidates).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].provenance.reviewStatus).toBe('approved');
    expect(provider.calls[0].provenance.source).toBe('post_run_candidate');
  });

  it('drops candidates below threshold entirely (no pending pile-up)', () => {
    const provider = makeFakeProvider();
    const candidates: ExtractedMemoryCandidate[] = [
      { kind: 'note', text: 'weak signal', confidence: 0.3 },
      { kind: 'fact', text: 'strong signal', confidence: 0.8 },
    ];

    const result = storePostRunMemoryCandidates(provider, baseInput, candidates, {
      minConfidence: 0.6,
    });

    expect(result.candidates).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].content).toContain('strong signal');
    expect(provider.calls[0].provenance.reviewStatus).toBe('approved');
  });

  it('treats missing confidence as 0 (drops by default)', () => {
    const provider = makeFakeProvider();
    const candidates: ExtractedMemoryCandidate[] = [
      { kind: 'note', text: 'no confidence given' },
    ];

    const result = storePostRunMemoryCandidates(provider, baseInput, candidates, {
      minConfidence: 0.6,
    });

    expect(result.candidates).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });

  it('requireReview=true stores high-confidence candidates as pending (opt-in legacy)', () => {
    const provider = makeFakeProvider();
    const candidates: ExtractedMemoryCandidate[] = [
      { kind: 'fact', text: 'fact', confidence: 0.95 },
    ];

    storePostRunMemoryCandidates(provider, baseInput, candidates, {
      minConfidence: 0.6,
      requireReview: true,
    });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].provenance.reviewStatus).toBe('pending');
  });

  it('default threshold (0.6) when minConfidence omitted', () => {
    const provider = makeFakeProvider();
    const candidates: ExtractedMemoryCandidate[] = [
      { kind: 'fact', text: 'at threshold', confidence: 0.6 },
      { kind: 'fact', text: 'just below', confidence: 0.59 },
    ];

    storePostRunMemoryCandidates(provider, baseInput, candidates);

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].content).toContain('at threshold');
  });

  it('respects maxCandidates ordering before threshold filter', () => {
    const provider = makeFakeProvider();
    const candidates: ExtractedMemoryCandidate[] = [
      { kind: 'fact', text: 'first',  confidence: 0.9 },
      { kind: 'fact', text: 'second', confidence: 0.9 },
      { kind: 'fact', text: 'third',  confidence: 0.9 },
    ];

    storePostRunMemoryCandidates(provider, baseInput, candidates, {
      minConfidence: 0.6,
      maxCandidates: 2,
    });

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0].content).toContain('first');
    expect(provider.calls[1].content).toContain('second');
  });
});
