import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { FleetServerStatus } from '@/lib/fleet';

/* ------------------------------------------------------------------ */
/*  Temp directory for fleet-alerts.json                               */
/* ------------------------------------------------------------------ */

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'fleet-alerts-test-'));
  process.env.ALERTS_FILE_PATH = resolve(tmpDir, 'fleet-alerts.json');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.ALERTS_FILE_PATH;
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

import {
  getAlerts,
  acknowledgeAlert,
  getAlertRules,
  updateAlertRules,
  evaluateAlerts,
} from '@/lib/fleet-alerts';

function makeServerStatus(overrides: Partial<FleetServerStatus> = {}): FleetServerStatus {
  return {
    id: 'srv-1',
    name: 'Test Server',
    environment: 'production',
    region: 'us-east',
    tags: [],
    status: 'healthy',
    lastHeartbeat: new Date().toISOString(),
    uptime: 60_000,
    agents: 2,
    liveSessions: 5,
    p50Ms: 120,
    cpu: 35,
    mem: 50,
    disk: 40,
    channels: { telegram: 1, whatsapp: 1 },
    version: 'v1.0.0',
    dirty: false,
    sslExpiryDays: 90,
    alerts: [],
    url: 'http://localhost:3000',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('getAlerts', () => {
  it('returns empty array initially', () => {
    expect(getAlerts()).toEqual([]);
  });
});

describe('evaluateAlerts — creation', () => {
  it('creates alert for offline server', () => {
    evaluateAlerts([makeServerStatus({ status: 'offline' })]);
    const alerts = getAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('server_offline');
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].message).toBe('Server offline');
  });

  it('creates alert for high CPU', () => {
    evaluateAlerts([makeServerStatus({ cpu: 95 })]);
    const alerts = getAlerts();
    expect(alerts.some((a) => a.type === 'high_cpu')).toBe(true);
    expect(alerts.find((a) => a.type === 'high_cpu')!.message).toBe('CPU usage 95%');
  });

  it('creates alert for high memory', () => {
    evaluateAlerts([makeServerStatus({ mem: 90 })]);
    const alerts = getAlerts();
    expect(alerts.some((a) => a.type === 'high_memory')).toBe(true);
    expect(alerts.find((a) => a.type === 'high_memory')!.message).toBe('Memory usage 90%');
  });

  it('creates alert for high disk', () => {
    evaluateAlerts([makeServerStatus({ disk: 95 })]);
    const alerts = getAlerts();
    expect(alerts.some((a) => a.type === 'high_disk')).toBe(true);
    expect(alerts.find((a) => a.type === 'high_disk')!.message).toBe('Disk usage 95%');
  });

  it('creates alert for elevated P50', () => {
    evaluateAlerts([makeServerStatus({ p50Ms: 1500 })]);
    const alerts = getAlerts();
    expect(alerts.some((a) => a.type === 'elevated_p50')).toBe(true);
    expect(alerts.find((a) => a.type === 'elevated_p50')!.message).toBe('P50 latency 1500ms');
  });

  it('creates alert for SSL expiring', () => {
    evaluateAlerts([makeServerStatus({ sslExpiryDays: 7 })]);
    const alerts = getAlerts();
    expect(alerts.some((a) => a.type === 'ssl_expiring')).toBe(true);
    expect(alerts.find((a) => a.type === 'ssl_expiring')!.message).toBe('SSL expires in 7 days');
  });

  it('creates alert for channel disconnected', () => {
    evaluateAlerts([makeServerStatus({ channels: { telegram: 0, whatsapp: 0 } })]);
    const alerts = getAlerts();
    expect(alerts.some((a) => a.type === 'channel_disconnected')).toBe(true);
  });
});

describe('evaluateAlerts — deduplication', () => {
  it('does NOT create duplicate alerts for same server+type', () => {
    const offlineServer = makeServerStatus({ status: 'offline' });
    evaluateAlerts([offlineServer]);
    evaluateAlerts([offlineServer]);
    evaluateAlerts([offlineServer]);

    const alerts = getAlerts();
    const offlineAlerts = alerts.filter((a) => a.type === 'server_offline' && a.serverId === 'srv-1');
    expect(offlineAlerts).toHaveLength(1);
  });
});

describe('evaluateAlerts — auto-resolve', () => {
  it('auto-resolves when condition clears', () => {
    // First: server offline → creates alert
    evaluateAlerts([makeServerStatus({ status: 'offline' })]);
    expect(getAlerts({ status: 'open' })).toHaveLength(1);

    // Second: server healthy → alert should auto-resolve
    evaluateAlerts([makeServerStatus({ status: 'healthy' })]);
    const open = getAlerts({ status: 'open' });
    expect(open).toHaveLength(0);

    // The alert should still exist in "all" view
    const all = getAlerts({ status: 'all' });
    expect(all).toHaveLength(1);
    expect(all[0].resolvedAt).not.toBeNull();
  });
});

