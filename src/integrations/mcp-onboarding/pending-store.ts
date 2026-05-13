import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface PendingConnection {
  id: string;
  state: string;
  agentId: string;
  agentSessionKey: string | null;
  mcpUrl: string;
  authMode: 'oauth' | 'apikey' | 'none';
  codeVerifier: string | null;
  clientId: string | null;
  clientSecret: string | null;
  oauthMetadata: string | null;
  toolsMetadata: string | null;
  requestedBy: string;
  status: 'pending' | 'exchanging' | 'completed' | 'failed' | 'cancelled' | 'expired';
  failureReason: string | null;
  createdAt: number;
  expiresAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mcp_pending_connections (
  id              TEXT PRIMARY KEY,
  state           TEXT UNIQUE NOT NULL,
  agent_id        TEXT NOT NULL,
  agent_session_key TEXT,
  mcp_url         TEXT NOT NULL,
  auth_mode       TEXT NOT NULL,
  code_verifier   TEXT,
  client_id       TEXT,
  client_secret   TEXT,
  oauth_metadata  TEXT,
  tools_metadata  TEXT,
  requested_by    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  failure_reason  TEXT,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mcp_pending_state ON mcp_pending_connections(state);
CREATE INDEX IF NOT EXISTS idx_mcp_pending_expires ON mcp_pending_connections(expires_at);
`;

export interface PendingStore {
  insert(row: PendingConnection): void;
  byId(id: string): PendingConnection | null;
  consumeByState(state: string): PendingConnection | null;
  markCompleted(id: string, toolsMetadata: string): void;
  markFailed(id: string, reason: string): void;
  markCancelled(id: string, reason?: string): void;
  list(): PendingConnection[];
  sweepExpired(now: number): PendingConnection[];
  close(): void;
}

export function openPendingStore(path: string): PendingStore {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const rowToRecord = (r: Record<string, unknown>): PendingConnection => ({
    id: r.id as string,
    state: r.state as string,
    agentId: r.agent_id as string,
    agentSessionKey: (r.agent_session_key as string | null) ?? null,
    mcpUrl: r.mcp_url as string,
    authMode: r.auth_mode as PendingConnection['authMode'],
    codeVerifier: (r.code_verifier as string | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    clientSecret: (r.client_secret as string | null) ?? null,
    oauthMetadata: (r.oauth_metadata as string | null) ?? null,
    toolsMetadata: (r.tools_metadata as string | null) ?? null,
    requestedBy: r.requested_by as string,
    status: r.status as PendingConnection['status'],
    failureReason: (r.failure_reason as string | null) ?? null,
    createdAt: r.created_at as number,
    expiresAt: r.expires_at as number,
  });

  return {
    insert(row) {
      db.prepare(
        `
        INSERT INTO mcp_pending_connections (
          id, state, agent_id, agent_session_key, mcp_url, auth_mode,
          code_verifier, client_id, client_secret, oauth_metadata,
          tools_metadata, requested_by, status, failure_reason,
          created_at, expires_at
        ) VALUES (
          @id, @state, @agentId, @agentSessionKey, @mcpUrl, @authMode,
          @codeVerifier, @clientId, @clientSecret, @oauthMetadata,
          @toolsMetadata, @requestedBy, @status, @failureReason,
          @createdAt, @expiresAt
        )
      `,
      ).run(row);
    },
    byId(id) {
      const r = db
        .prepare('SELECT * FROM mcp_pending_connections WHERE id = ?')
        .get(id);
      return r ? rowToRecord(r as Record<string, unknown>) : null;
    },
    consumeByState(state) {
      const r = db
        .prepare(
          `UPDATE mcp_pending_connections
           SET status = 'exchanging'
           WHERE state = ? AND status = 'pending'
           RETURNING *`,
        )
        .get(state);
      return r ? rowToRecord(r as Record<string, unknown>) : null;
    },
    markCompleted(id, toolsMetadata) {
      // Zero out short-lived OAuth secrets on terminal transition. We keep
      // oauth_metadata because the completed credential row references it,
      // but the PKCE verifier and DCR-issued client_secret have no purpose
      // post-exchange and must not persist in plaintext SQLite.
      db.prepare(
        `UPDATE mcp_pending_connections
         SET status = 'completed',
             tools_metadata = ?,
             code_verifier = NULL,
             client_secret = NULL
         WHERE id = ?`,
      ).run(toolsMetadata, id);
    },
    markFailed(id, reason) {
      // Failed flows never need verifier / client_secret / oauth_metadata
      // again — null them out so a compromised SQLite file leaks less.
      db.prepare(
        `UPDATE mcp_pending_connections
         SET status = 'failed',
             failure_reason = ?,
             code_verifier = NULL,
             client_secret = NULL,
             oauth_metadata = NULL
         WHERE id = ?`,
      ).run(reason, id);
    },
    markCancelled(id, reason) {
      // Same rationale as markFailed.
      db.prepare(
        `UPDATE mcp_pending_connections
         SET status = 'cancelled',
             failure_reason = ?,
             code_verifier = NULL,
             client_secret = NULL,
             oauth_metadata = NULL
         WHERE id = ?`,
      ).run(reason ?? null, id);
    },
    list() {
      const rows = db
        .prepare(
          'SELECT * FROM mcp_pending_connections ORDER BY created_at DESC',
        )
        .all();
      return rows.map((r) => rowToRecord(r as Record<string, unknown>));
    },
    sweepExpired(now) {
      // Also catch rows stuck in 'exchanging' — if the process crashes
      // between consumeByState (which sets status='exchanging') and the
      // markCompleted/markFailed/markCancelled call, the row would
      // otherwise stay in that intermediate state forever.
      const rows = db
        .prepare(
          `UPDATE mcp_pending_connections
           SET status = 'expired'
           WHERE expires_at < ? AND status IN ('pending', 'exchanging')
           RETURNING *`,
        )
        .all(now);
      return rows.map((r) => rowToRecord(r as Record<string, unknown>));
    },
    close() {
      db.close();
    },
  };
}
