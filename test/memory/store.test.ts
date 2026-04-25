import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '../../src/memory/store.js';
import type { Chunk, SearchResult } from '../../src/memory/store.js';

describe('MemoryStore', () => {
  let tmpDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'memstore-test-'));
    store = new MemoryStore(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── 1. creates tables on init ──────────────────────────────────
  it('creates tables on init', () => {
    const tables = store.listTables();
    expect(tables).toContain('chunks');
    expect(tables).toContain('chunks_fts');
    expect(tables).toContain('memory_entries');
  });

  // ─── 2. indexes and retrieves chunks ────────────────────────────
  it('indexes and retrieves chunks', () => {
    const content = '# Hello\n\nSome markdown content here.';
    const entry = store.indexFile('docs/readme.md', content, {
      source: 'memory_write',
      runId: 'run-1',
      traceId: 'trace-1',
      sessionKey: 'web:agent:session',
    });

    const chunks = store.getChunks('docs/readme.md');
    expect(entry).toMatchObject({
      path: 'docs/readme.md',
      source: 'memory_write',
      reviewStatus: 'approved',
      provenance: {
        runId: 'run-1',
        traceId: 'trace-1',
        sessionKey: 'web:agent:session',
      },
    });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].memoryEntryId).toBe(entry.id);
    expect(chunks[0].path).toBe('docs/readme.md');
    expect(chunks[0].text).toBe(content);
    expect(chunks[0].startLine).toBe(0);
    expect(chunks[0].endLine).toBe(2);
    expect(chunks[0].contentHash).toBeTruthy();
    expect(chunks[0].id).toBeTruthy();
  });

  it('lists and updates memory entry review metadata', () => {
    const entry = store.indexFile('docs/review.md', 'candidate memory', {
      source: 'post_run_candidate',
      reviewStatus: 'pending',
      runId: 'run-2',
    });

    expect(store.getMemoryEntry(entry.id)).toMatchObject({
      id: entry.id,
      path: 'docs/review.md',
      source: 'post_run_candidate',
      reviewStatus: 'pending',
    });
    expect(store.getMemoryEntryByPath('docs/review.md')?.id).toBe(entry.id);
    expect(store.listMemoryEntries({ reviewStatus: 'pending' }).map((item) => item.id)).toEqual([entry.id]);

    expect(store.updateMemoryEntryReview(entry.id, 'rejected', 'stale')).toBe(true);
    expect(store.getMemoryEntry(entry.id)).toMatchObject({
      reviewStatus: 'rejected',
      reviewNote: 'stale',
    });
  });

  // ─── 3. re-indexes on content change ────────────────────────────
  it('re-indexes on content change (old chunks deleted, new ones created)', () => {
    store.indexFile('docs/readme.md', 'original content');
    const before = store.getChunks('docs/readme.md');
    expect(before).toHaveLength(1);
    const oldHash = before[0].contentHash;

    store.indexFile('docs/readme.md', 'updated content that is different');
    const after = store.getChunks('docs/readme.md');
    expect(after).toHaveLength(1);
    expect(after[0].contentHash).not.toBe(oldHash);
    expect(after[0].text).toBe('updated content that is different');
  });

  // ─── 4. deletes chunks when file removed ────────────────────────
  it('deletes chunks when file removed', () => {
    store.indexFile('docs/readme.md', 'some content');
    expect(store.getChunks('docs/readme.md')).toHaveLength(1);

    store.removeFile('docs/readme.md');
    expect(store.getChunks('docs/readme.md')).toHaveLength(0);
  });

  // ─── 5. performs FTS search ─────────────────────────────────────
  it('performs FTS search (index two files, search for term in one)', () => {
    store.indexFile('docs/alpha.md', 'The quick brown fox jumps over the lazy dog.');
    store.indexFile('docs/beta.md', 'TypeScript is a statically typed language.');

    const results = store.textSearch('fox', 10);
    expect(results.length).toBe(1);
    expect(results[0].path).toBe('docs/alpha.md');
    expect(results[0].memoryEntryId).toBeTruthy();
    expect(results[0].text).toContain('fox');
    expect(results[0].score).toBeDefined();
  });

  it('excludes pending and rejected entries from search until approved', () => {
    const pending = store.indexFile('docs/pending.md', 'Durable pending project codename phoenix.', {
      source: 'post_run_candidate',
      reviewStatus: 'pending',
    });
    store.indexFile('docs/approved.md', 'Durable approved project codename falcon.', {
      source: 'memory_write',
      reviewStatus: 'approved',
    });

    expect(store.textSearch('phoenix', 10)).toEqual([]);
    expect(store.textSearch('falcon', 10).map((result) => result.path)).toEqual(['docs/approved.md']);

    store.updateMemoryEntryReview(pending.id, 'approved');
    expect(store.textSearch('phoenix', 10).map((result) => result.path)).toEqual(['docs/pending.md']);
  });

  // ─── 6. chunking: long content gets split ───────────────────────
  it('chunking: long content gets split into multiple chunks', () => {
    // Create content that exceeds maxChars (1600)
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) {
      lines.push(`Line ${i}: ${'x'.repeat(20)}`);
    }
    const longContent = lines.join('\n');
    expect(longContent.length).toBeGreaterThan(1600);

    store.indexFile('docs/long.md', longContent);
    const chunks = store.getChunks('docs/long.md');
    expect(chunks.length).toBeGreaterThan(1);

    // Verify chunks have correct ordering
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startLine).toBeGreaterThanOrEqual(chunks[i - 1].startLine);
    }
  });

  // ─── 7. chunking: short content stays as single chunk ──────────
  it('chunking: short content stays as single chunk', () => {
    const shortContent = 'Just a short note.';
    store.indexFile('docs/short.md', shortContent);

    const chunks = store.getChunks('docs/short.md');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(shortContent);
  });

  // ─── 8. vectorSearch: returns results sorted by similarity ──────
  it('vectorSearch: returns results sorted by similarity (mock embeddings)', () => {
    store.indexFile('docs/a.md', 'Document about cats');
    store.indexFile('docs/b.md', 'Document about dogs');
    store.indexFile('docs/c.md', 'Document about birds');

    const chunksA = store.getChunks('docs/a.md');
    const chunksB = store.getChunks('docs/b.md');
    const chunksC = store.getChunks('docs/c.md');

    // Create mock embeddings: vectors where similarity is controlled
    const embA = new Float32Array([1, 0, 0, 0]);
    const embB = new Float32Array([0.9, 0.1, 0, 0]); // very similar to A
    const embC = new Float32Array([0, 0, 1, 0]); // orthogonal to A

    store.setEmbedding(chunksA[0].id, embA, 'mock-model');
    store.setEmbedding(chunksB[0].id, embB, 'mock-model');
    store.setEmbedding(chunksC[0].id, embC, 'mock-model');

    const queryEmb = new Float32Array([1, 0, 0, 0]); // identical to A
    const results = store.vectorSearch(queryEmb, 3);

    expect(results.length).toBe(3);
    // A should be most similar (exact match), then B (close), then C (orthogonal)
    expect(results[0].path).toBe('docs/a.md');
    expect(results[0].memoryEntryId).toBeTruthy();
    expect(results[1].path).toBe('docs/b.md');
    expect(results[2].path).toBe('docs/c.md');
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[1].score).toBeGreaterThan(results[2].score);
  });

  // ─── 9. setEmbedding stores embedding blob correctly ────────────
  it('setEmbedding stores embedding blob correctly', () => {
    store.indexFile('docs/emb.md', 'Embedding test content');
    const chunks = store.getChunks('docs/emb.md');
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);

    store.setEmbedding(chunks[0].id, embedding, 'text-embedding-3-small');

    // Verify via vectorSearch that the embedding is stored and retrievable
    const results = store.vectorSearch(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]), 1);
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('docs/emb.md');
    expect(results[0].score).toBeCloseTo(1.0, 4); // identical vectors => cosine similarity 1
  });

  // ─── getAllChunks ───────────────────────────────────────────────
  it('getAllChunks returns chunks from all files', () => {
    store.indexFile('a.md', 'aaa');
    store.indexFile('b.md', 'bbb');
    const all = store.getAllChunks();
    expect(all.length).toBe(2);
    const paths = all.map((c) => c.path);
    expect(paths).toContain('a.md');
    expect(paths).toContain('b.md');
  });
});
