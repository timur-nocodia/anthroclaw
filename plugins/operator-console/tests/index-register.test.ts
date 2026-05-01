/**
 * Smoke tests for operator-console register() entry point (Task 24).
 *
 * Verifies:
 *   - register() runs without throwing for a stub PluginContext
 *   - All 5 tools registered when global capabilities include all of them
 *   - Capability filter at the global level omits tools
 *   - Per-agent gating refuses calls when enabled=false even though tools registered
 *   - Per-agent capabilities narrow further at call time
 */

import { describe, it, expect, vi } from 'vitest';
import type { PluginContext, PluginMcpTool } from '../src/types-shim.js';
import { register } from '../src/index.js';

interface StubCtxOpts {
  globalConfig?: Record<string, unknown>;
  agentConfigs?: Record<string, Record<string, unknown>>;
  withPlumbing?: boolean;
}

function makeStubCtx(opts: StubCtxOpts = {}): PluginContext & {
  _registered: PluginMcpTool[];
} {
  const registered: PluginMcpTool[] = [];
  const ctx: PluginContext & { _registered: PluginMcpTool[] } = {
    pluginName: 'operator-console',
    pluginVersion: '0.1.0',
    dataDir: '/tmp/op-console-test',
    registerHook: vi.fn(),
    registerMcpTool: vi.fn((tool: PluginMcpTool) => {
      registered.push(tool);
    }),
    registerContextEngine: vi.fn(),
    registerSlashCommand: vi.fn(),
    runSubagent: vi.fn(async () => ''),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getAgentConfig: vi.fn((id: string) => opts.agentConfigs?.[id] ?? {}),
    getGlobalConfig: vi.fn(() => opts.globalConfig ?? {}),
    _registered: registered,
  };

  if (opts.withPlumbing) {
    ctx.getPeerPauseStore = vi.fn(() => null);
    ctx.getNotificationsEmitter = vi.fn(() => null);
    ctx.dispatchSyntheticInbound = vi.fn(async () => ({ messageId: 'm', sessionKey: 's' }));
    ctx.searchAgentMemory = vi.fn(async () => ({ results: [] }));
  }

  return ctx;
}

describe('operator-console register()', () => {
  it('registers all 5 tools when global capabilities include all five (default)', async () => {
    const ctx = makeStubCtx({
      globalConfig: {
        plugins: {
          'operator-console': {
            enabled: true,
            manages: '*',
          },
        },
      },
    });
    await register(ctx);
    const names = ctx._registered.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'peer_pause',
        'delegate_to_peer',
        'list_active_peers',
        'peer_summary',
        'escalate',
      ].sort(),
    );
  });

  it('omits tools whose capability is not in global capabilities', async () => {
    const ctx = makeStubCtx({
      globalConfig: {
        plugins: {
          'operator-console': {
            enabled: true,
            manages: '*',
            capabilities: ['peer_pause', 'escalate'],
          },
        },
      },
    });
    await register(ctx);
    const names = ctx._registered.map((t) => t.name).sort();
    expect(names).toEqual(['peer_pause', 'escalate'].sort());
  });

  it('registers tools but per-agent enabled=false makes every call return an error', async () => {
    const ctx = makeStubCtx({
      globalConfig: {
        plugins: { 'operator-console': { enabled: true, manages: '*' } },
      },
      agentConfigs: {
        klavdia: { plugins: { 'operator-console': { enabled: false } } },
      },
      withPlumbing: true,
    });
    await register(ctx);
    const escalate = ctx._registered.find((t) => t.name === 'escalate');
    expect(escalate).toBeDefined();
    const r = await escalate!.handler({ message: 'help' }, { agentId: 'klavdia' });
    const body = JSON.parse(r.content[0].text) as Record<string, unknown>;
    expect(body.error).toMatch(/not enabled for this agent/i);
  });

  it('per-agent capabilities narrow what tools the calling agent can use', async () => {
    const ctx = makeStubCtx({
      globalConfig: {
        plugins: { 'operator-console': { enabled: true, manages: '*' } },
      },
      agentConfigs: {
        klavdia: {
          plugins: {
            'operator-console': {
              enabled: true,
              manages: ['amina'],
              capabilities: ['escalate'],
            },
          },
        },
      },
      withPlumbing: true,
    });
    await register(ctx);
    const peerPause = ctx._registered.find((t) => t.name === 'peer_pause');
    const r = await peerPause!.handler(
      {
        target_agent_id: 'amina',
        peer: { channel: 'whatsapp', account_id: 'b', peer_id: '1' },
        action: 'pause',
        ttl_minutes: 5,
      },
      { agentId: 'klavdia' },
    );
    const body = JSON.parse(r.content[0].text) as Record<string, unknown>;
    expect(body.error).toMatch(/capability "peer_pause" is not enabled/i);
  });

  it('returns a PluginInstance with shutdown()', async () => {
    const ctx = makeStubCtx({
      globalConfig: {
        plugins: { 'operator-console': { enabled: true, manages: '*' } },
      },
    });
    const inst = await register(ctx);
    expect(typeof inst.shutdown).toBe('function');
    await expect(inst.shutdown!()).resolves.toBeUndefined();
  });

  it('default global config (no plugins block) still registers all 5 tools (per-agent will gate them)', async () => {
    const ctx = makeStubCtx({});
    await register(ctx);
    expect(ctx._registered.length).toBe(5);
  });

  it('escalate runs end-to-end when emitter is wired and per-agent config enables it', async () => {
    const emitter = { emit: vi.fn(async () => undefined) };
    const ctx = makeStubCtx({
      globalConfig: {
        plugins: { 'operator-console': { enabled: true, manages: '*' } },
      },
      agentConfigs: {
        klavdia: {
          plugins: { 'operator-console': { enabled: true, manages: '*' } },
        },
      },
    });
    ctx.getNotificationsEmitter = vi.fn(() => emitter);
    await register(ctx);
    const escalate = ctx._registered.find((t) => t.name === 'escalate')!;
    const r = await escalate.handler(
      { message: 'human help', priority: 'high' },
      { agentId: 'klavdia' },
    );
    const body = JSON.parse(r.content[0].text) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(emitter.emit).toHaveBeenCalledOnce();
  });
});
