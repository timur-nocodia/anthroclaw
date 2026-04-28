/**
 * MessageStore — immutable append-only SQLite message log with FTS5 search.
 *
 * Immutability is API-level: no `update()` or `delete()` method is exposed.
 * The only controlled mutations are `gcExternalizedToolResult` (content
 * replacement for GC'd tool results) and `setPinned` (boolean flip).
 *
 * FTS5 triggers in schema.sql keep `messages_fts` in sync automatically for
 * both the append path and both controlled mutations.
 */

import type Database from 'better-sqlite3';
import { estimateTokens } from './tokens.js';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface InboundMessage {
  session_id: string;
  /** 'telegram' | 'whatsapp' | 'cli' | 'unknown' (free-form; 'unknown' is the canonical empty value) */
  source: string;
  /** 'user' | 'assistant' | 'tool' | 'system' */
  role: string;
  content: string;
  tool_call_id?: string;
  tool_calls_json?: string;
  tool_name?: string;
  /** unix ms */
  ts: number;
  pinned?: boolean;
}

export interface StoredMessage extends InboundMessage {
  store_id: number;
  token_estimate: number;
  /** narrowed from optional → required */
  pinned: boolean;
}

export interface SearchOpts {
  source?: string;
  sort?: 'relevance' | 'recency' | 'hybrid';
  limit?: number;
  /** Only consider messages with store_id > minStoreId. */
  minStoreId?: number;
  /** Restrict to a session_id (or null = all sessions). */
  sessionId?: string | null;
}

