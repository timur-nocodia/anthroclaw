import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../src/db/bootstrap.js';
import { MessageStore } from '../src/store.js';
import { SummaryDAG } from '../src/dag.js';
import { LifecycleManager } from '../src/lifecycle.js';
import { LCMConfigSchema } from '../src/config.js';
import { createDescribeTool, DESCRIBE_RATE_LIMIT_PER_TURN } from '../src/tools/describe.js';
import { createStatusTool, STATUS_RATE_LIMIT_PER_TURN } from '../src/tools/status.js';
import type { AgentState } from '../src/agent-state.js';

const CTX_DESC = { agentId: 'test-agent' };
const CTX_STATUS = { agentId: 'agent1' };

// ─── Shared helpers ──────────────────────────────────────────────────────────

function makeDb(dir: string) {
  const db = new Database(join(dir, 'lcm.sqlite'));
  bootstrap(db);
  return db;
}

function makeState(
  db: Database.Database,
  store: MessageStore,
  dag: SummaryDAG,
  lifecycle?: LifecycleManager,
): AgentState {
  return {
    db,
    store,
    dag,
    lifecycle: lifecycle ?? new LifecycleManager(db),
    config: LCMConfigSchema.parse({}),
  };
}

// ─── lcm_describe tests ──────────────────────────────────────────────────────

