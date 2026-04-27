import { resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FleetServer {
  id: string;
  name: string;
  city?: string;
  environment: 'production' | 'staging' | 'development';
  region: string;
  tags: string[];
  url: string;
  apiKey: string;
  primary?: boolean;
  ssh?: {
    host: string;
    port: number;
    user: string;
    keyEncrypted?: string;
  };
  release?: {
    version: string;
    repo: string;
    upgradePolicy: string;
  };
  policies?: {
    backup: { schedule: string; destination: string } | null;
    monitoring: boolean;
    logRetention: string;
    maxMediaGB: number;
  };
  deployedAt?: string;
  deployedBy?: string;
}

export interface FleetServerStatus {
  id: string;
  name: string;
  city?: string;
  environment: string;
  region: string;
  tags: string[];
  primary?: boolean;
  status: 'healthy' | 'degraded' | 'offline';
  lastHeartbeat: string | null;
  uptime: number | null;
  agents: number;
  liveSessions: number;
  p50Ms: number | null;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  channels: { telegram: number; whatsapp: number };
  version: string | null;
  dirty: boolean;
  sslExpiryDays: number | null;
  alerts: string[];
  url: string;
}

export interface FleetStatus {
  summary: {
    gateways: number;
    healthy: number;
    degraded: number;
    offline: number;
    totalAgents: number;
    totalSessions: number;
    messages24h: number;
    tokens24h: number;
    estimatedCost24h: number;
  };
  servers: FleetServerStatus[];
}

/* ------------------------------------------------------------------ */
/*  Token pricing (USD per million tokens)                             */
/* ------------------------------------------------------------------ */

const TOKEN_PRICING: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5 },
  'claude-haiku-4-5': { input: 0.8, output: 4, cacheRead: 0.08 },
};

const DEFAULT_PRICING = { input: 3, output: 15, cacheRead: 0.3 }; // fallback to Sonnet pricing
const REMOTE_STATUS_TIMEOUT_MS = Number.parseInt(
  process.env.FLEET_REMOTE_STATUS_TIMEOUT_MS ?? '1500',
  10,
);

/* ------------------------------------------------------------------ */
/*  Fleet file path                                                    */
/* ------------------------------------------------------------------ */

function getFleetFilePath(): string {
  return process.env.FLEET_FILE_PATH ?? resolve(process.cwd(), '..', 'data', 'fleet.json');
}

/* ------------------------------------------------------------------ */
/*  CRUD operations                                                    */
/* ------------------------------------------------------------------ */

export function loadFleet(): FleetServer[] {
  const filePath = getFleetFilePath();
  if (!existsSync(filePath)) {
    return [];
  }
  const raw = readFileSync(filePath, 'utf-8').trim();
  if (raw === '') return [];
  return JSON.parse(raw) as FleetServer[];
}

export function saveFleet(servers: FleetServer[]): void {
  const filePath = getFleetFilePath();
  const dir = resolve(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(servers, null, 2), 'utf-8');
}

export function addServer(server: FleetServer): void {
  const servers = loadFleet();
  if (servers.some((s) => s.id === server.id)) {
    throw new Error(`Server with id '${server.id}' already exists`);
  }
  servers.push(server);
  saveFleet(servers);
}

export function removeServer(id: string): void {
  const servers = loadFleet();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) {
    throw new Error(`Server '${id}' not found`);
  }
  servers.splice(idx, 1);
  saveFleet(servers);
}

export function updateServer(id: string, patch: Partial<FleetServer>): void {
  const servers = loadFleet();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) {
    throw new Error(`Server '${id}' not found`);
  }
  servers[idx] = { ...servers[idx], ...patch, id }; // prevent id override
  saveFleet(servers);
}

export function getServer(id: string): FleetServer | undefined {
  return loadFleet().find((s) => s.id === id);
}

export function ensureLocalServer(): FleetServer {
  const existing = getServer('local');
  if (existing) return existing;

  const local: FleetServer = {
    id: 'local',
    name: 'Local Gateway',
    environment: 'development',
    region: 'local',
    tags: ['local'],
    url: 'http://localhost:3000',
    apiKey: 'self',
    primary: true,
  };
  addServer(local);
  return local;
}

