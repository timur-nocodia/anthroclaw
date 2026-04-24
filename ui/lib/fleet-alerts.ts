import { resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FleetServerStatus } from '@/lib/fleet';

/* ------------------------------------------------------------------ */
/*  File path                                                          */
/* ------------------------------------------------------------------ */

function getAlertsFilePath(): string {
  return process.env.ALERTS_FILE_PATH ?? resolve(process.cwd(), '..', 'data', 'fleet-alerts.json');
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FleetAlert {
  id: string;
  serverId: string;
  serverName: string;
  type:
    | 'server_offline'
    | 'high_cpu'
    | 'high_memory'
    | 'high_disk'
    | 'elevated_p50'
    | 'ssl_expiring'
    | 'channel_disconnected'
    | 'version_mismatch';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  triggeredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface AlertRules {
  cpuThreshold: number;
  cpuDurationMin: number;
  memThreshold: number;
  diskThreshold: number;
  p50ThresholdMs: number;
  offlineTimeoutSec: number;
  sslExpiryDays: number;
  channelDisconnectMin: number;
  enabledTypes: string[];
}

const DEFAULT_RULES: AlertRules = {
  cpuThreshold: 80,
  cpuDurationMin: 5,
  memThreshold: 80,
  diskThreshold: 90,
  p50ThresholdMs: 1000,
  offlineTimeoutSec: 60,
  sslExpiryDays: 14,
  channelDisconnectMin: 5,
  enabledTypes: [
    'server_offline',
    'high_cpu',
    'high_memory',
    'high_disk',
    'elevated_p50',
    'ssl_expiring',
    'channel_disconnected',
  ],
};

interface AlertsStore {
  alerts: FleetAlert[];
  rules: AlertRules;
}

/* ------------------------------------------------------------------ */
/*  Persistence helpers                                                */
/* ------------------------------------------------------------------ */

function loadStore(): AlertsStore {
  const filePath = getAlertsFilePath();
  if (!existsSync(filePath)) {
    return { alerts: [], rules: { ...DEFAULT_RULES } };
  }
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<AlertsStore>;
  return {
    alerts: parsed.alerts ?? [],
    rules: { ...DEFAULT_RULES, ...parsed.rules },
  };
}

function saveStore(store: AlertsStore): void {
  const filePath = getAlertsFilePath();
  const dir = resolve(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/** Check if an alert is "open" (not acknowledged, not resolved). */
function isOpen(alert: FleetAlert): boolean {
  return alert.acknowledgedAt === null && alert.resolvedAt === null;
}

/** Check if an alert is "acknowledged" (acknowledged but not resolved). */
function isAcknowledged(alert: FleetAlert): boolean {
  return alert.acknowledgedAt !== null && alert.resolvedAt === null;
}

/** Find an existing open or acknowledged alert for the same server+type. */
function findActive(alerts: FleetAlert[], serverId: string, type: FleetAlert['type']): FleetAlert | undefined {
  return alerts.find(
    (a) => a.serverId === serverId && a.type === type && a.resolvedAt === null,
  );
}

/* ------------------------------------------------------------------ */
/*  Core operations                                                    */
/* ------------------------------------------------------------------ */

export function getAlerts(filter?: { status?: 'open' | 'acknowledged' | 'all' }): FleetAlert[] {
  const store = loadStore();
  const now = Date.now();

  // Always exclude resolved alerts older than 24h
  const fresh = store.alerts.filter((a) => {
    if (a.resolvedAt !== null) {
      return now - new Date(a.resolvedAt).getTime() < TWENTY_FOUR_HOURS_MS;
    }
    return true;
  });

  const status = filter?.status ?? 'all';
  switch (status) {
    case 'open':
      return fresh.filter(isOpen);
    case 'acknowledged':
      return fresh.filter(isAcknowledged);
    case 'all':
    default:
      return fresh;
  }
}

export function acknowledgeAlert(alertId: string): boolean {
  const store = loadStore();
  const alert = store.alerts.find((a) => a.id === alertId);
  if (!alert) return false;

  alert.acknowledgedAt = new Date().toISOString();
  saveStore(store);
  return true;
}

export function getAlertRules(): AlertRules {
  const store = loadStore();
  return store.rules;
}

export function updateAlertRules(patch: Partial<AlertRules>): AlertRules {
  const store = loadStore();
  store.rules = { ...store.rules, ...patch };
  saveStore(store);
  return store.rules;
}

/* ------------------------------------------------------------------ */
/*  Evaluation — called after each fetchFleetStatus()                  */
/* ------------------------------------------------------------------ */

export function evaluateAlerts(serverStatuses: FleetServerStatus[]): void {
  const store = loadStore();
  const { alerts, rules } = store;
  const now = new Date().toISOString();

  // Track which (serverId, type) combinations are still active this cycle
  const activeConditions = new Set<string>();

  for (const server of serverStatuses) {
    const checks: Array<{
      type: FleetAlert['type'];
      condition: boolean;
      severity: FleetAlert['severity'];
      message: string;
    }> = [
      {
        type: 'server_offline',
        condition: server.status === 'offline',
        severity: 'critical',
        message: 'Server offline',
      },
      {
        type: 'high_cpu',
        condition: server.cpu !== null && server.cpu > rules.cpuThreshold,
        severity: 'warning',
        message: `CPU usage ${server.cpu}%`,
      },
      {
        type: 'high_memory',
        condition: server.mem !== null && server.mem > rules.memThreshold,
        severity: 'warning',
        message: `Memory usage ${server.mem}%`,
      },
      {
        type: 'high_disk',
        condition: server.disk !== null && server.disk > rules.diskThreshold,
        severity: 'warning',
        message: `Disk usage ${server.disk}%`,
      },
      {
        type: 'elevated_p50',
        condition: server.p50Ms !== null && server.p50Ms > rules.p50ThresholdMs,
        severity: 'warning',
        message: `P50 latency ${server.p50Ms}ms`,
      },
      {
        type: 'ssl_expiring',
        condition:
          server.sslExpiryDays !== null && server.sslExpiryDays < rules.sslExpiryDays,
        severity: 'warning',
        message: `SSL expires in ${server.sslExpiryDays} days`,
      },
      {
        type: 'channel_disconnected',
        condition: server.channels.telegram === 0 && server.channels.whatsapp === 0 && server.status !== 'offline',
        severity: 'warning',
        message: 'All channels disconnected',
      },
    ];

    for (const check of checks) {
      // Skip disabled types
      if (!rules.enabledTypes.includes(check.type)) continue;

      const key = `${server.id}:${check.type}`;

      if (check.condition) {
        activeConditions.add(key);

        // Don't create duplicate if one already exists for this server+type
        if (!findActive(alerts, server.id, check.type)) {
          alerts.push({
            id: randomUUID(),
            serverId: server.id,
            serverName: server.name,
            type: check.type,
            severity: check.severity,
            message: check.message,
            triggeredAt: now,
            acknowledgedAt: null,
            resolvedAt: null,
          });
        }
      }
    }
  }

  // Auto-resolve alerts whose condition has cleared
  for (const alert of alerts) {
    if (alert.resolvedAt !== null) continue; // already resolved
    const key = `${alert.serverId}:${alert.type}`;
    if (!activeConditions.has(key)) {
      alert.resolvedAt = now;
    }
  }

  // Clean up resolved alerts older than 24h
  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
  store.alerts = alerts.filter((a) => {
    if (a.resolvedAt !== null) {
      return new Date(a.resolvedAt).getTime() > cutoff;
    }
    return true;
  });

  saveStore(store);
}
