import type Database from 'better-sqlite3';

export interface LifecycleState {
  conversation_id: string;
  current_session_id: string | null;
  last_finalized_session_id: string | null;
  current_frontier_store_id: number | null;
  last_finalized_frontier_id: number | null;
  debt_kind: 'raw_backlog' | null;
  debt_size_estimate: number | null;
  updated_at: number | null;
  reset_at: number | null;
  finalized_at: number | null;
}

type RawRow = {
  conversation_id: string;
  current_session_id: string | null;
  last_finalized_session_id: string | null;
  current_frontier_store_id: number | null;
  last_finalized_frontier_id: number | null;
  debt_kind: string | null;
  debt_size_estimate: number | null;
  updated_at: number | null;
  reset_at: number | null;
  finalized_at: number | null;
};

export class LifecycleManager {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Returns null if no row exists for this conversation_id. */
  get(conversationId: string): LifecycleState | null {
    const row = this.db
      .prepare('SELECT * FROM lcm_lifecycle_state WHERE conversation_id = ?')
      .get(conversationId) as RawRow | undefined;

    if (row == null) return null;

    return {
      conversation_id: row.conversation_id,
      current_session_id: row.current_session_id ?? null,
      last_finalized_session_id: row.last_finalized_session_id ?? null,
      current_frontier_store_id: row.current_frontier_store_id ?? null,
      last_finalized_frontier_id: row.last_finalized_frontier_id ?? null,
      debt_kind: (row.debt_kind as 'raw_backlog' | null) ?? null,
      debt_size_estimate: row.debt_size_estimate ?? null,
      updated_at: row.updated_at ?? null,
      reset_at: row.reset_at ?? null,
      finalized_at: row.finalized_at ?? null,
    };
  }

  /** First-time setup or no-op-if-exists. Sets current_session_id and updated_at. */
  initialize(conversationId: string, sessionId: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO lcm_lifecycle_state
           (conversation_id, current_session_id, updated_at)
         VALUES (?, ?, ?)`
      )
      .run(conversationId, sessionId, Date.now());
  }

  /** Update current_frontier_store_id and updated_at. Throws if row doesn't exist. */
  recordCompactedFrontier(conversationId: string, storeId: number): void {
    const result = this.db
      .prepare(
        `UPDATE lcm_lifecycle_state
         SET current_frontier_store_id = ?, updated_at = ?
         WHERE conversation_id = ?`
      )
      .run(storeId, Date.now(), conversationId);

    if (result.changes === 0) {
      throw new Error(`LifecycleManager: conversation not initialized: ${conversationId}`);
    }
  }

  /** Set debt_kind and debt_size_estimate. Throws if row doesn't exist. */
  recordDebt(conversationId: string, kind: 'raw_backlog', sizeEstimate: number): void {
    const result = this.db
      .prepare(
        `UPDATE lcm_lifecycle_state
         SET debt_kind = ?, debt_size_estimate = ?, updated_at = ?
         WHERE conversation_id = ?`
      )
      .run(kind, sizeEstimate, Date.now(), conversationId);

    if (result.changes === 0) {
      throw new Error(`LifecycleManager: conversation not initialized: ${conversationId}`);
    }
  }

  /** Clear debt_kind and debt_size_estimate (set to null). Throws if row doesn't exist. */
  clearDebt(conversationId: string): void {
    const result = this.db
      .prepare(
        `UPDATE lcm_lifecycle_state
         SET debt_kind = NULL, debt_size_estimate = NULL, updated_at = ?
         WHERE conversation_id = ?`
      )
      .run(Date.now(), conversationId);

    if (result.changes === 0) {
      throw new Error(`LifecycleManager: conversation not initialized: ${conversationId}`);
    }
  }

  /**
   * Session reset: rotates session_id (current → last_finalized), clears debt,
   * sets reset_at, finalized_at. Sets new current_frontier_store_id to null.
   * Stores the old session's frontier in last_finalized_frontier_id.
   * Throws if row doesn't exist OR if oldSessionId doesn't match current_session_id.
   */
  recordReset(conversationId: string, oldSessionId: string, newSessionId: string): void {
    const doReset = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT current_session_id, current_frontier_store_id
           FROM lcm_lifecycle_state
           WHERE conversation_id = ?`
        )
        .get(conversationId) as
        | { current_session_id: string | null; current_frontier_store_id: number | null }
        | undefined;

      if (row == null) {
        throw new Error(`LifecycleManager: conversation not initialized: ${conversationId}`);
      }

      if (row.current_session_id !== oldSessionId) {
        throw new Error(
          `LifecycleManager.recordReset: oldSessionId mismatch ` +
            `(expected ${row.current_session_id}, got ${oldSessionId})`
        );
      }

      const now = Date.now();
      this.db
        .prepare(
          `UPDATE lcm_lifecycle_state
           SET last_finalized_session_id = current_session_id,
               last_finalized_frontier_id = current_frontier_store_id,
               current_session_id = ?,
               current_frontier_store_id = NULL,
               debt_kind = NULL,
               debt_size_estimate = NULL,
               reset_at = ?,
               finalized_at = ?,
               updated_at = ?
           WHERE conversation_id = ?`
        )
        .run(newSessionId, now, now, now, conversationId);
    });

    doReset();
  }
}
