import { describe, expect, it, vi } from 'vitest';
import { register } from '../src/index.js';
import type { PluginContext } from '../src/types-shim.js';

describe('Honcho plugin register()', () => {
  it('registers a context engine and status tool without touching Honcho network', async () => {
    const ctx = createContext({
      globalConfig: {
        plugins: {
          honcho: {
            defaults: { enabled: true, mode: 'context' },
          },
        },
      },
    });

    await register(ctx);

    expect(ctx.registerContextEngine).toHaveBeenCalledOnce();
    expect(ctx.registerMcpTool).toHaveBeenCalledOnce();
    expect(ctx.registerMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'status' }),
    );
  });
});

function createContext(input: { globalConfig?: unknown } = {}): PluginContext {
  return {
    pluginName: 'honcho',
    pluginVersion: '0.1.0',
    dataDir: '/tmp/honcho-test',
    registerHook: vi.fn(),
    registerMcpTool: vi.fn(),
    registerContextEngine: vi.fn(),
    registerSlashCommand: vi.fn(),
    runSubagent: vi.fn(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getAgentConfig: vi.fn(() => ({})),
    getGlobalConfig: vi.fn(() => input.globalConfig ?? {}),
  };
}
