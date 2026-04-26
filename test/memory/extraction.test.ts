import { describe, expect, it, vi } from 'vitest';
import {
  buildPostRunMemoryExtractionPrompt,
  parseMemoryCandidates,
  storePostRunMemoryCandidates,
} from '../../src/memory/extraction.js';
import type { MemoryProvider } from '../../src/memory/provider.js';

function makeProvider(): MemoryProvider {
  return {
    indexFile: vi.fn((path, content, provenance) => ({
      id: `entry:${path}`,
      path,
      contentHash: 'hash',
      source: provenance?.source ?? 'index',
      reviewStatus: provenance?.reviewStatus ?? 'approved',
      provenance: provenance ?? {},
      createdAt: 1000,
      updatedAt: 1000,
    })),
    getChunks: vi.fn(() => []),
    getAllChunks: vi.fn(() => []),
    removeFile: vi.fn(),
    textSearch: vi.fn(() => []),
    setEmbedding: vi.fn(),
    vectorSearch: vi.fn(() => []),
    getMemoryEntry: vi.fn(() => null),
    getMemoryEntryByPath: vi.fn(() => null),
    listMemoryEntries: vi.fn(() => []),
    updateMemoryEntryReview: vi.fn(() => true),
    listTables: vi.fn(() => []),
    close: vi.fn(),
  };
}

describe('post-run memory extraction', () => {
  it('builds a bounded extraction prompt', () => {
    const prompt = buildPostRunMemoryExtractionPrompt({
      agentId: 'agent-1',
      runId: 'run-1',
      sessionKey: 'session-1',
      userText: 'u'.repeat(100),
      assistantText: 'a'.repeat(100),
    }, { maxInputChars: 80, maxCandidates: 3 });

    expect(prompt).toContain('Return strict JSON only');
    expect(prompt).toContain('Maximum candidates: 3');
    expect(prompt).toContain('[truncated]');
  });

  it('parses and normalizes candidate JSON', () => {
    const candidates = parseMemoryCandidates(JSON.stringify({
      candidates: [
        { kind: 'decision', text: 'The team chose SDK-native memory review.', confidence: 0.9 },
        { kind: 'bad', text: 'x' },
      ],
    }));

    expect(candidates).toEqual([{
      kind: 'decision',
      text: 'The team chose SDK-native memory review.',
      confidence: 0.9,
      reason: undefined,
    }]);
  });

  it('stores proposed candidates as pending post-run entries', () => {
    const provider = makeProvider();
    const result = storePostRunMemoryCandidates(provider, {
      agentId: 'agent-1',
      runId: 'run-1',
      sessionKey: 'session-1',
      sdkSessionId: 'sdk-1',
      channel: 'telegram',
      peerHash: 'peer-hash',
      userText: 'hello',
      assistantText: 'answer',
    }, [{
      kind: 'fact',
      text: 'The project codename is Phoenix.',
      confidence: 0.8,
      reason: 'User stated it directly.',
    }], {
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    });

    expect(result.candidates).toHaveLength(1);
    expect(provider.indexFile).toHaveBeenCalledWith(
      'memory/candidates/run-1/2026-01-02T03-04-05-000Z-1-fact.md',
      expect.stringContaining('The project codename is Phoenix.'),
      expect.objectContaining({
        source: 'post_run_candidate',
        reviewStatus: 'pending',
        runId: 'run-1',
        sessionKey: 'session-1',
        agentId: 'agent-1',
        sdkSessionId: 'sdk-1',
        sourceChannel: 'telegram',
        sourcePeerHash: 'peer-hash',
        metadata: expect.objectContaining({
          kind: 'fact',
          confidence: 0.8,
        }),
      }),
    );
  });
});
