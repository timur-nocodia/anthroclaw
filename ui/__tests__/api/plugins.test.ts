import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

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

// ─── Per-test agents-dir fixture ──────────────────────────────────────
// `lib/agents.ts` resolves AGENTS_DIR from process.cwd()/../agents at module
// import time. The UI test runner runs with cwd=ui/, so we need to redirect
// agents to a tmp dir. Simplest path: chdir into a tmp parent before importing
// the route modules, and reset between tests.

let tmpRoot: string;
let agentsDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpRoot = mkdtempSync(join(tmpdir(), 'plugins-api-test-'));
  // Mimic real layout: cwd is .../ui, agents resolves to ../agents
  const fakeUi = join(tmpRoot, 'ui');
  mkdirSync(fakeUi, { recursive: true });
  agentsDir = join(tmpRoot, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  process.chdir(fakeUi);
  vi.resetModules();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

function writeAgentYml(id: string, body: Record<string, unknown>): void {
  const dir = join(agentsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.yml'), stringifyYaml(body), 'utf-8');
}

// ─── Fake gateway helpers ─────────────────────────────────────────────

interface FakePluginEntry {
  manifest: { name: string; version: string; description?: string; configSchema?: string };
  instance: Record<string, unknown>;
  tools: Array<{ name: string }>;
  hasEngine: boolean;
}

function makeFakeGateway(plugins: FakePluginEntry[]) {
  const enabled = new Map<string, Set<string>>();
  return {
    enableForAgentSpy: vi.fn(),
    disableForAgentSpy: vi.fn(),
    pluginRegistry: {
      listPlugins: vi.fn(() =>
        plugins.map((p) => ({ manifest: p.manifest, instance: p.instance })),
      ),
      getMcpToolsForPlugin: vi.fn((name: string) => {
        const p = plugins.find((x) => x.manifest.name === name);
        return p ? p.tools : [];
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

// ─── Tests ────────────────────────────────────────────────────────────

describe('GET /api/plugins', () => {
  it('returns the installed plugin list with manifest + computed flags', async () => {
    const fakeGw = makeFakeGateway([
      {
        manifest: { name: 'lcm', version: '0.1.0', description: 'Lossless Context Memory', configSchema: 'config.js' },
        instance: {},
        tools: [{ name: 'lcm_search' }, { name: 'lcm_compress' }],
        hasEngine: true,
      },
      {
        manifest: { name: 'example', version: '0.0.1' },
        instance: {},
        tools: [],
        hasEngine: false,
      },
    ]);

    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { GET } = await import('@/app/api/plugins/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.plugins).toHaveLength(2);
    expect(json.plugins[0]).toEqual({
      name: 'lcm',
      version: '0.1.0',
      description: 'Lossless Context Memory',
      hasConfigSchema: true,
      hasMcpTools: true,
      hasContextEngine: true,
      toolCount: 2,
    });
    expect(json.plugins[1]).toEqual({
      name: 'example',
      version: '0.0.1',
      description: undefined,
      hasConfigSchema: false,
      hasMcpTools: false,
      hasContextEngine: false,
      toolCount: 0,
    });
  });
});

describe('GET /api/agents/[agentId]/plugins', () => {
  it('returns enabled state + config for each plugin', async () => {
    writeAgentYml('alpha', {
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
      plugins: {
        lcm: { enabled: true, threshold: 0.7 },
      },
    });

    const fakeGw = makeFakeGateway([
      {
        manifest: { name: 'lcm', version: '0.1.0' },
        instance: {},
        tools: [],
        hasEngine: true,
      },
      {
        manifest: { name: 'example', version: '0.0.1' },
        instance: {},
        tools: [],
        hasEngine: false,
      },
    ]);
    fakeGw.pluginRegistry.enableForAgent('alpha', 'lcm');

    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { GET } = await import('@/app/api/agents/[agentId]/plugins/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/agents/alpha/plugins'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.agentId).toBe('alpha');
    expect(json.plugins).toEqual([
      { name: 'lcm', enabled: true, config: { enabled: true, threshold: 0.7 } },
      { name: 'example', enabled: false, config: {} },
    ]);
  });

  it('returns 404 for unknown agent', async () => {
    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0' }, instance: {}, tools: [], hasEngine: false },
    ]);
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { GET } = await import('@/app/api/agents/[agentId]/plugins/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/agents/missing/plugins'),
      { params: Promise.resolve({ agentId: 'missing' }) },
    );
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/agents/[agentId]/plugins/[name]', () => {
  it('enables a plugin: persists to agent.yml + calls enableForAgent', async () => {
    writeAgentYml('alpha', {
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
    });

    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0' }, instance: {}, tools: [], hasEngine: true },
    ]);

    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { PUT } = await import('@/app/api/agents/[agentId]/plugins/[name]/route');
    const res = await PUT(
      jsonRequest('http://localhost:3000/api/agents/alpha/plugins/lcm', { enabled: true }),
      { params: Promise.resolve({ agentId: 'alpha', name: 'lcm' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, enabled: true });

    // Verify YAML was updated
    const yml = parseYaml(readFileSync(join(agentsDir, 'alpha', 'agent.yml'), 'utf-8'));
    expect(yml.plugins.lcm.enabled).toBe(true);

    // Verify gateway hot-toggled
    expect(fakeGw.pluginRegistry.enableForAgent).toHaveBeenCalledWith('alpha', 'lcm');
    expect(fakeGw.pluginRegistry.disableForAgent).not.toHaveBeenCalled();
  });

  it('disables a plugin: persists to agent.yml + calls disableForAgent', async () => {
    writeAgentYml('alpha', {
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
      plugins: { lcm: { enabled: true, threshold: 0.5 } },
    });

    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0' }, instance: {}, tools: [], hasEngine: true },
    ]);

    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(fakeGw),
    }));

    const { PUT } = await import('@/app/api/agents/[agentId]/plugins/[name]/route');
    const res = await PUT(
      jsonRequest('http://localhost:3000/api/agents/alpha/plugins/lcm', { enabled: false }),
      { params: Promise.resolve({ agentId: 'alpha', name: 'lcm' }) },
    );
    expect(res.status).toBe(200);

    const yml = parseYaml(readFileSync(join(agentsDir, 'alpha', 'agent.yml'), 'utf-8'));
    expect(yml.plugins.lcm.enabled).toBe(false);
    // Other config keys preserved
    expect(yml.plugins.lcm.threshold).toBe(0.5);

    expect(fakeGw.pluginRegistry.disableForAgent).toHaveBeenCalledWith('alpha', 'lcm');
  });

  it('returns 400 on missing/invalid body', async () => {
    writeAgentYml('alpha', { model: 'claude-sonnet-4-6', routes: [{ channel: 'telegram' }] });

    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0' }, instance: {}, tools: [], hasEngine: false },
    ]);
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(fakeGw) }));

    const { PUT } = await import('@/app/api/agents/[agentId]/plugins/[name]/route');
    const res = await PUT(
      jsonRequest('http://localhost:3000/api/agents/alpha/plugins/lcm', { enabled: 'yes' }),
      { params: Promise.resolve({ agentId: 'alpha', name: 'lcm' }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown plugin', async () => {
    writeAgentYml('alpha', { model: 'claude-sonnet-4-6', routes: [{ channel: 'telegram' }] });

    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0' }, instance: {}, tools: [], hasEngine: false },
    ]);
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(fakeGw) }));

    const { PUT } = await import('@/app/api/agents/[agentId]/plugins/[name]/route');
    const res = await PUT(
      jsonRequest('http://localhost:3000/api/agents/alpha/plugins/ghost', { enabled: true }),
      { params: Promise.resolve({ agentId: 'alpha', name: 'ghost' }) },
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('unknown_plugin');
  });

  it('returns 404 for unknown agent', async () => {
    const fakeGw = makeFakeGateway([
      { manifest: { name: 'lcm', version: '0.1.0' }, instance: {}, tools: [], hasEngine: false },
    ]);
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(fakeGw) }));

    const { PUT } = await import('@/app/api/agents/[agentId]/plugins/[name]/route');
    const res = await PUT(
      jsonRequest('http://localhost:3000/api/agents/missing/plugins/lcm', { enabled: true }),
      { params: Promise.resolve({ agentId: 'missing', name: 'lcm' }) },
    );
    expect(res.status).toBe(404);
  });
});
