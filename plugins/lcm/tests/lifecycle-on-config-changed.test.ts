/**
 * Lifecycle test: LCM plugin's `onAgentConfigChanged` invalidates the cached
 * per-agent state for the given agentId so the next tool/hook invocation
 * re-reads agent.yml via ctx.getAgentConfig().
 *
 * Without this, UI config edits (PUT /agents/:id/plugins/lcm/config) would
 * update agent.yml but the running engine would keep the stale config that
 * was captured at first cache miss in getOrCreateForAgent().
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginContext } from '../src/types-shim.js';
import { register } from '../src/index.js';

// ── Stub PluginContext (mirrors index-register.test.ts) ──────────────────────

function makeStubCtx(
  getAgentConfig: PluginContext['getAgentConfig'],
): PluginContext & { _tmp: string } {
  const _tmp = mkdtempSync(join(tmpdir(), 'lcm-lifecycle-'));
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
    getAgentConfig,
    getGlobalConfig: vi.fn(() => ({})),
    _tmp,
  };
}

const tmps: string[] = [];
afterEach(() => {
  for (const t of tmps.splice(0)) {
    try {
      rmSync(t, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('LCM plugin: onAgentConfigChanged', () => {
  it('exposes onAgentConfigChanged on the returned PluginInstance', async () => {
    const ctx = makeStubCtx(() => ({}));
    tmps.push(ctx._tmp);
    const instance = await register(ctx);
    expect(typeof instance.onAgentConfigChanged).toBe('function');
  });

  it('invalidates cached per-agent state so the next call re-reads agent config', async () => {
    // The stub returns a *mutable* config so we can verify the engine is
    // rebuilt with the new threshold after invalidation.
    let currentConfig: Record<string, unknown> = {
      enabled: true,
      triggers: { soft_threshold: 0.5, hard_threshold: 0.8 },
    };
    const getAgentConfig = vi.fn((_id: string) => ({
      plugins: { lcm: currentConfig },
    }));
    const ctx = makeStubCtx(getAgentConfig);
    tmps.push(ctx._tmp);
    const instance = await register(ctx);

    const engineFacade = (
      ctx.registerContextEngine as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];

    // First call: cache miss, getAgentConfig invoked once.
    await engineFacade.compress({
      agentId: 'agent-X',
      sessionKey: 's1',
      messages: [],
      currentTokens: 0,
    });
    expect(getAgentConfig).toHaveBeenCalledTimes(1);

    // Second call: cache hit, getAgentConfig NOT invoked again.
    await engineFacade.compress({
      agentId: 'agent-X',
      sessionKey: 's1',
      messages: [],
      currentTokens: 0,
    });
    expect(getAgentConfig).toHaveBeenCalledTimes(1);

    // Update the underlying config and notify the plugin: the next
    // invocation must call getAgentConfig again to pick up the new value.
    currentConfig = {
      enabled: true,
      triggers: { soft_threshold: 0.9, hard_threshold: 0.95 },
    };
    await instance.onAgentConfigChanged?.('agent-X');

    await engineFacade.compress({
      agentId: 'agent-X',
      sessionKey: 's1',
      messages: [],
      currentTokens: 0,
    });
    expect(getAgentConfig).toHaveBeenCalledTimes(2);

    await instance.shutdown?.();
  });

  it('is a no-op when called for an agent that was never resolved', async () => {
    const ctx = makeStubCtx(() => ({}));
    tmps.push(ctx._tmp);
    const instance = await register(ctx);

    // Should not throw, even though no per-agent state exists.
    expect(() => instance.onAgentConfigChanged?.('never-seen')).not.toThrow();
    expect(ctx.logger.error).not.toHaveBeenCalled();

    await instance.shutdown?.();
  });

  it('does not affect other agents cached state', async () => {
    const getAgentConfig = vi.fn((_id: string) => ({
      plugins: { lcm: { enabled: true } },
    }));
    const ctx = makeStubCtx(getAgentConfig);
    tmps.push(ctx._tmp);
    const instance = await register(ctx);

    const engineFacade = (
      ctx.registerContextEngine as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];

    // Prime caches for two distinct agents.
    await engineFacade.compress({
      agentId: 'agent-A',
      sessionKey: 's1',
      messages: [],
      currentTokens: 0,
    });
    await engineFacade.compress({
      agentId: 'agent-B',
      sessionKey: 's1',
      messages: [],
      currentTokens: 0,
    });
    expect(getAgentConfig).toHaveBeenCalledTimes(2);

    // Invalidate only agent-A. agent-B should still be cached.
    await instance.onAgentConfigChanged?.('agent-A');

    await engineFacade.compress({
      agentId: 'agent-A',
      sessionKey: 's1',
      messages: [],
      currentTokens: 0,
    });
    expect(getAgentConfig).toHaveBeenCalledTimes(3); // A re-read

    await engineFacade.compress({
      agentId: 'agent-B',
      sessionKey: 's1',
      messages: [],
      currentTokens: 0,
    });
    expect(getAgentConfig).toHaveBeenCalledTimes(3); // B still cached

    await instance.shutdown?.();
  });
});
