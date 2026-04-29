/**
 * Read-only access helper for the LCM SQLite databases used by the UI
 * introspection routes (Plan 3 Task B1).
 *
 * The gateway plugin owns the canonical write path; the UI opens these DBs
 * read-only for drill-down views. Each request opens + closes its own handle
 * so we don't keep file locks across requests.
 *
 * Path layout: `<repoRoot>/data/lcm-db/<agentId>.sqlite`. The UI process
 * runs at `<repoRoot>/ui`, so we resolve via `process.cwd()/../data` to
 * stay symmetric with `ui/lib/agents.ts` and `ui/lib/gateway.ts`.
 */

import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { SummaryDAG } from '../../plugins/lcm/dist/dag.js';
import { MessageStore } from '../../plugins/lcm/dist/store.js';

export type LcmHandle = {
  db: Database.Database;
  store: MessageStore;
  dag: SummaryDAG;
};

/**
 * Absolute path to the LCM SQLite file for `agentId`. Does not check
 * existence — callers should use `existsSync` or `openLcmReadOnly`.
 */
export function lcmDbPath(agentId: string): string {
  return resolve(process.cwd(), '..', 'data', 'lcm-db', `${agentId}.sqlite`);
}

/**
 * Open the LCM database for `agentId` in read-only mode and return the
 * `MessageStore` + `SummaryDAG` accessors.
 *
 * Returns `null` if the SQLite file doesn't exist (fresh agent / LCM never
 * ingested anything). Throws on schema-level corruption — callers that want
 * a graceful empty-state response should fall back to that on errors caught
 * here. The route layer for Task B1 catches schema errors and returns the
 * empty-state shape, so the schema absence case stays a 200.
 *
 * IMPORTANT: caller MUST close `db` after use (`db.close()`) — every request
 * opens a fresh handle to avoid lock contention with the running gateway.
 */
export function openLcmReadOnly(agentId: string): LcmHandle | null {
  const dbPath = lcmDbPath(agentId);
  if (!existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true });
  // Both constructors prepare statements eagerly; if the schema doesn't
  // exist the prepare() throws synchronously and we propagate. Routes
  // handle the empty-state fallback explicitly.
  const store = new MessageStore(db);
  const dag = new SummaryDAG(db);
  return { db, store, dag };
}
