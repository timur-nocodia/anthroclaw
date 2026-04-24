import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// Temp directory for fleet.json
let tmpDir: string;
let fleetFilePath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'fleet-test-'));
  fleetFilePath = resolve(tmpDir, 'fleet.json');
  process.env.FLEET_FILE_PATH = fleetFilePath;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FLEET_FILE_PATH;
  vi.restoreAllMocks();
});

// Mock the gateway and metrics modules
vi.mock('@/lib/gateway', () => ({
  getGateway: vi.fn().mockResolvedValue({
    getStatus: vi.fn().mockReturnValue({
      uptime: 60_000,
      agents: ['agent-1', 'agent-2'],
      activeSessions: 5,
      nodeVersion: 'v22.0.0',
      platform: 'darwin',
      channels: {
        telegram: [{ accountId: 'tg1', botUsername: 'bot', status: 'connected' }],
        whatsapp: [{ accountId: 'wa1', phone: '+1234', status: 'connected' }],
      },
    }),
  }),
}));

vi.mock('@backend/metrics/collector.js', () => ({
  metrics: {
    snapshot: vi.fn().mockReturnValue({
      counters: {},
      gauges: {
        active_sessions: 5,
        agents_loaded: 2,
        queued_messages: 0,
        memory_store_bytes: 0,
        media_store_bytes: 0,
      },
      histograms: {
        query_duration_ms: { p50: 120, p95: 450, p99: 800, avg: 200, count: 100 },
      },
      tokens_24h: {
        input: 500_000,
        output: 200_000,
        byModel: {
          'claude-sonnet-4-6': { input: 500_000, output: 200_000 },
        },
      },
      messages_24h: 42,
      system: {
        cpu_percent: 35,
        mem_percent: 60,
        mem_rss_bytes: 200_000_000,
        disk_percent: 45,
        disk_used_bytes: 50_000_000_000,
        disk_total_bytes: 100_000_000_000,
        node_version: 'v22.0.0',
        platform: 'darwin',
        git_version: 'v1.2.3',
        git_dirty: false,
        ssl_expiry_days: null,
      },
    }),
  },
}));

