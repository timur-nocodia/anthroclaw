# Fleet API Contracts

All fleet routes require authentication. The fleet orchestrator is the "local" instance's Next.js server that proxies to remote AnthroClaw gateways.

---

## Fleet Servers

### GET /api/fleet/servers
```
Response: 200 FleetServer[]
```

```typescript
interface FleetServer {
  id: string;
  name: string;
  city?: string;
  environment: 'production' | 'staging' | 'development';
  region: string;
  tags: string[];
  url: string;
  primary?: boolean;
  deployedAt?: string;
  deployedBy?: string;
  release?: { version: string; repo: string; upgradePolicy: string };
  policies?: { backup: object; monitoring: boolean; logRetention: string; maxMediaGB: number };
}
```

### POST /api/fleet/servers
Register an existing server (manual add without deploy wizard).
```
Request:  { id, url, apiKey, environment, region, city?, tags? }
Response: 201 { id }
          400 { error: "already_exists" | "invalid_url" }
```

### PUT /api/fleet/servers/[serverId]
Update server metadata (tags, environment, etc.)
```
Request:  { city?, environment?, region?, tags?, primary? }
Response: 200 { ok: true }
```

### DELETE /api/fleet/servers/[serverId]
Remove server from fleet (does not stop or destroy the server).
```
Response: 200 { ok: true }
```

---

## Fleet Status (aggregated)

### GET /api/fleet/status
Polls all registered servers and returns aggregated status.
```
Response: 200 {
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
```

```typescript
interface FleetServerStatus {
  id: string;
  status: 'healthy' | 'degraded' | 'offline';
  lastHeartbeat: string | null;
  uptime: number | null;
  agents: number;
  liveSessions: number;
  p50Ms: number | null;
  cpu: number | null;       // 0-100
  mem: number | null;       // 0-100
  disk: number | null;      // 0-100
  channels: {
    telegram: number;
    whatsapp: number;
  };
  version: string | null;
  dirty: boolean;
  sslExpiryDays: number | null;
  alerts: string[];          // active alert messages for this server
}
```

---

## Fleet Alerts

### GET /api/fleet/alerts
```
Query:    ?status=open|acknowledged|all
Response: 200 FleetAlert[]
```

```typescript
interface FleetAlert {
  id: string;
  serverId: string;
  serverName: string;
  type: 'server_offline' | 'high_cpu' | 'high_memory' | 'high_disk' | 'elevated_p50' | 'ssl_expiring' | 'channel_disconnected' | 'version_mismatch';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  triggeredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}
```

### PUT /api/fleet/alerts/[alertId]/ack
```
Response: 200 { ok: true }
```

### GET /api/fleet/alert-rules
```
Response: 200 AlertRules
```

```typescript
interface AlertRules {
  cpuThreshold: number;        // default 80
  cpuDurationMin: number;      // default 5
  memThreshold: number;        // default 80
  diskThreshold: number;       // default 90
  p50ThresholdMs: number;      // default 1000
  offlineTimeoutSec: number;   // default 60
  sslExpiryDays: number;       // default 14
  channelDisconnectMin: number; // default 5
  enabledTypes: string[];      // which alert types are active
}
```

### PUT /api/fleet/alert-rules
```
Request:  Partial<AlertRules>
Response: 200 { ok: true }
```

---

## Fleet Commands

### POST /api/fleet/commands/execute
```
Request: {
  command: 'rolling_restart' | 'hot_reload' | 'pull_redeploy' | 'sync_agents' | 'backup' | 'rotate_keys' | 'stop_fleet';
  targetServerIds: string[];
  options?: Record<string, unknown>;  // command-specific
}
Response: SSE stream of CommandEvent
```

```typescript
type CommandEvent =
  | { type: 'progress'; serverId: string; step: string; status: 'running' | 'done' | 'error'; message?: string; elapsed?: number }
  | { type: 'summary'; total: number; success: number; failed: number }
  | { type: 'error'; message: string };
```

**Command-specific options:**