describe('createDescribeTool', () => {
  let tmp: string;
  let db: Database.Database;
  let store: MessageStore;
  let dag: SummaryDAG;
  let tool: ReturnType<typeof createDescribeTool>;

  // node_ids for test data
  let messagesNodeId: string;
  let nodesNodeId: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lcm-describe-'));
    db = makeDb(tmp);
    store = new MessageStore(db);
    dag = new SummaryDAG(db);

    const state = makeState(db, store, dag);
    tool = createDescribeTool({ resolveAgent: () => state });

    // Seed: 3 messages in session1
    store.append({ session_id: 'session1', source: 'cli', role: 'user', content: 'hello world', ts: 1000 });
    store.append({ session_id: 'session1', source: 'telegram', role: 'assistant', content: 'hi there', ts: 2000 });
    store.append({ session_id: 'session1', source: 'cli', role: 'user', content: 'another message', ts: 3000 });

    // Create a source_type='messages' D0 node
    messagesNodeId = dag.create({
      session_id: 'session1',
      depth: 0,
      summary: 'Summary of messages',
      token_count: 10,
      source_token_count: 20,
      source_ids: [1, 2],
      source_type: 'messages',
      earliest_at: 1000,
      latest_at: 2000,
      expand_hint: 'Expand to see full conversation',
    });

    // Create a source_type='nodes' D1 node
    nodesNodeId = dag.create({
      session_id: 'session1',
      depth: 1,
      summary: 'Higher level summary',
      token_count: 8,
      source_token_count: 10,
      source_ids: [messagesNodeId],
      source_type: 'nodes',
      earliest_at: 1000,
      latest_at: 2000,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  // Test 1: Tool name is 'describe', has description, has Zod schema
  it('has name "describe", non-empty description, and Zod inputSchema', () => {
    expect(tool.name).toBe('describe');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(10);
    expect(tool.inputSchema).toBeDefined();
  });

  // Test 2: No-args call returns overview
  it('no-args call returns overview with depth_distribution, total_messages, total_nodes, oldest_at, newest_at (T24: aggregated across whole agent DB by default)', async () => {
    const result = await tool.handler({}, CTX_DESC);
    const parsed = JSON.parse(result.content[0].text);
    // No session_id → null (aggregated across all sessions in agent DB)
    expect(parsed.session_key).toBeNull();
    expect(typeof parsed.session_count).toBe('number');
    expect(typeof parsed.total_messages).toBe('number');
    expect(parsed.total_messages).toBe(3);
    expect(typeof parsed.total_nodes).toBe('number');
    expect(parsed.total_nodes).toBe(2);
    expect(parsed.depth_distribution).toBeDefined();
    expect(typeof parsed.depth_distribution).toBe('object');
    // Depth 0 has 1 node, depth 1 has 1 node
    expect(parsed.depth_distribution['0']).toBe(1);
    expect(parsed.depth_distribution['1']).toBe(1);
    expect(parsed.oldest_at).toBe(1000);
    expect(parsed.newest_at).toBe(3000);
  });

  it('explicit session_id input narrows the overview to that session', async () => {
    const result = await tool.handler({ session_id: 'session1' }, CTX_DESC);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.session_key).toBe('session1');
    expect(parsed.session_count).toBe(1);
    expect(parsed.total_messages).toBe(3);
    expect(parsed.total_nodes).toBe(2);
  });

  // Test 3: node_id arg for source_type='messages' node returns metadata with children as {store_id, role, snippet}
  it('node_id arg for source_type="messages" node returns metadata with children as {store_id, role, snippet}', async () => {
    const result = await tool.handler({ node_id: messagesNodeId }, CTX_DESC);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.node_id).toBe(messagesNodeId);
    expect(parsed.depth).toBe(0);
    expect(parsed.summary).toBe('Summary of messages');
    expect(parsed.token_count).toBe(10);
    expect(parsed.source_token_count).toBe(20);
    expect(parsed.source_count).toBe(2);
    expect(parsed.source_type).toBe('messages');
    expect(parsed.expand_hint).toBe('Expand to see full conversation');
    expect(parsed.earliest_at).toBe(1000);
    expect(parsed.latest_at).toBe(2000);
    expect(Array.isArray(parsed.children)).toBe(true);
    expect(parsed.children.length).toBe(2);
    // Children should have store_id, role, snippet
    for (const child of parsed.children) {
      expect(typeof child.store_id).toBe('number');
      expect(typeof child.role).toBe('string');
      expect(typeof child.snippet).toBe('string');
      // snippet is content.slice(0, 80)
      expect(child.snippet.length).toBeLessThanOrEqual(80);
      // should not have node_id
      expect(child.node_id).toBeUndefined();
    }
  });

  // Test 4: node_id arg for source_type='nodes' node returns metadata with children as {node_id, depth}
  it('node_id arg for source_type="nodes" node returns metadata with children as {node_id, depth}', async () => {
    const result = await tool.handler({ node_id: nodesNodeId }, CTX_DESC);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.node_id).toBe(nodesNodeId);
    expect(parsed.depth).toBe(1);
    expect(parsed.source_type).toBe('nodes');
    expect(Array.isArray(parsed.children)).toBe(true);
    expect(parsed.children.length).toBe(1);
    // Children should have node_id, depth
    const child = parsed.children[0];
    expect(typeof child.node_id).toBe('string');
    expect(typeof child.depth).toBe('number');
    // should not have store_id
    expect(child.store_id).toBeUndefined();
  });

  // Test 5: node_id for unknown id returns error JSON
  it('node_id for unknown id returns error JSON', async () => {
    const result = await tool.handler({ node_id: 'nonexistent-node-id-xyz' }, CTX_DESC);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).toMatch(/not found/i);
  });

  // Test 6: Both node_id AND externalized_ref → refine error → error JSON
  it('both node_id AND externalized_ref → Zod refine error → error JSON', async () => {
    const result = await tool.handler({ node_id: messagesNodeId, externalized_ref: 'some-ref' }, CTX_DESC);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error.length).toBeGreaterThan(0);
  });

  // Test 7: externalized_ref with no reader configured → error JSON
  it('externalized_ref with no reader configured → error JSON', async () => {
    const result = await tool.handler({ externalized_ref: 'some-ref' }, CTX_DESC);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).toMatch(/not supported/i);
  });

  // Test 8: externalized_ref with reader returning content → returns preview + size
  it('externalized_ref with reader returning content → preview + size', async () => {
    const content = 'A'.repeat(2000);
    const reader = async (_ref: string) => ({ content, size: content.length });
    const localState = makeState(db, store, dag);
    const toolWithReader = createDescribeTool({
      resolveAgent: () => localState,
      externalizedReader: reader,
    });
    const result = await toolWithReader.handler({ externalized_ref: 'ref-abc' }, CTX_DESC);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.externalized_ref).toBe('ref-abc');
    expect(typeof parsed.preview).toBe('string');
    expect(parsed.preview.length).toBe(1000); // first 1000 chars
    expect(parsed.size).toBe(2000);
  });

  // Test 9: externalized_ref with reader returning null → error JSON
  it('externalized_ref with reader returning null → error JSON', async () => {
    const reader = async (_ref: string) => null;
    const localState = makeState(db, store, dag);
    const toolWithReader = createDescribeTool({
      resolveAgent: () => localState,
      externalizedReader: reader,
    });
    const result = await toolWithReader.handler({ externalized_ref: 'missing-ref' }, CTX_DESC);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).toMatch(/not found/i);
  });

  // Test 10: Rate limit - 11th call returns error
  it('rate limit: 11th call returns error JSON', async () => {
    expect(DESCRIBE_RATE_LIMIT_PER_TURN).toBe(10);
    // 10 calls should succeed
    for (let i = 0; i < DESCRIBE_RATE_LIMIT_PER_TURN; i++) {
      const result = await tool.handler({}, CTX_DESC);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBeUndefined();
    }
    // 11th call should return rate limit error
    const result = await tool.handler({}, CTX_DESC);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).toMatch(/rate limit/i);
  });
});

// ─── lcm_status tests ────────────────────────────────────────────────────────

