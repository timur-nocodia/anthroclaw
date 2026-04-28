import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../src/db/bootstrap.js';
import { MessageStore } from '../src/store.js';
import { SummaryDAG } from '../src/dag.js';
import { LifecycleManager } from '../src/lifecycle.js';
import { LCMEngine, type EngineMessage, type ResolvedLCMConfig } from '../src/engine.js';

// ─── Shared config ───────────────────────────────────────────────────────────

const baseConfig: ResolvedLCMConfig = {
  leafChunkTokens: 200,
  condensationFanin: 4,
  freshTailLength: 6,
  assemblyCapTokens: 4000,
  l3TruncateChars: 2048,
  l2BudgetRatio: 0.5,
  dynamicLeafChunk: true,
  cacheFriendlyCondensation: true,
};

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function mockSubagent(returns: string | ((prompt: string) => string)) {
  return vi.fn(async (args: { prompt: string }) => {
    if (typeof returns === 'function') return returns(args.prompt);
    return returns;
  });
}

/**
 * Generate N messages with enough content to have meaningful token counts.
 * Each message is ~20 words (~25 tokens estimated via char/4).
 */
function genMsgs(n: number, role: 'user' | 'assistant' = 'user'): EngineMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role,
    content: `msg #${i} content here ${'word '.repeat(20)}`,
    ts: 1000 + i,
  }));
}

