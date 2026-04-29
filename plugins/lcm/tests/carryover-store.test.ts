/**
 * Unit tests for CarryoverStore — single-row pending carry-over snippet
 * persisted in the agent's LCM SQLite DB.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { bootstrap } from '../src/db/bootstrap.js';
import { CarryoverStore } from '../src/carryover.js';

let tmp: string;
let db: Database.Database;
let store: CarryoverStore;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'lcm-carryover-'));
  db = new Database(join(tmp, 'test.sqlite'));
  bootstrap(db);
  store = new CarryoverStore(db);
});

afterEach(() => {
  try { db.close(); } catch { /* ignore */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('CarryoverStore', () => {
  it('returns null when no row is present', () => {
    expect(store.get()).toBeNull();
  });

  it('persists and returns a row after upsert', () => {
    store.upsert({
      sourceSessionId: 'agent-x:telegram:dm:user1',
      snippet: 'previous summary…',
      createdAt: 1_700_000_000_000,
    });
    const row = store.get();
    expect(row).toEqual({
      source_session_id: 'agent-x:telegram:dm:user1',
      snippet: 'previous summary…',
      created_at: 1_700_000_000_000,
    });
  });

  it('upserts replace an existing row (single-row table)', () => {
    store.upsert({ sourceSessionId: 's1', snippet: 'first', createdAt: 1 });
    store.upsert({ sourceSessionId: 's2', snippet: 'second', createdAt: 2 });
    expect(store.get()).toEqual({
      source_session_id: 's2',
      snippet: 'second',
      created_at: 2,
    });
  });

  it('clear() removes the row, leaving get() null', () => {
    store.upsert({ sourceSessionId: 's1', snippet: 'x', createdAt: 1 });
    store.clear();
    expect(store.get()).toBeNull();
  });

  it('clear() on empty table is a no-op (no throw)', () => {
    expect(() => store.clear()).not.toThrow();
    expect(store.get()).toBeNull();
  });
});