describe('createStatusTool', () => {
  let tmp: string;
  let db: Database.Database;
  let store: MessageStore;
  let dag: SummaryDAG;
  let lifecycle: LifecycleManager;
  let tool: ReturnType<typeof createStatusTool>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lcm-status-'));
    db = makeDb(tmp);
    store = new MessageStore(db);
    dag = new SummaryDAG(db);
    lifecycle = new LifecycleManager(db);

    lifecycle.initialize('agent1', 'session1');

    const state = makeState(db, store, dag, lifecycle);
    tool = createStatusTool({ resolveAgent: () => state });

    // Seed some data
    store.append({ session_id: 'session1', source: 'cli', role: 'user', content: 'hello', ts: 1000 });
    store.append({ session_id: 'session1', source: 'cli', role: 'assistant', content: 'hi there', ts: 2000 });

    dag.create({
      session_id: 'session1',
      depth: 0,
      summary: 'D0 summary',
      token_count: 5,
      source_token_count: 10,
      source_ids: [1],
      source_type: 'messages',
      earliest_at: 1000,
      latest_at: 1000,
    });

    dag.create({
      session_id: 'session1',
      depth: 1,
      summary: 'D1 summary',
      token_count: 3,
      source_token_count: 5,
      source_ids: [1],
      source_type: 'messages',
      earliest_at: 1000,
      latest_at: 1000,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  // Test 11: Tool name is 'status', has description
  it('has name "status" and non-empty description', () => {
    expect(tool.name).toBe('status');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(10);
  });

  // Test 12: Empty input call returns full status JSON with store, dag, lifecycle keys
  it('empty input call returns full status JSON with store, dag, lifecycle, compression_count, last_compressed_at', async () => {
    const result = await tool.handler({}, CTX_STATUS);
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    // No session_id → null (aggregated across all sessions in agent DB)
    expect(parsed.session_key).toBeNull();
    expect(typeof parsed.session_count).toBe('number');
    expect(parsed.store).toBeDefined();
    expect(parsed.dag).toBeDefined();
    expect(parsed.lifecycle).toBeDefined();
    expect(typeof parsed.compression_count).toBe('number');
    expect(parsed.last_compressed_at).toBeNull();
  });

  it('explicit session_id input narrows the snapshot to that session', async () => {
    const result = await tool.handler({ session_id: 'session1' }, CTX_STATUS);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.session_key).toBe('session1');
    expect(parsed.session_count).toBe(1);
    expect(parsed.store.messages).toBe(2);
    expect(parsed.dag.d0).toBe(1);
    expect(parsed.dag.d1).toBe(1);
  });

  // Test 13: dag keys formatted as d0, d1, etc. (strings)
  it('dag keys are formatted as d0, d1, etc.', async () => {
    const result = await tool.handler({}, CTX_STATUS);
    const parsed = JSON.parse(result.content[0].text);
    // We have depth 0 and depth 1 nodes
    expect(parsed.dag['d0']).toBe(1);
    expect(parsed.dag['d1']).toBe(1);
    // No numeric keys
    expect(parsed.dag['0']).toBeUndefined();
    expect(parsed.dag['1']).toBeUndefined();
  });

  // Test 14: lifecycle keys: current_session_id, current_frontier_store_id, debt_kind, etc.
  it('lifecycle contains required keys', async () => {
    const result = await tool.handler({}, CTX_STATUS);
    const parsed = JSON.parse(result.content[0].text);
    const lc = parsed.lifecycle;
    expect('current_session_id' in lc).toBe(true);
    expect('last_finalized_session_id' in lc).toBe(true);
    expect('current_frontier_store_id' in lc).toBe(true);
    expect('debt_kind' in lc).toBe(true);
    expect('debt_size_estimate' in lc).toBe(true);
    expect('updated_at' in lc).toBe(true);
    expect(lc.current_session_id).toBe('session1');
  });

  // Test 15: compression_count returns 0; last_compressed_at returns null
  it('compression_count is 0 and last_compressed_at is null (T9-deferred)', async () => {
    const result = await tool.handler({}, CTX_STATUS);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.compression_count).toBe(0);
    expect(parsed.last_compressed_at).toBeNull();
  });

  // Test 16: Rate limit - 11th call returns error
  it('rate limit: 11th call returns error JSON', async () => {
    expect(STATUS_RATE_LIMIT_PER_TURN).toBe(10);
    // 10 calls should succeed
    for (let i = 0; i < STATUS_RATE_LIMIT_PER_TURN; i++) {
      const result = await tool.handler({}, CTX_STATUS);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBeUndefined();
    }
    // 11th call should return rate limit error
    const result = await tool.handler({}, CTX_STATUS);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).toMatch(/rate limit/i);
  });
});