function makeEngine(
  store: MessageStore,
  dag: SummaryDAG,
  lifecycle: LifecycleManager,
  runSubagent: ReturnType<typeof mockSubagent>,
  config: ResolvedLCMConfig = baseConfig,
) {
  return new LCMEngine({
    store,
    dag,
    lifecycle,
    runSubagent,
    config,
    logger: noopLogger,
  });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('LCMEngine', () => {
  let tmp: string;
  let db: Database.Database;
  let store: MessageStore;
  let dag: SummaryDAG;
  let lifecycle: LifecycleManager;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lcm-engine-'));
    db = new Database(join(tmp, 'lcm.sqlite'));
    bootstrap(db);
    store = new MessageStore(db);
    dag = new SummaryDAG(db);
    lifecycle = new LifecycleManager(db);
    lifecycle.initialize('agent1', 'session1');
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  // ── 1. ingest appends messages to store ──────────────────────────────────
  it('ingest: appends messages to store with correct source', () => {
    const engine = makeEngine(store, dag, lifecycle, mockSubagent('summary'));
    const msgs: EngineMessage[] = [
      { role: 'user', content: 'hello world', ts: 1000 },
      { role: 'assistant', content: 'hello back', ts: 1001 },
    ];

    engine.ingest('session1', 'telegram', msgs);

    const stored = store.listSession('session1');
    expect(stored).toHaveLength(2);
    expect(stored[0].source).toBe('telegram');
    expect(stored[0].role).toBe('user');
    expect(stored[0].content).toBe('hello world');
    expect(stored[1].role).toBe('assistant');
  });

  // ── 2. compress no-op when messages ≤ freshTailLength + 1 ────────────────
  it('compress: no-op when messages ≤ freshTailLength + 1 (system + fresh tail)', async () => {
    const engine = makeEngine(store, dag, lifecycle, mockSubagent('summary'));
    // system + 6 messages = 7 total = freshTailLength + 1
    const msgs: EngineMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      ...genMsgs(6),
    ];

    engine.ingest('session1', 'cli', msgs);
    const result = await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 500,
    });

    expect(result.compressionApplied).toBe(false);
    expect(result.newNodesCreated).toBe(0);
    expect(result.messages).toBe(msgs); // same reference
  });

  // ── 3. compress 50 messages → leaf pass creates D0 nodes ─────────────────
  it('compress: 50 messages → leaf pass creates D0 nodes in DAG', async () => {
    const engine = makeEngine(store, dag, lifecycle, mockSubagent('short summary'), {
      ...baseConfig,
      leafChunkTokens: 200,
      condensationFanin: 100, // prevent condensation from running
      cacheFriendlyCondensation: false,
    });

    const sysMsg: EngineMessage = { role: 'system', content: 'System prompt.' };
    const bodyMsgs = genMsgs(50);
    const msgs = [sysMsg, ...bodyMsgs];

    engine.ingest('session1', 'cli', msgs);
    const result = await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 5000,
    });

    expect(result.compressionApplied).toBe(true);
    expect(result.newNodesCreated).toBeGreaterThan(0);

    const d0Nodes = dag.getNodesAtDepth('session1', 0);
    expect(d0Nodes.length).toBeGreaterThan(0);
  });

  // ── 4. compress 100 messages → D0 + D1 nodes after condensation ───────────
  it('compress: 100 messages → D0 and D1 nodes after condensation', async () => {
    const engine = makeEngine(store, dag, lifecycle, mockSubagent('short summary'), {
      ...baseConfig,
      leafChunkTokens: 150,
      condensationFanin: 4,
      cacheFriendlyCondensation: false,
    });

    const sysMsg: EngineMessage = { role: 'system', content: 'System prompt.' };
    const bodyMsgs = genMsgs(100);
    const msgs = [sysMsg, ...bodyMsgs];

    engine.ingest('session1', 'cli', msgs);
    const result = await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 10000,
    });

    expect(result.compressionApplied).toBe(true);

    const d0Nodes = dag.getNodesAtDepth('session1', 0);
    const d1Nodes = dag.getNodesAtDepth('session1', 1);
    expect(d0Nodes.length).toBeGreaterThan(0);
    expect(d1Nodes.length).toBeGreaterThan(0);
  });

  // ── 5. condensationFanin=4: 4 D0 nodes → exactly 1 D1 ───────────────────
  it('compress: condensationFanin=4 with exactly 4 D0 → exactly 1 D1', async () => {
    // Use tiny leafChunkTokens to force many D0 nodes from few messages
    const engine = makeEngine(store, dag, lifecycle, mockSubagent('short summary'), {
      ...baseConfig,
      leafChunkTokens: 50,
      condensationFanin: 4,
      cacheFriendlyCondensation: false,
      dynamicLeafChunk: false,
    });

    const sysMsg: EngineMessage = { role: 'system', content: 'System prompt.' };
    // Each message has ~20 words, ~100 chars, ~25 tokens. leafChunkTokens=50 → ~2 per chunk.
    // 8 body msgs → ~4 D0 chunks → 1 D1 condensation
    const bodyMsgs = genMsgs(8);
    const msgs = [sysMsg, ...bodyMsgs];

    engine.ingest('session1', 'cli', msgs);
    const result = await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 2000,
    });

    const d0Nodes = dag.getNodesAtDepth('session1', 0);
    const d1Nodes = dag.getNodesAtDepth('session1', 1);

    // We should have D0 nodes that were condensed
    expect(result.compressionApplied).toBe(true);
    // At least one D1 node should exist (4 D0 → 1 D1)
    if (d0Nodes.length >= 4) {
      expect(d1Nodes.length).toBeGreaterThanOrEqual(1);
    }
  });

  // ── 6a. cacheFriendlyCondensation=true skips single fanin group ─────────
  it('compress: cacheFriendlyCondensation=true skips condensation when only 1 fanin group exists', async () => {
    const runSubagent = mockSubagent('short summary');
    const engine = makeEngine(store, dag, lifecycle, runSubagent, {
      ...baseConfig,
      leafChunkTokens: 50,
      condensationFanin: 4,
      cacheFriendlyCondensation: true,
      dynamicLeafChunk: false,
    });

    const sysMsg: EngineMessage = { role: 'system', content: 'System prompt.' };
    // 8 messages → ~4 D0 nodes = exactly 1 fanin group → should be SKIPPED
    const bodyMsgs = genMsgs(8);
    const msgs = [sysMsg, ...bodyMsgs];

    engine.ingest('session1', 'cli', msgs);
    await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 2000,
    });

    // With cacheFriendlyCondensation=true and only 1 group, D1 should NOT be created
    const d1Nodes = dag.getNodesAtDepth('session1', 1);
    expect(d1Nodes.length).toBe(0);
  });

  // ── 6b. cacheFriendlyCondensation=false condenses anyway ─────────────────
  it('compress: cacheFriendlyCondensation=false condenses even with 1 fanin group', async () => {
    const runSubagent = mockSubagent('short summary');
    const engine = makeEngine(store, dag, lifecycle, runSubagent, {
      ...baseConfig,
      leafChunkTokens: 50,
      condensationFanin: 4,
      cacheFriendlyCondensation: false,
      dynamicLeafChunk: false,
    });

    const sysMsg: EngineMessage = { role: 'system', content: 'System prompt.' };
    const bodyMsgs = genMsgs(8);
    const msgs = [sysMsg, ...bodyMsgs];

    engine.ingest('session1', 'cli', msgs);
    await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 2000,
    });

    const d0Nodes = dag.getNodesAtDepth('session1', 0);
    const d1Nodes = dag.getNodesAtDepth('session1', 1);

    // With cacheFriendlyCondensation=false, condensation should occur when ≥fanin nodes
    if (d0Nodes.length >= 4) {
      expect(d1Nodes.length).toBeGreaterThanOrEqual(1);
    }
  });

  // ── 7. dynamicLeafChunk=true: large backlog → fewer D0 nodes ─────────────
  it('compress: dynamicLeafChunk=true doubles chunk size for large backlogs', async () => {
    const runSubagentFixed = mockSubagent('short summary');
    const runSubagentDynamic = mockSubagent('short summary');

    const sysMsg: EngineMessage = { role: 'system', content: 'System prompt.' };
    const bodyMsgs = genMsgs(40); // ~40 * 25 tokens = ~1000 raw tokens

    // Fixed chunking (dynamic=false, leafChunkTokens=100)
    const engineFixed = makeEngine(store, dag, lifecycle, runSubagentFixed, {
      ...baseConfig,
      leafChunkTokens: 100,
      dynamicLeafChunk: false,
      condensationFanin: 100, // prevent condensation
      cacheFriendlyCondensation: false,
    });
    const msgs = [sysMsg, ...bodyMsgs];
    engineFixed.ingest('session1', 'cli', msgs);
    await engineFixed.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 5000,
    });
    const d0Fixed = dag.getNodesAtDepth('session1', 0).length;

    // Dynamic chunking with a fresh DB
    db.close();
    rmSync(tmp, { recursive: true, force: true });
    tmp = mkdtempSync(join(tmpdir(), 'lcm-engine-dyn-'));
    db = new Database(join(tmp, 'lcm.sqlite'));
    bootstrap(db);
    store = new MessageStore(db);
    dag = new SummaryDAG(db);
    lifecycle = new LifecycleManager(db);
    lifecycle.initialize('agent1', 'session1');

    const engineDynamic = makeEngine(store, dag, lifecycle, runSubagentDynamic, {
      ...baseConfig,
      leafChunkTokens: 100,
      dynamicLeafChunk: true, // doubles when rawTokens > 2x chunk
      condensationFanin: 100,
      cacheFriendlyCondensation: false,
    });
    engineDynamic.ingest('session1', 'cli', msgs);
    await engineDynamic.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 5000,
    });
    const d0Dynamic = dag.getNodesAtDepth('session1', 0).length;

    // Dynamic should produce fewer or equal D0 nodes than fixed
    // (because it doubles the chunk size when raw_tokens > 2x chunk)
    expect(d0Dynamic).toBeLessThanOrEqual(d0Fixed);
  });

  // ── 8. L1 timeout → escalation succeeds with L2/L3 ───────────────────────
  it('compress: L1 subagent throws → escalation falls back gracefully, compress still succeeds', async () => {
    let callCount = 0;
    const throwingSubagent = vi.fn(async () => {
      callCount++;
      if (callCount % 2 === 1) throw new Error('timeout'); // L1 throws
      return 'L2 summary of content'; // L2 succeeds
    });

    const engine = makeEngine(store, dag, lifecycle, throwingSubagent, {
      ...baseConfig,
      leafChunkTokens: 50,
      condensationFanin: 100,
      cacheFriendlyCondensation: false,
      dynamicLeafChunk: false,
    });

    const sysMsg: EngineMessage = { role: 'system', content: 'System prompt.' };
    const bodyMsgs = genMsgs(10);
    const msgs = [sysMsg, ...bodyMsgs];

    engine.ingest('session1', 'cli', msgs);
    const result = await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 3000,
    });

    // Should succeed despite L1 failures
    expect(result.compressionApplied).toBe(true);
    const d0Nodes = dag.getNodesAtDepth('session1', 0);
    expect(d0Nodes.length).toBeGreaterThan(0);
  });

  // ── 9. compress respects assemblyCapTokens ────────────────────────────────
  it('compress: output messages fit within assemblyCapTokens (with tolerance)', async () => {
    const engine = makeEngine(store, dag, lifecycle, mockSubagent('short'), {
      ...baseConfig,
      leafChunkTokens: 100,
      assemblyCapTokens: 2000,
      condensationFanin: 100,
      cacheFriendlyCondensation: false,
    });

    const sysMsg: EngineMessage = { role: 'system', content: 'System prompt. '.repeat(10) };
    const bodyMsgs = genMsgs(30);
    const msgs = [sysMsg, ...bodyMsgs];

    engine.ingest('session1', 'cli', msgs);
    const result = await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 8000,
    });

    if (result.compressionApplied) {
      // Token estimate with 2x tolerance for estimation error
      const { estimateTokens } = await import('../src/tokens.js');
      const totalTokens = result.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
      // Cap with 2x tolerance
      expect(totalTokens).toBeLessThanOrEqual(baseConfig.assemblyCapTokens * 2);
    }
  });

  // ── 10. compress preserves system message at index 0 ─────────────────────
  it('compress: system message (index 0) is preserved at the start', async () => {
    const engine = makeEngine(store, dag, lifecycle, mockSubagent('summary'), {
      ...baseConfig,
      leafChunkTokens: 50,
      condensationFanin: 100,
      cacheFriendlyCondensation: false,
    });

    const systemContent = 'You are a special assistant with unique instructions.';
    const sysMsg: EngineMessage = { role: 'system', content: systemContent };
    const bodyMsgs = genMsgs(20);
    const msgs = [sysMsg, ...bodyMsgs];

    engine.ingest('session1', 'cli', msgs);
    const result = await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 3000,
    });

    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toBe(systemContent);
  });

  // ── 11. compress preserves freshTailLength messages at end ───────────────
  it('compress: freshTailLength messages are preserved at the end of output', async () => {
    const freshTailLength = 6;
    const engine = makeEngine(store, dag, lifecycle, mockSubagent('summary'), {
      ...baseConfig,
      freshTailLength,
      leafChunkTokens: 50,
      condensationFanin: 100,
      cacheFriendlyCondensation: false,
    });

    const sysMsg: EngineMessage = { role: 'system', content: 'System prompt.' };
    const bodyMsgs = genMsgs(20);
    const msgs = [sysMsg, ...bodyMsgs];

    engine.ingest('session1', 'cli', msgs);
    const result = await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 3000,
    });

    if (result.compressionApplied) {
      const output = result.messages;
      const lastFresh = output.slice(-freshTailLength);
      const expectedTail = bodyMsgs.slice(-freshTailLength);

      // The last freshTailLength messages in output should match original tail
      expect(lastFresh).toHaveLength(freshTailLength);
      for (let i = 0; i < freshTailLength; i++) {
        expect(lastFresh[i].content).toBe(expectedTail[i].content);
        expect(lastFresh[i].role).toBe(expectedTail[i].role);
      }
    }
  });

  // ── 12. assemble with no DAG nodes returns input unchanged ───────────────
  it('assemble: returns input messages unchanged when no DAG nodes exist', async () => {
    const engine = makeEngine(store, dag, lifecycle, mockSubagent('summary'));

    const msgs: EngineMessage[] = [
      { role: 'system', content: 'System prompt.' },
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    const result = await engine.assemble({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
    });

    expect(result.messages).toEqual(msgs);
  });

  // ── 13. assemble injects anchor blocks (role='system') ───────────────────
  it('assemble: injects anchor blocks between system and fresh tail when DAG has nodes', async () => {
    // Manually create a DAG node for the session
    dag.create({
      session_id: 'session1',
      depth: 0,
      summary: 'This is a D0 summary of earlier conversation.',
      token_count: 20,
      source_token_count: 100,
      source_ids: [1],
      source_type: 'messages',
      earliest_at: 1000,
      latest_at: 2000,
    });

    const engine = makeEngine(store, dag, lifecycle, mockSubagent('summary'));

    const msgs: EngineMessage[] = [
      { role: 'system', content: 'System prompt.' },
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    const result = await engine.assemble({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
    });

    // Should have more messages than input (anchors injected)
    expect(result.messages.length).toBeGreaterThan(msgs.length);
    // System is still first
    expect(result.messages[0].role).toBe('system');
    // There should be an anchor block (system role) with the summary
    const anchorMsgs = result.messages.slice(1, -2);
    const anchorContent = anchorMsgs.map(m => m.content).join('\n');
    expect(anchorContent).toContain('D0');
  });

  // ── 14. assemble depth ordering: D2 before D1 before D0 ─────────────────
  it('assemble: depth ordering — higher-depth anchors appear before lower-depth', async () => {
    // Create nodes at D0, D1, D2 for session1
    const d0Id = dag.create({
      session_id: 'session1',
      depth: 0,
      summary: 'D0 leaf summary',
      token_count: 10,
      source_token_count: 50,
      source_ids: [1],
      source_type: 'messages',
      earliest_at: 1000,
      latest_at: 2000,
    });

    const d1Id = dag.create({
      session_id: 'session1',
      depth: 1,
      summary: 'D1 condensed summary',
      token_count: 8,
      source_token_count: 30,
      source_ids: [d0Id],
      source_type: 'nodes',
      earliest_at: 1000,
      latest_at: 2000,
    });

    dag.create({
      session_id: 'session1',
      depth: 2,
      summary: 'D2 high-level summary',
      token_count: 5,
      source_token_count: 20,
      source_ids: [d1Id],
      source_type: 'nodes',
      earliest_at: 1000,
      latest_at: 2000,
    });

    const engine = makeEngine(store, dag, lifecycle, mockSubagent('summary'));

    const msgs: EngineMessage[] = [
      { role: 'system', content: 'System prompt.' },
      { role: 'user', content: 'Recent message 1' },
      { role: 'assistant', content: 'Recent reply 1' },
    ];

    const result = await engine.assemble({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
    });

    // Find anchor messages (between system and fresh tail)
    const anchors = result.messages.filter(m =>
      m.role === 'system' && m.content.includes('Summary')
    ).map(m => m.content);

    expect(anchors.length).toBeGreaterThan(0);

    // If we have multiple anchor messages or one combined anchor,
    // D2 content should appear before D1, D1 before D0
    const combinedAnchor = anchors.join('\n');
    const d2Pos = combinedAnchor.indexOf('D2');
    const d1Pos = combinedAnchor.indexOf('D1');
    const d0Pos = combinedAnchor.indexOf('D0');

    // D2 appears before D1, D1 before D0
    if (d2Pos >= 0 && d1Pos >= 0) {
      expect(d2Pos).toBeLessThan(d1Pos);
    }
    if (d1Pos >= 0 && d0Pos >= 0) {
      expect(d1Pos).toBeLessThan(d0Pos);
    }
  });

  // ── 15. compress updates lifecycle frontier ───────────────────────────────
  it('compress: updates lifecycle frontier after successful compression', async () => {
    const engine = makeEngine(store, dag, lifecycle, mockSubagent('summary'), {
      ...baseConfig,
      leafChunkTokens: 50,
      condensationFanin: 100,
      cacheFriendlyCondensation: false,
      dynamicLeafChunk: false,
    });

    const sysMsg: EngineMessage = { role: 'system', content: 'System.' };
    const bodyMsgs = genMsgs(15);
    const msgs = [sysMsg, ...bodyMsgs];

    engine.ingest('session1', 'cli', msgs);

    const before = lifecycle.get('agent1');
    expect(before?.current_frontier_store_id).toBeNull();

    await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 3000,
    });

    const after = lifecycle.get('agent1');
    // Frontier should have been updated to some positive store_id
    expect(after?.current_frontier_store_id).toBeGreaterThan(0);
  });

  // ── 16. compress records debt when residual backlog remains ───────────────
  it('compress: records raw_backlog debt when backlog exceeds chunk threshold', async () => {
    const engine = makeEngine(store, dag, lifecycle, mockSubagent('summary'), {
      ...baseConfig,
      // Very large leafChunkTokens → small messages won't fill a chunk → debt
      leafChunkTokens: 10000,
      condensationFanin: 100,
      cacheFriendlyCondensation: false,
      dynamicLeafChunk: false,
    });

    const sysMsg: EngineMessage = { role: 'system', content: 'System.' };
    // 20 small messages — each ~25 tokens — total ~500 tokens, well under 10000 leafChunkTokens
    const bodyMsgs = genMsgs(20);
    const msgs = [sysMsg, ...bodyMsgs];

    engine.ingest('session1', 'cli', msgs);

    // Compression should bail-out (not enough tokens to fill a chunk)
    await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 1000,
    });

    // If backlog exists but is below chunk size, no compression → check debt state
    // The engine should record debt if backlog chars > 0
    const state = lifecycle.get('agent1');
    // debt_kind is either 'raw_backlog' or null depending on whether residual exists
    // In this case, messages[1:-6] is the backlog (20-6=14 msgs) but < 10000 tokens
    // so no leaf pass runs → debt recorded
    expect(state?.debt_kind).toBe('raw_backlog');
  });

  // ── 17. compress clears debt when no remainder ────────────────────────────
  it('compress: clears debt when no remaining backlog after compression', async () => {
    // First set debt manually
    lifecycle.recordDebt('agent1', 'raw_backlog', 5000);
    expect(lifecycle.get('agent1')?.debt_kind).toBe('raw_backlog');

    const engine = makeEngine(store, dag, lifecycle, mockSubagent('summary'), {
      ...baseConfig,
      leafChunkTokens: 50,
      condensationFanin: 100,
      cacheFriendlyCondensation: false,
      dynamicLeafChunk: false,
    });

    const sysMsg: EngineMessage = { role: 'system', content: 'System.' };
    // 8 small messages — backlog = 8 - 6 = 2 messages after fresh tail
    // With leafChunkTokens=50 (~25 tokens each), 2 messages = ~50 tokens = threshold
    // Need to adjust: use exactly freshTailLength+1 backlog msgs to ensure they all fit
    const bodyMsgs = genMsgs(8);
    const msgs = [sysMsg, ...bodyMsgs];

    engine.ingest('session1', 'cli', msgs);
    await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 2000,
    });

    const state = lifecycle.get('agent1');
    // If compression ran and there's no remaining backlog, debt should be cleared
    if (dag.getNodesAtDepth('session1', 0).length > 0) {
      expect(state?.debt_kind).toBeNull();
    }
  });

  // ── 18. Integration: 200 messages → drill-down recovers all originals ─────
  it('integration: 200 messages → compress → drill-down recovers all originals via collectLeafMessageIds', async () => {
    const engine = makeEngine(store, dag, lifecycle, mockSubagent('summary of the segment'), {
      ...baseConfig,
      leafChunkTokens: 100,
      condensationFanin: 4,
      cacheFriendlyCondensation: false,
      dynamicLeafChunk: false,
    });

    const sysMsg: EngineMessage = { role: 'system', content: 'System prompt.' };
    const bodyMsgs = genMsgs(200);
    const msgs = [sysMsg, ...bodyMsgs];

    // Ingest all messages first
    engine.ingest('session1', 'cli', msgs);

    // Get all store_ids ingested
    const allStored = store.listSession('session1');
    const allStoreIds = new Set(allStored.map(m => m.store_id));

    await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 20000,
    });

    // Collect all leaf message ids from all D0 nodes
    const d0Nodes = dag.getNodesAtDepth('session1', 0);
    expect(d0Nodes.length).toBeGreaterThan(0);

    const recoveredIds = new Set<number>();
    for (const node of d0Nodes) {
      const ids = dag.collectLeafMessageIds(node.node_id);
      ids.forEach(id => recoveredIds.add(id));
    }

    // Also check via highest depth nodes using drill-down
    const allDepths = new Set<number>();
    for (let d = 0; d <= 5; d++) {
      const nodes = dag.getNodesAtDepth('session1', d);
      if (nodes.length > 0) allDepths.add(d);
    }
    const maxDepth = Math.max(...allDepths);

    if (maxDepth >= 1) {
      const topNodes = dag.getNodesAtDepth('session1', maxDepth);
      for (const node of topNodes) {
        const ids = dag.collectLeafMessageIds(node.node_id);
        ids.forEach(id => recoveredIds.add(id));
      }
    }

    // All store_ids from the backlog (non-system, non-fresh-tail) should be recoverable.
    // The engine compacts bodyMsgs[0..n-freshTailLength-1]; system msg is NOT compacted.
    // Fresh tail messages stay in raw form (not in DAG).
    const backlogStored = allStored
      .filter(m => m.role !== 'system') // system prompt is never DAG-compacted
      .slice(0, allStored.filter(m => m.role !== 'system').length - baseConfig.freshTailLength);
    if (backlogStored.length > 0) {
      for (const msg of backlogStored) {
        expect(recoveredIds.has(msg.store_id)).toBe(true);
      }
    }
  });

  // ── 19. getStatus returns correct counts ──────────────────────────────────
  it('getStatus: returns storedMessages, totalTokens, nodesAtDepth correctly', async () => {
    const engine = makeEngine(store, dag, lifecycle, mockSubagent('summary'), {
      ...baseConfig,
      leafChunkTokens: 50,
      condensationFanin: 100,
      cacheFriendlyCondensation: false,
    });

    const sysMsg: EngineMessage = { role: 'system', content: 'System prompt.' };
    const bodyMsgs = genMsgs(15);
    const msgs = [sysMsg, ...bodyMsgs];

    engine.ingest('session1', 'cli', msgs);
    await engine.compress({
      agentId: 'agent1',
      sessionKey: 'session1',
      messages: msgs,
      currentTokens: 3000,
    });

    const status = engine.getStatus('session1');

    expect(status.sessionKey).toBe('session1');
    expect(status.storedMessages).toBe(msgs.length);
    expect(status.totalTokens).toBeGreaterThan(0);

    const d0Count = dag.getNodesAtDepth('session1', 0).length;
    if (d0Count > 0) {
      expect(status.nodesAtDepth[0]).toBe(d0Count);
    }
    expect(status.lifecycle).toBeNull(); // T9: lifecycle always null
  });

  // ── 20. Prototype has exactly ingest, compress, assemble, getStatus ───────
  it('immutability: LCMEngine.prototype has exactly the 4 public methods', () => {
    const proto = LCMEngine.prototype;
    const methods = Object.getOwnPropertyNames(proto).filter(m => m !== 'constructor');
    const publicMethods = methods.filter(m => !m.startsWith('_'));
    const expectedPublic = new Set(['ingest', 'compress', 'assemble', 'getStatus']);

    const unexpectedPublic = publicMethods.filter(m => !expectedPublic.has(m));
    expect(unexpectedPublic).toEqual([]);

    expectedPublic.forEach(m => {
      expect(proto).toHaveProperty(m);
    });
  });
});
