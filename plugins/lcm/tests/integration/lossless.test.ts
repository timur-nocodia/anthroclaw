/**
 * @lossless drill-down integration test — Plan 2 / T23.
 *
 * THE invariant test for the LCM design: every summary node at any depth
 * (D0/D1/D2+) must be able to recover its source messages byte-exact via
 * `dag.collectLeafMessageIds()` + `store.getMany()`.
 *
 * If any of these sub-tests fail, the lossless property is broken and the
 * Plan 2 acceptance bar is not met.
 *
 * Sub-tests:
 *   1. Drill-down byte-exact — many messages → multiple compress passes →
 *      D2 exists → drill from D2 down to leaf message store_ids returns
 *      content/role/ts byte-exact for every original message.
 *   2. Source lineage cross-platform filtering — mixed-source messages →
 *      `dag.search` with `source: 'telegram'` and `source: 'cli'` filters
 *      both return non-empty results.
 *   3. Carry-over preserves drill-down after session reset —
 *      reassignSessionNodes(SESSION, newSession, depth=2) → drill-down on
 *      new-session node still resolves to the original messages (which stay
 *      in the OLD session_id; carry-over is at the DAG level, not the
 *      message-store level).
 *   4. Drill-down survives SQLite restart — close/reopen DB → getNodesAtDepth
 *      and collectLeafMessageIds return identical results.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../../src/db/bootstrap.js';
import { MessageStore } from '../../src/store.js';
import { SummaryDAG } from '../../src/dag.js';
import { LifecycleManager } from '../../src/lifecycle.js';
import {
  LCMEngine,
  type EngineMessage,
  type ResolvedLCMConfig,
} from '../../src/engine.js';

const SESSION = 'lossless-test:cli:dm:user-1';
const AGENT_ID = 'a-lossless';

// Deterministic mock subagent. Returns a short summary derived from input
// length — guaranteed shorter than source so escalation succeeds at L1. Each
// summary contains the literal token "anchor" so dag.search can find nodes.
async function mockSubagent(args: { prompt: string }): Promise<string> {
  return `anchor summary len ${args.prompt.length}`;
}

// Tuned config: 200 messages × ~25 tok/msg ÷ 50 tok/leaf ≈ 100 D0s,
// ÷ fanin 4 = ~25 D1s, ÷ 4 = ~6 D2s — so D2 emerges in a single compress pass.
// If you tune the engine and this stops emerging, lower leafChunkTokens or
// raise message count rather than weakening assertions in the tests below.
function buildConfig(): ResolvedLCMConfig {
  return {
    leafChunkTokens: 50,             // small chunk → many D0 nodes from 200 msgs
    condensationFanin: 4,            // 4 D{n} → 1 D{n+1}, standard fan-in
    freshTailLength: 2,              // last 2 messages excluded from compression
    assemblyCapTokens: 32_000,
    l3TruncateChars: 2048,
    l2BudgetRatio: 0.5,
    dynamicLeafChunk: false,         // off — keeps chunk size predictable for invariant
    cacheFriendlyCondensation: false, // off — don't skip when single fanin group
  };
}

const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('@lossless: full DAG drill-down recovers byte-exact source messages', () => {
  let tmp: string;
  let dbPath: string;
  let db: Database.Database;
  let store: MessageStore;
  let dag: SummaryDAG;
  let lifecycle: LifecycleManager;
  let engine: LCMEngine;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lcm-lossless-'));
    dbPath = join(tmp, 'lcm.sqlite');
    db = new Database(dbPath);
    bootstrap(db);
    store = new MessageStore(db);
    dag = new SummaryDAG(db);
    lifecycle = new LifecycleManager(db);
    // Required: engine.compress's lifecycle.clearDebt + recordCompactedFrontier
    // throw if the row doesn't exist (engine catches & warns, but we want clean
    // state for these invariant tests).
    lifecycle.initialize(AGENT_ID, SESSION);

    engine = new LCMEngine({
      store,
      dag,
      lifecycle,
      runSubagent: mockSubagent,
      config: buildConfig(),
      logger: stubLogger,
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    // Sub-test 4 reopens db mid-test; if it fails between close and reassign,
    // db could be a closed handle and .close() would throw. Tolerate.
    try { db.close(); } catch { /* already closed or not opened */ }
    rmSync(tmp, { recursive: true, force: true });
  });

  // ─── Sub-test 1: Drill-down byte-exact ─────────────────────────────────────
  it('preserves exact source messages through full D2→D1→D0→messages drill-down', async () => {
    interface OriginalMsg {
      content: string;
      role: 'user' | 'assistant';
      ts: number;
      storeId: number;
    }

    // Append 200 unique-marker messages
    const original: OriginalMsg[] = [];
    for (let i = 0; i < 200; i++) {
      const role: 'user' | 'assistant' = i % 2 === 0 ? 'user' : 'assistant';
      const content = `MARKER-${i}: ${'x'.repeat(50)}`;
      const ts = 1000 + i;
      const storeId = store.append({
        session_id: SESSION,
        source: 'cli',
        role,
        content,
        ts,
      });
      original.push({ content, role, ts, storeId });
    }

    // Build messages payload — system prompt then the 200 originals
    const sysMsg: EngineMessage = {
      role: 'system',
      content: 'System prompt for lossless test.',
    };
    const messagesPayload: EngineMessage[] = [
      sysMsg,
      ...original.map<EngineMessage>(m => ({
        role: m.role,
        content: m.content,
        ts: m.ts,
      })),
    ];

    // Single compress pass. With leafChunkTokens=50 and ~messages of ~25 tokens
    // each, 200 backlog messages produce ~100 D0s → ~25 D1s → ~6 D2s in one go.
    const result = await engine.compress({
      agentId: AGENT_ID,
      sessionKey: SESSION,
      messages: messagesPayload,
      currentTokens: 100_000,
    });
    expect(result.compressionApplied, 'compression must apply').toBe(true);

    const d0 = dag.getNodesAtDepth(SESSION, 0);
    const d1 = dag.getNodesAtDepth(SESSION, 1);
    const d2 = dag.getNodesAtDepth(SESSION, 2);
    expect(d0.length, 'D0 nodes must exist').toBeGreaterThan(0);
    expect(d1.length, 'D1 nodes must exist').toBeGreaterThan(0);
    expect(
      d2.length,
      'D2 nodes must exist after single compress pass with tuned config',
    ).toBeGreaterThan(0);

    // Drill from a D2 node down to leaf message store_ids
    const targetD2 = d2[0];
    const leafIds = dag.collectLeafMessageIds(targetD2.node_id);
    expect(leafIds.length, 'D2 must drill to ≥1 leaf message id').toBeGreaterThan(0);

    // BYTE-EXACT recovery — every recovered message must match an original
    const recovered = store.getMany(leafIds);
    expect(recovered.length).toBe(leafIds.length);
    for (const r of recovered) {
      const orig = original.find(
        o => o.content === r.content && o.role === r.role && o.ts === r.ts,
      );
      expect(
        orig,
        `recovered message must match an original byte-exact — got: ${r.content.slice(0, 40)}`,
      ).toBeDefined();
      // store_id should also match (deterministic since we appended in order)
      if (orig) expect(r.store_id).toBe(orig.storeId);
    }

    // Critical invariant: union of leaf-ids across all DAG nodes (any depth)
    // must cover every NON-fresh-tail original message. The fresh tail (last
    // freshTailLength=2 messages) is excluded from compression by design.
    const allDagLeafIds = new Set<number>();
    for (const depth of [0, 1, 2, 3, 4]) {
      for (const node of dag.getNodesAtDepth(SESSION, depth)) {
        for (const id of dag.collectLeafMessageIds(node.node_id)) {
          allDagLeafIds.add(id);
        }
      }
    }

    const expectedCovered = original.slice(0, -2).map(o => o.storeId);
    for (const id of expectedCovered) {
      expect(
        allDagLeafIds.has(id),
        `original store_id=${id} must appear in DAG leaf-ids at any depth`,
      ).toBe(true);
    }

    // D2's leaf-ids must be a SUBSET of all-depths leaf-ids (sanity)
    const d2AllLeafIds = new Set<number>();
    for (const node of d2) {
      for (const id of dag.collectLeafMessageIds(node.node_id)) {
        d2AllLeafIds.add(id);
      }
    }
    for (const id of d2AllLeafIds) {
      expect(allDagLeafIds.has(id)).toBe(true);
    }

    // Marker findability: every original is preserved in the immutable store
    const targetIdx = 100;
    const marker = `MARKER-${targetIdx}`;
    const grepResults = store.search(marker, { sessionId: SESSION, limit: 5 });
    expect(
      grepResults.length,
      `marker ${marker} must remain findable in immutable message store`,
    ).toBeGreaterThan(0);
  });

  // ─── Sub-test 2: Source lineage cross-platform filtering ───────────────────
  it('source lineage preserves cross-platform filtering after compaction', async () => {
    // Mixed-source messages: alternating telegram / cli
    for (let i = 0; i < 100; i++) {
      const source = i % 2 === 0 ? 'telegram' : 'cli';
      const role: 'user' | 'assistant' = i % 4 < 2 ? 'user' : 'assistant';
      store.append({
        session_id: SESSION,
        source,
        role,
        content: `${source}-msg-${i}: ${'y'.repeat(40)}`,
        ts: 1000 + i,
      });
    }

    const sysMsg: EngineMessage = { role: 'system', content: 'System prompt.' };
    const stored = store.listSession(SESSION);
    const payload: EngineMessage[] = [
      sysMsg,
      ...stored.map<EngineMessage>(m => ({
        role: m.role as EngineMessage['role'],
        content: m.content,
        ts: m.ts,
      })),
    ];

    await engine.compress({
      agentId: AGENT_ID,
      sessionKey: SESSION,
      messages: payload,
      currentTokens: 100_000,
    });

    // Confirm DAG nodes exist
    const allNodes =
      dag.getNodesAtDepth(SESSION, 0).length +
      dag.getNodesAtDepth(SESSION, 1).length +
      dag.getNodesAtDepth(SESSION, 2).length;
    expect(allNodes, 'compression must produce DAG nodes').toBeGreaterThan(0);

    // dag.search supports a `source` filter via recursive lineage CTE
    // (see dag.ts:_nodeMatchesSource). Each node's leaf messages are walked
    // and matched against the supplied source value.
    const telegramOnly = dag.search('anchor', {
      sessionId: SESSION,
      source: 'telegram',
      limit: 50,
    });
    const cliOnly = dag.search('anchor', {
      sessionId: SESSION,
      source: 'cli',
      limit: 50,
    });

    expect(
      telegramOnly.length,
      'source=telegram filter must return ≥1 DAG node whose lineage contains telegram messages',
    ).toBeGreaterThan(0);
    expect(
      cliOnly.length,
      'source=cli filter must return ≥1 DAG node whose lineage contains cli messages',
    ).toBeGreaterThan(0);

    // Sanity: each filtered node's drill-down must include ≥1 message of the
    // requested source.
    for (const r of telegramOnly) {
      const leafIds = dag.collectLeafMessageIds(r.node_id);
      const messages = store.getMany(leafIds);
      const hasTelegram = messages.some(m => m.source === 'telegram');
      expect(
        hasTelegram,
        `node ${r.node_id} returned for source=telegram must have ≥1 telegram message in its lineage`,
      ).toBe(true);
    }
    for (const r of cliOnly) {
      const leafIds = dag.collectLeafMessageIds(r.node_id);
      const messages = store.getMany(leafIds);
      const hasCli = messages.some(m => m.source === 'cli');
      expect(
        hasCli,
        `node ${r.node_id} returned for source=cli must have ≥1 cli message in its lineage`,
      ).toBe(true);
    }
  });

  // ─── Sub-test 3: Carry-over preserves drill-down after session reset ───────
  it('carry-over preserves drill-down after session reset', async () => {
    for (let i = 0; i < 100; i++) {
      store.append({
        session_id: SESSION,
        source: 'cli',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `carry-msg-${i}: ${'z'.repeat(40)}`,
        ts: 1000 + i,
      });
    }

    const sysMsg: EngineMessage = { role: 'system', content: 'System prompt.' };
    const stored = store.listSession(SESSION);
    const payload: EngineMessage[] = [
      sysMsg,
      ...stored.map<EngineMessage>(m => ({
        role: m.role as EngineMessage['role'],
        content: m.content,
        ts: m.ts,
      })),
    ];
    await engine.compress({
      agentId: AGENT_ID,
      sessionKey: SESSION,
      messages: payload,
      currentTokens: 100_000,
    });

    // Confirm depth-2 nodes exist before carry-over
    const d2Before = dag.getNodesAtDepth(SESSION, 2);
    expect(d2Before.length, 'precondition: D2 must exist before carry-over').toBeGreaterThan(0);

    const newSession = `${SESSION}:session-2`;
    const moved = dag.reassignSessionNodes(SESSION, newSession, 2);
    expect(moved, 'reassignSessionNodes must move ≥1 node at depth ≥ 2').toBeGreaterThan(0);

    // Original session no longer has D2 nodes
    expect(dag.getNodesAtDepth(SESSION, 2).length).toBe(0);

    // New session has the carried-over D2 nodes
    const d2New = dag.getNodesAtDepth(newSession, 2);
    expect(d2New.length).toBe(d2Before.length);

    // Drill-down on a new-session D2 node still resolves to original messages.
    // CRITICAL: messages stay in the OLD session — carry-over is DAG-level only.
    const leafIds = dag.collectLeafMessageIds(d2New[0].node_id);
    expect(leafIds.length).toBeGreaterThan(0);
    const recovered = store.getMany(leafIds);
    expect(recovered.length).toBe(leafIds.length);
    expect(
      recovered.every(r => r.session_id === SESSION),
      'recovered messages must keep their original session_id (not the new session)',
    ).toBe(true);
    expect(
      recovered.every(r => r.content.startsWith('carry-msg-')),
      'recovered messages must be the originals',
    ).toBe(true);
  });

  // ─── Sub-test 4: Drill-down survives SQLite restart ────────────────────────
  it('drill-down survives SQLite restart', async () => {
    for (let i = 0; i < 100; i++) {
      store.append({
        session_id: SESSION,
        source: 'cli',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `restart-msg-${i}: ${'w'.repeat(40)}`,
        ts: 1000 + i,
      });
    }

    const sysMsg: EngineMessage = { role: 'system', content: 'System prompt.' };
    const stored = store.listSession(SESSION);
    const payload: EngineMessage[] = [
      sysMsg,
      ...stored.map<EngineMessage>(m => ({
        role: m.role as EngineMessage['role'],
        content: m.content,
        ts: m.ts,
      })),
    ];
    await engine.compress({
      agentId: AGENT_ID,
      sessionKey: SESSION,
      messages: payload,
      currentTokens: 100_000,
    });

    const d2Before = dag.getNodesAtDepth(SESSION, 2);
    expect(d2Before.length, 'precondition: D2 must exist before restart').toBeGreaterThan(0);

    const targetNodeIdBefore = d2Before[0].node_id;
    const leafIdsBefore = dag.collectLeafMessageIds(targetNodeIdBefore);
    expect(leafIdsBefore.length).toBeGreaterThan(0);

    // Capture all-depth fingerprint
    const beforeFingerprint = JSON.stringify({
      d0: dag.getNodesAtDepth(SESSION, 0).map(n => n.node_id).sort(),
      d1: dag.getNodesAtDepth(SESSION, 1).map(n => n.node_id).sort(),
      d2: d2Before.map(n => n.node_id).sort(),
    });

    // ── Close & reopen DB ────────────────────────────────────────────────
    db.close();
    db = new Database(dbPath);
    bootstrap(db); // idempotent — must not bump schema version
    const dag2 = new SummaryDAG(db);
    const store2 = new MessageStore(db);

    const d2After = dag2.getNodesAtDepth(SESSION, 2);
    const afterFingerprint = JSON.stringify({
      d0: dag2.getNodesAtDepth(SESSION, 0).map(n => n.node_id).sort(),
      d1: dag2.getNodesAtDepth(SESSION, 1).map(n => n.node_id).sort(),
      d2: d2After.map(n => n.node_id).sort(),
    });

    expect(afterFingerprint, 'DAG node-id fingerprint must be identical after restart').toBe(
      beforeFingerprint,
    );

    // collectLeafMessageIds for the same node must return identical results
    const leafIdsAfter = dag2.collectLeafMessageIds(targetNodeIdBefore);
    expect(
      leafIdsAfter.slice().sort((a, b) => a - b),
      'leaf message ids must be identical after restart',
    ).toEqual(leafIdsBefore.slice().sort((a, b) => a - b));

    // And the messages themselves must still resolve byte-exact
    const recoveredAfter = store2.getMany(leafIdsAfter);
    expect(recoveredAfter.length).toBe(leafIdsAfter.length);
    expect(
      recoveredAfter.every(r => r.content.startsWith('restart-msg-')),
      'messages must survive restart byte-exact',
    ).toBe(true);
  });
});
