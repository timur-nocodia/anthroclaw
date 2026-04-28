// ─────────────────────────────────────────────────────────────────────────────
// search-query.ts — FTS5 query parser, LIKE-fallback helpers, directness score.
// Ported from hermes-lcm/search_query.py (sanitize_fts5_query,
// compute_directness_score simplified) plus helpers extracted from
// _search-helpers.ts (T5) now absorbed into this module.
// ─────────────────────────────────────────────────────────────────────────────

const CJK_REGEX = /[一-鿿぀-ヿ가-힯]/;
const EMOJI_REGEX = /\p{Emoji}/u;

/**
 * Returns true if `query` has CJK / emoji / unbalanced quotes / empty
 * whitespace that would break or mis-tokenize FTS5 search.
 * Triggers LIKE-fallback path.
 */
export function requiresLikeFallback(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) return true;
  if (CJK_REGEX.test(trimmed)) return true;
  if (EMOJI_REGEX.test(trimmed)) return true;
  // Unbalanced double-quotes confuse FTS5 phrase parsing
  const quoteCount = (trimmed.match(/"/g) ?? []).length;
  if (quoteCount % 2 === 1) return true;
  return false;
}

/**
 * Escape a string for a SQLite LIKE pattern. Escapes `\`, `%`, `_` using `\`
 * as the escape character. Returns the LIKE-ready pattern (already wrapped in
 * `%`s for substring match) and the escape char to use in the `ESCAPE '...'`
 * clause.
 *
 * Example: escapeLike('100%') => { pattern: '%100\\%%', escapeChar: '\\' }
 */
export function escapeLike(query: string): { pattern: string; escapeChar: string } {
  const escaped = query
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  return { pattern: `%${escaped}%`, escapeChar: '\\' };
}

// Characters that are special in FTS5 query syntax
const FTS5_SPECIAL_CHARS = new Set('"()*^-:{}');

/**
 * Sanitize a free-form user query into an FTS5-safe string. Strips dangerous
 * FTS5 syntax operators (`"()*^-:{}`) from unquoted regions while preserving
 * balanced phrase quotes. Empty input → empty output.
 *
 * Mirrors hermes-lcm `sanitize_fts5_query`.
 */
export function parseFtsQuery(query: string): string {
  if (!query) return '';
  const result: string[] = [];
  let inQuote = false;
  let quoteBuffer: string[] = [];
  for (const char of query) {
    if (char === '"') {
      if (inQuote) {
        result.push('"', ...quoteBuffer, '"');
        quoteBuffer = [];
        inQuote = false;
      } else {
        if (result.length && !/\s/.test(result[result.length - 1])) result.push(' ');
        inQuote = true;
        quoteBuffer = [];
      }
      continue;
    }
    if (inQuote) {
      quoteBuffer.push(char);
      continue;
    }
    result.push(FTS5_SPECIAL_CHARS.has(char) ? ' ' : char);
  }
  // Unbalanced final quote — flush buffer with FTS5 chars sanitized
  if (inQuote && quoteBuffer.length) {
    for (const c of quoteBuffer) {
      result.push(FTS5_SPECIAL_CHARS.has(c) ? ' ' : c);
    }
  }
  return result.join('').trim();
}

// Strip ASCII punctuation from token edges for directness scoring
const TOKEN_EDGE_PUNCT = /^[\W_]+|[\W_]+$/g;

/**
 * Compute a "directness" score in [0..1] — how strongly the snippet matches
 * the user's query intent.
 *
 * Algorithm (simplified vs. hermes-lcm's float-valued version):
 *   1. Tokenize query: split on whitespace, lowercase, strip ASCII punctuation
 *      from token edges, drop tokens of length < 2.
 *   2. If no tokens → return 0.
 *   3. Count distinct tokens that appear in `snippet` (case-insensitive substring match).
 *   4. Return `distinctMatches / totalTokens`.
 */
export function computeDirectnessScore(query: string, snippet: string): number {
  const text = (query ?? '').toLowerCase();
  const haystack = (snippet ?? '').toLowerCase();
  if (!text.trim() || !haystack) return 0;
  const tokens = text
    .split(/\s+/)
    .map((t) => t.replace(TOKEN_EDGE_PUNCT, ''))
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return 0;
  const unique = new Set(tokens);
  let matches = 0;
  for (const tok of unique) {
    if (haystack.includes(tok)) matches++;
  }
  return matches / unique.size;
}

/**
 * Build a contextual snippet (≤ 120 chars centered on first match) for
 * LIKE-fallback search results. Mirrors FTS5 `snippet()` shape.
 *
 * @internal — used by MessageStore and SummaryDAG search; not part of T7's
 * public API but lives here because it belongs to the search-query domain.
 */
export function buildLikeSnippet(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 20);
      const end = Math.min(content.length, idx + term.length + 100);
      const prefix = start > 0 ? '...' : '';
      const suffix = end < content.length ? '...' : '';
      return prefix + content.slice(start, end) + suffix;
    }
  }
  return content.slice(0, 120);
}
