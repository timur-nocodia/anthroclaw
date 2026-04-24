import { describe, it, expect, vi } from 'vitest';
import { PrefetchCache } from '../../src/memory/prefetch.js';
import type { MemoryStore, SearchResult } from '../../src/memory/store.js';

function makeStore(results: SearchResult[] = []): MemoryStore {
  return {
    textSearch: vi.fn(() => results),
    vectorSearch: vi.fn(() => []),
    indexFile: vi.fn(),
    getChunks: vi.fn(() => []),
    getAllChunks: vi.fn(() => []),
    removeFile: vi.fn(),
    setEmbedding: vi.fn(),
    listTables: vi.fn(() => []),
    close: vi.fn(),
  } as unknown as MemoryStore;
}

describe('PrefetchCache', () => {
  it('extracts keywords from text', () => {
    const cache = new PrefetchCache();
    const keywords = cache.extractKeywords('The quick brown fox jumps over the lazy dog repeatedly');
    expect(keywords.length).toBeGreaterThan(0);
    expect(keywords).toContain('quick');
    expect(keywords).not.toContain('the');
  });

  it('filters out short words and stopwords', () => {
    const cache = new PrefetchCache();
    const keywords = cache.extractKeywords('I am a big data scientist');
    expect(keywords).not.toContain('am');
    expect(keywords).not.toContain('a');
    expect(keywords).toContain('data');
    expect(keywords).toContain('scientist');
  });

  it('prefetches and returns results', async () => {
    const cache = new PrefetchCache();
    const results: SearchResult[] = [
      { path: 'memory/test.md', startLine: 0, endLine: 5, text: 'Test content here', score: 0.9 },
    ];
    const store = makeStore(results);

    await cache.prefetch('session1', 'Testing the memory system works correctly', store);

    const fetched = cache.get('session1');
    expect(fetched).not.toBeNull();
    expect(fetched!).toHaveLength(1);
    expect(fetched![0].path).toBe('memory/test.md');
  });

  it('returns null for unknown session', () => {
    const cache = new PrefetchCache();
    expect(cache.get('unknown')).toBeNull();
  });

  it('invalidates cache for a session', async () => {
    const cache = new PrefetchCache();
    const store = makeStore([
      { path: 'test.md', startLine: 0, endLine: 5, text: 'content', score: 0.8 },
    ]);

    await cache.prefetch('sess1', 'some relevant keyword topic', store);
    expect(cache.get('sess1')).not.toBeNull();

    cache.invalidate('sess1');
    expect(cache.get('sess1')).toBeNull();
  });

  it('discards stale cache when keywords diverge', async () => {
    const cache = new PrefetchCache();
    const store = makeStore([
      { path: 'test.md', startLine: 0, endLine: 5, text: 'content', score: 0.8 },
    ]);

    await cache.prefetch('sess1', 'TypeScript programming language framework', store);

    // Totally unrelated keywords should get null
    const result = cache.get('sess1', ['cooking', 'recipes', 'ingredients', 'baking']);
    expect(result).toBeNull();
  });

  it('returns prefetched results when keywords overlap', async () => {
    const cache = new PrefetchCache();
    const store = makeStore([
      { path: 'test.md', startLine: 0, endLine: 5, text: 'content about typescript', score: 0.8 },
    ]);

    await cache.prefetch('sess1', 'TypeScript programming language framework', store);

    // Overlapping keyword
    const kw = cache.extractKeywords('TypeScript programming language framework');
    const result = cache.get('sess1', kw);
    expect(result).not.toBeNull();
  });

  it('clears all cache', async () => {
    const cache = new PrefetchCache();
    const store = makeStore([
      { path: 'test.md', startLine: 0, endLine: 5, text: 'content', score: 0.8 },
    ]);

    await cache.prefetch('a', 'some keyword topic here', store);
    await cache.prefetch('b', 'another keyword topic here', store);

    cache.clear();
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
  });
});
