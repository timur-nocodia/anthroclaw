/**
 * SummaryDAG — hierarchical compaction graph backed by SQLite.
 *
 * Each node summarises either raw messages (source_type='messages', depth 0/1)
 * or other nodes (source_type='nodes', depth 2+). Edges point from a summary
 * node to its sources, forming a DAG.
 *
 * Depth semantics:
 *   D0 — leaf summaries of raw messages (minutes timescale)
 *   D1 — condensation of D0 nodes (hours)
 *   D2 — condensation of D1 nodes (days)
 *   D3+ — further condensation (weeks/months)
 *
 * Lossless drill-down invariant: every summary node must be able to recover
 * all of its leaf message store_ids via collectLeafMessageIds().
 *
 * NOTE: T7 will move requiresLikeFallback/escapeLike to search-query.ts.
 * Keep them non-exported for now so the refactor is non-breaking.
 */

import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { requiresLikeFallback, escapeLike, buildLikeSnippet } from './search-query.js';

// ─── Public interfaces ───────────────────────────────────────────────────────

export interface InboundNode {
  session_id: string;
  depth: number;
  summary: string;
  token_count: number;
  source_token_count: number;
  /** store_ids (numbers) when source_type='messages'; node_ids (strings) when 'nodes' */
  source_ids: (string | number)[];
  source_type: 'messages' | 'nodes';
  /** unix ms */
  earliest_at: number;
  /** unix ms */
  latest_at: number;
  expand_hint?: string;
}

export interface SummaryNode extends InboundNode {
  node_id: string;    // ulid
  created_at: number; // unix ms, set by create()
}

export interface NodeSearchOpts {
  source?: string;
  limit?: number;
  sessionId?: string | null;
  depthMin?: number;
  depthMax?: number;
}

export interface NodeSearchResult {
  node_id: string;
  depth: number;
  snippet: string;
  rank: number;
  ts: number; // latest_at
}

// ─── Internal row type ───────────────────────────────────────────────────────

interface NodeRow {
  node_id: string;
  session_id: string;
  depth: number;
  summary: string;
  token_count: number;
  source_token_count: number;
  source_ids_json: string;
  source_type: 'messages' | 'nodes';
  earliest_at: number;
  latest_at: number;
  created_at: number;
  expand_hint: string | null;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/** Normalise a source value for comparison (empty / null → 'unknown'). */
function normalizeSource(source: string | null | undefined): string {
  const s = (source ?? '').trim();
  return s || 'unknown';
}

// ─── Type alias for prepared statement ───────────────────────────────────────

type Stmt = Database.Statement<unknown[], unknown>;

// ─── SummaryDAG ──────────────────────────────────────────────────────────────

export class SummaryDAG {
  private readonly _db: Database.Database;

  // Prepared statements cached for performance
  private readonly _stmtInsert: Stmt;
  private readonly _stmtGet: Stmt;
  private readonly _stmtNodesAtDepth: Stmt;

  constructor(db: Database.Database) {
    this._db = db;

    this._stmtInsert = db.prepare(`
      INSERT INTO summary_nodes
        (node_id, session_id, depth, summary, token_count, source_token_count,
         source_ids_json, source_type, earliest_at, latest_at, created_at, expand_hint)
      VALUES
        (@node_id, @session_id, @depth, @summary, @token_count, @source_token_count,
         @source_ids_json, @source_type, @earliest_at, @latest_at, @created_at, @expand_hint)
    `);

    this._stmtGet = db.prepare(`
      SELECT node_id, session_id, depth, summary, token_count, source_token_count,
             source_ids_json, source_type, earliest_at, latest_at, created_at, expand_hint
      FROM summary_nodes
      WHERE node_id = ?
    `);

    this._stmtNodesAtDepth = db.prepare(`
      SELECT node_id, session_id, depth, summary, token_count, source_token_count,
             source_ids_json, source_type, earliest_at, latest_at, created_at, expand_hint
      FROM summary_nodes
      WHERE session_id = ? AND depth = ?
      ORDER BY created_at ASC
    `);
  }

