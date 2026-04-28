import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../src/db/bootstrap.js';
import { MessageStore } from '../src/store.js';
import { SummaryDAG } from '../src/dag.js';
import type { InboundNode, SummaryNode } from '../src/dag.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeDb(tmp: string) {
  const db = new Database(join(tmp, 'lcm.sqlite'));
  bootstrap(db);
  return db;
}

function newNode(opts: Partial<InboundNode> = {}): InboundNode {
  return {
    session_id: 's',
    depth: 0,
    summary: 'test summary',
    token_count: 100,
    source_token_count: 500,
    source_ids: [1, 2, 3],
    source_type: 'messages',
    earliest_at: 1000,
    latest_at: 2000,
    ...opts,
  };
}

/** Base32 alphabet used by ULID */
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// ─── suite ──────────────────────────────────────────────────────────────────

describe('SummaryDAG', () => {
  let tmp: string;
  let db: InstanceType<typeof Database>;
  let dag: SummaryDAG;
  let store: MessageStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lcm-dag-'));
    db = makeDb(tmp);
    dag = new SummaryDAG(db);
    store = new MessageStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  // ── 1. create returns ulid (26 chars, base32 alphabet) ────────────────────
  it('create returns a valid ULID string (26 chars, base32 alphabet)', () => {
    const id = dag.create(newNode());
    expect(id).toHaveLength(26);
    expect(ULID_RE.test(id)).toBe(true);
  });

  // ── 2. create + get round-trip (including expand_hint) ───────────────────
  it('create + get round-trips all fields including expand_hint', () => {
    const inbound: InboundNode = {
      session_id: 'sess-abc',
      depth: 1,
      summary: 'A longer summary text',
      token_count: 250,
      source_token_count: 1200,
      source_ids: ['node-a', 'node-b'],
      source_type: 'nodes',
      earliest_at: 5000,
      latest_at: 8000,
      expand_hint: 'Expand for details about topic X',
    };
    const id = dag.create(inbound);
    const node = dag.get(id);

    expect(node).not.toBeNull();
    expect(node!.node_id).toBe(id);
    expect(node!.session_id).toBe('sess-abc');
    expect(node!.depth).toBe(1);
    expect(node!.summary).toBe('A longer summary text');
    expect(node!.token_count).toBe(250);
    expect(node!.source_token_count).toBe(1200);
    expect(node!.source_ids).toEqual(['node-a', 'node-b']);
    expect(node!.source_type).toBe('nodes');
    expect(node!.earliest_at).toBe(5000);
    expect(node!.latest_at).toBe(8000);
    expect(node!.expand_hint).toBe('Expand for details about topic X');
    expect(node!.created_at).toBeTypeOf('number');
    expect(node!.created_at).toBeGreaterThan(0);
  });

  // ── 3. get returns null for unknown node_id ───────────────────────────────
  it('get returns null for an unknown node_id', () => {
    expect(dag.get('01NONEXISTENT0000000000000')).toBeNull();
  });

  // ── 4. getChildren returns nodes for source_type='nodes' parent ───────────
  it('getChildren returns child nodes for source_type="nodes" parent', () => {
    const child1 = dag.create(newNode({ session_id: 's', depth: 0 }));
    const child2 = dag.create(newNode({ session_id: 's', depth: 0 }));
    const parent = dag.create(newNode({
      session_id: 's',
      depth: 1,
      source_ids: [child1, child2],
      source_type: 'nodes',
    }));

    const children = dag.getChildren(parent);
    expect(children).toHaveLength(2);
    const childIds = children.map((c) => c.node_id);
    expect(childIds).toContain(child1);
    expect(childIds).toContain(child2);
  });

  // ── 5. getChildren returns empty for source_type='messages' parent ─────────
  it('getChildren returns empty array for source_type="messages" node', () => {
    const id = dag.create(newNode({ source_type: 'messages', source_ids: [1, 2, 3] }));
    expect(dag.getChildren(id)).toEqual([]);
  });

  // ── 6. getChildren returns empty for unknown parent ────────────────────────
  it('getChildren returns empty for unknown node_id', () => {
    expect(dag.getChildren('UNKNOWN00000000000000000000')).toEqual([]);
  });

  // ── 7. getSourceMessageIds returns numbers for source_type='messages' ──────
  it('getSourceMessageIds returns numbers for source_type="messages" node', () => {
    const id = dag.create(newNode({ source_type: 'messages', source_ids: [10, 20, 30] }));
    const ids = dag.getSourceMessageIds(id);
    expect(ids).toEqual([10, 20, 30]);
    ids.forEach((v) => expect(typeof v).toBe('number'));
  });

  // ── 8. getSourceMessageIds returns empty for source_type='nodes' ───────────
  it('getSourceMessageIds returns empty for source_type="nodes" node', () => {
    const child = dag.create(newNode());
    const id = dag.create(newNode({
      depth: 1,
      source_ids: [child],
      source_type: 'nodes',
    }));
    expect(dag.getSourceMessageIds(id)).toEqual([]);
  });

  // ── 9. getNodesAtDepth orders by created_at ASC ───────────────────────────
  it('getNodesAtDepth orders by created_at ASC (uses explicit timestamps)', () => {
    // We can't easily control created_at since it's set to Date.now() in create().
    // Insert 3 nodes and verify they come back in insertion order (ulid is time-ordered).
    const id1 = dag.create(newNode({ session_id: 'sess-ord', depth: 0 }));
    const id2 = dag.create(newNode({ session_id: 'sess-ord', depth: 0 }));
    const id3 = dag.create(newNode({ session_id: 'sess-ord', depth: 0 }));

    const nodes = dag.getNodesAtDepth('sess-ord', 0);
    expect(nodes.map((n) => n.node_id)).toEqual([id1, id2, id3]);
  });

  // ── 10. getNodesAtDepth filters by session_id strictly ────────────────────
  it('getNodesAtDepth filters by session_id strictly', () => {
    dag.create(newNode({ session_id: 'sess-A', depth: 0 }));
    dag.create(newNode({ session_id: 'sess-B', depth: 0 }));
    dag.create(newNode({ session_id: 'sess-A', depth: 0 }));

    const nodesA = dag.getNodesAtDepth('sess-A', 0);
    const nodesB = dag.getNodesAtDepth('sess-B', 0);
    expect(nodesA).toHaveLength(2);
    expect(nodesB).toHaveLength(1);
    nodesA.forEach((n) => expect(n.session_id).toBe('sess-A'));
  });

  // ── 11. getUncondensedAtDepth: only non-referenced node returned ──────────
  it('getUncondensedAtDepth returns only nodes not referenced by d+1 parent', () => {
    const sess = 'sess-unc';
    const a = dag.create(newNode({ session_id: sess, depth: 0, summary: 'node a' }));
    const b = dag.create(newNode({ session_id: sess, depth: 0, summary: 'node b' }));
    const c = dag.create(newNode({ session_id: sess, depth: 0, summary: 'node c' }));
    const d = dag.create(newNode({ session_id: sess, depth: 0, summary: 'node d' }));

    // d1 references a, b, c — leaving d uncondensed
    dag.create(newNode({
      session_id: sess,
      depth: 1,
      source_ids: [a, b, c],
      source_type: 'nodes',
      summary: 'parent of a b c',
    }));

    const uncondensed = dag.getUncondensedAtDepth(sess, 0);
    expect(uncondensed).toHaveLength(1);
    expect(uncondensed[0].node_id).toBe(d);
  });

  // ── 12. getUncondensedAtDepth returns all when no d+1 nodes ───────────────
  it('getUncondensedAtDepth returns all nodes when no d+1 nodes exist', () => {
    const sess = 'sess-all-unc';
    const a = dag.create(newNode({ session_id: sess, depth: 0, summary: 'alpha' }));
    const b = dag.create(newNode({ session_id: sess, depth: 0, summary: 'beta' }));

    const uncondensed = dag.getUncondensedAtDepth(sess, 0);
    expect(uncondensed).toHaveLength(2);
    const ids = uncondensed.map((n) => n.node_id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
  });

  // ── 13. search FTS5 happy path ────────────────────────────────────────────
  it('search FTS5: returns matching nodes', () => {
    dag.create(newNode({ session_id: 'fts-sess', summary: 'quantum entanglement theory' }));
    dag.create(newNode({ session_id: 'fts-sess', summary: 'classical mechanics overview' }));

    const results = dag.search('quantum');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const snippets = results.map((r) => r.snippet).join(' ');
    expect(snippets.toLowerCase()).toContain('quantum');
  });

  // ── 14. search returns empty for no match ─────────────────────────────────
  it('search returns empty array when no nodes match', () => {
    dag.create(newNode({ summary: 'hello world nice weather' }));
    const results = dag.search('xyzzy_not_present_anywhere');
    expect(results).toEqual([]);
  });

  // ── 15. search source-lineage filter: d2 node matches when leaves have right source ──
  it('search source-lineage filter matches d2 node when leaf messages have matching source', () => {
    const sess = 'src-match-sess';

    // Seed messages with source='telegram'
    const m1 = store.append({ session_id: sess, source: 'telegram', role: 'user', content: 'keyword telegram message one', ts: 1000 });
    const m2 = store.append({ session_id: sess, source: 'telegram', role: 'user', content: 'keyword telegram message two', ts: 2000 });

    // d0 node summarizing those messages
    const d0 = dag.create(newNode({
      session_id: sess,
      depth: 0,
      summary: 'keyword summary at d0',
      source_ids: [m1, m2],
      source_type: 'messages',
    }));

    // d1 node referencing d0
    const d1 = dag.create(newNode({
      session_id: sess,
      depth: 1,
      summary: 'keyword summary at d1',
      source_ids: [d0],
      source_type: 'nodes',
    }));

    // d2 node referencing d1
    const d2 = dag.create(newNode({
      session_id: sess,
      depth: 2,
      summary: 'keyword summary at d2',
      source_ids: [d1],
      source_type: 'nodes',
    }));

    const results = dag.search('keyword', { source: 'telegram' });
    const resultIds = results.map((r) => r.node_id);
    // d2 (and d1, d0) should match because leaves are telegram messages
    expect(resultIds).toContain(d2);
  });

  // ── 16. search source-lineage filter EXCLUDES non-matching nodes ──────────
  it('search source-lineage filter excludes d2 node when leaf messages have wrong source', () => {
    const sess = 'src-excl-sess';

    // Messages with source='cli' (not 'telegram')
    const m1 = store.append({ session_id: sess, source: 'cli', role: 'user', content: 'exclusion keyword content one', ts: 1000 });
    const m2 = store.append({ session_id: sess, source: 'cli', role: 'user', content: 'exclusion keyword content two', ts: 2000 });

    const d0 = dag.create(newNode({
      session_id: sess,
      depth: 0,
      summary: 'exclusion keyword d0',
      source_ids: [m1, m2],
      source_type: 'messages',
    }));
    const d1 = dag.create(newNode({
      session_id: sess,
      depth: 1,
      summary: 'exclusion keyword d1',
      source_ids: [d0],
      source_type: 'nodes',
    }));
    const d2 = dag.create(newNode({
      session_id: sess,
      depth: 2,
      summary: 'exclusion keyword d2',
      source_ids: [d1],
      source_type: 'nodes',
    }));

    // Search with source='telegram' should return NOTHING
    const results = dag.search('exclusion keyword', { source: 'telegram' });
    const resultIds = results.map((r) => r.node_id);
    expect(resultIds).not.toContain(d2);
    expect(resultIds).not.toContain(d1);
    expect(resultIds).not.toContain(d0);
  });

  // ── 16b. search source-lineage matches legacy blank-source messages when filter is unknown ──
  it('search source-lineage matches legacy blank-source messages when filter is unknown', () => {
    // Insert a message with source='' directly via raw SQL (bypasses MessageStore normalization)
    const insertRaw = db.prepare(`
      INSERT INTO messages (session_id, source, role, content, ts, token_estimate, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const blankId = insertRaw.run('s', '', 'user', 'legacy blank source content', 1, 5, 0).lastInsertRowid as number;

    // Create a d1 node whose source_ids reference the blank-source message
    const nodeId = dag.create({
      session_id: 's',
      depth: 1,
      summary: 'distinctkeyword wraps legacy content',
      token_count: 8,
      source_token_count: 5,
      source_ids: [blankId],
      source_type: 'messages',
      earliest_at: 1,
      latest_at: 1,
    });

    // Search with source: 'unknown' should match the d1 node since its leaf message has source=''
    const results = dag.search('distinctkeyword', { sessionId: 's', source: 'unknown' });
    const ids = results.map(r => r.node_id);
    expect(ids).toContain(nodeId);
  });

  // ── 17. search depthMin/depthMax bounds ───────────────────────────────────
  it('search respects depthMin and depthMax filters', () => {
    const sess = 'depth-filter-sess';
    const d0 = dag.create(newNode({ session_id: sess, depth: 0, summary: 'depthbound topic alpha' }));
    const d1 = dag.create(newNode({ session_id: sess, depth: 1, summary: 'depthbound topic beta', source_type: 'nodes', source_ids: [d0] }));
    const d2 = dag.create(newNode({ session_id: sess, depth: 2, summary: 'depthbound topic gamma', source_type: 'nodes', source_ids: [d1] }));

    const midOnly = dag.search('depthbound', { depthMin: 1, depthMax: 1 });
    const midIds = midOnly.map((r) => r.node_id);
    expect(midIds).toContain(d1);
    expect(midIds).not.toContain(d0);
    expect(midIds).not.toContain(d2);
  });

  // ── 18. search LIKE-fallback for CJK content ─────────────────────────────
  it('search LIKE-fallback works for CJK summary content', () => {
    dag.create(newNode({ summary: '日本語のサマリー テキスト' }));
    dag.create(newNode({ summary: 'english only summary text' }));

    // CJK query should use LIKE fallback
    const results = dag.search('サマリー');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  // ── 19. reassignSessionNodes moves only depth >= minDepth ─────────────────
  it('reassignSessionNodes moves nodes at depth >= minDepth and returns count', () => {
    const old = 'old-sess';
    const neo = 'new-sess';
    dag.create(newNode({ session_id: old, depth: 0, summary: 'depth 0 node' }));
    dag.create(newNode({ session_id: old, depth: 1, summary: 'depth 1 node', source_type: 'nodes', source_ids: [] }));
    dag.create(newNode({ session_id: old, depth: 2, summary: 'depth 2 node', source_type: 'nodes', source_ids: [] }));

    const moved = dag.reassignSessionNodes(old, neo, 1);
    expect(moved).toBe(2); // depth 1 and 2 moved

    expect(dag.getNodesAtDepth(old, 0)).toHaveLength(1); // depth 0 stays
    expect(dag.getNodesAtDepth(old, 1)).toHaveLength(0);
    expect(dag.getNodesAtDepth(neo, 1)).toHaveLength(1);
    expect(dag.getNodesAtDepth(neo, 2)).toHaveLength(1);
  });

  // ── 20. reassignSessionNodes leaves d0 when minDepth=2 ────────────────────
  it('reassignSessionNodes leaves d0 and d1 nodes when minDepth=2', () => {
    const old = 'reassign-old';
    const neo = 'reassign-new';
    dag.create(newNode({ session_id: old, depth: 0 }));
    dag.create(newNode({ session_id: old, depth: 1, source_type: 'nodes', source_ids: [] }));
    dag.create(newNode({ session_id: old, depth: 2, source_type: 'nodes', source_ids: [] }));

    const moved = dag.reassignSessionNodes(old, neo, 2);
    expect(moved).toBe(1); // only depth 2

    expect(dag.getNodesAtDepth(old, 0)).toHaveLength(1);
    expect(dag.getNodesAtDepth(old, 1)).toHaveLength(1);
    expect(dag.getNodesAtDepth(neo, 2)).toHaveLength(1);
  });

  // ── 21. findOrphans detects orphan child reference ────────────────────────
  it('findOrphans detects references to non-existent nodes', () => {
    const sess = 'orphan-sess';
    // A parent referencing a node_id that doesn't exist
    dag.create(newNode({
      session_id: sess,
      depth: 1,
      source_type: 'nodes',
      source_ids: ['FAKEID00000000000000000001', 'FAKEID00000000000000000002'],
    }));

    const orphans = dag.findOrphans();
    expect(orphans).toContain('FAKEID00000000000000000001');
    expect(orphans).toContain('FAKEID00000000000000000002');
  });

  // ── 22. findOrphans filters by session_id when provided ──────────────────
  it('findOrphans filters by session_id when provided', () => {
    dag.create(newNode({
      session_id: 'sess-X',
      depth: 1,
      source_type: 'nodes',
      source_ids: ['ORPHAN_IN_X00000000000000001'],
    }));
    dag.create(newNode({
      session_id: 'sess-Y',
      depth: 1,
      source_type: 'nodes',
      source_ids: ['ORPHAN_IN_Y00000000000000002'],
    }));

    const xOrphans = dag.findOrphans('sess-X');
    expect(xOrphans).toContain('ORPHAN_IN_X00000000000000001');
    expect(xOrphans).not.toContain('ORPHAN_IN_Y00000000000000002');

    const yOrphans = dag.findOrphans('sess-Y');
    expect(yOrphans).toContain('ORPHAN_IN_Y00000000000000002');
    expect(yOrphans).not.toContain('ORPHAN_IN_X00000000000000001');
  });

  // ── 23. findOrphans returns [] when no orphans ────────────────────────────
  it('findOrphans returns empty array when no orphaned references exist', () => {
    const sess = 'clean-sess';
    const child = dag.create(newNode({ session_id: sess, depth: 0 }));
    dag.create(newNode({
      session_id: sess,
      depth: 1,
      source_type: 'nodes',
      source_ids: [child],
    }));

    expect(dag.findOrphans()).toEqual([]);
  });

  // ── 24. walkSubtree returns all descendants for 3-level tree ──────────────
  it('walkSubtree returns all descendants for a 3-level tree', () => {
    const sess = 'walk-sess';
    const g1 = dag.create(newNode({ session_id: sess, depth: 0, summary: 'grandchild 1' }));
    const g2 = dag.create(newNode({ session_id: sess, depth: 0, summary: 'grandchild 2' }));
    const g3 = dag.create(newNode({ session_id: sess, depth: 0, summary: 'grandchild 3' }));
    const g4 = dag.create(newNode({ session_id: sess, depth: 0, summary: 'grandchild 4' }));

    const c1 = dag.create(newNode({ session_id: sess, depth: 1, source_type: 'nodes', source_ids: [g1, g2], summary: 'child 1' }));
    const c2 = dag.create(newNode({ session_id: sess, depth: 1, source_type: 'nodes', source_ids: [g3, g4], summary: 'child 2' }));

    const root = dag.create(newNode({ session_id: sess, depth: 2, source_type: 'nodes', source_ids: [c1, c2], summary: 'root' }));

    const descendants = dag.walkSubtree(root);
    // Should include c1, c2, g1, g2, g3, g4 — NOT the root itself
    expect(descendants).toHaveLength(6);
    expect(descendants).toContain(c1);
    expect(descendants).toContain(c2);
    expect(descendants).toContain(g1);
    expect(descendants).toContain(g2);
    expect(descendants).toContain(g3);
    expect(descendants).toContain(g4);
    expect(descendants).not.toContain(root);
  });

  // ── 25. walkSubtree returns [] for leaf node (source_type='messages') ─────
  it('walkSubtree returns empty array for leaf (source_type="messages") node', () => {
    const leaf = dag.create(newNode({ source_type: 'messages', source_ids: [1, 2, 3] }));
    expect(dag.walkSubtree(leaf)).toEqual([]);
  });

  // ── 26. collectLeafMessageIds — lossless drill-down (CRITICAL) ────────────
  it('collectLeafMessageIds recovers all 12 leaf store_ids from a 3-level tree', () => {
    const sess = 'collect-sess';

    // 4 d0 nodes, each referencing 3 unique message store_ids
    // Use store_ids in 100–111 range to avoid conflict with other tests
    const d0a = dag.create(newNode({ session_id: sess, depth: 0, source_ids: [100, 101, 102], source_type: 'messages' }));
    const d0b = dag.create(newNode({ session_id: sess, depth: 0, source_ids: [103, 104, 105], source_type: 'messages' }));
    const d0c = dag.create(newNode({ session_id: sess, depth: 0, source_ids: [106, 107, 108], source_type: 'messages' }));
    const d0d = dag.create(newNode({ session_id: sess, depth: 0, source_ids: [109, 110, 111], source_type: 'messages' }));

    // 2 d1 nodes each covering 2 d0 nodes
    const d1a = dag.create(newNode({ session_id: sess, depth: 1, source_ids: [d0a, d0b], source_type: 'nodes' }));
    const d1b = dag.create(newNode({ session_id: sess, depth: 1, source_ids: [d0c, d0d], source_type: 'nodes' }));

    // 1 d2 node covering both d1 nodes
    const d2 = dag.create(newNode({ session_id: sess, depth: 2, source_ids: [d1a, d1b], source_type: 'nodes' }));

    const leafIds = dag.collectLeafMessageIds(d2);

    expect(leafIds).toHaveLength(12);
    // Must be deduped and sorted ASC
    const expected = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111];
    expect(leafIds).toEqual(expected);
  });

  // ── 27. collectLeafMessageIds for source_type='messages' node returns own source_ids ──
  it('collectLeafMessageIds for a messages node returns its own source_ids', () => {
    const id = dag.create(newNode({ source_type: 'messages', source_ids: [7, 8, 9] }));
    const leafIds = dag.collectLeafMessageIds(id);
    expect(leafIds).toEqual([7, 8, 9]);
  });

  // ── 28. collectLeafMessageIds for unknown node returns [] ─────────────────
  it('collectLeafMessageIds for unknown node_id returns empty array', () => {
    expect(dag.collectLeafMessageIds('DOESNOTEXIST0000000000000A')).toEqual([]);
  });

  // ── 29. create with expand_hint persists it; get returns it ──────────────
  it('create persists expand_hint; get returns it correctly', () => {
    const hint = 'Expand for details about: neural networks';
    const id = dag.create(newNode({ expand_hint: hint }));
    const node = dag.get(id);
    expect(node!.expand_hint).toBe(hint);
  });

  // ── 30. immutability: only expected methods on prototype ──────────────────
  it('SummaryDAG prototype exposes exactly the 12 public methods + constructor', () => {
    const proto = SummaryDAG.prototype;
    const methods = Object.getOwnPropertyNames(proto).filter((m) => m !== 'constructor');
    const expected = new Set([
      'create',
      'get',
      'getChildren',
      'getSourceMessageIds',
      'getNodesAtDepth',
      'getUncondensedAtDepth',
      'search',
      'reassignSessionNodes',
      'findOrphans',
      'walkSubtree',
      'collectLeafMessageIds',
      'countByDepth',
    ]);
    // No extra public methods
    const unexpectedPublic = methods.filter((m) => !m.startsWith('_') && !expected.has(m));
    expect(unexpectedPublic).toEqual([]);
    // All expected methods exist
    expected.forEach((m) => {
      expect(proto).toHaveProperty(m);
    });
  });

  // ── 31. countByDepth returns correct depth → count map ───────────────────
  it('countByDepth returns correct depth → count mapping', () => {
    const sess = 'count-depth-sess';
    // Create 3 D0 nodes, 2 D1 nodes, 1 D2 node
    dag.create(newNode({ session_id: sess, depth: 0 }));
    dag.create(newNode({ session_id: sess, depth: 0 }));
    dag.create(newNode({ session_id: sess, depth: 0 }));
    dag.create(newNode({ session_id: sess, depth: 1, source_type: 'nodes', source_ids: [] }));
    dag.create(newNode({ session_id: sess, depth: 1, source_type: 'nodes', source_ids: [] }));
    dag.create(newNode({ session_id: sess, depth: 2, source_type: 'nodes', source_ids: [] }));

    const counts = dag.countByDepth(sess);
    expect(counts[0]).toBe(3);
    expect(counts[1]).toBe(2);
    expect(counts[2]).toBe(1);

    // Different session should return empty
    const otherCounts = dag.countByDepth('other-sess');
    expect(Object.keys(otherCounts)).toHaveLength(0);
  });
});
