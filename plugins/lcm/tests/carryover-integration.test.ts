/**
 * Integration tests for the LCM plugin's auto-prompt + carry-over wiring.
 *
 * Exercises the full register() flow:
 *   - on_session_reset hook registered + captures snippet
 *   - assemble() prepends LCM tool-prompt block (always when enabled)
 *   - assemble() consumes the pending carry-over once on a new sessionKey
 *     and never again until a fresh on_session_reset fires
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginContext } from '../src/types-shim.js';
import { register } from '../src/index.js';

interface AssembleFn {
  (input: { agentId: string; sessionKey: string; messages: unknown[] }): Promise<
    { messages: unknown[] } | null
  >;
}

interface HookHandler {
  (payload: Record<string, unknown>): void | Promise<void>;
}

function makeStubCtx(): PluginContext & { _tmp: string } {
  const _tmp = mkdtempSync(join(tmpdir(), 'lcm-carryover-int-'));
  return {
    pluginName: 'lcm',
    pluginVersion: '0.1.0',
    dataDir: _tmp,
    registerHook: vi.fn(),
    registerMcpTool: vi.fn(),
    registerContextEngine: vi.fn(),
    registerSlashCommand: vi.fn(),
    runSubagent: vi.fn(async () => ''),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    // Enable LCM for the test agent so the engine and hooks actually run.
    getAgentConfig: vi.fn(() => ({ plugins: { lcm: { enabled: true } } })),
    getGlobalConfig: vi.fn(() => ({})),
    _tmp,
  };
}

const tmps: string[] = [];
afterEach(() => {
  for (const t of tmps.splice(0)) {
    try { rmSync(t, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function getRegisteredHook(ctx: PluginContext, event: string): HookHandler | undefined {
  const calls = (ctx.registerHook as ReturnType<typeof vi.fn>).mock.calls as [string, HookHandler][];
  const found = calls.find(([e]) => e === event);
  return found?.[1];
}

function getEngine(ctx: PluginContext): { assemble: AssembleFn } {
  const calls = (ctx.registerContextEngine as ReturnType<typeof vi.fn>).mock.calls;
  return calls[0][0] as { assemble: AssembleFn };
}

/**
 * Touch the agent's per-LCM state via a no-op assemble so the plugin lazily
 * opens the SQLite file and bootstraps the schema. After this, the test can
 * open the same file directly and INSERT a fixture node into summary_nodes.
 */
async function ensureAgentDbInitialized(
  engine: { assemble: AssembleFn },
  agentId: string,
): Promise<void> {
  await engine.assemble({ agentId, sessionKey: `${agentId}:bootstrap`, messages: [] });
}

