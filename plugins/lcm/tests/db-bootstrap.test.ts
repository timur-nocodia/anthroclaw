import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap, getSchemaVersion, SCHEMA_VERSION } from '../src/db/bootstrap.js';

describe('bootstrap', () => {
  let tmp: string;
  let dbPath: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lcm-bootstrap-'));
    dbPath = join(tmp, 'lcm.sqlite');
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('creates fresh database with current schema version', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('creates messages table with all expected columns', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    const cols = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining([
      'store_id', 'session_id', 'source', 'role', 'content',
      'tool_call_id', 'tool_calls_json', 'tool_name', 'ts', 'token_estimate', 'pinned',
    ]));
    db.close();
  });

  it('creates summary_nodes table with all expected columns', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    const cols = db.prepare('PRAGMA table_info(summary_nodes)').all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining([
      'node_id', 'session_id', 'depth', 'summary', 'source_ids_json', 'source_type',
      'token_count', 'source_token_count', 'earliest_at', 'latest_at', 'created_at',
    ]));
    db.close();
  });

  it('creates messages_fts virtual table with triggers', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'`).all();
    expect(tables.length).toBeGreaterThan(0);
    const triggers = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='messages'`).all() as Array<{ name: string }>;
    const trigNames = triggers.map(t => t.name);
    expect(trigNames).toEqual(expect.arrayContaining(['msg_fts_insert', 'msg_fts_delete', 'msg_fts_update']));
    db.close();
  });

  it('FTS triggers keep messages_fts in sync on insert', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    db.prepare(`INSERT INTO messages (session_id, source, role, content, ts) VALUES (?, ?, ?, ?, ?)`)
      .run('test-session', 'cli', 'user', 'hello world', Date.now());
    const r = db.prepare(`SELECT COUNT(*) as c FROM messages_fts WHERE messages_fts MATCH ?`).get('hello') as { c: number };
    expect(r.c).toBe(1);
    db.close();
  });

  it('FTS triggers keep nodes_fts in sync on insert', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    db.prepare(`INSERT INTO summary_nodes (node_id, session_id, depth, summary, token_count, source_token_count, source_ids_json, source_type, earliest_at, latest_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('node-1', 's', 0, 'banana fruit', 10, 100, '[]', 'messages', 1, 2, 3);
    const r = db.prepare(`SELECT COUNT(*) as c FROM nodes_fts WHERE nodes_fts MATCH ?`).get('banana') as { c: number };
    expect(r.c).toBe(1);
    db.close();
  });

  it('lcm_lifecycle_state table exists and accepts insert', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    db.prepare(`INSERT INTO lcm_lifecycle_state(conversation_id, current_session_id) VALUES(?, ?)`).run('conv-1', 'sess-1');
    const r = db.prepare(`SELECT * FROM lcm_lifecycle_state WHERE conversation_id = ?`).get('conv-1');
    expect(r).toBeDefined();
    db.close();
  });

  it('source_type CHECK constraint rejects invalid values', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    expect(() =>
      db.prepare(`INSERT INTO summary_nodes (node_id, session_id, depth, summary, token_count, source_token_count, source_ids_json, source_type, earliest_at, latest_at, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('node-X', 's', 0, 'x', 1, 1, '[]', 'INVALID_TYPE', 1, 2, 3)
    ).toThrow();
    db.close();
  });

  it('bootstrap is idempotent (running twice does not throw)', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    bootstrap(db);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('rejects schema versions newer than current with clear error', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    db.prepare(`INSERT OR REPLACE INTO schema_meta(key, value) VALUES('schema_version', ?)`).run(String(SCHEMA_VERSION + 99));
    expect(() => bootstrap(db)).toThrow(/newer.*version|incompatible|forward/i);
    db.close();
  });

  it('WAL mode enabled after bootstrap', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    const mode = db.pragma('journal_mode', { simple: true });
    expect(mode).toBe('wal');
    db.close();
  });

  it('FTS update trigger: messages_fts swaps old term for new', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    const result = db.prepare(
      `INSERT INTO messages (session_id, source, role, content, ts) VALUES (?, ?, ?, ?, ?)`
    ).run('s', 'cli', 'user', 'apple', Date.now());
    const id = result.lastInsertRowid as number;

    // Verify initial term indexed
    const before = db.prepare(`SELECT COUNT(*) as c FROM messages_fts WHERE messages_fts MATCH ?`).get('apple') as { c: number };
    expect(before.c).toBe(1);

    db.prepare(`UPDATE messages SET content = ? WHERE store_id = ?`).run('banana', id);

    // Old term should be gone
    const oldGone = db.prepare(`SELECT COUNT(*) as c FROM messages_fts WHERE messages_fts MATCH ?`).get('apple') as { c: number };
    expect(oldGone.c).toBe(0);
    // New term should be indexed
    const newPresent = db.prepare(`SELECT COUNT(*) as c FROM messages_fts WHERE messages_fts MATCH ?`).get('banana') as { c: number };
    expect(newPresent.c).toBe(1);
    db.close();
  });

  it('FTS delete trigger: messages_fts removes deleted row term', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    const result = db.prepare(
      `INSERT INTO messages (session_id, source, role, content, ts) VALUES (?, ?, ?, ?, ?)`
    ).run('s', 'cli', 'user', 'kiwi', Date.now());
    const id = result.lastInsertRowid as number;

    const before = db.prepare(`SELECT COUNT(*) as c FROM messages_fts WHERE messages_fts MATCH ?`).get('kiwi') as { c: number };
    expect(before.c).toBe(1);

    db.prepare(`DELETE FROM messages WHERE store_id = ?`).run(id);

    const after = db.prepare(`SELECT COUNT(*) as c FROM messages_fts WHERE messages_fts MATCH ?`).get('kiwi') as { c: number };
    expect(after.c).toBe(0);
    db.close();
  });

  it('FTS update trigger: nodes_fts swaps old term for new', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    db.prepare(
      `INSERT INTO summary_nodes (node_id, session_id, depth, summary, token_count, source_token_count, source_ids_json, source_type, earliest_at, latest_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('n1', 's', 0, 'orange juice', 5, 100, '[]', 'messages', 1, 2, 3);

    const before = db.prepare(`SELECT COUNT(*) as c FROM nodes_fts WHERE nodes_fts MATCH ?`).get('orange') as { c: number };
    expect(before.c).toBe(1);

    db.prepare(`UPDATE summary_nodes SET summary = ? WHERE node_id = ?`).run('lemon water', 'n1');

    const oldGone = db.prepare(`SELECT COUNT(*) as c FROM nodes_fts WHERE nodes_fts MATCH ?`).get('orange') as { c: number };
    expect(oldGone.c).toBe(0);
    const newPresent = db.prepare(`SELECT COUNT(*) as c FROM nodes_fts WHERE nodes_fts MATCH ?`).get('lemon') as { c: number };
    expect(newPresent.c).toBe(1);
    db.close();
  });

  it('FTS delete trigger: nodes_fts removes deleted row term', () => {
    const db = new Database(dbPath);
    bootstrap(db);
    db.prepare(
      `INSERT INTO summary_nodes (node_id, session_id, depth, summary, token_count, source_token_count, source_ids_json, source_type, earliest_at, latest_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('n2', 's', 0, 'mango pulp', 5, 100, '[]', 'messages', 1, 2, 3);

    const before = db.prepare(`SELECT COUNT(*) as c FROM nodes_fts WHERE nodes_fts MATCH ?`).get('mango') as { c: number };
    expect(before.c).toBe(1);

    db.prepare(`DELETE FROM summary_nodes WHERE node_id = ?`).run('n2');

    const after = db.prepare(`SELECT COUNT(*) as c FROM nodes_fts WHERE nodes_fts MATCH ?`).get('mango') as { c: number };
    expect(after.c).toBe(0);
    db.close();
  });
});
