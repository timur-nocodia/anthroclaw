import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { bootstrap } from '../src/db/bootstrap.js';
import { MessageStore } from '../src/store.js';
import { SummaryDAG } from '../src/dag.js';
import { createGrepTool, GREP_RATE_LIMIT_PER_TURN } from '../src/tools/grep.js';

describe('createGrepTool', () => {
  let tmp: string;
  let db: Database.Database;
  let store: MessageStore;
  let dag: SummaryDAG;
  let tool: ReturnType<typeof createGrepTool>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lcm-grep-'));
    db = new Database(join(tmp, 'lcm.sqlite'));
    bootstrap(db);
    store = new MessageStore(db);
    dag = new SummaryDAG(db);
    tool = createGrepTool({ store, dag, sessionResolver: () => 'session1' });

    // Seed test data
    store.append({ session_id: 'session1', source: 'cli', role: 'user', content: 'apple banana', ts: 1 });
    store.append({ session_id: 'session1', source: 'telegram', role: 'user', content: 'apple cherry', ts: 2 });
    dag.create({
      session_id: 'session1',
      depth: 0,
      summary: 'apple summary node',
      token_count: 5,
      source_token_count: 10,
      source_ids: [1, 2],
      source_type: 'messages',
      earliest_at: 1,
      latest_at: 2,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  // Test 1: tool name is 'grep' (not 'lcm_grep')
  it('has name "grep" (namespacing is done automatically by framework)', () => {
    expect(tool.name).toBe('grep');
  });

  // Test 2: non-empty description
  it('has a non-empty description', () => {
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(10);
  });

  // Test 3: inputSchema is a Zod schema — verify by parsing valid input
  it('inputSchema accepts valid input and provides defaults', () => {
    expect(tool.inputSchema).toBeDefined();
    const parsed = (tool.inputSchema as z.ZodObject<z.ZodRawShape>).parse({ query: 'apple' });
    expect(parsed.query).toBe('apple');
    expect(parsed.scope).toBe('both');
    expect(parsed.source).toBe('all');
    expect(parsed.sort).toBe('hybrid');
    expect(parsed.limit).toBe(20);
  });

  // Test 4: schema rejects empty query
  it('schema rejects empty query', () => {
    expect(() =>
      (tool.inputSchema as z.ZodObject<z.ZodRawShape>).parse({ query: '' })
    ).toThrow();
  });

  // Test 5: schema rejects limit > 100
  it('schema rejects limit > 100', () => {
    expect(() =>
      (tool.inputSchema as z.ZodObject<z.ZodRawShape>).parse({ query: 'apple', limit: 101 })
    ).toThrow();
  });

  // Test 6: schema rejects unknown enum values
  it('schema rejects unknown scope enum value', () => {
    expect(() =>
      (tool.inputSchema as z.ZodObject<z.ZodRawShape>).parse({ query: 'apple', scope: 'invalid' })
    ).toThrow();
  });

  // Test 7: scope='messages' returns only message kinds
  it('handler with scope="messages" returns only message kinds', async () => {
    const result = await tool.handler({ query: 'apple', scope: 'messages' });
    const parsed = JSON.parse(result.content[0].text) as { results: Array<{ kind: string }> };
    expect(parsed.results.length).toBeGreaterThan(0);
    for (const r of parsed.results) {
      expect(r.kind).toBe('message');
    }
  });

  // Test 8: scope='summaries' returns only summary kinds
  it('handler with scope="summaries" returns only summary kinds', async () => {
    const result = await tool.handler({ query: 'apple', scope: 'summaries' });
    const parsed = JSON.parse(result.content[0].text) as { results: Array<{ kind: string }> };
    expect(parsed.results.length).toBeGreaterThan(0);
    for (const r of parsed.results) {
      expect(r.kind).toBe('summary');
    }
  });

  // Test 9: scope='both' returns mixed results
  it('handler with scope="both" returns mixed results', async () => {
    const result = await tool.handler({ query: 'apple', scope: 'both' });
    const parsed = JSON.parse(result.content[0].text) as { results: Array<{ kind: string }> };
    const kinds = new Set(parsed.results.map((r) => r.kind));
    expect(kinds.has('message')).toBe(true);
    expect(kinds.has('summary')).toBe(true);
  });

  // Test 10: source filter returns only matching source messages
  it('source filter source="telegram" returns only telegram messages', async () => {
    const result = await tool.handler({ query: 'apple', scope: 'messages', source: 'telegram' });
    const parsed = JSON.parse(result.content[0].text) as {
      results: Array<{ kind: string; store_id?: number }>;
    };
    // Should only have telegram apple cherry (store_id=2)
    expect(parsed.results.length).toBeGreaterThan(0);
    for (const r of parsed.results) {
      expect(r.kind).toBe('message');
      // The only telegram message has store_id=2
      expect(r.store_id).toBe(2);
    }
  });

  // Test 11: limit caps results
  it('limit caps the results count', async () => {
    // Add more data so we have more than 1 message to cap
    store.append({ session_id: 'session1', source: 'cli', role: 'user', content: 'apple orange', ts: 3 });
    store.append({ session_id: 'session1', source: 'cli', role: 'user', content: 'apple mango', ts: 4 });
    const result = await tool.handler({ query: 'apple', scope: 'messages', limit: 1 });
    const parsed = JSON.parse(result.content[0].text) as { results: unknown[] };
    expect(parsed.results.length).toBeLessThanOrEqual(1);
  });

  // Test 12: rate limit - 11th call returns error
  it('rate limit: 11th call within same closure returns error', async () => {
    // GREP_RATE_LIMIT_PER_TURN = 10
    expect(GREP_RATE_LIMIT_PER_TURN).toBe(10);

    // Call 10 times (all should succeed)
    for (let i = 0; i < GREP_RATE_LIMIT_PER_TURN; i++) {
      const result = await tool.handler({ query: 'apple' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBeUndefined();
    }

    // 11th call should return rate limit error
    const result = await tool.handler({ query: 'apple' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toMatch(/rate limit/i);
  });

  // Test 13: JSON output is well-formed
  it('JSON output is well-formed (parse roundtrip)', async () => {
    const result = await tool.handler({ query: 'apple' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    // Should not throw
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toBeDefined();
  });

  // Test 14: output text field contains a results array
  it('output text contains a results array', async () => {
    const result = await tool.handler({ query: 'apple' });
    const parsed = JSON.parse(result.content[0].text) as { results: unknown[] };
    expect(Array.isArray(parsed.results)).toBe(true);
  });

  // Test 15: each result has required fields per kind
  it('each message result has store_id; each summary result has node_id and depth', async () => {
    const result = await tool.handler({ query: 'apple', scope: 'both' });
    const parsed = JSON.parse(result.content[0].text) as {
      results: Array<{
        kind: string;
        store_id?: number;
        node_id?: string;
        depth?: number;
        snippet: string;
        rank: number;
        ts: number;
      }>;
    };

    for (const r of parsed.results) {
      expect(r.snippet).toBeDefined();
      expect(typeof r.rank).toBe('number');
      expect(typeof r.ts).toBe('number');

      if (r.kind === 'message') {
        expect(typeof r.store_id).toBe('number');
        expect(r.node_id).toBeUndefined();
      } else if (r.kind === 'summary') {
        expect(typeof r.node_id).toBe('string');
        expect(typeof r.depth).toBe('number');
        expect(r.store_id).toBeUndefined();
      }
    }
  });
});