describe('acknowledgeAlert', () => {
  it('sets acknowledgedAt on existing alert', () => {
    evaluateAlerts([makeServerStatus({ status: 'offline' })]);
    const alerts = getAlerts();
    expect(alerts).toHaveLength(1);

    const result = acknowledgeAlert(alerts[0].id);
    expect(result).toBe(true);

    const updated = getAlerts({ status: 'all' });
    expect(updated[0].acknowledgedAt).not.toBeNull();
  });

  it('returns false for unknown ID', () => {
    expect(acknowledgeAlert('nonexistent-id')).toBe(false);
  });
});

describe('getAlerts filter', () => {
  it('open returns only unacknowledged + unresolved', () => {
    // Create two alerts
    evaluateAlerts([
      makeServerStatus({ id: 'srv-1', name: 'S1', status: 'offline' }),
      makeServerStatus({ id: 'srv-2', name: 'S2', cpu: 95 }),
    ]);

    const allAlerts = getAlerts({ status: 'all' });
    expect(allAlerts.length).toBeGreaterThanOrEqual(2);

    // Acknowledge one
    acknowledgeAlert(allAlerts[0].id);

    const open = getAlerts({ status: 'open' });
    expect(open.every((a) => a.acknowledgedAt === null && a.resolvedAt === null)).toBe(true);
    expect(open.find((a) => a.id === allAlerts[0].id)).toBeUndefined();
  });

  it('acknowledged returns only acknowledged alerts', () => {
    evaluateAlerts([makeServerStatus({ status: 'offline' })]);
    const alerts = getAlerts();
    acknowledgeAlert(alerts[0].id);

    const acked = getAlerts({ status: 'acknowledged' });
    expect(acked).toHaveLength(1);
    expect(acked[0].acknowledgedAt).not.toBeNull();
    expect(acked[0].resolvedAt).toBeNull();
  });

  it('all returns everything', () => {
    // Create alert, acknowledge it, then resolve it
    evaluateAlerts([makeServerStatus({ status: 'offline' })]);
    const alerts = getAlerts();
    acknowledgeAlert(alerts[0].id);

    // Resolve by clearing condition
    evaluateAlerts([makeServerStatus({ status: 'healthy' })]);

    const all = getAlerts({ status: 'all' });
    expect(all).toHaveLength(1);
    expect(all[0].resolvedAt).not.toBeNull();

    // open and acknowledged should both be empty
    expect(getAlerts({ status: 'open' })).toHaveLength(0);
    expect(getAlerts({ status: 'acknowledged' })).toHaveLength(0);
  });
});

describe('getAlertRules', () => {
  it('returns defaults when no store file exists', () => {
    const rules = getAlertRules();
    expect(rules.cpuThreshold).toBe(80);
    expect(rules.memThreshold).toBe(80);
    expect(rules.diskThreshold).toBe(90);
    expect(rules.p50ThresholdMs).toBe(1000);
    expect(rules.offlineTimeoutSec).toBe(60);
    expect(rules.sslExpiryDays).toBe(14);
    expect(rules.channelDisconnectMin).toBe(5);
    expect(rules.enabledTypes).toContain('server_offline');
  });
});

describe('updateAlertRules', () => {
  it('patches specific fields and persists', () => {
    const updated = updateAlertRules({ cpuThreshold: 90, memThreshold: 70 });
    expect(updated.cpuThreshold).toBe(90);
    expect(updated.memThreshold).toBe(70);
    // Other defaults unchanged
    expect(updated.diskThreshold).toBe(90);

    // Persisted
    const reloaded = getAlertRules();
    expect(reloaded.cpuThreshold).toBe(90);
    expect(reloaded.memThreshold).toBe(70);
  });
});

describe('disabled alert types', () => {
  it('does not evaluate disabled types', () => {
    // Disable server_offline
    updateAlertRules({ enabledTypes: ['high_cpu'] });

    evaluateAlerts([makeServerStatus({ status: 'offline' })]);
    const alerts = getAlerts();
    expect(alerts.find((a) => a.type === 'server_offline')).toBeUndefined();
  });
});

describe('resolved alert cleanup', () => {
  it('cleans up resolved alerts older than 24h', () => {
    // Create and resolve an alert
    evaluateAlerts([makeServerStatus({ status: 'offline' })]);
    evaluateAlerts([makeServerStatus({ status: 'healthy' })]);

    // All alerts should be resolved
    let all = getAlerts({ status: 'all' });
    expect(all).toHaveLength(1);
    expect(all[0].resolvedAt).not.toBeNull();

    // Manually backdate the resolvedAt to >24h ago by reading/writing the file
    const { readFileSync, writeFileSync } = require('node:fs');
    const filePath = process.env.ALERTS_FILE_PATH!;
    const store = JSON.parse(readFileSync(filePath, 'utf-8'));
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    store.alerts[0].resolvedAt = oldDate;
    writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');

    // Now run evaluateAlerts again — it should clean up the old alert
    evaluateAlerts([makeServerStatus({ status: 'healthy' })]);

    all = getAlerts({ status: 'all' });
    expect(all).toHaveLength(0);
  });
});
