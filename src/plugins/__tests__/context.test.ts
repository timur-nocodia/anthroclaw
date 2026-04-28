import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createPluginContext, type ContextDeps } from '../context.js';
import type { ContextEngine, PluginMcpTool } from '../types.js';

function mkDeps(): ContextDeps {
  return {
    pluginName: 'test',
    pluginVersion: '0.1.0',
    dataDir: '/tmp/test-plugin',
    rootLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    registerHook: vi.fn(),
    registerTool: vi.fn(),
    registerEngine: vi.fn(),
    registerCommand: vi.fn(),
    getAgentConfig: vi.fn().mockReturnValue({ id: 'agent-x' }),
    getGlobalConfig: vi.fn().mockReturnValue({ defaults: {} }),
  };
}

describe('createPluginContext', () => {
  it('exposes pluginName, pluginVersion, dataDir', () => {
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    expect(ctx.pluginName).toBe('test');
    expect(ctx.pluginVersion).toBe('0.1.0');
    expect(ctx.dataDir).toBe('/tmp/test-plugin');
  });

  it('registerHook delegates to deps.registerHook with pluginName', () => {
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    const handler = vi.fn();
    ctx.registerHook('on_after_query', handler);
    expect(deps.registerHook).toHaveBeenCalledWith('test', 'on_after_query', handler);
  });

  it('registerMcpTool calls deps.registerTool with namespaced name', () => {
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    const tool: PluginMcpTool = {
      name: 'my_tool',
      description: 'd',
      inputSchema: z.object({}),
      handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    };
    ctx.registerMcpTool(tool);
    expect(deps.registerTool).toHaveBeenCalledOnce();
    const arg = (deps.registerTool as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.name).toBe('test_my_tool');
  });

  it('registerContextEngine calls deps.registerEngine', () => {
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    const engine: ContextEngine = { compress: async () => null };
    ctx.registerContextEngine(engine);
    expect(deps.registerEngine).toHaveBeenCalledOnce();
    expect(deps.registerEngine).toHaveBeenCalledWith('test', engine);
  });

  it('registerSlashCommand calls deps.registerCommand', () => {
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    const cmd = {
      name: 'mycmd',
      description: 'd',
      handler: async () => 'ok',
    };
    ctx.registerSlashCommand(cmd);
    expect(deps.registerCommand).toHaveBeenCalledOnce();
    expect(deps.registerCommand).toHaveBeenCalledWith(cmd);
  });

  it('runSubagent is a function', () => {
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    expect(typeof ctx.runSubagent).toBe('function');
  });

  it('logger child includes plugin name in output', () => {
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    ctx.logger.info({ x: 1 }, 'hello');
    expect(deps.rootLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ plugin: 'test', x: 1 }),
      'hello'
    );
  });

  it('getAgentConfig and getGlobalConfig forward from deps', () => {
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    expect(ctx.getAgentConfig('agent-x')).toEqual({ id: 'agent-x' });
    expect(ctx.getGlobalConfig()).toEqual({ defaults: {} });
  });
});
