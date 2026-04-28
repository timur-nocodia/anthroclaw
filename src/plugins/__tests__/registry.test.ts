import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { PluginRegistry } from '../registry.js';
import type { ContextEngine, PluginMcpTool } from '../types.js';

describe('PluginRegistry', () => {
  it('starts empty', () => {
    const reg = new PluginRegistry();
    expect(reg.listPlugins()).toEqual([]);
    expect(reg.getMcpToolsForAgent('any')).toEqual([]);
    expect(reg.getContextEngine('any')).toBeNull();
    expect(reg.listSlashCommands()).toEqual([]);
  });

  it('registers a plugin with manifest + instance', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    expect(reg.listPlugins().map(p => p.manifest.name)).toEqual(['lcm']);
  });

  it('per-agent enable/disable defaults to disabled', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    expect(reg.isEnabledFor('agent-1', 'lcm')).toBe(false);
  });

  it('isEnabledFor returns true after enableForAgent', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    reg.enableForAgent('agent-1', 'lcm');
    expect(reg.isEnabledFor('agent-1', 'lcm')).toBe(true);
  });

  it('disableForAgent reverts state', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    reg.enableForAgent('agent-1', 'lcm');
    reg.disableForAgent('agent-1', 'lcm');
    expect(reg.isEnabledFor('agent-1', 'lcm')).toBe(false);
  });

  it('enableForAgent throws for unknown plugin', () => {
    const reg = new PluginRegistry();
    expect(() => reg.enableForAgent('agent-1', 'unknown')).toThrow(/unknown plugin/i);
  });

  it('registerMcpTool exposes only to enabled agents', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    const tool: PluginMcpTool = {
      name: 'lcm_grep', description: 'd',
      inputSchema: z.object({}),
      handler: async () => ({ content: [{ type: 'text', text: 'r' }] }),
    };
    reg.addToolFromPlugin('lcm', tool);

    expect(reg.getMcpToolsForAgent('agent-disabled')).toEqual([]);
    reg.enableForAgent('agent-1', 'lcm');
    expect(reg.getMcpToolsForAgent('agent-1')).toHaveLength(1);
    expect(reg.getMcpToolsForAgent('agent-1')[0].name).toBe('lcm_grep');
  });

  it('getContextEngine returns null when plugin disabled for agent', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    const engine: ContextEngine = { compress: async () => null };
    reg.addEngineFromPlugin('lcm', engine);
    expect(reg.getContextEngine('agent-1')).toBeNull();
    reg.enableForAgent('agent-1', 'lcm');
    expect(reg.getContextEngine('agent-1')).toEqual({ name: 'lcm', engine });
  });

  it('multiple ContextEngines — last enabled wins, with warning', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm-a', { manifest: { name: 'lcm-a', version: '0.1.0', entry: 'x' } as never, instance: {} });
    reg.addPlugin('lcm-b', { manifest: { name: 'lcm-b', version: '0.1.0', entry: 'x' } as never, instance: {} });
    const engineA: ContextEngine = { compress: async () => null };
    const engineB: ContextEngine = { compress: async () => null };
    reg.addEngineFromPlugin('lcm-a', engineA);
    reg.addEngineFromPlugin('lcm-b', engineB);

    reg.enableForAgent('agent-1', 'lcm-a');
    reg.enableForAgent('agent-1', 'lcm-b');
    expect(reg.getContextEngine('agent-1')).toEqual({ name: 'lcm-b', engine: engineB });
  });

  it('addEngineFromPlugin throws on duplicate registration', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    const engine: ContextEngine = {};
    reg.addEngineFromPlugin('lcm', engine);
    expect(() => reg.addEngineFromPlugin('lcm', engine)).toThrow(/already registered/i);
  });

  it('removePlugin clears all enables and registrations', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    reg.enableForAgent('agent-1', 'lcm');
    reg.removePlugin('lcm');
    expect(reg.listPlugins()).toEqual([]);
    expect(reg.isEnabledFor('agent-1', 'lcm')).toBe(false);
    expect(reg.getMcpToolsForAgent('agent-1')).toEqual([]);
    expect(reg.getContextEngine('agent-1')).toBeNull();
  });

  it('addCommandFromPlugin and listSlashCommands aggregate', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    reg.addCommandFromPlugin('lcm', { name: 'cmd1', description: 'd', handler: async () => 'ok' });
    reg.addCommandFromPlugin('lcm', { name: 'cmd2', description: 'd', handler: async () => 'ok' });
    expect(reg.listSlashCommands()).toHaveLength(2);
  });

  // ─── Hook registration (C1 regression) ───────────────────────────

  it('addHookFromPlugin and listAllHooks track registrations', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    reg.addHookFromPlugin('lcm', 'on_after_query', handler1);
    reg.addHookFromPlugin('lcm', 'on_before_query', handler2);
    const all = reg.listAllHooks();
    expect(all).toHaveLength(2);
    expect(all[0]).toEqual({ pluginName: 'lcm', event: 'on_after_query', handler: handler1 });
    expect(all[1]).toEqual({ pluginName: 'lcm', event: 'on_before_query', handler: handler2 });
  });

  it('listAllHooks returns empty when no hooks registered', () => {
    const reg = new PluginRegistry();
    expect(reg.listAllHooks()).toEqual([]);
  });

  it('removePlugin clears its hook registrations', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    reg.addHookFromPlugin('lcm', 'on_after_query', vi.fn());
    reg.removePlugin('lcm');
    expect(reg.listAllHooks()).toEqual([]);
  });

  // ─── McpToolContext (T24) ─────────────────────────────────────────

  it('PluginMcpTool.handler receives McpToolContext with agentId at invocation time', async () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    const observed: string[] = [];
    const tool: PluginMcpTool = {
      name: 'spy',
      description: 'records ctx.agentId',
      inputSchema: z.object({}),
      handler: async (_input, ctx) => {
        observed.push(ctx.agentId);
        return { content: [{ type: 'text', text: ctx.agentId }] };
      },
    };
    reg.addToolFromPlugin('lcm', tool);
    reg.enableForAgent('agent-A', 'lcm');
    reg.enableForAgent('agent-B', 'lcm');

    // Simulate the agent.ts wrapping: each agent invokes the tool with its own id.
    const toolsForA = reg.getMcpToolsForAgent('agent-A');
    const toolsForB = reg.getMcpToolsForAgent('agent-B');
    await toolsForA[0].handler({}, { agentId: 'agent-A' });
    await toolsForB[0].handler({}, { agentId: 'agent-B' });

    expect(observed).toEqual(['agent-A', 'agent-B']);
  });

  it('listAllHooks aggregates hooks from multiple plugins', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('plugin-a', { manifest: { name: 'plugin-a', version: '0.1.0', entry: 'x' } as never, instance: {} });
    reg.addPlugin('plugin-b', { manifest: { name: 'plugin-b', version: '0.1.0', entry: 'x' } as never, instance: {} });
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    reg.addHookFromPlugin('plugin-a', 'on_message_received', handlerA);
    reg.addHookFromPlugin('plugin-b', 'on_after_query', handlerB);
    const all = reg.listAllHooks();
    expect(all).toHaveLength(2);
    expect(all.find(h => h.pluginName === 'plugin-a')?.event).toBe('on_message_received');
    expect(all.find(h => h.pluginName === 'plugin-b')?.event).toBe('on_after_query');
  });
});