describe('LCM carry-over + auto-prompt integration', () => {
  it('always prepends the lcm_memory tool-prompt as a system block when enabled', async () => {
    const ctx = makeStubCtx();
    tmps.push(ctx._tmp);
    const instance = await register(ctx);

    const engine = getEngine(ctx);
    const result = await engine.assemble({
      agentId: 'agent-A',
      sessionKey: 'agent-A:dm:1',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result).not.toBeNull();
    const msgs = result!.messages as Array<{ role: string; content: string }>;
    // First non-original message is the tool-prompt system block.
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toContain('<lcm_memory>');
    expect(msgs.some((m) => m.role === 'user' && m.content === 'hi')).toBe(true);

    await instance.shutdown?.();
  });

  it('carry-over: on_session_reset → assemble on new sessionKey injects + consumes once', async () => {
    const ctx = makeStubCtx();
    tmps.push(ctx._tmp);
    const instance = await register(ctx);
    const engine = getEngine(ctx);
    const onSessionReset = getRegisteredHook(ctx, 'on_session_reset');
    expect(onSessionReset, 'on_session_reset hook should be registered').toBeDefined();

    // Seed the agent's DAG by directly using the same DB the plugin opened.
    // Easiest path: run an assemble + ingest some content via the engine's
    // own machinery. But for an isolated unit-style test it's simpler to
    // poke the underlying DAG via the plugin's per-agent state.
    await ensureAgentDbInitialized(engine, 'agent-A');
    const dbPath = join(ctx.dataDir, 'lcm-db', 'agent-A.sqlite');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);
    // Insert a depth-1 summary node for the OLD session.
    db.prepare(
      `INSERT INTO summary_nodes
         (node_id, session_id, depth, summary, token_count, source_token_count,
          source_ids_json, source_type, earliest_at, latest_at, created_at, expand_hint)
       VALUES
         (@node_id, @session_id, 1, @summary, 100, 1000, '[]', 'messages', @ts, @ts, @ts, NULL)`,
    ).run({
      node_id: 'fake-node-1',
      session_id: 'agent-A:dm:OLD',
      summary: 'Discussed pricing strategy for Q3.',
      ts: Date.now(),
    });
    db.close();

    // Fire on_session_reset for the OLD session.
    await onSessionReset!({ agentId: 'agent-A', sessionKey: 'agent-A:dm:OLD' });

    // Now assemble for a NEW session — the carry-over block should land.
    const r1 = await engine.assemble({
      agentId: 'agent-A',
      sessionKey: 'agent-A:dm:NEW',
      messages: [{ role: 'user', content: 'continue' }],
    });
    const msgs1 = r1!.messages as Array<{ role: string; content: string }>;
    const carryover1 = msgs1.find((m) => m.content.includes('<previous_session_memory>'));
    expect(carryover1, 'carry-over block should appear on first assemble').toBeDefined();
    expect(carryover1!.content).toContain('Discussed pricing strategy for Q3.');
    expect(carryover1!.content).toContain('agent-A:dm:OLD');

    // Second assemble for the SAME new session: carry-over already consumed.
    const r2 = await engine.assemble({
      agentId: 'agent-A',
      sessionKey: 'agent-A:dm:NEW',
      messages: [{ role: 'user', content: 'continue 2' }],
    });
    const msgs2 = r2!.messages as Array<{ role: string; content: string }>;
    expect(msgs2.find((m) => m.content.includes('<previous_session_memory>'))).toBeUndefined();
    // But the always-on tool-prompt should still be there.
    expect(msgs2.find((m) => m.content.includes('<lcm_memory>'))).toBeDefined();

    await instance.shutdown?.();
  });

  it('carry-over: same sessionKey as the source skips injection (no "ghost" block on session re-use)', async () => {
    const ctx = makeStubCtx();
    tmps.push(ctx._tmp);
    const instance = await register(ctx);
    const engine = getEngine(ctx);
    const onSessionReset = getRegisteredHook(ctx, 'on_session_reset');

    await ensureAgentDbInitialized(engine, 'agent-B');
    // Seed a node for session S1.
    const dbPath = join(ctx.dataDir, 'lcm-db', 'agent-B.sqlite');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO summary_nodes
         (node_id, session_id, depth, summary, token_count, source_token_count,
          source_ids_json, source_type, earliest_at, latest_at, created_at, expand_hint)
       VALUES (?, 'S1', 1, 'older summary', 100, 1000, '[]', 'messages', ?, ?, ?, NULL)`,
    ).run('fake-node-2', Date.now(), Date.now(), Date.now());
    db.close();

    // Reset for session S1.
    await onSessionReset!({ agentId: 'agent-B', sessionKey: 'S1' });

    // Now assemble for the SAME session S1 — should NOT inject (carry-over
    // is only for cross-session continuity, not "the session that was reset").
    const r = await engine.assemble({
      agentId: 'agent-B',
      sessionKey: 'S1',
      messages: [{ role: 'user', content: 'still S1' }],
    });
    const msgs = r!.messages as Array<{ role: string; content: string }>;
    expect(msgs.find((m) => m.content.includes('<previous_session_memory>'))).toBeUndefined();

    await instance.shutdown?.();
  });

  it('carry-over: skipped when carry_over_on_session_reset=false', async () => {
    const ctx = makeStubCtx();
    tmps.push(ctx._tmp);
    // Disable carry-over via per-agent config.
    (ctx.getAgentConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      plugins: {
        lcm: {
          enabled: true,
          lifecycle: { carry_over_on_session_reset: false },
        },
      },
    });
    const instance = await register(ctx);
    const engine = getEngine(ctx);
    const onSessionReset = getRegisteredHook(ctx, 'on_session_reset');

    await ensureAgentDbInitialized(engine, 'agent-C');
    const dbPath = join(ctx.dataDir, 'lcm-db', 'agent-C.sqlite');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO summary_nodes
         (node_id, session_id, depth, summary, token_count, source_token_count,
          source_ids_json, source_type, earliest_at, latest_at, created_at, expand_hint)
       VALUES (?, 'OLD', 1, 'should not be carried', 100, 1000, '[]', 'messages', ?, ?, ?, NULL)`,
    ).run('fake-node-3', Date.now(), Date.now(), Date.now());
    db.close();

    await onSessionReset!({ agentId: 'agent-C', sessionKey: 'OLD' });

    const r = await engine.assemble({
      agentId: 'agent-C',
      sessionKey: 'NEW',
      messages: [{ role: 'user', content: 'hello' }],
    });
    const msgs = r!.messages as Array<{ role: string; content: string }>;
    expect(msgs.find((m) => m.content.includes('<previous_session_memory>'))).toBeUndefined();

    await instance.shutdown?.();
  });
});
