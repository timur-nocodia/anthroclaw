// ─────────────────────────────────────────────────────────────────
// Internal search helpers shared by store.ts (messages) and dag.ts (nodes).
// Currently duplicated; T7 (search-query.ts) will absorb this module
// into a public search-query API and adapt callers accordingly.
//
// Not exported from plugins/lcm/src/index.ts — these are package-internal.
// ─────────────────────────────────────────────────────────────────

const CJK_REGEX = /[一-鿿぀-ヿ가-힯]/;
const EMOJI_REGEX = /\p{Emoji}/u;

/**
 * True if `query` contains characters that the FTS5 porter+unicode61 tokenizer
 * mis-handles, or syntax that would cause an FTS5 parse error.
 *
 * Triggers LIKE-fallback path in MessageStore.search and SummaryDAG.search.
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
 * Escape SQLite LIKE special chars (\, %, _) using \ as the escape char.
 * Caller must use ESCAPE '\' in the LIKE clause.
 */
export function escapeLike(term: string): string {
  return term
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/**
 * Build a contextual snippet (≤ 120 chars centered on first match)
 * for LIKE-fallback search results. Mirrors FTS5 `snippet()` shape.
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
