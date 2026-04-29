import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

// ─── Auth bypass ──────────────────────────────────────────────────────
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long!!';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'testpassword123';

vi.mock('@/lib/require-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/require-auth')>('@/lib/require-auth');
  return {
    ...actual,
    requireAuth: vi.fn().mockResolvedValue({ email: 'admin@test.com', authMethod: 'cookie' }),
  };
});

// ─── Per-test fixture: agents dir + plugin dir under tmp ─────────────

let tmpRoot: string;
let agentsDir: string;
let pluginsDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'plugin-config-api-'));
  const fakeUi = join(tmpRoot, 'ui');
  mkdirSync(fakeUi, { recursive: true });
  agentsDir = join(tmpRoot, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  pluginsDir = join(tmpRoot, 'plugins');
  mkdirSync(pluginsDir, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(fakeUi);
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

function writeAgentYml(id: string, body: Record<string, unknown>): void {
  const dir = join(agentsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.yml'), stringifyYaml(body), 'utf-8');
}

/**
 * Materialize a fake plugin on disk so the route can dynamic-import its
 * compiled config schema module. The schema file is written as ESM JS
 * exporting `default`, `configSchema`, or a NamedSchema export depending on
 * `exportName`.
 */
function writePluginSchemaModule(
  pluginName: string,
  exportName: 'default' | 'configSchema' | 'named',
  schemaSource: string,
  manifestRelPath: string = 'dist/config.js',
): string {
  const pluginDir = join(pluginsDir, pluginName);
  mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
  mkdirSync(join(pluginDir, 'dist'), { recursive: true });

  const manifest = {
    name: pluginName,
    version: '0.1.0',
    description: `${pluginName} plugin`,
    entry: 'dist/index.js',
    configSchema: manifestRelPath,
  };
  writeFileSync(
    join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  // Write the schema module. We import zod from the workspace's installed
  // copy (resolved via `import('zod')` from this test file's location).
  // The plugin module itself uses a relative-to-tmp `import 'zod'` — node
  // will hoist resolution to the project's node_modules.
  let body = `import { z } from 'zod';\n${schemaSource}\n`;
  if (exportName === 'default') {
    body += `export default __SCHEMA__;\n`;
  } else if (exportName === 'configSchema') {
    body += `export const configSchema = __SCHEMA__;\n`;
  } else {
    // pluginName camelCased + ConfigSchema, e.g. "lcm" → "lcmConfigSchema"
    // The route also tries upper-cased ("LcmConfigSchema") — exercise the
    // upper-cased path here.
    const Cap = pluginName.charAt(0).toUpperCase() + pluginName.slice(1);
    body += `export const ${Cap}ConfigSchema = __SCHEMA__;\n`;
  }
  writeFileSync(join(pluginDir, manifestRelPath), body, 'utf-8');
  return pluginDir;
}

// ─── Fake gateway helpers ─────────────────────────────────────────────

interface FakePluginEntry {
  manifest: { name: string; version: string; description?: string; configSchema?: string };
  pluginDir?: string;
  hasEngine?: boolean;
  tools?: Array<{ name: string }>;
}

function makeFakeGateway(plugins: FakePluginEntry[], resolvedPluginsDir?: string) {
  const enabled = new Map<string, Set<string>>();
  return {
    refreshAgentPluginTools: vi.fn(),
    resolvedPluginsDir: resolvedPluginsDir ?? pluginsDir,
    getResolvedPluginsDir: vi.fn(() => resolvedPluginsDir ?? pluginsDir),
    pluginRegistry: {
      listPlugins: vi.fn(() =>
        plugins.map((p) => ({ manifest: p.manifest, instance: {} })),
      ),
      getMcpToolsForPlugin: vi.fn((name: string) => {
        const p = plugins.find((x) => x.manifest.name === name);
        return p?.tools ?? [];
      }),
      hasContextEngineForPlugin: vi.fn((name: string) => {
        const p = plugins.find((x) => x.manifest.name === name);
        return p?.hasEngine ?? false;
      }),
      isEnabledFor: vi.fn(
        (agentId: string, pluginName: string) =>
          enabled.get(agentId)?.has(pluginName) ?? false,
      ),
      enableForAgent: vi.fn((agentId: string, pluginName: string) => {
        if (!plugins.some((p) => p.manifest.name === pluginName)) {
          throw new Error(`unknown plugin: ${pluginName}`);
        }
        const set = enabled.get(agentId) ?? new Set<string>();
        set.add(pluginName);
        enabled.set(agentId, set);
      }),
      disableForAgent: vi.fn((agentId: string, pluginName: string) => {
        enabled.get(agentId)?.delete(pluginName);
      }),
    },
  };
}

function jsonRequest(url: string, body: unknown, method = 'PUT'): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── A simple Zod schema source we can substitute via ${schema} ───────
// We construct schemas inline rather than using LCMConfigSchema directly
// so the test does not depend on the real plugin being built.

const SAMPLE_SCHEMA_SOURCE = `
const __SCHEMA__ = z.object({
  enabled: z.boolean().default(false),
  triggers: z.object({
    threshold: z.number().int().positive().default(40000),
  }).default({ threshold: 40000 }),
});`;

// ─── Tests: GET /api/plugins/[name]/config-schema ─────────────────────

describe('GET /api/plugins/[name]/config-schema', () => {
  it('returns JSON Schema and parsed defaults for a plugin with default export', async () => {
    writePluginSchemaModule('demo', 'default', SAMPLE_SCHEMA_SOURCE);

    const fakeGw = makeFakeGateway([
      { manifest: { name: 'demo', version: '0.1.0', configSchema: 'dist/config.js' } },
    ]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { GET } = await import('@/app/api/plugins/[name]/config-schema/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/plugins/demo/config-schema'),
      { params: Promise.resolve({ name: 'demo' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe('demo');
    expect(json.jsonSchema).toBeTruthy();
    expect(json.jsonSchema.type).toBe('object');
    expect(json.jsonSchema.properties).toHaveProperty('enabled');
    expect(json.jsonSchema.properties).toHaveProperty('triggers');
    expect(json.defaults).toEqual({ enabled: false, triggers: { threshold: 40000 } });
  });

  it('finds schema via named "configSchema" export', async () => {
    writePluginSchemaModule('namedcfg', 'configSchema', SAMPLE_SCHEMA_SOURCE);

    const fakeGw = makeFakeGateway([
      { manifest: { name: 'namedcfg', version: '0.1.0', configSchema: 'dist/config.js' } },
    ]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { GET } = await import('@/app/api/plugins/[name]/config-schema/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/plugins/namedcfg/config-schema'),
      { params: Promise.resolve({ name: 'namedcfg' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.jsonSchema.properties).toHaveProperty('enabled');
  });

  it('finds schema via "<Name>ConfigSchema" capitalized export', async () => {
    writePluginSchemaModule('lcm', 'named', SAMPLE_SCHEMA_SOURCE);

    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0', configSchema: 'dist/config.js' } },
    ]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { GET } = await import('@/app/api/plugins/[name]/config-schema/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/plugins/lcm/config-schema'),
      { params: Promise.resolve({ name: 'lcm' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.jsonSchema.properties).toHaveProperty('enabled');
    expect(json.defaults).toEqual({ enabled: false, triggers: { threshold: 40000 } });
  });

  it('returns 404 for unknown plugin', async () => {
    const fakeGw = makeFakeGateway([]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { GET } = await import('@/app/api/plugins/[name]/config-schema/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/plugins/ghost/config-schema'),
      { params: Promise.resolve({ name: 'ghost' }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when plugin has no configSchema declared', async () => {
    const fakeGw = makeFakeGateway([
      { manifest: { name: 'plain', version: '0.1.0' } },
    ]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { GET } = await import('@/app/api/plugins/[name]/config-schema/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/plugins/plain/config-schema'),
      { params: Promise.resolve({ name: 'plain' }) },
    );
    expect(res.status).toBe(404);
  });
});

// ─── Tests: GET /api/agents/[agentId]/plugins/[name]/config ──────────

describe('GET /api/agents/[agentId]/plugins/[name]/config', () => {
  it('returns the current per-agent config block', async () => {
    writeAgentYml('alpha', {
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
      plugins: { lcm: { enabled: true, threshold: 0.7 } },
    });

    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0', configSchema: 'dist/config.js' } },
    ]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { GET } = await import('@/app/api/agents/[agentId]/plugins/[name]/config/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/agents/alpha/plugins/lcm/config'),
      { params: Promise.resolve({ agentId: 'alpha', name: 'lcm' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.agentId).toBe('alpha');
    expect(json.pluginName).toBe('lcm');
    expect(json.config).toEqual({ enabled: true, threshold: 0.7 });
  });

  it('returns config: {} when agent has no plugins.<name> block', async () => {
    writeAgentYml('alpha', {
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
    });

    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0', configSchema: 'dist/config.js' } },
    ]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { GET } = await import('@/app/api/agents/[agentId]/plugins/[name]/config/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/agents/alpha/plugins/lcm/config'),
      { params: Promise.resolve({ agentId: 'alpha', name: 'lcm' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.config).toEqual({});
  });

  it('returns 404 for unknown agent', async () => {
    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0', configSchema: 'dist/config.js' } },
    ]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { GET } = await import('@/app/api/agents/[agentId]/plugins/[name]/config/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/agents/missing/plugins/lcm/config'),
      { params: Promise.resolve({ agentId: 'missing', name: 'lcm' }) },
    );
    expect(res.status).toBe(404);
  });
});

// ─── Tests: PUT /api/agents/[agentId]/plugins/[name]/config ──────────

describe('PUT /api/agents/[agentId]/plugins/[name]/config', () => {
  it('writes a valid config and returns ok', async () => {
    writeAgentYml('alpha', {
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
    });
    writePluginSchemaModule('lcm', 'default', SAMPLE_SCHEMA_SOURCE);

    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0', configSchema: 'dist/config.js' } },
    ]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { PUT } = await import('@/app/api/agents/[agentId]/plugins/[name]/config/route');
    const res = await PUT(
      jsonRequest('http://localhost:3000/api/agents/alpha/plugins/lcm/config', {
        config: { enabled: true, triggers: { threshold: 50000 } },
      }),
      { params: Promise.resolve({ agentId: 'alpha', name: 'lcm' }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const yml = parseYaml(readFileSync(join(agentsDir, 'alpha', 'agent.yml'), 'utf-8'));
    expect(yml.plugins.lcm.triggers.threshold).toBe(50000);
    expect(yml.plugins.lcm.enabled).toBe(true);

    expect(fakeGw.refreshAgentPluginTools).toHaveBeenCalledWith('alpha');
  });

  it('returns 400 with Zod issue details when config fails schema validation', async () => {
    writeAgentYml('alpha', {
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
    });
    writePluginSchemaModule('lcm', 'default', SAMPLE_SCHEMA_SOURCE);

    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0', configSchema: 'dist/config.js' } },
    ]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { PUT } = await import('@/app/api/agents/[agentId]/plugins/[name]/config/route');
    const res = await PUT(
      jsonRequest('http://localhost:3000/api/agents/alpha/plugins/lcm/config', {
        // triggers.threshold is required positive int — pass a string
        config: { enabled: true, triggers: { threshold: 'oops' } },
      }),
      { params: Promise.resolve({ agentId: 'alpha', name: 'lcm' }) },
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_config');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
  });

  it('returns 400 on malformed body (missing config field)', async () => {
    writeAgentYml('alpha', {
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
    });
    writePluginSchemaModule('lcm', 'default', SAMPLE_SCHEMA_SOURCE);

    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0', configSchema: 'dist/config.js' } },
    ]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { PUT } = await import('@/app/api/agents/[agentId]/plugins/[name]/config/route');
    const res = await PUT(
      jsonRequest('http://localhost:3000/api/agents/alpha/plugins/lcm/config', {
        wrong_field: 'value',
      }),
      { params: Promise.resolve({ agentId: 'alpha', name: 'lcm' }) },
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
  });

  it('returns 400 for unknown plugin', async () => {
    writeAgentYml('alpha', {
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
    });

    const fakeGw = makeFakeGateway([]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { PUT } = await import('@/app/api/agents/[agentId]/plugins/[name]/config/route');
    const res = await PUT(
      jsonRequest('http://localhost:3000/api/agents/alpha/plugins/ghost/config', {
        config: {},
      }),
      { params: Promise.resolve({ agentId: 'alpha', name: 'ghost' }) },
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('unknown_plugin');
  });

  it('returns 404 for unknown agent', async () => {
    writePluginSchemaModule('lcm', 'default', SAMPLE_SCHEMA_SOURCE);
    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0', configSchema: 'dist/config.js' } },
    ]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { PUT } = await import('@/app/api/agents/[agentId]/plugins/[name]/config/route');
    const res = await PUT(
      jsonRequest('http://localhost:3000/api/agents/missing/plugins/lcm/config', {
        config: { enabled: false, triggers: { threshold: 1 } },
      }),
      { params: Promise.resolve({ agentId: 'missing', name: 'lcm' }) },
    );
    expect(res.status).toBe(404);
  });

  it('preserves YAML comments and blank lines on config update', async () => {
    const yml =
      [
        '# Top comment',
        'model: claude-sonnet-4-6  # inline comment',
        'routes:',
        '  - channel: telegram',
        '    scope: dm',
        '',
        '# About plugins',
        'plugins:',
        '  lcm:',
        '    enabled: false',
        '    triggers:',
        '      threshold: 1000',
      ].join('\n') + '\n';
    const dir = join(agentsDir, 'alpha');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent.yml'), yml, 'utf-8');

    writePluginSchemaModule('lcm', 'default', SAMPLE_SCHEMA_SOURCE);
    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0', configSchema: 'dist/config.js' } },
    ]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { PUT } = await import('@/app/api/agents/[agentId]/plugins/[name]/config/route');
    const res = await PUT(
      jsonRequest('http://localhost:3000/api/agents/alpha/plugins/lcm/config', {
        config: { enabled: true, triggers: { threshold: 9999 } },
      }),
      { params: Promise.resolve({ agentId: 'alpha', name: 'lcm' }) },
    );
    expect(res.status).toBe(200);

    const after = readFileSync(join(agentsDir, 'alpha', 'agent.yml'), 'utf-8');
    expect(after).toContain('# Top comment');
    expect(after).toContain('# About plugins');
    expect(after).toContain('# inline comment');
    expect(after).toMatch(/threshold:\s*9999/);
    expect(after).toMatch(/enabled:\s*true/);
  });

  it('calls refreshAgentPluginTools after a successful write', async () => {
    writeAgentYml('alpha', {
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
    });
    writePluginSchemaModule('lcm', 'default', SAMPLE_SCHEMA_SOURCE);
    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0', configSchema: 'dist/config.js' } },
    ]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { PUT } = await import('@/app/api/agents/[agentId]/plugins/[name]/config/route');
    await PUT(
      jsonRequest('http://localhost:3000/api/agents/alpha/plugins/lcm/config', {
        config: { enabled: true, triggers: { threshold: 50000 } },
      }),
      { params: Promise.resolve({ agentId: 'alpha', name: 'lcm' }) },
    );
    expect(fakeGw.refreshAgentPluginTools).toHaveBeenCalledWith('alpha');
  });
});
