/**
 * CarryoverStore — single-row table per agent DB holding a pending
 * cross-session memory snippet built on `on_session_reset` and consumed
 * on the next `assemble()` invocation under a different sessionKey.
 *
 * Why a separate file: `MessageStore` is for the immutable conversation log
 * with FTS5; carry-over is small, mutable, and orthogonal. Keeping it
 * separate avoids cluttering MessageStore's prepared-statement footprint.
 */

import type Database from 'better-sqlite3';

export interface CarryoverRow {
  source_session_id: string;
  snippet: string;
  created_at: number;
}

type Stmt = Database.Statement<unknown[], unknown>;

export class CarryoverStore {
  private readonly _stmtGet: Stmt;
  private readonly _stmtUpsert: Stmt;
  private readonly _stmtDelete: Stmt;

  constructor(db: Database.Database) {
    this._stmtGet = db.prepare(
      `SELECT source_session_id, snippet, created_at FROM carryover_pending WHERE id = 1`,
    );
    this._stmtUpsert = db.prepare(
      `INSERT INTO carryover_pending (id, source_session_id, snippet, created_at)
       VALUES (1, @source_session_id, @snippet, @created_at)
       ON CONFLICT(id) DO UPDATE SET
         source_session_id = excluded.source_session_id,
         snippet           = excluded.snippet,
         created_at        = excluded.created_at`,
    );
    this._stmtDelete = db.prepare(`DELETE FROM carryover_pending WHERE id = 1`);
  }

  get(): CarryoverRow | null {
    return (this._stmtGet.get() as CarryoverRow | undefined) ?? null;
  }

  upsert(args: { sourceSessionId: string; snippet: string; createdAt: number }): void {
    this._stmtUpsert.run({
      source_session_id: args.sourceSessionId,
      snippet: args.snippet,
      created_at: args.createdAt,
    });
  }

  clear(): void {
    this._stmtDelete.run();
  }
}
