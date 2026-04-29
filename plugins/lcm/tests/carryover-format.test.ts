/**
 * Unit tests for buildCarryoverSnippet + formatCarryoverBlock + formatToolPromptBlock.
 * Pure functions over a real DAG instance; no plugin glue required.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { bootstrap } from '../src/db/bootstrap.js';
import { SummaryDAG } from '../src/dag.js';
import {
  buildCarryoverSnippet,
  formatCarryoverBlock,
  formatToolPromptBlock,
  LCM_TOOL_PROMPT,
} from '../src/carryover-format.js';

let tmp: string;
let db: Database.Database;
let dag: SummaryDAG;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'lcm-carryover-fmt-'));
  db = new Database(join(tmp, 'test.sqlite'));
  bootstrap(db);
  dag = new SummaryDAG(db);
});

afterEach(() => {
  try { db.close(); } catch { /* ignore */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

function insertNode(opts: {
  sessionId: string;
  depth: number;
  summary: string;
  ts?: number;
}) {
  const ts = opts.ts ?? Date.now();
  dag.create({
    session_id: opts.sessionId,
    depth: opts.depth,
    summary: opts.summary,
    token_count: 100,
    source_token_count: 1000,
    source_ids: [],
    source_type: 'messages',
    earliest_at: ts,
    latest_at: ts,
  });
}

describe('formatToolPromptBlock', () => {
  it('returns the canonical lcm_memory tool prompt verbatim', () => {
    expect(formatToolPromptBlock()).toBe(LCM_TOOL_PROMPT);
    expect(LCM_TOOL_PROMPT).toContain('<lcm_memory>');
    expect(LCM_TOOL_PROMPT).toContain('lcm_grep');
    expect(LCM_TOOL_PROMPT).toContain('lcm_expand_query');
    expect(LCM_TOOL_PROMPT).toContain('</lcm_memory>');
  });
});

describe('formatCarryoverBlock', () => {
  it('wraps snippet in <previous_session_memory> with source session id', () => {
    const out = formatCarryoverBlock('SUMMARY HERE', 'agent:telegram:dm:42');
    expect(out).toContain('<previous_session_memory>');
    expect(out).toContain('agent:telegram:dm:42');
    expect(out).toContain('SUMMARY HERE');
    expect(out).toContain('</previous_session_memory>');
  });
});

describe('buildCarryoverSnippet', () => {
  it('returns null when the source session has no DAG nodes', () => {
    const result = buildCarryoverSnippet(dag, 'empty-session', 2);
    expect(result).toBeNull();
  });

  it('takes nodes from highest depth down, capped by retainDepth+1 levels', () => {
    insertNode({ sessionId: 's1', depth: 0, summary: 'd0-leaf-A' });
    insertNode({ sessionId: 's1', depth: 0, summary: 'd0-leaf-B' });
    insertNode({ sessionId: 's1', depth: 1, summary: 'd1-mid-A' });
    insertNode({ sessionId: 's1', depth: 2, summary: 'd2-top-A' });

    const snippet = buildCarryoverSnippet(dag, 's1', /* retainDepth */ 1);
    expect(snippet).not.toBeNull();
    // retainDepth=1 means take the top 2 levels (D2 + D1), skip D0
    expect(snippet).toContain('d2-top-A');
    expect(snippet).toContain('d1-mid-A');
    expect(snippet).not.toContain('d0-leaf-A');
  });

  it('respects maxChars cap and appends a truncation marker', () => {
    insertNode({ sessionId: 's2', depth: 1, summary: 'A'.repeat(5_000) });
    insertNode({ sessionId: 's2', depth: 1, summary: 'B'.repeat(5_000) });
    const snippet = buildCarryoverSnippet(dag, 's2', 2, /* maxChars */ 1_000);
    expect(snippet).not.toBeNull();
    expect(snippet!.length).toBeGreaterThan(1_000);
    expect(snippet!.length).toBeLessThanOrEqual(1_000 + 100);
    expect(snippet).toContain('[…truncated]');
  });

  it('does not pick up nodes from a different session', () => {
    insertNode({ sessionId: 's-other', depth: 1, summary: 'wrong-session' });
    insertNode({ sessionId: 's-mine', depth: 1, summary: 'right-session' });
    const snippet = buildCarryoverSnippet(dag, 's-mine', 2);
    expect(snippet).toContain('right-session');
    expect(snippet).not.toContain('wrong-session');
  });
});