export interface SearchResult {
  store_id: number;
  session_id: string;
  source: string;
  role: string;
  ts: number;
  /** FTS5 snippet() output (or synthetic for LIKE-fallback) */
  snippet: string;
  /** BM25 rank from FTS5 (or synthetic score for LIKE-fallback — lower = more relevant) */
  rank: number;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function normalizeSource(source: string | null | undefined): string {
  const s = (source ?? '').trim();
  return s || 'unknown';
}

/**
 * Detect whether a query should bypass FTS5 and use LIKE fallback.
 * Triggers: CJK characters, emoji, unbalanced double-quotes, or empty/whitespace.
 *
 * NOTE: T7 will move this to search-query.ts. Keep non-exported so refactor is
 * non-breaking.
 */
function requiresLikeFallback(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  // CJK unified ideographs, Hiragana/Katakana, Hangul
  if (/[一-鿿぀-ヿ가-힯]/.test(trimmed)) return true;

  // Emoji (Unicode property; node supports /\p{Emoji}/u)
  if (/\p{Emoji}/u.test(trimmed)) return true;

  // Unbalanced double-quotes
  if (((trimmed.match(/"/g) ?? []).length % 2) === 1) return true;

  return false;
}

/**
 * Escape a single term for use with SQLite LIKE … ESCAPE '\\'.
 * Escapes backslash, percent, underscore.
 *
 * NOTE: T7 will move this to search-query.ts. Keep non-exported.
 */
function escapeLike(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Build a simple snippet from plain content for LIKE-fallback results.
 * Returns up to 120 chars surrounding the first term match.
 */
function buildLikeSnippet(content: string, terms: string[]): string {
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

// ─── Row type for internal mapping ───────────────────────────────────────────

interface MessageRow {
  store_id: number;
  session_id: string;
  source: string;
  role: string;
  content: string;
  tool_call_id: string | null;
  tool_calls_json: string | null;
  tool_name: string | null;
  ts: number;
  token_estimate: number;
  pinned: number; // SQLite 0/1
}

// ─── MessageStore ─────────────────────────────────────────────────────────────

// Alias for the generic statement type used internally
type Stmt = Database.Statement<unknown[], unknown>;

export class MessageStore {
  private readonly _db: Database.Database;

  // Prepared statements cached for performance
  private readonly _stmtInsert: Stmt;
  private readonly _stmtGet: Stmt;
  private readonly _stmtListSession: Stmt;
  private readonly _stmtMaxStoreId: Stmt;
  private readonly _stmtCount: Stmt;
  private readonly _stmtGcUpdate: Stmt;
  private readonly _stmtSetPinned: Stmt;

  constructor(db: Database.Database) {
    this._db = db;

    this._stmtInsert = db.prepare(`
      INSERT INTO messages
        (session_id, source, role, content, tool_call_id, tool_calls_json, tool_name, ts, token_estimate, pinned)
      VALUES
        (@session_id, @source, @role, @content, @tool_call_id, @tool_calls_json, @tool_name, @ts, @token_estimate, @pinned)
    `);

    this._stmtGet = db.prepare(`
      SELECT store_id, session_id, source, role, content, tool_call_id, tool_calls_json, tool_name, ts, token_estimate, pinned
      FROM messages
      WHERE store_id = ?
    `);

    this._stmtListSession = db.prepare(`
      SELECT store_id, session_id, source, role, content, tool_call_id, tool_calls_json, tool_name, ts, token_estimate, pinned
      FROM messages
      WHERE session_id = ?
      ORDER BY store_id ASC
    `);

    this._stmtMaxStoreId = db.prepare(`
      SELECT COALESCE(MAX(store_id), 0) AS v FROM messages
    `);

    this._stmtCount = db.prepare(`
      SELECT COUNT(*) AS v FROM messages WHERE session_id = ?
    `);

    this._stmtGcUpdate = db.prepare(`
      UPDATE messages SET content = ? WHERE store_id = ?
    `);

    this._stmtSetPinned = db.prepare(`
      UPDATE messages SET pinned = ? WHERE store_id = ?
    `);
  }

  // ─── Write ─────────────────────────────────────────────────────────────────

  /** Append a message. Returns the assigned store_id. */
  append(msg: InboundMessage): number {
    const source = normalizeSource(msg.source);
    const tokenEstimate = estimateTokens(msg.content);
    const pinned = msg.pinned ? 1 : 0;

    const result = this._stmtInsert.run({
      session_id: msg.session_id,
      source,
      role: msg.role,
      content: msg.content,
      tool_call_id: msg.tool_call_id ?? null,
      tool_calls_json: msg.tool_calls_json ?? null,
      tool_name: msg.tool_name ?? null,
      ts: msg.ts,
      token_estimate: tokenEstimate,
      pinned,
    });

    return result.lastInsertRowid as number;
  }

  /**
   * Rewrite the content of a previously externalized tool-result row.
   * The schema's `msg_fts_update` trigger automatically syncs FTS5.
   */
  gcExternalizedToolResult(storeId: number, placeholder: string): void {
    this._stmtGcUpdate.run(placeholder, storeId);
  }

  /** Flip the pinned flag. */
  setPinned(storeId: number, pinned: boolean): void {
    this._stmtSetPinned.run(pinned ? 1 : 0, storeId);
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  /** Retrieve a single message by store_id, or null if not found. */
  get(storeId: number): StoredMessage | null {
    const row = this._stmtGet.get(storeId) as MessageRow | undefined;
    return row ? this._rowToMessage(row) : null;
  }

  /**
   * Fetch many messages by store_ids. Result order matches the input order.
   * Missing ids are silently skipped. Duplicate ids in input return duplicate
   * results in the same positions.
   */
  getMany(storeIds: number[]): StoredMessage[] {
    if (storeIds.length === 0) return [];

    const placeholders = storeIds.map(() => '?').join(',');
    const rows = this._db
      .prepare(
        `SELECT store_id, session_id, source, role, content, tool_call_id, tool_calls_json, tool_name, ts, token_estimate, pinned
         FROM messages WHERE store_id IN (${placeholders})`
      )
      .all(...storeIds) as MessageRow[];

    const byId = new Map<number, StoredMessage>(rows.map(r => [r.store_id, this._rowToMessage(r)]));
    return storeIds.flatMap(id => {
      const m = byId.get(id);
      return m ? [m] : [];
    });
  }

  /** All messages for a session, ordered by store_id ASC. */
  listSession(sessionId: string): StoredMessage[] {
    const rows = this._stmtListSession.all(sessionId) as MessageRow[];
    return rows.map(r => this._rowToMessage(r));
  }

  /** MAX(store_id) across all messages; returns 0 if the store is empty. */
  maxStoreId(): number {
    const row = this._stmtMaxStoreId.get() as { v: number };
    return row.v;
  }

  /** Count of messages in a given session. */
  countInSession(sessionId: string): number {
    const row = this._stmtCount.get(sessionId) as { v: number };
    return row.v;
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  /**
   * Full-text search across message content.
   *
   * Uses FTS5 by default; falls back to LIKE when the query contains CJK
   * characters, emoji, or unbalanced double-quotes (those trip FTS5's query
   * parser or produce wrong results with porter stemmer).
   *
   * Sort modes:
   * - 'relevance' (default): BM25 rank ASC (lower = more relevant per FTS5 convention)
   * - 'recency': ts DESC, store_id DESC (newest first, ignores relevance)
   * - 'hybrid': rank ASC, ts DESC — FTS rank as primary, recency as tiebreaker.
   *   This differs from both pure relevance (no ts) and pure recency (no rank),
   *   ensuring a third deterministic ordering that favours highly-relevant recent
   *   messages over highly-relevant old ones when ranks are close.
   */
  search(query: string, opts: SearchOpts = {}): SearchResult[] {
    if (requiresLikeFallback(query)) {
      return this._searchLike(query, opts);
    }
    return this._searchFts(query, opts);
  }

  // ─── Private: FTS5 path ───────────────────────────────────────────────────

  private _searchFts(query: string, opts: SearchOpts): SearchResult[] {
    const limit = Math.min(opts.limit ?? 20, 10000);
    const sort = opts.sort ?? 'relevance';

    const orderBy =
      sort === 'recency'
        ? 'm.ts DESC, m.store_id DESC'
        : sort === 'hybrid'
        ? 'rank ASC, m.ts DESC'  // rank primary, recency as tiebreaker
        : 'rank ASC';            // relevance default

    const whereClauses: string[] = ['messages_fts MATCH ?'];
    const args: unknown[] = [query];

    if (opts.sessionId) {
      whereClauses.push('m.session_id = ?');
      args.push(opts.sessionId);
    }

    if (opts.source !== undefined) {
      const normalized = normalizeSource(opts.source);
      if (normalized === 'unknown') {
        whereClauses.push("(m.source = ? OR (m.source IS NULL OR m.source = ''))");
        args.push('unknown');
      } else {
        whereClauses.push('m.source = ?');
        args.push(normalized);
      }
    }

    if (opts.minStoreId !== undefined) {
      whereClauses.push('m.store_id > ?');
      args.push(opts.minStoreId);
    }

    args.push(limit);

    const sql = `
      SELECT m.store_id, m.session_id, m.source, m.role, m.ts,
             snippet(messages_fts, 0, '>>>', '<<<', '...', 40) AS snippet,
             rank
      FROM messages_fts
      JOIN messages m ON m.store_id = messages_fts.rowid
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ?
    `;

    try {
      const rows = this._db.prepare(sql).all(...args) as Array<{
        store_id: number;
        session_id: string;
        source: string;
        role: string;
        ts: number;
        snippet: string;
        rank: number;
      }>;

      return rows.map(r => ({
        store_id: r.store_id,
        session_id: r.session_id,
        source: normalizeSource(r.source),
        role: r.role,
        ts: r.ts,
        snippet: r.snippet ?? '',
        rank: r.rank,
      }));
    } catch {
      // FTS5 query parse error (e.g., certain operator combinations) → LIKE fallback
      return this._searchLike(query, opts);
    }
  }

  // ─── Private: LIKE fallback path ──────────────────────────────────────────

  private _searchLike(query: string, opts: SearchOpts): SearchResult[] {
    const limit = Math.min(opts.limit ?? 20, 10000);

    // Extract terms (split on whitespace, filter empties)
    const rawTerms = query.trim().split(/\s+/).filter(t => t.length > 0);
    if (rawTerms.length === 0) return [];

    const whereClauses: string[] = [];
    const args: unknown[] = [];

    if (opts.sessionId) {
      whereClauses.push('session_id = ?');
      args.push(opts.sessionId);
    }

    if (opts.source !== undefined) {
      const normalized = normalizeSource(opts.source);
      if (normalized === 'unknown') {
        whereClauses.push("(source = ? OR (source IS NULL OR source = ''))");
        args.push('unknown');
      } else {
        whereClauses.push('source = ?');
        args.push(normalized);
      }
    }

    if (opts.minStoreId !== undefined) {
      whereClauses.push('store_id > ?');
      args.push(opts.minStoreId);
    }

    // OR across all terms
    const likeArgs: unknown[] = [];
    const likeConditions = rawTerms.map(term => {
      likeArgs.push(`%${escapeLike(term)}%`);
      return "content LIKE ? ESCAPE '\\'";
    });
    whereClauses.push(`(${likeConditions.join(' OR ')})`);
    args.push(...likeArgs);

    args.push(limit * 5); // fetch more to score + trim

    const whereStr = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const sql = `
      SELECT store_id, session_id, source, role, content, ts
      FROM messages
      ${whereStr}
      -- ORDER BY store_id DESC makes pre-trim deterministic across runs
      -- and biases toward recent messages (better for our use case).
      ORDER BY store_id DESC
      LIMIT ?
    `;

    const rows = this._db.prepare(sql).all(...args) as Array<{
      store_id: number;
      session_id: string;
      source: string;
      role: string;
      content: string;
      ts: number;
    }>;

    // Score: count matching terms in content (case-insensitive)
    interface ScoredRow {
      store_id: number;
      session_id: string;
      source: string;
      role: string;
      ts: number;
      snippet: string;
      score: number;
    }

    const scored: ScoredRow[] = [];
    for (const row of rows) {
      const lowerContent = row.content.toLowerCase();
      const score = rawTerms.reduce((acc, term) => {
        const lowerTerm = term.toLowerCase();
        let count = 0;
        let idx = 0;
        while ((idx = lowerContent.indexOf(lowerTerm, idx)) >= 0) {
          count++;
          idx += lowerTerm.length;
        }
        return acc + count;
      }, 0);

      if (score <= 0) continue;

      scored.push({
        store_id: row.store_id,
        session_id: row.session_id,
        source: normalizeSource(row.source),
        role: row.role,
        ts: row.ts,
        snippet: buildLikeSnippet(row.content, rawTerms),
        score,
      });
    }

    // Sort: higher score = better → use -score to match FTS5 convention (lower rank = better)
    const sort = opts.sort ?? 'relevance';
    if (sort === 'recency') {
      scored.sort((a, b) => b.ts - a.ts || b.store_id - a.store_id);
    } else if (sort === 'hybrid') {
      scored.sort((a, b) => b.score - a.score || b.ts - a.ts);
    } else {
      // relevance
      scored.sort((a, b) => b.score - a.score);
    }

    return scored.slice(0, limit).map(r => ({
      store_id: r.store_id,
      session_id: r.session_id,
      source: r.source,
      role: r.role,
      ts: r.ts,
      snippet: r.snippet,
      // Synthetic rank: negative score so lower = more relevant (matches FTS5 BM25 convention)
      rank: -r.score,
    }));
  }

  // ─── Private: row mapping ─────────────────────────────────────────────────

  private _rowToMessage(row: MessageRow): StoredMessage {
    return {
      store_id: row.store_id,
      session_id: row.session_id,
      source: normalizeSource(row.source),
      role: row.role,
      content: row.content,
      tool_call_id: row.tool_call_id ?? undefined,
      tool_calls_json: row.tool_calls_json ?? undefined,
      tool_name: row.tool_name ?? undefined,
      ts: row.ts,
      token_estimate: row.token_estimate,
      pinned: row.pinned !== 0,
    };
  }
}
