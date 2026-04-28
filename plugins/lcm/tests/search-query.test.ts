import { describe, it, expect } from 'vitest';
import {
  requiresLikeFallback,
  escapeLike,
  parseFtsQuery,
  computeDirectnessScore,
  buildLikeSnippet,
} from '../src/search-query.js';

// ─── requiresLikeFallback ────────────────────────────────────────────────────

describe('requiresLikeFallback', () => {
  it('returns true for CJK input', () => {
    expect(requiresLikeFallback('你好')).toBe(true);
  });

  it('returns true for emoji input', () => {
    expect(requiresLikeFallback('hello 👋')).toBe(true);
  });

  it('returns true for unbalanced double-quote', () => {
    expect(requiresLikeFallback('unclosed"')).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(requiresLikeFallback('')).toBe(true);
  });

  it('returns true for whitespace-only string', () => {
    expect(requiresLikeFallback('   ')).toBe(true);
  });

  it('returns false for normal ASCII query', () => {
    expect(requiresLikeFallback('apple banana')).toBe(false);
  });

  it('returns false for balanced quotes', () => {
    expect(requiresLikeFallback('"phrase match" term')).toBe(false);
  });
});

// ─── escapeLike ─────────────────────────────────────────────────────────────

describe('escapeLike', () => {
  it('wraps result with % on both sides', () => {
    const { pattern } = escapeLike('hello');
    expect(pattern).toBe('%hello%');
  });

  it('escapes literal % as \\%', () => {
    const { pattern } = escapeLike('100%');
    expect(pattern).toContain('\\%');
    expect(pattern).toBe('%100\\%%');
  });

  it('escapes literal _ as \\_', () => {
    const { pattern } = escapeLike('some_thing');
    expect(pattern).toBe('%some\\_thing%');
  });

  it('escapes literal \\ as \\\\', () => {
    const { pattern } = escapeLike('C:\\path');
    expect(pattern).toBe('%C:\\\\path%');
  });

  it('returns escapeChar of single backslash', () => {
    const { escapeChar } = escapeLike('anything');
    expect(escapeChar).toBe('\\');
  });

  it('empty string produces pattern %% with escapeChar \\', () => {
    const result = escapeLike('');
    expect(result.pattern).toBe('%%');
    expect(result.escapeChar).toBe('\\');
  });
});

// ─── parseFtsQuery ──────────────────────────────────────────────────────────

describe('parseFtsQuery', () => {
  it('returns empty string for empty input', () => {
    expect(parseFtsQuery('')).toBe('');
  });

  it('strips FTS5 special chars from unquoted region', () => {
    const result = parseFtsQuery('apple()*^-:{}banana');
    // FTS5 specials replaced with spaces; result should contain apple and banana
    expect(result).toContain('apple');
    expect(result).toContain('banana');
    // None of the special chars should remain
    for (const ch of ['(', ')', '*', '^', '-', ':', '{', '}']) {
      expect(result).not.toContain(ch);
    }
  });

  it('preserves balanced quoted phrases', () => {
    const result = parseFtsQuery('word1 "phrase here" word2');
    expect(result).toBe('word1 "phrase here" word2');
  });

  it('strips FTS5 specials inside unbalanced trailing quote', () => {
    // "before "unbalanced — the opening quote is not closed, so its
    // buffer is flushed through the sanitizer
    const result = parseFtsQuery('before "unbalanced');
    expect(result).toContain('before');
    expect(result).toContain('unbalanced');
    // No raw " should survive (the quote was opened but never closed)
    expect(result).not.toContain('"');
  });

  it('is idempotent', () => {
    const inputs = [
      'hello world',
      'apple()*^-:{}banana',
      '"phrase here" other',
      'foo-bar:baz',
    ];
    for (const input of inputs) {
      const once = parseFtsQuery(input);
      const twice = parseFtsQuery(once);
      expect(twice).toBe(once);
    }
  });

  it('passes CJK characters through unchanged', () => {
    const result = parseFtsQuery('你好 world');
    expect(result).toContain('你好');
    expect(result).toContain('world');
  });
});

// ─── computeDirectnessScore ─────────────────────────────────────────────────

describe('computeDirectnessScore', () => {
  it('returns 0 for empty query', () => {
    expect(computeDirectnessScore('', 'some snippet')).toBe(0);
  });

  it('returns 0 for empty snippet', () => {
    expect(computeDirectnessScore('query terms', '')).toBe(0);
  });

  it('returns 1.0 when all distinct query terms appear in snippet (case-insensitive)', () => {
    const score = computeDirectnessScore('apple banana', 'I have Apple and BANANA in stock');
    expect(score).toBe(1.0);
  });

  it('returns 0.5 when half of distinct query terms appear', () => {
    // 2 distinct tokens: "apple", "banana" — only "apple" found in snippet
    const score = computeDirectnessScore('apple banana', 'only apple here');
    expect(score).toBe(0.5);
  });

  it('returns 0 when no query terms appear in snippet', () => {
    const score = computeDirectnessScore('apple banana', 'nothing relevant here');
    expect(score).toBe(0);
  });

  it('repeated tokens in query do not inflate score (uses distinct set)', () => {
    // 'apple apple apple' → 1 distinct token 'apple'
    const scoreRepeated = computeDirectnessScore('apple apple apple', 'apple is here');
    // 'apple' → 1 distinct token
    const scoreOnce = computeDirectnessScore('apple', 'apple is here');
    // Both should be 1.0 since the single distinct token matches
    expect(scoreRepeated).toBe(1.0);
    expect(scoreOnce).toBe(1.0);
    // And they are equal (repetition in query doesn't change denominator)
    expect(scoreRepeated).toBe(scoreOnce);
  });

  it('strips edge punctuation from tokens', () => {
    // Token "(apple)" → stripped to "apple" → length >= 2 → counts
    const score = computeDirectnessScore('(apple)', 'The apple is good');
    expect(score).toBe(1.0);
  });

  it('drops tokens shorter than 2 characters', () => {
    // Query is entirely single-char tokens; after filtering no tokens remain
    const score = computeDirectnessScore('a b c', 'a b c are all here');
    expect(score).toBe(0);
  });
});

// ─── buildLikeSnippet ───────────────────────────────────────────────────────

describe('buildLikeSnippet', () => {
  it('returns a non-empty string when term is found in content', () => {
    const result = buildLikeSnippet('The quick brown fox jumped over the lazy dog', ['fox']);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('fox');
  });

  it('returns first 120 chars when no term matches', () => {
    const longContent = 'a'.repeat(200);
    const result = buildLikeSnippet(longContent, ['notfound']);
    expect(result.length).toBe(120);
  });

  it('returns empty string (or fallback) for empty content', () => {
    const result = buildLikeSnippet('', ['term']);
    // slice(0, 120) on empty string → ''
    expect(result).toBe('');
  });

  it('adds leading ellipsis when match is not at the start', () => {
    // Put content before the match so start > 0 triggers ellipsis
    const content = 'x'.repeat(30) + 'targetword' + 'y'.repeat(50);
    const result = buildLikeSnippet(content, ['targetword']);
    expect(result).toContain('targetword');
    expect(result.startsWith('...')).toBe(true);
  });
});
