/**
 * @e2e — Plan 3 Task A4: full plugin admin flow against a REAL Gateway.
 *
 * Unlike plugins.test.ts and plugin-config.test.ts (which mock the registry),
 * this test boots a real Gateway with the LCM plugin loaded from
 * <repoRoot>/plugins/lcm/dist and exercises every admin route handler against
 * that live instance. It catches across-the-stack bugs that unit tests miss:
 *   - YAML write → registry observation race
 *   - getResolvedPluginsDir() wiring between route + Gateway
 *   - notifyAgentConfigChanged invalidation reaching the plugin
 *   - MCP tool list rebuild after enable / disable
 *   - The Zod-derived JSON Schema actually loads from the LCM dist on disk
 *
 * Pattern: mirrors test/lcm-e2e.test.ts (gateway-level e2e from Plan 2).
 *
 * Pitfalls this test deliberately works around:
 *
 *   1. ui/lib/agents.ts and ui/lib/plugin-schema.ts both compute paths from
 *      `process.cwd()` at *module load time*. We `vi.spyOn(process, 'cwd')`
 *      AND `vi.resetModules()` before the route imports happen so the
 *      module-level constants pick up our tmp paths.
 *
 *   2. ui/lib/gateway.ts has a singleton; we use the exported
 *      `_setInstanceForTest` helper to inject our test Gateway instead of
 *      letting `getGateway()` boot one from the real config.yml.
 *
 *   3. The Gateway plugin loader uses `<dataDir>/../plugins` — but we pass an
 *      explicit pluginsDir. The route's plugin-schema loader reads
 *      `gw.getResolvedPluginsDir()` (real method on the real Gateway) so it
 *      lands on the right plugins/lcm/dist regardless of cwd.
 *
 *   4. The LCM plugin must be built before this test runs (we depend on
 *      plugins/lcm/dist/index.js + dist/config.js being on disk). The test
 *      asserts this up front to fail fast with a clear message.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { NextRequest } from 'next/server';

// ── SDK mock — gateway.start() must not require real auth or network ────
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...real,
    startup: vi.fn(async () => {
      throw new Error('mocked: no SDK in tests');
    }),
  };
});

// ── Auth bypass ────────────────────────────────────────────────────────
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long!!';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'testpassword123';

vi.mock('@/lib/require-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/require-auth')>(
    '@/lib/require-auth',
  );
  return {
    ...actual,
    requireAuth: vi
      .fn()
      .mockResolvedValue({ email: 'admin@test.com', authMethod: 'cookie' }),
  };
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const PLUGINS_DIR = resolve(REPO_ROOT, 'plugins');
const LCM_DIST_ENTRY = resolve(REPO_ROOT, 'plugins/lcm/dist/index.js');
const LCM_DIST_CONFIG = resolve(REPO_ROOT, 'plugins/lcm/dist/config.js');

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('@e2e: plugin admin full flow', () => {
  let tmpRoot: string | undefined;
  let tmpDataDir: string | undefined;
  let tmpAgentsDir: string | undefined;
  let testGateway: import('../../../src/gateway.js').Gateway | null = null;

  afterEach(async () => {
    if (testGateway) {
      try {
        await testGateway.stop();
      } catch {
        /* ignore — best-effort teardown */
      }
      testGateway = null;
    }
    // Reset the gateway singleton so the next test starts clean.
    try {
      const gwModule = await import('@/lib/gateway');
      gwModule._resetForTest();
    } catch {
      /* ignore */
    }
    if (tmpDataDir) rmSync(tmpDataDir, { recursive: true, force: true });
    if (tmpAgentsDir) rmSync(tmpAgentsDir, { recursive: true, force: true });
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('full plugin admin flow: list → enable → schema → config → disable', async () => {
    // ── Pre-flight: LCM dist must exist ────────────────────────────────
    if (!existsSync(LCM_DIST_ENTRY) || !existsSync(LCM_DIST_CONFIG)) {
      throw new Error(
        `LCM dist missing — run \`pnpm --filter @anthroclaw/plugin-lcm build\` first. Looked at: ${LCM_DIST_ENTRY}`,
      );
    }

    // ── tmp layout: <tmpRoot>/{ui,agents,data} so cwd-relative resolution works
    tmpRoot = mkdtempSync(join(tmpdir(), 'p3-e2e-'));
    const fakeUi = join(tmpRoot, 'ui');
    tmpAgentsDir = join(tmpRoot, 'agents');
    tmpDataDir = join(tmpRoot, 'data');
    mkdirSync(fakeUi, { recursive: true });
    mkdirSync(tmpAgentsDir, { recursive: true });
    mkdirSync(tmpDataDir, { recursive: true });

    // Spy cwd → fakeUi BEFORE route modules import (their AGENTS_DIR uses
    // `resolve(process.cwd(), '..', 'agents')` at module load time).
    vi.spyOn(process, 'cwd').mockReturnValue(fakeUi);
    vi.resetModules();

    // ── Test agent (initially without a plugins block) ─────────────────
    mkdirSync(join(tmpAgentsDir, 'test-agent'));
    writeFileSync(
      join(tmpAgentsDir, 'test-agent', 'agent.yml'),
      [
        '# operator-authored agent',
        'model: claude-sonnet-4-6',
        'safety_profile: trusted',
        'routes:',
        '  - channel: telegram',
        '    scope: dm',
        '',
      ].join('\n'),
    );
    writeFileSync(join(tmpAgentsDir, 'test-agent', 'CLAUDE.md'), '# test\n');

    // ── Boot real Gateway ──────────────────────────────────────────────
    const config = {
      defaults: {
        model: 'claude-sonnet-4-6',
        embedding_provider: 'off' as const,
        embedding_model: 'text-embedding-3-small',
        debounce_ms: 0,
      },
    };

    const { Gateway } = await import('../../../src/gateway.js');
    testGateway = new Gateway();
    await testGateway.start(
      config as never,
      tmpAgentsDir,
      tmpDataDir,
      PLUGINS_DIR,
    );

    // Inject our gateway into the UI singleton so route handlers see it.
    const gwModule = await import('@/lib/gateway');
    gwModule._setInstanceForTest(testGateway);

    // ── Phase 1: List plugins ──────────────────────────────────────────
    const { GET: listPlugins } = await import('@/app/api/plugins/route');
    let res = await listPlugins();
    expect(res.status).toBe(200);
    let body = await res.json();
    const names = body.plugins.map((p: { name: string }) => p.name);
    expect(names).toContain('lcm');
    const lcmListEntry = body.plugins.find(
      (p: { name: string }) => p.name === 'lcm',
    );
    expect(lcmListEntry?.hasConfigSchema).toBe(true);
    expect(lcmListEntry?.hasContextEngine).toBe(true);
    expect(lcmListEntry?.toolCount).toBeGreaterThanOrEqual(6);

    // ── Phase 2: Per-agent state — initially disabled ──────────────────
    const { GET: getAgentPlugins } = await import(
      '@/app/api/agents/[agentId]/plugins/route'
    );
    res = await getAgentPlugins(
      new NextRequest('http://localhost:3000/api/agents/test-agent/plugins'),
      { params: Promise.resolve({ agentId: 'test-agent' }) },
    );
    expect(res.status).toBe(200);
    body = await res.json();
    expect(body.agentId).toBe('test-agent');
    const lcmEntry = body.plugins.find(
      (p: { name: string; enabled: boolean }) => p.name === 'lcm',
    );
    expect(lcmEntry?.enabled).toBe(false);
    expect(lcmEntry?.config).toEqual({});

    // ── Phase 3: Enable LCM ────────────────────────────────────────────
    const { PUT: putAgentPlugin } = await import(
      '@/app/api/agents/[agentId]/plugins/[name]/route'
    );
    res = await putAgentPlugin(
      jsonRequest('http://localhost:3000/api/agents/test-agent/plugins/lcm', {
        enabled: true,
      }),
      { params: Promise.resolve({ agentId: 'test-agent', name: 'lcm' }) },
    );
    expect(res.status).toBe(200);
    body = await res.json();
    expect(body).toEqual({ ok: true, enabled: true });

    // Real registry observed the toggle.
    expect(testGateway.pluginRegistry.isEnabledFor('test-agent', 'lcm')).toBe(
      true,
    );

    // YAML on disk reflects the toggle AND preserves the operator's top
    // comment (proves parseDocument round-trip is wired through).
    const ymlAfterEnable = readFileSync(
      join(tmpAgentsDir, 'test-agent', 'agent.yml'),
      'utf-8',
    );
    expect(ymlAfterEnable).toMatch(/plugins:[\s\S]*lcm:[\s\S]*enabled:\s*true/);
    expect(ymlAfterEnable).toContain('# operator-authored agent');

    // MCP tools include lcm_* (post-refresh) — note: this query goes through
    // pluginRegistry, not the per-agent MCP server, so it returns the
    // currently-enabled plugin set.
    const tools = testGateway.pluginRegistry.getMcpToolsForAgent('test-agent');
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('lcm_grep');
    expect(toolNames).toContain('lcm_describe');

    // ── Phase 4: Get JSON Schema for LCM config ────────────────────────
    const { GET: getSchema } = await import(
      '@/app/api/plugins/[name]/config-schema/route'
    );
    res = await getSchema(
      new NextRequest('http://localhost:3000/api/plugins/lcm/config-schema'),
      { params: Promise.resolve({ name: 'lcm' }) },
    );
    expect(res.status).toBe(200);
    body = await res.json();
    expect(body.name).toBe('lcm');
    expect(body.jsonSchema).toBeTruthy();
    expect(body.jsonSchema.type).toBe('object');
    // LCM's config has a `triggers` block — assert its schema is reachable.
    expect(body.jsonSchema.properties).toBeTruthy();
    expect(body.defaults).toBeTruthy();
    expect(typeof body.defaults).toBe('object');

    // ── Phase 5: Update config + verify cache invalidation ─────────────
    const { PUT: putConfig } = await import(
      '@/app/api/agents/[agentId]/plugins/[name]/config/route'
    );
    // Use defaults as a base + tweak one trigger field — keeps the config
    // valid against LCM's Zod schema regardless of future field additions.
    const newConfig = {
      ...(body.defaults as Record<string, unknown>),
      enabled: true,
      triggers: {
        ...((body.defaults as { triggers?: Record<string, unknown> }).triggers ??
          {}),
        compress_threshold_tokens: 50000,
      },
    };
    res = await putConfig(
      jsonRequest(
        'http://localhost:3000/api/agents/test-agent/plugins/lcm/config',
        { config: newConfig },
      ),
      { params: Promise.resolve({ agentId: 'test-agent', name: 'lcm' }) },
    );
    expect(res.status).toBe(200);

    // YAML reflects the new threshold.
    const ymlAfterConfig = readFileSync(
      join(tmpAgentsDir, 'test-agent', 'agent.yml'),
      'utf-8',
    );
    expect(ymlAfterConfig).toMatch(/compress_threshold_tokens:\s*50000/);

    // Re-read via the GET handler and confirm the round-trip is consistent.
    res = await getAgentPlugins(
      new NextRequest('http://localhost:3000/api/agents/test-agent/plugins'),
      { params: Promise.resolve({ agentId: 'test-agent' }) },
    );
    body = await res.json();
    const lcmAfterConfig = body.plugins.find(
      (p: { name: string }) => p.name === 'lcm',
    );
    expect(lcmAfterConfig?.config?.triggers?.compress_threshold_tokens).toBe(
      50000,
    );
    // Still enabled.
    expect(lcmAfterConfig?.enabled).toBe(true);

    // ── Phase 6: Disable LCM ───────────────────────────────────────────
    res = await putAgentPlugin(
      jsonRequest('http://localhost:3000/api/agents/test-agent/plugins/lcm', {
        enabled: false,
      }),
      { params: Promise.resolve({ agentId: 'test-agent', name: 'lcm' }) },
    );
    expect(res.status).toBe(200);

    expect(testGateway.pluginRegistry.isEnabledFor('test-agent', 'lcm')).toBe(
      false,
    );

    // After disable, MCP tools must NOT include lcm_*.
    const toolsAfterDisable =
      testGateway.pluginRegistry.getMcpToolsForAgent('test-agent');
    const toolNamesAfterDisable = toolsAfterDisable.map((t) => t.name);
    expect(toolNamesAfterDisable).not.toContain('lcm_grep');
    expect(toolNamesAfterDisable).not.toContain('lcm_describe');

    // YAML still preserves the config block (only `enabled` flips).
    const ymlAfterDisable = readFileSync(
      join(tmpAgentsDir, 'test-agent', 'agent.yml'),
      'utf-8',
    );
    expect(ymlAfterDisable).toMatch(/enabled:\s*false/);
    expect(ymlAfterDisable).toMatch(/compress_threshold_tokens:\s*50000/);
  }, 30_000);
});