/* ------------------------------------------------------------------ */
/*  Status fetching                                                    */
/* ------------------------------------------------------------------ */

interface GatewayStatusResponse {
  uptime?: number;
  agents?: string[];
  activeSessions?: number;
  channels?: {
    telegram?: unknown[];
    whatsapp?: unknown[];
  };
}

interface MetricsResponse {
  gauges?: {
    active_sessions?: number;
    agents_loaded?: number;
  };
  histograms?: {
    query_duration_ms?: { p50?: number };
  };
  tokens_24h?: {
    input?: number;
    output?: number;
    cache_read?: number;
    byModel?: Record<string, { input: number; output: number; cache_read?: number }>;
  };
  messages_24h?: number;
  system?: {
    cpu_percent?: number;
    mem_percent?: number;
    disk_percent?: number;
    git_version?: string;
    git_dirty?: boolean;
    ssl_expiry_days?: number | null;
  };
}

function determineStatus(
  metricsData: MetricsResponse | null,
): 'healthy' | 'degraded' | 'offline' {
  if (!metricsData) return 'offline';

  const cpu = metricsData.system?.cpu_percent ?? 0;
  const mem = metricsData.system?.mem_percent ?? 0;
  const disk = metricsData.system?.disk_percent ?? 0;
  const p50 = metricsData.histograms?.query_duration_ms?.p50 ?? 0;

  if (cpu > 80 || mem > 80 || disk > 90 || p50 > 1000) {
    return 'degraded';
  }

  return 'healthy';
}

function estimateCost(tokens24h: MetricsResponse['tokens_24h']): number {
  if (!tokens24h) return 0;

  const byModel = tokens24h.byModel;
  if (byModel && Object.keys(byModel).length > 0) {
    let cost = 0;
    for (const [model, usage] of Object.entries(byModel)) {
      const pricing = TOKEN_PRICING[model] ?? DEFAULT_PRICING;
      cost += (usage.input / 1_000_000) * pricing.input;
      cost += (usage.output / 1_000_000) * pricing.output;
      cost += ((usage.cache_read ?? 0) / 1_000_000) * pricing.cacheRead;
    }
    return Math.round(cost * 100) / 100;
  }

  // Fallback: use aggregate tokens with default pricing
  const input = tokens24h.input ?? 0;
  const output = tokens24h.output ?? 0;
  const cost =
    (input / 1_000_000) * DEFAULT_PRICING.input +
    (output / 1_000_000) * DEFAULT_PRICING.output +
    ((tokens24h.cache_read ?? 0) / 1_000_000) * DEFAULT_PRICING.cacheRead;
  return Math.round(cost * 100) / 100;
}

async function fetchLocalStatus(): Promise<{
  gateway: GatewayStatusResponse;
  metrics: MetricsResponse;
}> {
  const { getGateway } = await import('@/lib/gateway');
  const { metrics } = await import('@backend/metrics/collector.js');

  const gw = await getGateway();
  return {
    gateway: gw.getStatus(),
    metrics: metrics.snapshot(),
  };
}

async function fetchRemoteStatus(
  server: FleetServer,
): Promise<{ gateway: GatewayStatusResponse; metrics: MetricsResponse }> {
  const headers = { Authorization: `Bearer ${server.apiKey}` };
  const signal = AbortSignal.timeout(Number.isFinite(REMOTE_STATUS_TIMEOUT_MS) ? REMOTE_STATUS_TIMEOUT_MS : 1500);

  const [gwRes, metricsRes] = await Promise.all([
    fetch(`${server.url}/api/gateway/status`, { headers, signal }),
    fetch(`${server.url}/api/metrics`, { headers, signal }),
  ]);

  if (!gwRes.ok || !metricsRes.ok) {
    throw new Error(`Remote server responded with error`);
  }

  return {
    gateway: (await gwRes.json()) as GatewayStatusResponse,
    metrics: (await metricsRes.json()) as MetricsResponse,
  };
}

