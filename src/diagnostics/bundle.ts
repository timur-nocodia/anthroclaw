import * as os from 'node:os';
import { getRecentLogs } from '../logger.js';
import { metrics } from '../metrics/collector.js';
import { redactSecrets } from '../security/redact.js';

export interface DiagnosticsBundleOptions {
  status: Record<string, unknown>;
  includeLogs?: boolean;
  runId?: string;
  logLimit?: number;
  runLimit?: number;
  routeDecisionLimit?: number;
  diagnosticEventLimit?: number;
}

export interface DiagnosticsBundle {
  manifest: {
    generatedAt: string;
    version: 1;
    contentPolicy: 'metadata-only';
    filters?: {
      runId?: string;
    };
  };
  status: unknown;
  metrics: unknown;
  runs: unknown[];
  routeDecisions: unknown[];
  diagnosticEvents: unknown[];
  interrupts: unknown[];
  integrationAuditEvents: unknown[];
  memoryInfluenceEvents: unknown[];
  logs: unknown[];
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cpus: number;
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    uptimeSeconds: number;
    pid: number;
  };
}

const REDACTED_KEYS = new Set([
  'api_key',
  'apikey',
  'authorization',
  'auth',
  'cookie',
  'password',
  'secret',
  'token',
]);

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [...REDACTED_KEYS].some((secretKey) => normalized.includes(secretKey));
}

function safeNumber(read: () => number): number {
  try {
    return read();
  } catch {
    return 0;
  }
}

export function sanitizeForDiagnostics(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[MaxDepth]';

  if (typeof value === 'string') {
    return redactSecrets(value);
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForDiagnostics(entry, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = shouldRedactKey(key)
      ? '[REDACTED]'
      : sanitizeForDiagnostics(nested, depth + 1);
  }
  return out;
}

export function buildDiagnosticsBundle(options: DiagnosticsBundleOptions): DiagnosticsBundle {
  const runLimit = Math.max(1, Math.min(options.runLimit ?? 100, 500));
  const routeDecisionLimit = Math.max(1, Math.min(options.routeDecisionLimit ?? 100, 500));
  const diagnosticEventLimit = Math.max(1, Math.min(options.diagnosticEventLimit ?? 500, 2_000));
  const logLimit = Math.max(0, Math.min(options.logLimit ?? 200, 500));
  const run = options.runId ? metrics.getAgentRun(options.runId) : undefined;
  const routeDecisionFilter = options.runId
    ? { sessionKey: run?.sessionKey ?? '__missing_run__', limit: routeDecisionLimit }
    : { limit: routeDecisionLimit };

  return sanitizeForDiagnostics({
    manifest: {
      generatedAt: new Date().toISOString(),
      version: 1,
      contentPolicy: 'metadata-only',
      filters: options.runId ? { runId: options.runId } : undefined,
    },
    status: options.status,
    metrics: metrics.snapshot(),
    runs: options.runId ? (run ? [run] : []) : metrics.listAgentRuns({ limit: runLimit }),
    routeDecisions: metrics.listRouteDecisions(routeDecisionFilter),
    diagnosticEvents: metrics.listDiagnosticEvents({
      runId: options.runId,
      limit: diagnosticEventLimit,
    }),
    interrupts: metrics.listInterrupts({
      runId: options.runId,
      limit: diagnosticEventLimit,
    }),
    integrationAuditEvents: metrics.listIntegrationAuditEvents({
      runId: options.runId,
      limit: diagnosticEventLimit,
    }),
    memoryInfluenceEvents: metrics.listMemoryInfluenceEvents({
      runId: options.runId,
      limit: diagnosticEventLimit,
    }),
    logs: options.includeLogs === false ? [] : getRecentLogs(logLimit),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: safeNumber(() => os.cpus().length),
      totalMemoryBytes: safeNumber(() => os.totalmem()),
      freeMemoryBytes: safeNumber(() => os.freemem()),
      uptimeSeconds: Math.round(safeNumber(() => os.uptime())),
      pid: process.pid,
    },
  }) as DiagnosticsBundle;
}
