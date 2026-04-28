import { describe, it, expect, beforeAll, vi } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { discoverPlugins, loadPlugin } from '../../loader.js';
import { createPluginContext } from '../../context.js';
import { PluginRegistry } from '../../registry.js';
import { HookEmitter } from '../../../hooks/emitter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');
const PLUGINS_DIR = resolve(REPO_ROOT, 'plugins');

describe('plugin framework E2E', () => {
  beforeAll(() => {
    // Build stub plugin (idempotent)
    execSync('pnpm --filter @anthroclaw/plugin-example build', {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
  });

  it('discovers, loads, and registers stub plugin end-to-end', async () => {
    // 1. Discover
    const discovered = await discoverPlugins(PLUGINS_DIR);
    const example = discovered.find((d) => d.manifest.name === 'example');
    expect(example).toBeDefined();
    expect(example!.manifest.version).toBe('0.0.1');
    expect(example!.manifest.entry).toBe('dist/index.js');

    // 2. Load
    const mod = await loadPlugin(example!, { anthroclawVersion: '0.4.1' });
    expect(typeof mod.register).toBe('function');

    // 3. Build PluginContext + register
    const registry = new PluginRegistry();
    const fakeEmitter = new HookEmitter([]);
    const subscribeSpy = vi.spyOn(fakeEmitter, 'subscribe');

    const hookRegistrations: Array<{ pluginName: string; event: string; handler: Function }> = [];

    const ctx = createPluginContext({
      pluginName: example!.manifest.name,
      pluginVersion: example!.manifest.version,
      dataDir: '/tmp/example-plugin-e2e',
      rootLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      registerHook: (pluginName, event, handler) => {
        registry.addHookFromPlugin(pluginName, event, handler);
        hookRegistrations.push({ pluginName, event, handler });
        fakeEmitter.subscribe(event, handler);
      },
      registerTool: (tool) => registry.addToolFromPlugin('example', tool),
      registerEngine: (name, eng) => registry.addEngineFromPlugin(name, eng),
      registerCommand: () => {},
      getAgentConfig: () => ({}),
      getGlobalConfig: () => ({}),
    });

    const instance = await mod.register(ctx);
    registry.addPlugin('example', { manifest: example!.manifest, instance });
    registry.enableForAgent('agent-1', 'example');

    // 4. Tool registered, namespaced, callable
    const tools = registry.getMcpToolsForAgent('agent-1');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('example_echo');     // namespaced

    const result = await tools[0].handler({ message: 'hi' });
    expect(result.content[0].text).toBe('echo: hi');

    // 5. Hook subscribed on fakeEmitter
    expect(subscribeSpy).toHaveBeenCalledWith('on_after_query', expect.any(Function));
    expect(hookRegistrations).toHaveLength(1);
    expect(hookRegistrations[0]).toMatchObject({ pluginName: 'example', event: 'on_after_query' });
    expect(registry.listAllHooks()).toHaveLength(1);

    // 6. Tool not visible to disabled agent
    expect(registry.getMcpToolsForAgent('agent-disabled')).toEqual([]);

    // 7. Shutdown works without throwing
    await instance.shutdown?.();
  }, 30_000);                                         // 30s timeout — first build can be slow

  it('plugin gets removed via removePlugin and tools become invisible', async () => {
    const discovered = await discoverPlugins(PLUGINS_DIR);
    const example = discovered.find((d) => d.manifest.name === 'example');
    expect(example).toBeDefined();

    const mod = await loadPlugin(example!, { anthroclawVersion: '0.4.1' });
    const registry = new PluginRegistry();
    const ctx = createPluginContext({
      pluginName: example!.manifest.name,
      pluginVersion: example!.manifest.version,
      dataDir: '/tmp/example-plugin-e2e2',
      rootLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      registerHook: (pluginName, event, handler) => {
        registry.addHookFromPlugin(pluginName, event, handler);
      },
      registerTool: (tool) => registry.addToolFromPlugin('example', tool),
      registerEngine: (name, eng) => registry.addEngineFromPlugin(name, eng),
      registerCommand: () => {},
      getAgentConfig: () => ({}),
      getGlobalConfig: () => ({}),
    });

    const instance = await mod.register(ctx);
    registry.addPlugin('example', { manifest: example!.manifest, instance });
    registry.enableForAgent('agent-1', 'example');

    expect(registry.getMcpToolsForAgent('agent-1')).toHaveLength(1);

    registry.removePlugin('example');

    expect(registry.getMcpToolsForAgent('agent-1')).toEqual([]);
    expect(registry.listAllHooks()).toEqual([]);
    expect(registry.listPlugins()).toEqual([]);
  });
});
