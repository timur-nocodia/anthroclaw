import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../src/db/bootstrap.js';
import { LifecycleManager } from '../src/lifecycle.js';

describe('LifecycleManager', () => {
  let tmp: string;
  let db: InstanceType<typeof Database>;
  let lc: LifecycleManager;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lcm-lifecycle-'));
    db = new Database(join(tmp, 'lcm.sqlite'));
    bootstrap(db);
    lc = new LifecycleManager(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  // ── 1. get returns null for unknown conversation_id ──────────────────────
  it('get returns null for unknown conversation_id', () => {
    const result = lc.get('nonexistent-conv');
    expect(result).toBeNull();
  });

  // ── 2. initialize creates a row with current_session_id and updated_at ───
  it('initialize creates a row with current_session_id and updated_at', () => {
    const before = Date.now();
    lc.initialize('conv-1', 'session-a');
    const state = lc.get('conv-1');
    expect(state).not.toBeNull();
    expect(state!.conversation_id).toBe('conv-1');
    expect(state!.current_session_id).toBe('session-a');
    expect(state!.updated_at).toBeTypeOf('number');
    expect(state!.updated_at!).toBeGreaterThanOrEqual(before);
  });

  // ── 3. initialize is idempotent (second call leaves first data unchanged) ─
  it('initialize is idempotent — second call leaves first call data unchanged', () => {
    lc.initialize('conv-1', 'session-first');
    const stateAfterFirst = lc.get('conv-1');

    lc.initialize('conv-1', 'session-second');
    const stateAfterSecond = lc.get('conv-1');

    expect(stateAfterSecond!.current_session_id).toBe('session-first');
    expect(stateAfterSecond!.updated_at).toBe(stateAfterFirst!.updated_at);
  });

  // ── 4. initialize returns void ───────────────────────────────────────────
  it('initialize returns void', () => {
    const result = lc.initialize('conv-1', 'session-a');
    expect(result).toBeUndefined();
  });

  // ── 5. get returns LifecycleState with correct shape after init ──────────
  it('get returns LifecycleState with correct shape after init (other fields null)', () => {
    lc.initialize('conv-2', 'session-b');
    const state = lc.get('conv-2')!;

    expect(state.conversation_id).toBe('conv-2');
    expect(state.current_session_id).toBe('session-b');
    expect(state.last_finalized_session_id).toBeNull();
    expect(state.current_frontier_store_id).toBeNull();
    expect(state.last_finalized_frontier_id).toBeNull();
    expect(state.debt_kind).toBeNull();
    expect(state.debt_size_estimate).toBeNull();
    expect(state.reset_at).toBeNull();
    expect(state.finalized_at).toBeNull();
  });

  // ── 6. recordCompactedFrontier updates current_frontier_store_id ─────────
  it('recordCompactedFrontier updates current_frontier_store_id', () => {
    lc.initialize('conv-3', 'session-c');
    lc.recordCompactedFrontier('conv-3', 42);
    const state = lc.get('conv-3')!;
    expect(state.current_frontier_store_id).toBe(42);
  });

  // ── 7. recordCompactedFrontier updates updated_at ────────────────────────
  it('recordCompactedFrontier updates updated_at to a recent timestamp', () => {
    lc.initialize('conv-3', 'session-c');
    const initState = lc.get('conv-3')!;
    const before = Date.now();
    lc.recordCompactedFrontier('conv-3', 42);
    const state = lc.get('conv-3')!;
    expect(state.updated_at).toBeGreaterThanOrEqual(before);
    expect(state.updated_at).toBeGreaterThanOrEqual(initState.updated_at!);
  });

  // ── 8. recordCompactedFrontier throws if row doesn't exist ───────────────
  it('recordCompactedFrontier throws if row does not exist', () => {
    expect(() => lc.recordCompactedFrontier('no-such-conv', 1)).toThrow(
      'LifecycleManager: conversation not initialized: no-such-conv'
    );
  });

  // ── 9. recordDebt sets debt_kind and debt_size_estimate ──────────────────
  it('recordDebt sets debt_kind and debt_size_estimate', () => {
    lc.initialize('conv-4', 'session-d');
    lc.recordDebt('conv-4', 'raw_backlog', 500);
    const state = lc.get('conv-4')!;
    expect(state.debt_kind).toBe('raw_backlog');
    expect(state.debt_size_estimate).toBe(500);
  });

  // ── 10. recordDebt throws if row doesn't exist ───────────────────────────
  it('recordDebt throws if row does not exist', () => {
    expect(() => lc.recordDebt('no-conv', 'raw_backlog', 100)).toThrow(
      'LifecycleManager: conversation not initialized: no-conv'
    );
  });

  // ── 11. clearDebt sets debt fields to null ───────────────────────────────
  it('clearDebt sets debt_kind and debt_size_estimate to null', () => {
    lc.initialize('conv-5', 'session-e');
    lc.recordDebt('conv-5', 'raw_backlog', 100);
    lc.clearDebt('conv-5');
    const state = lc.get('conv-5')!;
    expect(state.debt_kind).toBeNull();
    expect(state.debt_size_estimate).toBeNull();
  });

  // ── 12. clearDebt throws if row doesn't exist ────────────────────────────
  it('clearDebt throws if row does not exist', () => {
    expect(() => lc.clearDebt('no-conv')).toThrow(
      'LifecycleManager: conversation not initialized: no-conv'
    );
  });

  // ── 13. recordReset happy path ───────────────────────────────────────────
  it('recordReset happy path: rotates session_id, clears debt, sets timestamps, frontier null', () => {
    lc.initialize('conv-6', 'session-old');
    lc.recordDebt('conv-6', 'raw_backlog', 200);

    const before = Date.now();
    lc.recordReset('conv-6', 'session-old', 'session-new');
    const state = lc.get('conv-6')!;

    expect(state.current_session_id).toBe('session-new');
    expect(state.last_finalized_session_id).toBe('session-old');
    expect(state.current_frontier_store_id).toBeNull();
    expect(state.debt_kind).toBeNull();
    expect(state.debt_size_estimate).toBeNull();
    expect(state.reset_at).toBeGreaterThanOrEqual(before);
    expect(state.finalized_at).toBeGreaterThanOrEqual(before);
  });

  // ── 14. recordReset preserves last_finalized_frontier_id ─────────────────
  it('recordReset preserves last_finalized_frontier_id from old current_frontier_store_id', () => {
    lc.initialize('conv-7', 'session-old');
    lc.recordCompactedFrontier('conv-7', 99);
    lc.recordReset('conv-7', 'session-old', 'session-new');
    const state = lc.get('conv-7')!;
    expect(state.last_finalized_frontier_id).toBe(99);
    expect(state.current_frontier_store_id).toBeNull();
  });

  // ── 15. recordReset throws if conversation doesn't exist ─────────────────
  it('recordReset throws if conversation does not exist', () => {
    expect(() => lc.recordReset('no-conv', 'old', 'new')).toThrow();
  });

  // ── 16. recordReset throws if oldSessionId doesn't match ─────────────────
  it('recordReset throws if oldSessionId does not match current_session_id', () => {
    lc.initialize('conv-8', 'session-actual');
    expect(() => lc.recordReset('conv-8', 'session-wrong', 'session-new')).toThrow(
      'LifecycleManager.recordReset: oldSessionId mismatch'
    );
  });

  // ── 17. recordReset is atomic: mismatch leaves state unchanged ────────────
  it('recordReset is atomic: mismatch causes no partial update', () => {
    lc.initialize('conv-9', 'session-actual');
    lc.recordDebt('conv-9', 'raw_backlog', 333);
    const stateBefore = lc.get('conv-9')!;

    try {
      lc.recordReset('conv-9', 'session-wrong', 'session-new');
    } catch {
      // expected
    }

    const stateAfter = lc.get('conv-9')!;
    expect(stateAfter.current_session_id).toBe(stateBefore.current_session_id);
    expect(stateAfter.last_finalized_session_id).toBe(stateBefore.last_finalized_session_id);
    expect(stateAfter.debt_kind).toBe(stateBefore.debt_kind);
    expect(stateAfter.debt_size_estimate).toBe(stateBefore.debt_size_estimate);
    expect(stateAfter.reset_at).toBe(stateBefore.reset_at);
    expect(stateAfter.finalized_at).toBe(stateBefore.finalized_at);
  });

  // ── 18. Immutability: prototype exposes exactly 6 public methods ──────────
  it('prototype exposes exactly get, initialize, recordCompactedFrontier, recordDebt, clearDebt, recordReset', () => {
    const methods = Object.getOwnPropertyNames(LifecycleManager.prototype).filter(
      (n) => n !== 'constructor'
    );
    expect(methods.sort()).toEqual(
      ['clearDebt', 'get', 'initialize', 'recordCompactedFrontier', 'recordDebt', 'recordReset'].sort()
    );
  });
});