```typescript
// pull_redeploy
{ branch?: string; tag?: string }

// sync_agents
{ sourceServerId: string; agentIds: string[] }

// rotate_keys
{ rotateAnthropic?: boolean; rotateTelegram?: boolean; rotateJwt?: boolean; newValues?: Record<string, string> }

// backup
{ destination?: string }  // 'local' or 's3://...'
```

---

## Deploy

### POST /api/fleet/deploy
Start a new gateway deployment.
```
Request: DeployConfig (full config from wizard)
Response: SSE stream of DeployEvent
```

```typescript
interface DeployConfig {
  identity: {
    name: string;
    environment: 'production' | 'staging' | 'development';
    region: string;
    city?: string;
    tags?: string[];
  };
  target: {
    type: 'ssh';
    host: string;
    port: number;
    user: string;
    authMethod: 'key' | 'password';
    sshKey?: string;
    password?: string;
  };
  networking: {
    domain?: string;
    httpPort: number;
    webhookMode: 'longpoll' | 'webhook';
  };
  release: {
    version: string;
    repo: string;
    upgradePolicy: 'manual' | 'auto-minor' | 'auto-patch' | 'auto-latest';
  };
  agents: {
    source: 'blank' | 'template' | 'git';
    sourceServerId?: string;
    agentIds?: string[];
    gitUrl?: string;
    gitRef?: string;
    channelTokens?: Record<string, string>;
  };
  policies: {
    backup: { schedule: string; destination: string } | null;
    monitoring: boolean;
    logRetention: string;
    maxMediaGB: number;
  };
}

type DeployEvent =
  | { type: 'step'; index: number; total: number; label: string; status: 'running' | 'done' | 'error'; elapsed?: number; message?: string }
  | { type: 'done'; url: string; credentials: { email: string; note: string } }
  | { type: 'error'; step: number; message: string };
```

### POST /api/fleet/deploy/dry-run
Run pre-flight checks without deploying.
```
Request:  DeployConfig
Response: 200 DryRunResult
```

```typescript
interface DryRunResult {
  checks: { name: string; status: 'pass' | 'fail' | 'warn'; message: string }[];
  canDeploy: boolean;
}
```

---

## Fleet Proxy

All existing API routes are proxied through the fleet for remote servers:

### ANY /api/fleet/[serverId]/[...path]

Proxies the request to `{server.url}/api/{path}` with the server's API key in the Authorization header.

```
GET /api/fleet/gw-prod-eu/agents → GET https://gw-prod-eu.anthroclaw.acme.internal/api/agents
POST /api/fleet/gw-prod-eu/agents/example/chat → POST https://gw-prod-eu.anthroclaw.acme.internal/api/agents/example/chat
```

For the local instance (server with `url` matching current host), proxy is skipped — requests go directly to the local Gateway singleton.

SSE streams from remote servers are proxied through: the fleet proxy opens the SSE connection to the remote server and re-emits events to the client.

---

## Metrics Endpoint (per gateway)

### GET /api/metrics

New endpoint that each AnthroClaw instance exposes. The fleet orchestrator calls this for each server.

```
Response: 200 {
  counters: {
    messages_received: number;
    messages_sent: number;
    queries_total: number;
    query_errors: number;
    tool_calls: number;
    sessions_created: number;
    sessions_reset: number;
    rate_limit_hits: number;
    access_denied: number;
    cron_fires: number;
  };
  gauges: {
    active_sessions: number;
    agents_loaded: number;
    queued_messages: number;
    memory_store_bytes: number;
    media_store_bytes: number;
  };
  histograms: {
    query_duration_ms: { p50: number; p95: number; p99: number; avg: number; count: number };
  };
  tokens_24h: {
    input: number;
    output: number;
    byModel: Record<string, { input: number; output: number }>;
  };
  messages_24h: number;
  system: {
    cpu_percent: number;
    mem_percent: number;
    mem_rss_bytes: number;
    disk_percent: number;
    disk_used_bytes: number;
    disk_total_bytes: number;
    node_version: string;
    platform: string;
    git_version: string;
    git_dirty: boolean;
    ssl_expiry_days: number | null;
  };
}
```

This requires instrumenting the Gateway with counters and timers. Implementation: a `MetricsCollector` singleton in `src/metrics/collector.ts` that accumulates counters, records histograms, and exposes the snapshot.
