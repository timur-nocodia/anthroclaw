import { describe, it, expect } from 'vitest';
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
    expect(reg.getContextEngine('agent-1')).toBe(engine);
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
    expect(reg.getContextEngine('agent-1')).toBe(engineB);
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
});