  // ─── Write ─────────────────────────────────────────────────────────────────

  /**
   * Insert a new summary node. Returns the assigned node_id (ulid).
   */
  create(node: InboundNode): string {
    const node_id = ulid();
    const created_at = Date.now();

    this._stmtInsert.run({
      node_id,
      session_id: node.session_id,
      depth: node.depth,
      summary: node.summary,
      token_count: node.token_count,
      source_token_count: node.source_token_count,
      source_ids_json: JSON.stringify(node.source_ids),
      source_type: node.source_type,
      earliest_at: node.earliest_at,
      latest_at: node.latest_at,
      created_at,
      expand_hint: node.expand_hint ?? null,
    });

    return node_id;
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  /**
   * Retrieve a single node by node_id, or null if not found.
   */
  get(nodeId: string): SummaryNode | null {
    const row = this._stmtGet.get(nodeId) as NodeRow | undefined;
    return row ? this._rowToNode(row) : null;
  }

  /**
   * Get immediate child nodes of a source_type='nodes' parent.
   * Returns nodes in the same order as source_ids_json.
   * Returns [] for source_type='messages' nodes or unknown nodeId.
   */
  getChildren(nodeId: string): SummaryNode[] {
    const parent = this._stmtGet.get(nodeId) as NodeRow | undefined;
    if (!parent || parent.source_type !== 'nodes') return [];

    const childIds: string[] = JSON.parse(parent.source_ids_json);
    if (childIds.length === 0) return [];

    const placeholders = childIds.map(() => '?').join(',');
    const rows = this._db
      .prepare(
        `SELECT node_id, session_id, depth, summary, token_count, source_token_count,
                source_ids_json, source_type, earliest_at, latest_at, created_at, expand_hint
         FROM summary_nodes WHERE node_id IN (${placeholders})`
      )
      .all(...childIds) as NodeRow[];

    // Return in source_ids_json order
    const byId = new Map(rows.map((r) => [r.node_id, this._rowToNode(r)]));
    return childIds.flatMap((id) => {
      const n = byId.get(id);
      return n ? [n] : [];
    });
  }

  /**
   * Get message store_ids for a source_type='messages' node.
   * Returns [] for source_type='nodes' nodes.
   */
  getSourceMessageIds(nodeId: string): number[] {
    const row = this._stmtGet.get(nodeId) as NodeRow | undefined;
    if (!row || row.source_type !== 'messages') return [];
    const ids: unknown[] = JSON.parse(row.source_ids_json);
    return ids.map((v) => Number(v));
  }

  /**
   * Get all nodes at a given depth in a session, ordered by created_at ASC.
   */
  getNodesAtDepth(sessionId: string, depth: number): SummaryNode[] {
    const rows = this._stmtNodesAtDepth.all(sessionId, depth) as NodeRow[];
    return rows.map((r) => this._rowToNode(r));
  }

  /**
   * Get nodes at depth `d` that do NOT appear in source_ids_json of any
   * node at depth `d+1` in the same session (i.e., not yet condensed).
   */
  getUncondensedAtDepth(sessionId: string, depth: number): SummaryNode[] {
    const rows = this._db
      .prepare(
        `SELECT n.node_id, n.session_id, n.depth, n.summary, n.token_count,
                n.source_token_count, n.source_ids_json, n.source_type,
                n.earliest_at, n.latest_at, n.created_at, n.expand_hint
         FROM summary_nodes n
         WHERE n.session_id = ?
           AND n.depth = ?
           AND NOT EXISTS (
             SELECT 1 FROM summary_nodes parent, json_each(parent.source_ids_json) j
             WHERE parent.session_id = n.session_id
               AND parent.depth = n.depth + 1
               AND parent.source_type = 'nodes'
               AND j.value = n.node_id
           )
         ORDER BY n.created_at ASC`
      )
      .all(sessionId, depth) as NodeRow[];

    return rows.map((r) => this._rowToNode(r));
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  /**
   * Full-text search across summary nodes.
   *
   * Uses FTS5 by default; falls back to LIKE when the query contains CJK
   * characters, emoji, or unbalanced double-quotes.
   *
   * Source-lineage filter: when opts.source is provided, only return nodes
   * whose descendant leaf messages have the matching source.
   *
   * Strategy: run FTS5 / LIKE first, then post-filter by source lineage using
   * a recursive CTE per candidate node (matching Python's get_source_nodes
   * post-filter approach). This avoids building a single super-CTE that
   * can't compose cleanly with FTS5.
   */
  search(query: string, opts: NodeSearchOpts = {}): NodeSearchResult[] {
    if (requiresLikeFallback(query)) {
      return this._searchLike(query, opts);
    }
    return this._searchFts(query, opts);
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  /**
   * Move all nodes from oldSessionId to newSessionId where depth >= minDepth.
   * Returns the count of rows updated.
   */
  reassignSessionNodes(oldSessionId: string, newSessionId: string, minDepth: number): number {
    const result = this._db
      .prepare(
        `UPDATE summary_nodes SET session_id = ?
         WHERE session_id = ? AND depth >= ?`
      )
      .run(newSessionId, oldSessionId, minDepth);

    return result.changes;
  }

  /**
   * Find node_ids that appear in some node's source_ids_json (when
   * source_type='nodes') but don't exist as actual nodes in summary_nodes.
   *
   * Optionally filtered to a single session's parents.
   */
  findOrphans(sessionId?: string): string[] {
    const rows = this._db
      .prepare(
        `SELECT DISTINCT j.value AS missing_id
         FROM summary_nodes parent, json_each(parent.source_ids_json) j
         WHERE parent.source_type = 'nodes'
           AND (? IS NULL OR parent.session_id = ?)
           AND NOT EXISTS (SELECT 1 FROM summary_nodes WHERE node_id = j.value)`
      )
      .all(sessionId ?? null, sessionId ?? null) as Array<{ missing_id: string }>;

    return rows.map((r) => r.missing_id);
  }

  /**
   * Walk the subtree rooted at rootNodeId, returning all descendant node_ids
   * (NOT including the root itself).
   *
   * Uses a recursive CTE traversing source_ids_json where source_type='nodes'.
   * Cycle safety: relies on `UNION` (not `UNION ALL`) for implicit dedup-based
   * termination. T6 lifecycle and T9 engine must never produce DAG cycles.
   */
  walkSubtree(rootNodeId: string): string[] {
    const rows = this._db
      .prepare(
        `WITH RECURSIVE descendants(node_id) AS (
           SELECT j.value
           FROM summary_nodes n, json_each(n.source_ids_json) j
           WHERE n.node_id = ? AND n.source_type = 'nodes'

           UNION

           SELECT j.value
           FROM summary_nodes child, descendants d, json_each(child.source_ids_json) j
           WHERE child.node_id = d.node_id AND child.source_type = 'nodes'
         )
         SELECT node_id FROM descendants`
      )
      .all(rootNodeId) as Array<{ node_id: string }>;

    return rows.map((r) => r.node_id);
  }

  /**
   * CRITICAL for lossless drill-down: walk down the subtree from nodeId
   * until reaching nodes with source_type='messages', then collect all
   * message store_ids. Returns a deduplicated, sorted ASC number array.
   * Cycle safety: relies on `UNION` (not `UNION ALL`) for implicit dedup-based
   * termination. T6 lifecycle and T9 engine must never produce DAG cycles.
   */
  collectLeafMessageIds(nodeId: string): number[] {
    // Check node exists first
    const row = this._stmtGet.get(nodeId) as NodeRow | undefined;
    if (!row) return [];

    const rawRows = this._db
      .prepare(
        `WITH RECURSIVE walk(node_id, source_type, source_ids_json) AS (
           SELECT node_id, source_type, source_ids_json
           FROM summary_nodes
           WHERE node_id = ?

           UNION

           SELECT child.node_id, child.source_type, child.source_ids_json
           FROM summary_nodes child
           JOIN walk parent ON parent.source_type = 'nodes'
             AND child.node_id IN (SELECT j.value FROM json_each(parent.source_ids_json) j)
         )
         SELECT DISTINCT CAST(j.value AS INTEGER) AS store_id
         FROM walk, json_each(walk.source_ids_json) j
         WHERE walk.source_type = 'messages'
         ORDER BY CAST(j.value AS INTEGER)`
      )
      .all(nodeId) as Array<{ store_id: number | string }>;

    return rawRows.map((r) => Number(r.store_id));
  }

  // ─── Private: FTS5 path ───────────────────────────────────────────────────

  private _searchFts(query: string, opts: NodeSearchOpts): NodeSearchResult[] {
    const limit = Math.min(opts.limit ?? 20, 10000);

    const whereClauses: string[] = ['nodes_fts MATCH ?'];
    const args: unknown[] = [query];

    if (opts.sessionId) {
      whereClauses.push('n.session_id = ?');
      args.push(opts.sessionId);
    }

    if (opts.depthMin !== undefined) {
      whereClauses.push('n.depth >= ?');
      args.push(opts.depthMin);
    }

    if (opts.depthMax !== undefined) {
      whereClauses.push('n.depth <= ?');
      args.push(opts.depthMax);
    }

    // We fetch more candidates to allow source-lineage post-filtering
    const fetchLimit = opts.source ? Math.min(limit * 10, 10000) : limit;
    args.push(fetchLimit);

    const sql = `
      SELECT n.node_id, n.depth, n.latest_at,
             snippet(nodes_fts, 0, '>>>', '<<<', '...', 40) AS snippet,
             rank
      FROM nodes_fts
      JOIN summary_nodes n ON n.rowid = nodes_fts.rowid
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY rank ASC
      LIMIT ?
    `;

    let rows: Array<{
      node_id: string;
      depth: number;
      latest_at: number;
      snippet: string;
      rank: number;
    }>;

    try {
      rows = this._db.prepare(sql).all(...args) as typeof rows;
    } catch {
      // FTS5 query parse error → LIKE fallback
      return this._searchLike(query, opts);
    }

    const results: NodeSearchResult[] = [];
    for (const r of rows) {
      if (opts.source && !this._nodeMatchesSource(r.node_id, opts.source)) {
        continue;
      }
      results.push({
        node_id: r.node_id,
        depth: r.depth,
        snippet: r.snippet ?? '',
        rank: r.rank,
        ts: r.latest_at,
      });
    }

    return results.slice(0, limit);
  }

  // ─── Private: LIKE fallback ───────────────────────────────────────────────

  private _searchLike(query: string, opts: NodeSearchOpts): NodeSearchResult[] {
    const limit = Math.min(opts.limit ?? 20, 10000);

    const rawTerms = query.trim().split(/\s+/).filter((t) => t.length > 0);
    if (rawTerms.length === 0) return [];

    const whereClauses: string[] = [];
    const args: unknown[] = [];

    if (opts.sessionId) {
      whereClauses.push('session_id = ?');
      args.push(opts.sessionId);
    }

    if (opts.depthMin !== undefined) {
      whereClauses.push('depth >= ?');
      args.push(opts.depthMin);
    }

    if (opts.depthMax !== undefined) {
      whereClauses.push('depth <= ?');
      args.push(opts.depthMax);
    }

    const likeArgs: unknown[] = [];
    const likeConditions = rawTerms.map((term) => {
      const { pattern } = escapeLike(term);
      likeArgs.push(pattern);
      return "summary LIKE ? ESCAPE '\\'";
    });
    whereClauses.push(`(${likeConditions.join(' OR ')})`);
    args.push(...likeArgs);

    const fetchLimit = opts.source ? Math.min(limit * 10, 10000) : limit * 5;
    args.push(fetchLimit);

    const whereStr = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const sql = `
      SELECT node_id, depth, summary, latest_at
      FROM summary_nodes
      ${whereStr}
      ORDER BY created_at DESC
      LIMIT ?
    `;

    const rows = this._db.prepare(sql).all(...args) as Array<{
      node_id: string;
      depth: number;
      summary: string;
      latest_at: number;
    }>;

    interface ScoredRow {
      node_id: string;
      depth: number;
      latest_at: number;
      snippet: string;
      score: number;
    }

    const scored: ScoredRow[] = [];
    for (const row of rows) {
      if (opts.source && !this._nodeMatchesSource(row.node_id, opts.source)) {
        continue;
      }

      const lowerSummary = row.summary.toLowerCase();
      let score = 0;
      for (const term of rawTerms) {
        const lowerTerm = term.toLowerCase();
        let idx = 0;
        while ((idx = lowerSummary.indexOf(lowerTerm, idx)) >= 0) {
          score++;
          idx += lowerTerm.length;
        }
      }

      if (score <= 0) continue;

      // Build a simple snippet
      const snippet = buildLikeSnippet(row.summary, rawTerms);

      scored.push({ node_id: row.node_id, depth: row.depth, latest_at: row.latest_at, snippet, score });
    }

    // Sort by score descending (higher = better, matches FTS5 convention of lower rank = better)
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((r) => ({
      node_id: r.node_id,
      depth: r.depth,
      snippet: r.snippet,
      rank: -r.score, // negative score so lower rank = more relevant
      ts: r.latest_at,
    }));
  }

  // ─── Private: source-lineage filter ──────────────────────────────────────

  /**
   * Check whether any descendant leaf message of this node has the given
   * source value. Uses a recursive CTE that walks the DAG to message leaves,
   * then JOINs with the messages table.
   *
   * Back-compat: source='unknown' matches m.source = '' OR m.source = 'unknown' OR m.source IS NULL.
   * Cycle safety: relies on `UNION` (not `UNION ALL`) for implicit dedup-based
   * termination. T6 lifecycle and T9 engine must never produce DAG cycles.
   */
  private _nodeMatchesSource(nodeId: string, source: string): boolean {
    if (!source) return true;

    const normalizedSource = normalizeSource(source);

    // Recursive CTE: walk down to message leaves, then join with messages table
    const row = this._db
      .prepare(
        `WITH RECURSIVE source_walk(node_id, source_type, source_ids_json) AS (
           SELECT node_id, source_type, source_ids_json
           FROM summary_nodes
           WHERE node_id = ?

           UNION

           SELECT child.node_id, child.source_type, child.source_ids_json
           FROM summary_nodes child
           JOIN source_walk walk ON walk.source_type = 'nodes'
             AND child.node_id IN (SELECT j.value FROM json_each(walk.source_ids_json) j)
         )
         SELECT 1
         FROM source_walk sw, json_each(sw.source_ids_json) j
         JOIN messages m ON sw.source_type = 'messages'
           AND m.store_id = CAST(j.value AS INTEGER)
         WHERE CASE
                 WHEN ? = 'unknown'
                   THEN (m.source = 'unknown' OR m.source = '' OR m.source IS NULL)
                 ELSE m.source = ?
               END
         LIMIT 1`
      )
      .get(nodeId, normalizedSource, normalizedSource) as unknown;

    return row !== undefined && row !== null;
  }

  // ─── Private: row mapping ─────────────────────────────────────────────────

  private _rowToNode(row: NodeRow): SummaryNode {
    const sourceIds: unknown[] = JSON.parse(row.source_ids_json);
    // Coerce: messages → numbers, nodes → strings (pass through)
    const typedIds: (string | number)[] =
      row.source_type === 'messages'
        ? sourceIds.map((v) => Number(v))
        : sourceIds.map((v) => String(v));

    return {
      node_id: row.node_id,
      session_id: row.session_id,
      depth: row.depth,
      summary: row.summary,
      token_count: row.token_count,
      source_token_count: row.source_token_count,
      source_ids: typedIds,
      source_type: row.source_type,
      earliest_at: row.earliest_at,
      latest_at: row.latest_at,
      created_at: row.created_at,
      expand_hint: row.expand_hint ?? undefined,
    };
  }
}
