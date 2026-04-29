-- ─────────────────────────────────────────────────────────────────
-- LCM SQLite Schema (managed via versioned migrations in bootstrap.ts)
-- ─────────────────────────────────────────────────────────────────

-- 1) Иммутабельный лог сообщений (append-only)
CREATE TABLE IF NOT EXISTS messages (
  store_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'unknown',
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  tool_call_id    TEXT,
  tool_calls_json TEXT,
  tool_name        TEXT,
  ts              INTEGER NOT NULL,
  token_estimate  INTEGER NOT NULL DEFAULT 0,
  pinned          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, store_id);
CREATE INDEX IF NOT EXISTS idx_messages_source  ON messages(source);

-- FTS5 в режиме external content поверх messages.content
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='store_id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS msg_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.store_id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS msg_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.store_id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS msg_fts_update AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.store_id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.store_id, new.content);
END;

-- 2) DAG свёрток
CREATE TABLE IF NOT EXISTS summary_nodes (
  node_id              TEXT PRIMARY KEY,
  session_id           TEXT NOT NULL,
  depth                INTEGER NOT NULL,
  summary              TEXT NOT NULL,
  token_count          INTEGER NOT NULL,
  source_token_count   INTEGER NOT NULL,
  source_ids_json      TEXT NOT NULL,
  source_type          TEXT NOT NULL CHECK (source_type IN ('messages', 'nodes')),
  earliest_at          INTEGER NOT NULL,
  latest_at            INTEGER NOT NULL,
  created_at           INTEGER NOT NULL,
  expand_hint          TEXT
);
CREATE INDEX IF NOT EXISTS idx_nodes_session_depth ON summary_nodes(session_id, depth, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  summary,
  content='summary_nodes',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS node_fts_insert AFTER INSERT ON summary_nodes BEGIN
  INSERT INTO nodes_fts(rowid, summary) VALUES (new.rowid, new.summary);
END;
CREATE TRIGGER IF NOT EXISTS node_fts_delete AFTER DELETE ON summary_nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, summary) VALUES('delete', old.rowid, old.summary);
END;
CREATE TRIGGER IF NOT EXISTS node_fts_update AFTER UPDATE ON summary_nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, summary) VALUES('delete', old.rowid, old.summary);
  INSERT INTO nodes_fts(rowid, summary) VALUES (new.rowid, new.summary);
END;

-- 3) Lifecycle state
CREATE TABLE IF NOT EXISTS lcm_lifecycle_state (
  conversation_id              TEXT PRIMARY KEY,
  current_session_id           TEXT,
  last_finalized_session_id    TEXT,
  current_frontier_store_id    INTEGER,
  last_finalized_frontier_id   INTEGER,
  debt_kind                    TEXT,
  debt_size_estimate           INTEGER,
  updated_at                   INTEGER,
  reset_at                     INTEGER,
  finalized_at                 INTEGER
);

-- 4) Метаданные (schema version, etc.)
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 5) Carry-over snippet pending injection on the next assemble().
-- Single-row table (per-agent DB already isolates by agentId).
-- Populated on `on_session_reset`; consumed and deleted by assemble()
-- when the current sessionKey != source_session_id (i.e. a new session).
CREATE TABLE IF NOT EXISTS carryover_pending (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  source_session_id   TEXT NOT NULL,
  snippet             TEXT NOT NULL,
  created_at          INTEGER NOT NULL
);
