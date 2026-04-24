import { describe, it, expect } from 'vitest';
import type { SearchResult } from '../../src/memory/store.js';
import { mergeResults } from '../../src/memory/search.js';
import type { MergeOptions } from '../../src/memory/search.js';

function makeResult(path: string, startLine: number, endLine: number, score: number): SearchResult {
  return { path, startLine, endLine, text: `text of ${path}:${startLine}-${endLine}`, score };
}

describe('mergeResults', () => {
  const defaultOpts: MergeOptions = {
    vectorWeight: 0.7,
    textWeight: 0.3,
    maxResults: 10,
    minScore: 0,
  };

  // ─── 1. merges with weights and deduplicates by path+lines ─────
  it('merges with weights and deduplicates by path+lines', () => {
    const vectorResults: SearchResult[] = [
      makeResult('a.md', 0, 10, 0.9),
      makeResult('b.md', 5, 15, 0.6),
    ];
    const textResults: SearchResult[] = [
      makeResult('a.md', 0, 10, 0.8), // duplicate with a.md vector result
      makeResult('c.md', 0, 5, 0.7),
    ];

    const results = mergeResults(vectorResults, textResults, defaultOpts);

    // a.md:0:10 appears in both, should be deduplicated (single entry)
    const aPaths = results.filter((r) => r.path === 'a.md' && r.startLine === 0 && r.endLine === 10);
    expect(aPaths).toHaveLength(1);

    // Its score = 0.9 * 0.7 + 0.8 * 0.3 = 0.63 + 0.24 = 0.87
    expect(aPaths[0].score).toBeCloseTo(0.87, 6);

    // b.md:5:15 only in vector: score = 0.6 * 0.7 + 0 * 0.3 = 0.42
    const bPaths = results.filter((r) => r.path === 'b.md');
    expect(bPaths).toHaveLength(1);
    expect(bPaths[0].score).toBeCloseTo(0.42, 6);

    // c.md:0:5 only in text: score = 0 * 0.7 + 0.7 * 0.3 = 0.21
    const cPaths = results.filter((r) => r.path === 'c.md');
    expect(cPaths).toHaveLength(1);
    expect(cPaths[0].score).toBeCloseTo(0.21, 6);

    // Total 3 unique results
    expect(results).toHaveLength(3);
  });

  // ─── 2. respects maxResults ────────────────────────────────────
  it('respects maxResults', () => {
    const vectorResults: SearchResult[] = [
      makeResult('a.md', 0, 5, 0.9),
      makeResult('b.md', 0, 5, 0.8),
      makeResult('c.md', 0, 5, 0.7),
    ];
    const textResults: SearchResult[] = [
      makeResult('d.md', 0, 5, 0.6),
    ];

    const opts: MergeOptions = { ...defaultOpts, maxResults: 2 };
    const results = mergeResults(vectorResults, textResults, opts);
    expect(results).toHaveLength(2);
  });

  // ─── 3. respects minScore ──────────────────────────────────────
  it('respects minScore', () => {
    const vectorResults: SearchResult[] = [
      makeResult('a.md', 0, 5, 0.9),  // score = 0.9 * 0.7 = 0.63
      makeResult('b.md', 0, 5, 0.1),  // score = 0.1 * 0.7 = 0.07
    ];
    const textResults: SearchResult[] = [];

    const opts: MergeOptions = { ...defaultOpts, minScore: 0.5 };
    const results = mergeResults(vectorResults, textResults, opts);
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('a.md');
  });

  // ─── 4. boosts items found in both result sets ─────────────────
  it('boosts items found in both result sets (score of overlap > non-overlap)', () => {
    // Overlap item has moderate scores in both
    const vectorResults: SearchResult[] = [
      makeResult('overlap.md', 0, 10, 0.5),
      makeResult('vector-only.md', 0, 10, 0.5),
    ];
    const textResults: SearchResult[] = [
      makeResult('overlap.md', 0, 10, 0.5),
      makeResult('text-only.md', 0, 10, 0.5),
    ];

    const results = mergeResults(vectorResults, textResults, defaultOpts);

    const overlapScore = results.find((r) => r.path === 'overlap.md')!.score;
    const vectorOnlyScore = results.find((r) => r.path === 'vector-only.md')!.score;
    const textOnlyScore = results.find((r) => r.path === 'text-only.md')!.score;

    // overlap: 0.5*0.7 + 0.5*0.3 = 0.5
    // vector-only: 0.5*0.7 = 0.35
    // text-only: 0.5*0.3 = 0.15
    expect(overlapScore).toBeGreaterThan(vectorOnlyScore);
    expect(overlapScore).toBeGreaterThan(textOnlyScore);
  });

  // ─── 5. handles empty vector results (text-only) ───────────────
  it('handles empty vector results (text-only)', () => {
    const vectorResults: SearchResult[] = [];
    const textResults: SearchResult[] = [
      makeResult('a.md', 0, 5, 0.8),
      makeResult('b.md', 0, 5, 0.6),
    ];

    const results = mergeResults(vectorResults, textResults, defaultOpts);
    expect(results).toHaveLength(2);
    // text-only: score = 0 * 0.7 + score * 0.3
    expect(results[0].score).toBeCloseTo(0.8 * 0.3, 6);
    expect(results[1].score).toBeCloseTo(0.6 * 0.3, 6);
  });

  // ─── 6. handles empty text results (vector-only) ──────────────
  it('handles empty text results (vector-only)', () => {
    const vectorResults: SearchResult[] = [
      makeResult('a.md', 0, 5, 0.9),
      makeResult('b.md', 0, 5, 0.7),
    ];
    const textResults: SearchResult[] = [];

    const results = mergeResults(vectorResults, textResults, defaultOpts);
    expect(results).toHaveLength(2);
    // vector-only: score = score * 0.7 + 0 * 0.3
    expect(results[0].score).toBeCloseTo(0.9 * 0.7, 6);
    expect(results[1].score).toBeCloseTo(0.7 * 0.7, 6);
  });

  // ─── 7. handles both empty (returns empty) ────────────────────
  it('handles both empty (returns empty)', () => {
    const results = mergeResults([], [], defaultOpts);
    expect(results).toHaveLength(0);
  });
});
