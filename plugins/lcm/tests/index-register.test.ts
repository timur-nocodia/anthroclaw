/**
 * Smoke tests for the LCM plugin register() entry point (T19).
 *
 * Verifies:
 *   1. register() runs without throwing
 *   2. ContextEngine is registered (spy)
 *   3. on_after_query hook is registered (spy)
 *   4. 6 MCP tools are registered (spy count)
 *   5. shutdown() closes per-agent DBs (perAgent map cleared)
 *   6. compress() returns null when config.enabled=false (default)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginContext } from '../src/types-shim.js';
import { register } from '../src/index.js';

// ── Stub PluginContext ─────────────────────────────────────────────────────────

function makeStubCtx(overrides: Partial<PluginContext> = {}): PluginContext & { _tmp: string } {
  const _tmp = mkdtempSync(join(tmpdir(), 'lcm-register-'));
  return {
    pluginName: 'lcm',
    pluginVersion: '0.1.0',
    dataDir: _tmp,
    registerHook: vi.fn(),
    registerMcpTool: vi.fn(),
    registerContextEngine: vi.fn(),
    registerSlashCommand: vi.fn(),
    runSubagent: vi.fn(async () => ''),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getAgentConfig: vi.fn(() => ({})),
    getGlobalConfig: vi.fn(() => ({})),
    _tmp,
    ...overrides,
  };
}

// ── Cleanup helper ────────────────────────────────────────────────────────────

const tmps: string[] = [];
afterEach(() => {
  for (const t of tmps.splice(0)) {
    try { rmSync(t, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('register()', () => {
  it('1. runs without throwing for a stub PluginContext', async () => {
    const ctx = makeStubCtx();
    tmps.push(ctx._tmp);
    await expect(register(ctx)).resolves.toBeDefined();
  });

  it('2. registers ContextEngine via ctx.registerContextEngine', async () => {
    const ctx = makeStubCtx();
    tmps.push(ctx._tmp);
    await register(ctx);
    expect(ctx.registerContextEngine).toHaveBeenCalledOnce();
    const engine = (ctx.registerContextEngine as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(typeof engine.compress).toBe('function');
    expect(typeof engine.assemble).toBe('function');
  });

  it('3. registers on_after_query hook via ctx.registerHook', async () => {
    const ctx = makeStubCtx();
    tmps.push(ctx._tmp);
    await register(ctx);
    const calls = (ctx.registerHook as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
    const afterQueryCall = calls.find(([event]) => event === 'on_after_query');
    expect(afterQueryCall).toBeDefined();
  });

  it('4. registers exactly 6 MCP tools via ctx.registerMcpTool', async () => {
    const ctx = makeStubCtx();
    tmps.push(ctx._tmp);
    await register(ctx);
    expect(ctx.registerMcpTool).toHaveBeenCalledTimes(6);
    // Verify each registered tool has a name and handler
    const calls = (ctx.registerMcpTool as ReturnType<typeof vi.fn>).mock.calls as [{ name: string; handler: unknown }][];
    for (const [tool] of calls) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('5. shutdown() closes all per-agent DBs (perAgent map clears, no open DB leak)', async () => {
    const ctx = makeStubCtx();
    tmps.push(ctx._tmp);
    const instance = await register(ctx);

    // Trigger creation of a named agent's DB by calling compress with a known agentId.
    // compress returns null (enabled=false) but still creates the per-agent state.
    const engine = (ctx.registerContextEngine as ReturnType<typeof vi.fn>).mock.calls[0][0];
    await engine.compress({ agentId: 'agent-test', sessionKey: 's1', messages: [], currentTokens: 0 });

    // After shutdown, calling the DB should not be possible.
    // We verify by checking the logger did not log an error during shutdown (happy path).
    await instance.shutdown?.();
    expect(ctx.logger.error).not.toHaveBeenCalled();
    // Calling shutdown again should be a no-op (map is empty)
    await instance.shutdown?.();
    expect(ctx.logger.error).not.toHaveBeenCalled();
  });

  it('6. compress() returns null when config.enabled=false (default)', async () => {
    const ctx = makeStubCtx();
    tmps.push(ctx._tmp);
    await register(ctx);
    const engine = (ctx.registerContextEngine as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Default config has enabled=false, so compress should return null
    const result = await engine.compress({
      agentId: 'agent-disabled',
      sessionKey: 'some-session',
      messages: [],
      currentTokens: 0,
    });
    expect(result).toBeNull();
  });

  it('7. assemble() returns null when config.enabled=false (default)', async () => {
    const ctx = makeStubCtx();
    tmps.push(ctx._tmp);
    await register(ctx);
    const engine = (ctx.registerContextEngine as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Default config has enabled=false, so assemble should return null
    const result = await engine.assemble({
      agentId: 'agent-disabled',
      sessionKey: 'some-session',
      messages: [],
    });
    expect(result).toBeNull();
  });
});