function buildServerStatus(
  server: FleetServer,
  gwData: GatewayStatusResponse | null,
  metricsData: MetricsResponse | null,
): FleetServerStatus {
  const status = determineStatus(metricsData);

  const alerts: string[] = [];
  if (metricsData) {
    const cpu = metricsData.system?.cpu_percent ?? 0;
    const mem = metricsData.system?.mem_percent ?? 0;
    const disk = metricsData.system?.disk_percent ?? 0;
    const p50 = metricsData.histograms?.query_duration_ms?.p50 ?? 0;
    const ssl = metricsData.system?.ssl_expiry_days;

    if (cpu > 80) alerts.push(`High CPU: ${cpu.toFixed(1)}%`);
    if (mem > 80) alerts.push(`High memory: ${mem.toFixed(1)}%`);
    if (disk > 90) alerts.push(`Disk nearly full: ${disk.toFixed(1)}%`);
    if (p50 > 1000) alerts.push(`High latency: p50 ${p50}ms`);
    if (ssl !== null && ssl !== undefined && ssl < 14) {
      alerts.push(`SSL expires in ${ssl} days`);
    }
  }

  return {
    id: server.id,
    name: server.name,
    city: server.city,
    environment: server.environment,
    region: server.region,
    tags: server.tags,
    primary: server.primary,
    status,
    lastHeartbeat: status !== 'offline' ? new Date().toISOString() : null,
    uptime: gwData?.uptime ?? null,
    agents: gwData?.agents?.length ?? 0,
    liveSessions: gwData?.activeSessions ?? metricsData?.gauges?.active_sessions ?? 0,
    p50Ms: metricsData?.histograms?.query_duration_ms?.p50 ?? null,
    cpu: metricsData?.system?.cpu_percent ?? null,
    mem: metricsData?.system?.mem_percent ?? null,
    disk: metricsData?.system?.disk_percent ?? null,
    channels: {
      telegram: gwData?.channels?.telegram?.length ?? 0,
      whatsapp: gwData?.channels?.whatsapp?.length ?? 0,
    },
    version: metricsData?.system?.git_version ?? null,
    dirty: metricsData?.system?.git_dirty ?? false,
    sslExpiryDays: metricsData?.system?.ssl_expiry_days ?? null,
    alerts,
    url: server.url,
  };
}

export async function fetchFleetStatus(): Promise<FleetStatus> {
  let servers = loadFleet();
  if (servers.length === 0) {
    ensureLocalServer();
    servers = loadFleet();
  }

  // Fetch all data in a single pass — keep both server status and raw metrics
  const fetchResults = await Promise.all(
    servers.map(async (server) => {
      try {
        const isLocal = server.apiKey === 'self';
        const { gateway, metrics: metricsData } = isLocal
          ? await fetchLocalStatus()
          : await fetchRemoteStatus(server);

        return {
          serverStatus: buildServerStatus(server, gateway, metricsData),
          metricsData,
        };
      } catch {
        return {
          serverStatus: buildServerStatus(server, null, null),
          metricsData: null as MetricsResponse | null,
        };
      }
    }),
  );

  // Aggregate summary from the single-pass results
  let totalAgents = 0;
  let totalSessions = 0;
  let messages24h = 0;
  let tokens24h = 0;
  let estimatedCost24h = 0;
  let healthy = 0;
  let degraded = 0;
  let offline = 0;

  for (const { serverStatus, metricsData } of fetchResults) {
    totalAgents += serverStatus.agents;
    totalSessions += serverStatus.liveSessions;

    if (serverStatus.status === 'healthy') healthy++;
    else if (serverStatus.status === 'degraded') degraded++;
    else offline++;

    if (metricsData) {
      messages24h += metricsData.messages_24h ?? 0;
      const t = metricsData.tokens_24h;
      if (t) {
        tokens24h += (t.input ?? 0) + (t.output ?? 0);
        estimatedCost24h += estimateCost(t);
      }
    }
  }

  return {
    summary: {
      gateways: servers.length,
      healthy,
      degraded,
      offline,
      totalAgents,
      totalSessions,
      messages24h,
      tokens24h,
      estimatedCost24h: Math.round(estimatedCost24h * 100) / 100,
    },
    servers: fetchResults.map((r) => r.serverStatus),
  };
}