import {
  loadFleet,
  saveFleet,
  addServer,
  removeServer,
  updateServer,
  getServer,
  ensureLocalServer,
  fetchFleetStatus,
} from '@/lib/fleet';
import type { FleetServer } from '@/lib/fleet';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeServer(overrides: Partial<FleetServer> = {}): FleetServer {
  return {
    id: 'test-1',
    name: 'Test Server',
    environment: 'development',
    region: 'us-east',
    tags: ['test'],
    url: 'http://localhost:4000',
    apiKey: 'key-123',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  CRUD tests                                                         */
/* ------------------------------------------------------------------ */

describe('loadFleet', () => {
  it('returns empty array when file does not exist', () => {
    expect(loadFleet()).toEqual([]);
  });

  it('returns servers after save', () => {
    const servers = [makeServer()];
    saveFleet(servers);
    expect(loadFleet()).toEqual(servers);
  });
});

describe('ensureLocalServer', () => {
  it('creates local entry when fleet is empty', () => {
    const local = ensureLocalServer();
    expect(local.id).toBe('local');
    expect(local.apiKey).toBe('self');
    expect(local.primary).toBe(true);

    const fleet = loadFleet();
    expect(fleet).toHaveLength(1);
    expect(fleet[0].id).toBe('local');
  });

  it('returns existing local entry if already present', () => {
    ensureLocalServer();
    const local2 = ensureLocalServer();
    expect(local2.id).toBe('local');

    const fleet = loadFleet();
    expect(fleet).toHaveLength(1);
  });
});

describe('addServer', () => {
  it('adds a server to fleet.json', () => {
    const server = makeServer();
    addServer(server);

    const fleet = loadFleet();
    expect(fleet).toHaveLength(1);
    expect(fleet[0].id).toBe('test-1');
  });

  it('rejects duplicate ID', () => {
    addServer(makeServer());
    expect(() => addServer(makeServer())).toThrow("already exists");
  });

  it('allows different IDs', () => {
    addServer(makeServer({ id: 'a' }));
    addServer(makeServer({ id: 'b' }));
    expect(loadFleet()).toHaveLength(2);
  });
});

describe('removeServer', () => {
  it('removes an existing server', () => {
    addServer(makeServer({ id: 'a' }));
    addServer(makeServer({ id: 'b' }));
    removeServer('a');

    const fleet = loadFleet();
    expect(fleet).toHaveLength(1);
    expect(fleet[0].id).toBe('b');
  });

  it('throws when server not found', () => {
    expect(() => removeServer('nonexistent')).toThrow("not found");
  });
});

describe('updateServer', () => {
  it('patches fields on an existing server', () => {
    addServer(makeServer({ id: 'upd' }));
    updateServer('upd', { city: 'NYC', tags: ['updated'] });

    const server = getServer('upd');
    expect(server?.city).toBe('NYC');
    expect(server?.tags).toEqual(['updated']);
    expect(server?.id).toBe('upd'); // id not changed
  });

  it('throws when server not found', () => {
    expect(() => updateServer('nope', { city: 'X' })).toThrow("not found");
  });

  it('does not allow id override', () => {
    addServer(makeServer({ id: 'keep-id' }));
    updateServer('keep-id', { id: 'hacked' } as Partial<FleetServer>);

    expect(getServer('keep-id')).toBeDefined();
    expect(getServer('hacked')).toBeUndefined();
  });
});

describe('getServer', () => {
  it('returns server when it exists', () => {
    addServer(makeServer({ id: 'found' }));
    expect(getServer('found')).toBeDefined();
    expect(getServer('found')?.id).toBe('found');
  });

  it('returns undefined when not found', () => {
    expect(getServer('ghost')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Status / aggregation tests                                         */
/* ------------------------------------------------------------------ */

describe('fetchFleetStatus', () => {
  it('returns valid FleetStatus with local-only server', async () => {
    ensureLocalServer();
    const status = await fetchFleetStatus();

    expect(status.summary.gateways).toBe(1);
    expect(status.summary.healthy).toBe(1);
    expect(status.summary.offline).toBe(0);
    expect(status.summary.degraded).toBe(0);
    expect(status.summary.totalAgents).toBe(2);
    expect(status.summary.totalSessions).toBe(5);
    expect(status.summary.messages24h).toBe(42);
    expect(status.summary.tokens24h).toBe(700_000);
    expect(status.servers).toHaveLength(1);
    expect(status.servers[0].status).toBe('healthy');
    expect(status.servers[0].channels.telegram).toBe(1);
    expect(status.servers[0].channels.whatsapp).toBe(1);
  });

  it('auto-creates local server when fleet is empty', async () => {
    const status = await fetchFleetStatus();
    expect(status.summary.gateways).toBe(1);
    expect(status.servers[0].id).toBe('local');
    expect(existsSync(fleetFilePath)).toBe(true);
  });

  it('returns offline status for unreachable remote server', async () => {
    // Mock fetch to reject (simulates unreachable server)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));

    addServer(makeServer({
      id: 'remote-bad',
      name: 'Bad Remote',
      url: 'http://remote.example.com',
      apiKey: 'remote-key',
    }));

    const status = await fetchFleetStatus();
    const remote = status.servers.find((s) => s.id === 'remote-bad');
    expect(remote).toBeDefined();
    expect(remote!.status).toBe('offline');
    expect(remote!.lastHeartbeat).toBeNull();
    expect(remote!.uptime).toBeNull();

    fetchSpy.mockRestore();
  });
});

describe('status determination', () => {
  it('healthy when all metrics normal', async () => {
    ensureLocalServer();
    const status = await fetchFleetStatus();
    expect(status.servers[0].status).toBe('healthy');
  });

  it('degraded when cpu > 80%', async () => {
    // Override the mock to return high CPU
    const { metrics } = await import('@backend/metrics/collector.js');
    vi.mocked(metrics.snapshot).mockReturnValueOnce({
      counters: {},
      gauges: { active_sessions: 1, agents_loaded: 1, queued_messages: 0, memory_store_bytes: 0, media_store_bytes: 0 },
      histograms: { query_duration_ms: { p50: 50, p95: 100, p99: 200, avg: 60, count: 10 } },
      tokens_24h: { input: 0, output: 0, byModel: {} },
      messages_24h: 0,
      system: {
        cpu_percent: 95,
        mem_percent: 40,
        mem_rss_bytes: 100_000_000,
        disk_percent: 30,
        disk_used_bytes: 30_000_000_000,
        disk_total_bytes: 100_000_000_000,
        node_version: 'v22.0.0',
        platform: 'darwin',
        git_version: 'v1.0.0',
        git_dirty: false,
        ssl_expiry_days: null,
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    ensureLocalServer();
    const status = await fetchFleetStatus();
    expect(status.servers[0].status).toBe('degraded');
    expect(status.servers[0].alerts.some((a) => a.includes('High CPU'))).toBe(true);
  });

  it('offline when fetch fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    addServer(makeServer({
      id: 'dead-server',
      url: 'http://dead.example.com',
      apiKey: 'some-key',
    }));

    const status = await fetchFleetStatus();
    const dead = status.servers.find((s) => s.id === 'dead-server');
    expect(dead).toBeDefined();
    expect(dead!.status).toBe('offline');

    fetchSpy.mockRestore();
  });
});

describe('cost estimation', () => {
  it('calculates cost correctly for Sonnet tokens', async () => {
    ensureLocalServer();
    const status = await fetchFleetStatus();

    // 500k input at $3/M = $1.50, 200k output at $15/M = $3.00 → $4.50
    expect(status.summary.estimatedCost24h).toBe(4.5);
  });

  it('uses default pricing when model unknown', async () => {
    const { metrics } = await import('@backend/metrics/collector.js');
    vi.mocked(metrics.snapshot).mockReturnValue({
      counters: {},
      gauges: { active_sessions: 0, agents_loaded: 0, queued_messages: 0, memory_store_bytes: 0, media_store_bytes: 0 },
      histograms: { query_duration_ms: { p50: 0, p95: 0, p99: 0, avg: 0, count: 0 } },
      tokens_24h: {
        input: 1_000_000,
        output: 1_000_000,
        byModel: {
          'claude-unknown-model': { input: 1_000_000, output: 1_000_000 },
        },
      },
      messages_24h: 10,
      system: {
        cpu_percent: 10,
        mem_percent: 20,
        mem_rss_bytes: 50_000_000,
        disk_percent: 10,
        disk_used_bytes: 10_000_000_000,
        disk_total_bytes: 100_000_000_000,
        node_version: 'v22.0.0',
        platform: 'darwin',
        git_version: 'v1.0.0',
        git_dirty: false,
        ssl_expiry_days: null,
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    ensureLocalServer();
    const status = await fetchFleetStatus();

    // 1M input at $3/M = $3, 1M output at $15/M = $15 → $18
    expect(status.summary.estimatedCost24h).toBe(18);
  });
});

describe('summary aggregation', () => {
  it('sums correctly across multiple servers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    // Local server + a remote that will be offline
    ensureLocalServer();
    addServer(makeServer({
      id: 'remote-1',
      url: 'http://remote.example.com',
      apiKey: 'key-1',
    }));

    const status = await fetchFleetStatus();

    expect(status.summary.gateways).toBe(2);
    expect(status.summary.healthy).toBe(1);
    expect(status.summary.offline).toBe(1);
    // Agents from local only (remote is offline → 0)
    expect(status.summary.totalAgents).toBe(2);
    expect(status.summary.totalSessions).toBe(5);

    fetchSpy.mockRestore();
  });
});
