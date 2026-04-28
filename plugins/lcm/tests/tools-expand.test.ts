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
import { createExpandTool, EXPAND_RATE_LIMIT_PER_TURN } from '../src/tools/expand.js';
import type { AgentState } from '../src/agent-state.js';

const CTX = { agentId: 'test-agent' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDb(dir: string) {
  const db = new Database(join(dir, 'lcm.sqlite'));
  bootstrap(db);
  return db;
}

function makeState(db: Database.Database, store: MessageStore, dag: SummaryDAG): AgentState {
  return {
    db,
    store,
    dag,
    lifecycle: new LifecycleManager(db),
    config: LCMConfigSchema.parse({}),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createExpandTool', () => {
  let tmp: string;
  let db: Database.Database;
  let store: MessageStore;
  let dag: SummaryDAG;
  let tool: ReturnType<typeof createExpandTool>;

  // DAG node ids for test data
  let messagesNodeId: string;
  let nodesNodeId: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lcm-expand-'));
    db = makeDb(tmp);
    store = new MessageStore(db);
    dag = new SummaryDAG(db);

    const state = makeState(db, store, dag);
    tool = createExpandTool({ resolveAgent: () => state });

    // Seed: 3 messages in session1
    store.append({ session_id: 'session1', source: 'cli', role: 'user', content: 'hello world', ts: 1000 });
    store.append({ session_id: 'session1', source: 'telegram', role: 'assistant', content: 'hi there', ts: 2000 });
    store.append({ session_id: 'session1', source: 'cli', role: 'user', content: 'another message', ts: 3000 });

    // Create a source_type='messages' D0 node referencing messages 1 and 2
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

    // Create a source_type='nodes' D1 node referencing the D0 node
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

  // Test 1: Tool name is 'expand'
  it('has name "expand"', () => {
    expect(tool.name).toBe('expand');
  });

  // Test 2: Has description and Zod schema
  it('has non-empty description and Zod inputSchema', () => {
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(10);
    expect(tool.inputSchema).toBeDefined();
  });

  // Test 3: Schema rejects empty input (no node_id and no externalized_ref)
  it('schema rejects empty input — refine fires with error', async () => {
    const result = await tool.handler({}, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error.length).toBeGreaterThan(0);
  });

  // Test 4: Schema rejects both node_id AND externalized_ref simultaneously
  it('schema rejects both node_id AND externalized_ref — refine fires with error', async () => {
    const result = await tool.handler({ node_id: messagesNodeId, externalized_ref: 'some-ref' }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error.length).toBeGreaterThan(0);
  });

  // Test 5: node_id with source_type='messages' returns type='messages' and items array
  it('node_id with source_type="messages" returns type="messages" and items with StoredMessage projections', async () => {
    const result = await tool.handler({ node_id: messagesNodeId }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe('messages');
    expect(parsed.node_id).toBe(messagesNodeId);
    expect(parsed.depth).toBe(0);
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(parsed.items.length).toBe(2);
    expect(typeof parsed.truncated).toBe('boolean');
    expect(parsed.truncated).toBe(false);

    // Each item should have the required fields
    for (const item of parsed.items) {
      expect(typeof item.store_id).toBe('number');
      expect(typeof item.role).toBe('string');
      expect(typeof item.content).toBe('string');
      expect(typeof item.ts).toBe('number');
      expect(typeof item.source).toBe('string');
    }

    // Check that content is present (not just snippets)
    expect(parsed.items[0].content).toBe('hello world');
    expect(parsed.items[1].content).toBe('hi there');
  });

  // Test 6: node_id with source_type='nodes' returns type='nodes' and items of SummaryNode projections (NOT recursive)
  it('node_id with source_type="nodes" returns type="nodes" with direct child SummaryNode projections', async () => {
    const result = await tool.handler({ node_id: nodesNodeId }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe('nodes');
    expect(parsed.node_id).toBe(nodesNodeId);
    expect(parsed.depth).toBe(1);
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(parsed.items.length).toBe(1);
    expect(typeof parsed.truncated).toBe('boolean');
    expect(parsed.truncated).toBe(false);

    const child = parsed.items[0];
    expect(child.node_id).toBe(messagesNodeId);
    expect(child.depth).toBe(0);
    expect(typeof child.summary).toBe('string');
    expect(typeof child.token_count).toBe('number');
    expect(child.source_type).toBe('messages');
    expect(typeof child.earliest_at).toBe('number');
    expect(typeof child.latest_at).toBe('number');
    // expand_hint is present (nullable)
    expect('expand_hint' in child).toBe(true);

    // Should NOT recursively expand beyond direct children
    // (the child itself should NOT have its own sub-children items)
    expect(child.items).toBeUndefined();
  });

  // Test 7: Unknown node_id returns error JSON
  it('unknown node_id returns error JSON', async () => {
    const result = await tool.handler({ node_id: 'nonexistent-node-id-xyz' }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).toMatch(/not found/i);
  });

  // Test 8: max_tokens caps results — truncated=true when many messages exceed limit
  it('max_tokens caps results: many messages exceed max_tokens → items.length < total and truncated=true', async () => {
    // Insert 10 messages with long content (>40 chars each)
    const longContent = 'x'.repeat(200); // will be ~50 tokens each
    const longIds: number[] = [];
    for (let i = 0; i < 10; i++) {
      const id = store.append({
        session_id: 'session2',
        source: 'cli',
        role: 'user',
        content: `Message ${i}: ${longContent}`,
        ts: 5000 + i,
      });
      longIds.push(id);
    }

    const bigNodeId = dag.create({
      session_id: 'session2',
      depth: 0,
      summary: 'Big node',
      token_count: 500,
      source_token_count: 1000,
      source_ids: longIds,
      source_type: 'messages',
      earliest_at: 5000,
      latest_at: 5009,
    });

    // Use a small max_tokens to trigger truncation (100 tokens will fit ~1-2 items)
    const result = await tool.handler({ node_id: bigNodeId, max_tokens: 100 }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe('messages');
    expect(parsed.items.length).toBeLessThan(10);
    expect(parsed.truncated).toBe(true);
  });

  // Test 9: max_tokens very large doesn't truncate — truncated=false
  it('max_tokens very large does not truncate; truncated=false', async () => {
    const result = await tool.handler({ node_id: messagesNodeId, max_tokens: 50000 }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe('messages');
    expect(parsed.items.length).toBe(2);
    expect(parsed.truncated).toBe(false);
  });

  // Test 10: externalized_ref with reader undefined returns error "not supported"
  it('externalized_ref with reader undefined returns error "not supported"', async () => {
    // tool has no reader (created without externalizedReader)
    const result = await tool.handler({ externalized_ref: 'some-ref' }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).toMatch(/not supported/i);
  });

  // Test 11: externalized_ref with reader returning null returns error "not found"
  it('externalized_ref with reader returning null returns error "not found"', async () => {
    const localState = makeState(db, store, dag);
    const toolWithReader = createExpandTool({
      resolveAgent: () => localState,
      externalizedReader: async (_ref) => null,
    });
    const result = await toolWithReader.handler({ externalized_ref: 'missing-ref' }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).toMatch(/not found/i);
  });

  // Test 12: externalized_ref with reader returning content returns type='externalized'
  it('externalized_ref with reader returning content returns type="externalized" with content and size', async () => {
    const content = 'Full content of the externalized blob';
    const localState = makeState(db, store, dag);
    const toolWithReader = createExpandTool({
      resolveAgent: () => localState,
      externalizedReader: async (ref) => ({ content: `[${ref}] ${content}`, size: content.length }),
    });
    const result = await toolWithReader.handler({ externalized_ref: 'ref-abc' }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe('externalized');
    expect(parsed.externalized_ref).toBe('ref-abc');
    expect(typeof parsed.content).toBe('string');
    expect(parsed.content).toContain(content);
    expect(typeof parsed.size).toBe('number');
    expect(parsed.size).toBe(content.length);
  });

  // Test 13: Rate limit — 11th call returns error JSON
  it('rate limit: 11th call returns error JSON', async () => {
    expect(EXPAND_RATE_LIMIT_PER_TURN).toBe(10);

    // 10 calls should succeed
    for (let i = 0; i < EXPAND_RATE_LIMIT_PER_TURN; i++) {
      const result = await tool.handler({ node_id: messagesNodeId }, CTX);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBeUndefined();
    }

    // 11th call should return rate limit error
    const result = await tool.handler({ node_id: messagesNodeId }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).toMatch(/rate limit/i);
  });
});
