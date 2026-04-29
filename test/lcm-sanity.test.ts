/**
 * Sanity smoke — Gateway boots with LCM plugin enabled.
 *
 * Companion to `test/plugin-framework-sanity.test.ts` (Plan 1) and
 * `test/lcm-e2e.test.ts` (Plan 2 / T25). This is the focused boot-time check:
 * does Gateway.start() find the LCM plugin, wire the agent, and expose all
 * 6 lcm_* tools through the per-agent MCP server. Faster to fail than T25's
 * full pipeline test — useful as a quick regression gate.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...real,
    startup: vi.fn(async () => { throw new Error('mocked: no SDK in tests'); }),
  };
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PLUGINS_DIR = resolve(REPO_ROOT, 'plugins');

const EXPECTED_TOOLS = [
  'lcm_grep',
  'lcm_describe',
  'lcm_expand',
  'lcm_expand_query',
  'lcm_status',
  'lcm_doctor',
];

describe('LCM sanity — Gateway.start loads LCM plugin and registers all 6 tools', () => {
  let tmpDataDir: string;
  let tmpAgentsDir: string;

  afterEach(() => {
    if (tmpDataDir) rmSync(tmpDataDir, { recursive: true, force: true });
    if (tmpAgentsDir) rmSync(tmpAgentsDir, { recursive: true, force: true });
  });

  it('boots Gateway with LCM enabled, wires per-agent MCP with all lcm_* tools', async () => {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'lcm-sanity-data-'));
    tmpAgentsDir = mkdtempSync(join(tmpdir(), 'lcm-sanity-agents-'));

    mkdirSync(join(tmpAgentsDir, 'test-agent'));
    writeFileSync(
      join(tmpAgentsDir, 'test-agent', 'agent.yml'),
      [
        'safety_profile: trusted',
        'routes:',
        '  - channel: telegram',
        '    scope: dm',
        'plugins:',
        '  lcm:',
        '    enabled: true',
      ].join('\n') + '\n',
    );
    writeFileSync(join(tmpAgentsDir, 'test-agent', 'CLAUDE.md'), '# test agent\n');

    const config = {
      defaults: {
        model: 'claude-sonnet-4-6',
        embedding_provider: 'off' as const,
        embedding_model: 'text-embedding-3-small',
        debounce_ms: 0,
      },
    };

    const { logger } = await import('../src/logger.js');
    const infoSpy = vi.spyOn(logger, 'info');

    const { Gateway } = await import('../src/gateway.js');
    const gateway = new Gateway();

    try {
      await gateway.start(config as never, tmpAgentsDir, tmpDataDir, PLUGINS_DIR);

      // Plugin loaded log
      const calls = infoSpy.mock.calls.map(c => JSON.stringify(c));
      const loadedLog = calls.find(c => c.includes('plugin loaded') && c.includes('lcm'));
      expect(
        loadedLog,
        `expected 'plugin loaded' log for lcm; tail of logs:\n${calls.slice(-15).join('\n')}`,
      ).toBeDefined();

      // Per-agent enable
      expect(gateway.pluginRegistry.isEnabledFor('test-agent', 'lcm')).toBe(true);

      // All 6 tools registered with auto-namespacing
      const tools = gateway.pluginRegistry.getMcpToolsForAgent('test-agent');
      const toolNames = tools.map(t => t.name);
      for (const expected of EXPECTED_TOOLS) {
        expect(toolNames, `expected tool ${expected} in registered set: ${toolNames.join(', ')}`)
          .toContain(expected);
      }

      // ContextEngine registered (compress + assemble surface available)
      const engineEntry = gateway.pluginRegistry.getContextEngine('test-agent');
      expect(engineEntry?.name, 'ContextEngine should be registered by lcm').toBe('lcm');
      expect(engineEntry?.engine.compress, 'engine.compress must be defined').toBeTypeOf('function');
      expect(engineEntry?.engine.assemble, 'engine.assemble must be defined').toBeTypeOf('function');
    } finally {
      await gateway.stop();
      infoSpy.mockRestore();
    }
  }, 30_000);
});
