import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../src/db/bootstrap.js';
import { MessageStore } from '../src/store.js';
import { SummaryDAG } from '../src/dag.js';
import { LifecycleManager } from '../src/lifecycle.js';
import { LCMConfigSchema } from '../src/config.js';
import { createExpandQueryTool, EXPAND_QUERY_RATE_LIMIT_PER_TURN } from '../src/tools/expand-query.js';
import type { AgentState } from '../src/agent-state.js';

const CTX = { agentId: 'test-agent' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDb(dir: string) {
  const db = new Database(join(dir, 'lcm.sqlite'));
  bootstrap(db);
  return db;
}

function makeState(
  db: Database.Database,
  store: MessageStore,
  dag: SummaryDAG,
  sessionKey: string,
): AgentState {
  return {
    db,
    store,
    dag,
    lifecycle: new LifecycleManager(db),
    config: LCMConfigSchema.parse({}),
    sessionKey,
  };
}

function mockSubagent(answer: string) {
  return vi.fn().mockResolvedValue(answer);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createExpandQueryTool', () => {
  let tmp: string;
  let db: Database.Database;
  let store: MessageStore;
  let dag: SummaryDAG;

  let messagesNodeId: string;
  let nodesNodeId: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lcm-expand-query-'));
    db = makeDb(tmp);
    store = new MessageStore(db);
    dag = new SummaryDAG(db);

    // Seed: 3 messages
    store.append({ session_id: 'session1', source: 'cli', role: 'user', content: 'hello world alpha', ts: 1_000 });
    store.append({ session_id: 'session1', source: 'telegram', role: 'assistant', content: 'hi there beta', ts: 2_000 });
    store.append({ session_id: 'session1', source: 'cli', role: 'user', content: 'another gamma', ts: 3_000 });

    // D0 node referencing messages 1 and 2
    messagesNodeId = dag.create({
      session_id: 'session1',
      depth: 0,
      summary: 'Summary of hello/hi exchange',
      token_count: 10,
      source_token_count: 20,
      source_ids: [1, 2],
      source_type: 'messages',
      earliest_at: 1_000,
      latest_at: 2_000,
    });

    // D1 node referencing the D0 node
    nodesNodeId = dag.create({
      session_id: 'session1',
      depth: 1,
      summary: 'Higher level summary of entire session',
      token_count: 8,
      source_token_count: 10,
      source_ids: [messagesNodeId],
      source_type: 'nodes',
      earliest_at: 1_000,
      latest_at: 3_000,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  // Test 1: Tool name, description, schema
  it('has name "expand_query", non-empty description, and a defined inputSchema', () => {
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session1'),
      runSubagent: mockSubagent('answer'),
    });
    expect(tool.name).toBe('expand_query');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(10);
    expect(tool.inputSchema).toBeDefined();
  });

  // Test 2: Schema requires prompt
  it('schema rejects missing prompt', async () => {
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session1'),
      runSubagent: mockSubagent('answer'),
    });
    const result = await tool.handler({ query: 'hello' }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error.length).toBeGreaterThan(0);
  });

  // Test 3: Schema rejects both query+node_ids, and also rejects neither
  it('schema rejects both query AND node_ids simultaneously', async () => {
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session1'),
      runSubagent: mockSubagent('answer'),
    });
    const resultBoth = await tool.handler({ prompt: 'test', query: 'hello', node_ids: [messagesNodeId] }, CTX);
    const parsedBoth = JSON.parse(resultBoth.content[0].text);
    expect(typeof parsedBoth.error).toBe('string');
  });

  it('schema rejects neither query NOR node_ids', async () => {
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session1'),
      runSubagent: mockSubagent('answer'),
    });
    const resultNeither = await tool.handler({ prompt: 'test' }, CTX);
    const parsedNeither = JSON.parse(resultNeither.content[0].text);
    expect(typeof parsedNeither.error).toBe('string');
  });

  // Test 4: Query-mode searches DAG, finds nodes, calls subagent with grounded context
  it('query-mode: searches DAG, calls subagent with grounded context, returns {answer, sources}', async () => {
    const runSubagent = mockSubagent('The answer is about hello world.');
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session1'),
      runSubagent,
    });

    const result = await tool.handler({ prompt: 'What was said?', query: 'hello' }, CTX);
    const parsed = JSON.parse(result.content[0].text);

    // Should have answer and sources
    expect(typeof parsed.answer).toBe('string');
    expect(parsed.answer).toBe('The answer is about hello world.');
    expect(Array.isArray(parsed.sources)).toBe(true);
    expect(parsed.sources.length).toBeGreaterThan(0);

    // Subagent should have been called with prompt + systemPrompt containing the context
    expect(runSubagent).toHaveBeenCalledOnce();
    const callArgs = runSubagent.mock.calls[0][0];
    expect(callArgs.prompt).toBe('What was said?');
    expect(typeof callArgs.systemPrompt).toBe('string');
    expect(callArgs.systemPrompt).toContain('CONTEXT');
    expect(callArgs.systemPrompt).toContain(messagesNodeId);
  });

  // Test 5: node_ids-mode: skips search, uses direct ids
  it('node_ids-mode: skips DAG search, uses direct node_ids', async () => {
    const runSubagent = mockSubagent('Direct answer.');
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session1'),
      runSubagent,
    });

    const result = await tool.handler({ prompt: 'Summarize', node_ids: [messagesNodeId] }, CTX);
    const parsed = JSON.parse(result.content[0].text);

    expect(typeof parsed.answer).toBe('string');
    expect(parsed.answer).toBe('Direct answer.');
    expect(Array.isArray(parsed.sources)).toBe(true);
    // Source node_id should be the one we passed
    expect(parsed.sources[0].node_id).toBe(messagesNodeId);
    // Snippet should be from the summary
    expect(typeof parsed.sources[0].snippet).toBe('string');
    expect(parsed.sources[0].snippet.length).toBeGreaterThan(0);

    // runSubagent called with context containing the messages
    expect(runSubagent).toHaveBeenCalledOnce();
    const callArgs = runSubagent.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain('hello world alpha');
  });

  // Test 6: Empty matches (query yields nothing) → error JSON
  it('query-mode: no matching nodes → returns error JSON', async () => {
    const runSubagent = mockSubagent('Should not be called');
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session1'),
      runSubagent,
    });

    // Use a query that will definitely not match
    const result = await tool.handler({ prompt: 'test', query: 'zzzznotfound1234567890xyz' }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).toMatch(/no matching nodes/i);
    expect(runSubagent).not.toHaveBeenCalled();
  });

  // Test 7: Unknown node_ids (none exist) → error JSON
  it('node_ids-mode: all node_ids unknown → returns error JSON', async () => {
    const runSubagent = mockSubagent('Should not be called');
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session1'),
      runSubagent,
    });

    const result = await tool.handler({ prompt: 'test', node_ids: ['nonexistent-node-id-xyz-123'] }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).toMatch(/no nodes found/i);
    expect(runSubagent).not.toHaveBeenCalled();
  });

  // Test 8: Context cap: many large nodes → only top-by-latest_at fit; sources reflects kept blocks
  it('context cap: large nodes exceed max_context_tokens; newer nodes are kept, older dropped', async () => {
    // Create two nodes with very different timestamps and large content
    const earlyMsgId = store.append({
      session_id: 'session2',
      source: 'cli',
      role: 'user',
      content: 'EARLY: ' + 'e'.repeat(500),
      ts: 100,
    });
    const lateMsgId = store.append({
      session_id: 'session2',
      source: 'cli',
      role: 'user',
      content: 'LATE: ' + 'l'.repeat(500),
      ts: 9_000,
    });

    const earlyNodeId = dag.create({
      session_id: 'session2',
      depth: 0,
      summary: 'Early node summary',
      token_count: 100,
      source_token_count: 200,
      source_ids: [earlyMsgId],
      source_type: 'messages',
      earliest_at: 100,
      latest_at: 100,
    });

    const lateNodeId = dag.create({
      session_id: 'session2',
      depth: 0,
      summary: 'Late node summary',
      token_count: 100,
      source_token_count: 200,
      source_ids: [lateMsgId],
      source_type: 'messages',
      earliest_at: 9_000,
      latest_at: 9_000,
    });

    const runSubagent = mockSubagent('Capped answer.');
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session2'),
      runSubagent,
    });

    // max_context_tokens is tiny — should only fit one node's content
    // Each message content is ~500 chars = ~125 tokens
    // Set max to 150 tokens — fits one, not two
    const result = await tool.handler({
      prompt: 'What happened?',
      node_ids: [earlyNodeId, lateNodeId],
      max_context_tokens: 150,
    }, CTX);
    const parsed = JSON.parse(result.content[0].text);

    // Should succeed (at least 1 fits)
    expect(parsed.error).toBeUndefined();
    expect(typeof parsed.answer).toBe('string');
    // Only 1 source should appear (the newer one, lateNodeId)
    expect(parsed.sources.length).toBe(1);
    expect(parsed.sources[0].node_id).toBe(lateNodeId);
    // The subagent context should contain LATE but not EARLY
    const callArgs = runSubagent.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain('LATE');
    expect(callArgs.systemPrompt).not.toContain('EARLY');
  });

  // Test 9: subagent returns empty → error JSON
  it('subagent returns empty string → returns error JSON', async () => {
    const runSubagent = vi.fn().mockResolvedValue('');
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session1'),
      runSubagent,
    });

    const result = await tool.handler({ prompt: 'test', node_ids: [messagesNodeId] }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).toMatch(/empty/i);
  });

  // Test 10: subagent throws → error JSON
  it('subagent throws → returns error JSON', async () => {
    const runSubagent = vi.fn().mockRejectedValue(new Error('subagent timeout'));
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session1'),
      runSubagent,
    });

    const result = await tool.handler({ prompt: 'test', node_ids: [messagesNodeId] }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).toMatch(/subagent timeout/i);
  });

  // Test 11: Rate limit (5/turn): 6th call returns error
  it('rate limit: 6th call returns error JSON', async () => {
    expect(EXPAND_QUERY_RATE_LIMIT_PER_TURN).toBe(5);

    const runSubagent = mockSubagent('ok');
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session1'),
      runSubagent,
    });

    // First 5 calls should succeed
    for (let i = 0; i < EXPAND_QUERY_RATE_LIMIT_PER_TURN; i++) {
      const result = await tool.handler({ prompt: 'test', node_ids: [messagesNodeId] }, CTX);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBeUndefined();
    }

    // 6th call should return rate limit error
    const result = await tool.handler({ prompt: 'test', node_ids: [messagesNodeId] }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).toMatch(/rate limit/i);
  });

  // Test 12: expansionTimeoutMs forwarded to runSubagent
  it('expansionTimeoutMs is forwarded to runSubagent as timeoutMs', async () => {
    const runSubagent = mockSubagent('timed answer');
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session1'),
      runSubagent,
      expansionTimeoutMs: 42_000,
    });

    await tool.handler({ prompt: 'test', node_ids: [messagesNodeId] }, CTX);

    expect(runSubagent).toHaveBeenCalledOnce();
    const callArgs = runSubagent.mock.calls[0][0];
    expect(callArgs.timeoutMs).toBe(42_000);
  });

  // Test 13: nodes-type source uses summary text (no recursion)
  it('nodes-type source_type uses summary text directly (no recursion)', async () => {
    const runSubagent = mockSubagent('summary-based answer');
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session1'),
      runSubagent,
    });

    const result = await tool.handler({ prompt: 'test', node_ids: [nodesNodeId] }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.answer).toBe('string');

    // systemPrompt should contain the D1 node's summary text
    const callArgs = runSubagent.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain('Higher level summary');
    // Should NOT contain raw message content (no recursion)
    expect(callArgs.systemPrompt).not.toContain('hello world alpha');
  });

  // Bonus Test 14: snippet in sources is at most 200 chars
  it('sources[].snippet is truncated to at most 200 chars', async () => {
    // Create a node with a very long summary
    const longSummary = 'x'.repeat(300);
    const longMsgId = store.append({
      session_id: 'session3',
      source: 'cli',
      role: 'user',
      content: 'test content',
      ts: 5_000,
    });
    const longNodeId = dag.create({
      session_id: 'session3',
      depth: 0,
      summary: longSummary,
      token_count: 10,
      source_token_count: 20,
      source_ids: [longMsgId],
      source_type: 'messages',
      earliest_at: 5_000,
      latest_at: 5_000,
    });

    const runSubagent = mockSubagent('answer with long snippet');
    const tool = createExpandQueryTool({
      resolveAgent: () => makeState(db, store, dag, 'session3'),
      runSubagent,
    });

    const result = await tool.handler({ prompt: 'test', node_ids: [longNodeId] }, CTX);
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.answer).toBe('string');
    expect(Array.isArray(parsed.sources)).toBe(true);
    expect(parsed.sources[0].snippet.length).toBeLessThanOrEqual(200);
  });
});
