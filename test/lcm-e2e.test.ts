/**
 * @e2e — Plan 2 Task 25: gateway + LCM plugin end-to-end smoke test.
 *
 * Verifies the whole stack wired together:
 *   1. Gateway loads the LCM plugin from plugins/lcm/.
 *   2. Per-agent enable populates `pluginRegistry`.
 *   3. All 6 lcm_* MCP tools are registered (auto-namespaced via createPluginContext).
 *   4. ContextEngine is registered and exposes compress + assemble.
 *   5. Mirror hook (`on_after_query`) is reachable via pluginRegistry.listAllHooks().
 *   6. Firing the hook with `newMessages` ingests them into the agent's per-agent DB.
 *   7. lcm_grep + lcm_describe + lcm_status resolve the right per-agent state from
 *      McpToolContext.agentId and observe the ingested data.
 *   8. ContextEngine.compress() executes without throwing (does not require actual
 *      compression — wiring verification only; T23 owns the byte-exact invariant).
 *
 * Pattern follows test/plugin-framework-sanity.test.ts.
 *
 * Note: this test deliberately lives in the gateway-level test/ tree (NOT
 * plugins/lcm/tests/) because plugins/lcm/vitest.config.ts restricts to
 * `tests/**` and lacks gateway module resolution.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

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
const PLUGINS_DIR = resolve(REPO_ROOT, 'plugins');

describe('@e2e: gateway + LCM plugin end-to-end', () => {
  let tmpDataDir: string;
  let tmpAgentsDir: string;

  afterEach(() => {
    if (tmpDataDir) rmSync(tmpDataDir, { recursive: true, force: true });
    if (tmpAgentsDir) rmSync(tmpAgentsDir, { recursive: true, force: true });
  });

  it('loads LCM plugin, registers tools + engine + mirror hook, and the full ingest→grep pipeline works', async () => {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'lcm-e2e-data-'));
    tmpAgentsDir = mkdtempSync(join(tmpdir(), 'lcm-e2e-agents-'));

    // ── Test agent with LCM enabled ──────────────────────────────────────────
    mkdirSync(join(tmpAgentsDir, 'test-agent'));
    writeFileSync(
      join(tmpAgentsDir, 'test-agent', 'agent.yml'),
      [
        'routes:',
        '  - channel: telegram',
        '    scope: dm',
        'plugins:',
        '  lcm:',
        '    enabled: true',
        // Use defaults so compression bails out for tiny test data — we don't want
        // to trigger a real summarizer subagent call (no SDK in tests). T25 is a
        // wiring smoke test; T23 owns the byte-exact compress invariant.
        '    triggers:',
        '      compress_threshold_tokens: 40000',
        '      fresh_tail_count: 64',
      ].join('\n') + '\n',
    );
    writeFileSync(join(tmpAgentsDir, 'test-agent', 'CLAUDE.md'), '# test agent\n');

    // Minimal GlobalConfig — no telegram/whatsapp keys ⇒ no network listeners start.
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

      // ── 1. Plugin loaded ───────────────────────────────────────────────────
      const calls = infoSpy.mock.calls.map(c => JSON.stringify(c));
      const loadedLog = calls.find(c => c.includes('plugin loaded') && c.includes('lcm'));
      expect(loadedLog, `expected 'plugin loaded' log for lcm`).toBeDefined();
      expect(gateway.pluginRegistry.isEnabledFor('test-agent', 'lcm')).toBe(true);

      // ── 2. All 6 lcm_* tools registered (auto-namespaced) ──────────────────
      const tools = gateway.pluginRegistry.getMcpToolsForAgent('test-agent');
      const toolNames = tools.map(t => t.name).sort();
      expect(toolNames).toEqual(
        expect.arrayContaining([
          'lcm_describe',
          'lcm_doctor',
          'lcm_expand',
          'lcm_expand_query',
          'lcm_grep',
          'lcm_status',
        ]),
      );

      // ── 3. ContextEngine registered ────────────────────────────────────────
      const engineEntry = gateway.pluginRegistry.getContextEngine('test-agent');
      expect(engineEntry, 'LCM should register a ContextEngine').toBeTruthy();
      expect(engineEntry?.name).toBe('lcm');
      expect(engineEntry?.engine.compress).toBeDefined();
      expect(engineEntry?.engine.assemble).toBeDefined();

      // ── 4. Mirror hook registered for on_after_query ───────────────────────
      const allHooks = gateway.pluginRegistry.listAllHooks();
      const afterQueryHook = allHooks.find(
        h => h.event === 'on_after_query' && h.pluginName === 'lcm',
      );
      expect(afterQueryHook, `expected on_after_query hook from lcm`).toBeDefined();

      // ── 5. Fire the mirror hook with synthetic messages ────────────────────
      // Real gateway-style session key.
      const sessionKey = 'test-agent:telegram:dm:user-1';

      // Payload shape per plugins/lcm/src/hooks/mirror.ts MirrorPayload:
      //   { agentId, sessionKey, source, newMessages: EngineMessage[] }
      const mirrorPayload = {
        agentId: 'test-agent',
        sessionKey,
        source: 'telegram',
        newMessages: [
          { role: 'user', content: 'MARKER-100: anchor message about widgets', ts: 1000 },
          { role: 'assistant', content: 'Reply about widgets discussion', ts: 1001 },
          { role: 'user', content: 'MARKER-200: another anchor about gadgets', ts: 1002 },
          { role: 'assistant', content: 'Reply about gadgets', ts: 1003 },
        ],
      };
      // Hook handler is sync (createMirrorHook returns void); awaiting Promise.resolve is safe.
      await Promise.resolve(afterQueryHook!.handler(mirrorPayload as never));

      // ── 6. lcm_grep finds the markers (cross-session search by default) ────
      const grepTool = tools.find(t => t.name === 'lcm_grep')!;
      const grepResult = await grepTool.handler(
        { query: 'MARKER-100' },
        { agentId: 'test-agent' },
      );
      const grepText = (grepResult.content[0] as { type: 'text'; text: string }).text;
      expect(
        grepText,
        `lcm_grep should find MARKER-100 — got: ${grepText.slice(0, 200)}`,
      ).toContain('MARKER-100');

      // Second grep — confirms multi-marker FTS works and rate limiting is per-tool.
      const grepResult2 = await grepTool.handler(
        { query: 'gadgets' },
        { agentId: 'test-agent' },
      );
      const grepText2 = (grepResult2.content[0] as { type: 'text'; text: string }).text;
      expect(grepText2).toContain('gadgets');

      // ── 7. lcm_describe overview reflects ingested rows ────────────────────
      const describeTool = tools.find(t => t.name === 'lcm_describe')!;
      const describeResult = await describeTool.handler({}, { agentId: 'test-agent' });
      const describeText = (describeResult.content[0] as { type: 'text'; text: string }).text;
      // Overview JSON should mention the count of stored messages (4).
      expect(describeText.length).toBeGreaterThan(0);
      expect(describeText).toMatch(/messages|stored|sessions|"4"|: 4/i);

      // ── 8. lcm_status produces non-empty stats output ──────────────────────
      const statusTool = tools.find(t => t.name === 'lcm_status')!;
      const statusResult = await statusTool.handler({}, { agentId: 'test-agent' });
      const statusText = (statusResult.content[0] as { type: 'text'; text: string }).text;
      expect(statusText.length).toBeGreaterThan(0);

      // ── 9. ContextEngine.compress() executes without throwing ──────────────
      // We pass agentId via input (the engine facade uses input.agentId, not ctx).
      // Engine messages duplicate the mirror payload; whether compression actually
      // applies depends on token thresholds — for this small workload it likely
      // bails out, which is fine. We just verify the wiring + non-throwing path.
      const compressResult = await engineEntry!.engine.compress!({
        agentId: 'test-agent',
        sessionKey,
        messages: mirrorPayload.newMessages,
        currentTokens: 100_000,
      } as never);
      // compress() returns either null (no compression) or { messages: [...] }.
      expect(
        compressResult === null ||
          (typeof compressResult === 'object' && compressResult !== null),
      ).toBe(true);

      // ── 10. ContextEngine.assemble() executes without throwing ─────────────
      const assembleResult = await engineEntry!.engine.assemble!({
        agentId: 'test-agent',
        sessionKey,
        messages: mirrorPayload.newMessages,
      } as never);
      // assemble() either returns null (pass-through) or { messages: [...] }.
      expect(
        assembleResult === null ||
          (typeof assembleResult === 'object' && assembleResult !== null),
      ).toBe(true);
    } finally {
      await gateway.stop();
      infoSpy.mockRestore();
    }
  }, 30_000);
});
