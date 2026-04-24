import type { SearchResult } from './store.js';

// ─── Types ────────────────────────────────────────────────────────

export interface MergeOptions {
  vectorWeight: number;   // default 0.7
  textWeight: number;     // default 0.3
  maxResults: number;
  minScore: number;
}

// ─── Hybrid Merge ─────────────────────────────────────────────────

interface MergedEntry {
  result: SearchResult;
  vScore: number;
  tScore: number;
}

function makeKey(r: SearchResult): string {
  return `${r.path}:${r.startLine}:${r.endLine}`;
}

export function mergeResults(
  vectorResults: SearchResult[],
  textResults: SearchResult[],
  opts: MergeOptions,
): SearchResult[] {
  const map = new Map<string, MergedEntry>();

  // 1-2. Add vector results
  for (const r of vectorResults) {
    const key = makeKey(r);
    map.set(key, { result: r, vScore: r.score, tScore: 0 });
  }

  // 3. Merge text results
  for (const r of textResults) {
    const key = makeKey(r);
    const existing = map.get(key);
    if (existing) {
      existing.tScore = r.score;
    } else {
      map.set(key, { result: r, vScore: 0, tScore: r.score });
    }
  }

  // 4. Compute final score
  const merged: SearchResult[] = [];
  for (const entry of map.values()) {
    const score = entry.vScore * opts.vectorWeight + entry.tScore * opts.textWeight;
    merged.push({
      ...entry.result,
      score,
    });
  }

  // 5. Filter by minScore
  const filtered = merged.filter((r) => r.score >= opts.minScore);

  // 6. Sort by score descending
  filtered.sort((a, b) => b.score - a.score);

  // 7. Return top maxResults
  return filtered.slice(0, opts.maxResults);
}
