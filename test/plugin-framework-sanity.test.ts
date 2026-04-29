import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the SDK so gateway.start() doesn't require real auth or network.
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...real,
    startup: vi.fn(async () => { throw new Error('mocked: no SDK in tests'); }),
  };
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
// The actual example plugin lives in plugins/__example (double-underscore = hidden prefix)
const PLUGINS_DIR = resolve(REPO_ROOT, 'plugins');

describe('Gateway sanity — plugin loads at runtime', () => {
  let tmpDataDir: string;
  let tmpAgentsDir: string;

  afterEach(() => {
    if (tmpDataDir) rmSync(tmpDataDir, { recursive: true, force: true });
    if (tmpAgentsDir) rmSync(tmpAgentsDir, { recursive: true, force: true });
  });

  it('loads example plugin via Gateway.start without crashing', async () => {
    // Setup minimal tmp dirs (no channels — telegram/whatsapp keys absent from config)
    tmpDataDir = mkdtempSync(join(tmpdir(), 'gw-sanity-data-'));
    tmpAgentsDir = mkdtempSync(join(tmpdir(), 'gw-sanity-agents-'));

    // Create a minimal test agent with the example plugin enabled
    mkdirSync(join(tmpAgentsDir, 'test-agent'));
    writeFileSync(
      join(tmpAgentsDir, 'test-agent', 'agent.yml'),
      [
        'safety_profile: trusted',
        'routes:',
        '  - channel: telegram',
        '    scope: dm',
        'plugins:',
        '  example:',
        '    enabled: true',
      ].join('\n') + '\n',
    );
    writeFileSync(join(tmpAgentsDir, 'test-agent', 'CLAUDE.md'), '# test agent\n');

    // Minimal GlobalConfig — no telegram/whatsapp so no network listeners start.
    const config = {
      defaults: {
        model: 'claude-sonnet-4-6',
        embedding_provider: 'off' as const,
        embedding_model: 'text-embedding-3-small',
        debounce_ms: 0,
      },
    };

    // Spy on logger.info to verify expected log messages
    const { logger } = await import('../src/logger.js');
    const infoSpy = vi.spyOn(logger, 'info');

    const { Gateway } = await import('../src/gateway.js');
    const gateway = new Gateway();

    try {
      await gateway.start(config as never, tmpAgentsDir, tmpDataDir, PLUGINS_DIR);

      // Verify 'plugin loaded' log appeared for 'example'
      const calls = infoSpy.mock.calls.map(c => JSON.stringify(c));
      const loadedLog = calls.find(c => c.includes('plugin loaded') && c.includes('example'));
      expect(
        loadedLog,
        `expected 'plugin loaded' log for example, got:\n${calls.slice(-15).join('\n')}`,
      ).toBeDefined();

      // Verify per-agent enable
      expect(gateway.pluginRegistry.isEnabledFor('test-agent', 'example')).toBe(true);

      // Verify tools wired (example plugin registers 'echo', namespaced to 'example_echo')
      const tools = gateway.pluginRegistry.getMcpToolsForAgent('test-agent');
      expect(tools.map(t => t.name)).toContain('example_echo');
    } finally {
      await gateway.stop();
      infoSpy.mockRestore();
    }
  }, 30_000);
});
