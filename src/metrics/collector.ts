import { execSync } from 'node:child_process';
import * as os from 'node:os';
import type { UsageRecord } from './insights.js';
import type {
  MetricsStore,
  StoredAgentRunFinish,
  StoredAgentRunRecord,
  StoredAgentRunStart,
  StoredAgentRunStatus,
  StoredDiagnosticEvent,
  StoredDirectWebhookDelivery,
  StoredFileOwnershipEvent,
  StoredIntegrationAuditEvent,
  StoredMemoryInfluenceEvent,
  StoredMemoryInfluenceSource,
  StoredInterruptRecord,
  StoredRouteDecision,
  StoredSessionEvent,
  StoredSubagentEvent,
  StoredToolEvent,
} from './store.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MetricsSnapshot {
  counters: Record<string, number>;
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
    cache_read: number;
    byModel: Record<string, { input: number; output: number; cache_read: number }>;
  };
  messages_24h: number;
  insights_30d: {
    totalSessions: number;
    totalMessages: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    topTools: Array<{ name: string; count: number }>;
    topModels: Array<{ model: string; sessions: number }>;
    periodDays: number;
  };
  events_30d: {
    tools: Record<string, number>;
    sessions: Record<string, number>;
    subagents: Record<string, number>;
    fileOwnership: Record<string, number>;
  };
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

interface TokenEntry {
  ts: number;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
}

/* ------------------------------------------------------------------ */
/*  MetricsCollector                                                    */
/* ------------------------------------------------------------------ */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const MAX_DURATION_SAMPLES = 1000;
const CPU_CACHE_TTL_MS = 5000;

class MetricsCollector {
  private counters = new Map<string, number>();
  private durationSamples: number[] = [];
  private tokenEntries: TokenEntry[] = [];
  private messageTimestamps: number[] = [];
  private store: MetricsStore | null = null;

  // Gauge sources — set externally by gateway
  gaugeProviders: {
    activeSessions?: () => number;
    agentsLoaded?: () => number;
    queuedMessages?: () => number;
    memoryStoreBytes?: () => number;
    mediaStoreBytes?: () => number;
  } = {};

  // System metrics caches
  private cpuCache: { value: number; ts: number } | null = null;
  private gitCache: { git_version: string; git_dirty: boolean } | null = null;

  /* ---------- Public API ---------- */

  increment(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
    this.store?.recordCounter(name, value);
  }

  recordQueryDuration(ms: number): void {
    if (this.durationSamples.length >= MAX_DURATION_SAMPLES) {
      // Remove oldest 10% in bulk to avoid repeated O(n) shifts
      this.durationSamples.splice(0, Math.floor(MAX_DURATION_SAMPLES * 0.1));
    }
    this.durationSamples.push(ms);
    this.store?.recordQueryDuration(ms);
  }

  recordTokens(model: string, input: number, output: number, cacheRead = 0): void {
    this.tokenEntries.push({ ts: Date.now(), model, input, output, cacheRead });
    this.store?.recordTokens(model, input, output, cacheRead);
  }

  recordMessage(): void {
    this.messageTimestamps.push(Date.now());
    this.store?.recordMessage();
  }

  recordUsage(usage: UsageRecord): void {
    this.store?.recordUsage(usage);
  }

  recordToolEvent(event: StoredToolEvent): void {
    this.store?.recordToolEvent(event);
  }

  recordSessionEvent(event: StoredSessionEvent): void {
    this.store?.recordSessionEvent(event);
  }

  recordSubagentEvent(event: StoredSubagentEvent): void {
    this.store?.recordSubagentEvent(event);
  }

  recordAgentRunStart(run: StoredAgentRunStart): void {
    this.store?.recordAgentRunStart(run);
  }

  recordAgentRunFinish(run: StoredAgentRunFinish): void {
    this.store?.recordAgentRunFinish(run);
  }

  recordRouteDecision(decision: StoredRouteDecision): void {
    this.store?.recordRouteDecision(decision);
  }

  recordDiagnosticEvent(event: StoredDiagnosticEvent): void {
    this.store?.recordDiagnosticEvent(event);
  }

  recordInterrupt(record: StoredInterruptRecord): void {
    this.store?.recordInterrupt(record);
  }

  recordFileOwnershipEvent(event: StoredFileOwnershipEvent): void {
    this.store?.recordFileOwnershipEvent(event);
  }

  recordIntegrationAuditEvent(event: StoredIntegrationAuditEvent): void {
    this.store?.recordIntegrationAuditEvent(event);
  }

  recordDirectWebhookDelivery(event: StoredDirectWebhookDelivery): void {
    this.store?.recordDirectWebhookDelivery(event);
  }

  recordMemoryInfluenceEvent(event: StoredMemoryInfluenceEvent): void {
    this.store?.recordMemoryInfluenceEvent(event);
  }

  getAgentRun(runId: string): StoredAgentRunRecord | undefined {
    return this.store?.getAgentRun(runId);
  }

  listAgentRuns(params: {
    agentId?: string;
    sessionKey?: string;
    sdkSessionId?: string;
    status?: StoredAgentRunStatus;
    limit?: number;
    offset?: number;
  } = {}): StoredAgentRunRecord[] {
    return this.store?.listAgentRuns(params) ?? [];
  }

  listRouteDecisions(params: {
    id?: string;
    agentId?: string;
    sessionKey?: string;
    outcome?: string;
    limit?: number;
    offset?: number;
  } = {}): StoredRouteDecision[] {
    return this.store?.listRouteDecisions(params) ?? [];
  }

  listDiagnosticEvents(params: {
    traceId?: string;
    runId?: string;
    agentId?: string;
    sessionKey?: string;
    limit?: number;
    offset?: number;
  } = {}): StoredDiagnosticEvent[] {
    return this.store?.listDiagnosticEvents(params) ?? [];
  }

  listInterrupts(params: {
    agentId?: string;
    runId?: string;
    targetId?: string;
    limit?: number;
    offset?: number;
  } = {}): StoredInterruptRecord[] {
    return this.store?.listInterrupts(params) ?? [];
  }

  listFileOwnershipEvents(params: {
    agentId?: string;
    sessionKey?: string;
    runId?: string;
    subagentId?: string;
    path?: string;
    eventType?: StoredFileOwnershipEvent['eventType'];
    action?: StoredFileOwnershipEvent['action'];
    limit?: number;
    offset?: number;
  } = {}): StoredFileOwnershipEvent[] {
    return this.store?.listFileOwnershipEvents(params) ?? [];
  }

  listIntegrationAuditEvents(params: {
    agentId?: string;
    sessionKey?: string;
    provider?: string;
    capabilityId?: string;
    toolName?: string;
    status?: StoredIntegrationAuditEvent['status'];
    limit?: number;
    offset?: number;
  } = {}): StoredIntegrationAuditEvent[] {
    return this.store?.listIntegrationAuditEvents(params) ?? [];
  }

  listDirectWebhookDeliveries(params: {
    webhook?: string;
    status?: StoredDirectWebhookDelivery['status'];
    delivered?: boolean;
    limit?: number;
    offset?: number;
  } = {}): StoredDirectWebhookDelivery[] {
    return this.store?.listDirectWebhookDeliveries(params) ?? [];
  }

  listMemoryInfluenceEvents(params: {
    agentId?: string;
    sessionKey?: string;
    runId?: string;
    sdkSessionId?: string;
    source?: StoredMemoryInfluenceSource;
    limit?: number;
    offset?: number;
  } = {}): StoredMemoryInfluenceEvent[] {
    return this.store?.listMemoryInfluenceEvents(params) ?? [];
  }

  setStore(store: MetricsStore | null): void {
    this.store = store;
  }

  snapshot(): MetricsSnapshot {
    const now = Date.now();
    const last24h = now - TWENTY_FOUR_HOURS_MS;
    return {
      counters: this.store ? this.store.counters() : Object.fromEntries(this.counters),
      gauges: {
        active_sessions: this.gaugeProviders.activeSessions?.() ?? 0,
        agents_loaded: this.gaugeProviders.agentsLoaded?.() ?? 0,
        queued_messages: this.gaugeProviders.queuedMessages?.() ?? 0,
        memory_store_bytes: this.gaugeProviders.memoryStoreBytes?.() ?? 0,
        media_store_bytes: this.gaugeProviders.mediaStoreBytes?.() ?? 0,
      },
      histograms: {
        query_duration_ms: this.store ? this.store.queryDurationHistogram() : this.computeHistogram(),
      },
      tokens_24h: this.store ? this.store.tokensSince(last24h) : this.computeTokens24h(),
      messages_24h: this.store ? this.store.messagesSince(last24h) : this.computeMessages24h(),
      insights_30d: this.store ? this.store.usageReport(30) : {
        totalSessions: 0,
        totalMessages: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        topTools: [],
        topModels: [],
        periodDays: 30,
      },
      events_30d: this.store
        ? this.store.eventsSince(now - 30 * TWENTY_FOUR_HOURS_MS)
        : { tools: {}, sessions: {}, subagents: {}, fileOwnership: {} },
      system: this.getSystemMetrics(),
    };
  }

  getSystemMetrics(): MetricsSnapshot['system'] {
    return {
      cpu_percent: this.getCpuPercent(),
      mem_percent: this.getMemPercent(),
      mem_rss_bytes: process.memoryUsage().rss,
      ...this.getDiskMetrics(),
      node_version: process.version,
      platform: process.platform,
      ...this.getGitInfo(),
      ssl_expiry_days: null,
    };
  }

  /* ---------- Histogram computation ---------- */

  private computeHistogram(): MetricsSnapshot['histograms']['query_duration_ms'] {
    const samples = this.durationSamples;
    if (samples.length === 0) {
      return { p50: 0, p95: 0, p99: 0, avg: 0, count: 0 };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((s, v) => s + v, 0);

    return {
      p50: sorted[Math.min(Math.floor(count * 0.5), count - 1)],
      p95: sorted[Math.min(Math.floor(count * 0.95), count - 1)],
      p99: sorted[Math.min(Math.floor(count * 0.99), count - 1)],
      avg: Math.round((sum / count) * 100) / 100,
      count,
    };
  }

  /* ---------- 24h rolling windows ---------- */

  private pruneOlderThan24h<T>(entries: T[], getTimestamp: (e: T) => number): T[] {
    const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
    return entries.filter((e) => getTimestamp(e) > cutoff);
  }

  private computeTokens24h(): MetricsSnapshot['tokens_24h'] {
    this.tokenEntries = this.pruneOlderThan24h(this.tokenEntries, (e) => e.ts);

    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    const byModel: Record<string, { input: number; output: number; cache_read: number }> = {};

    for (const entry of this.tokenEntries) {
      totalInput += entry.input;
      totalOutput += entry.output;
      totalCacheRead += entry.cacheRead;

      const modelBucket = byModel[entry.model] ??= { input: 0, output: 0, cache_read: 0 };
      modelBucket.input += entry.input;
      modelBucket.output += entry.output;
      modelBucket.cache_read += entry.cacheRead;
    }

    return { input: totalInput, output: totalOutput, cache_read: totalCacheRead, byModel };
  }

  private computeMessages24h(): number {
    this.messageTimestamps = this.pruneOlderThan24h(this.messageTimestamps, (ts) => ts);
    return this.messageTimestamps.length;
  }

  /* ---------- System metrics ---------- */

  private getCpuPercent(): number {
    const now = Date.now();
    if (this.cpuCache && now - this.cpuCache.ts < CPU_CACHE_TTL_MS) {
      return this.cpuCache.value;
    }

    try {
      const cpus = os.cpus();
      const totalCores = cpus.length || 1;

      // Use process.cpuUsage() — microseconds of CPU time
      const usage = process.cpuUsage();
      const totalUs = usage.user + usage.system;
      const uptimeMs = process.uptime() * 1000;

      // % = CPU time / (wall time * cores) * 100
      const percent = uptimeMs > 0
        ? Math.min(100, Math.round((totalUs / 1000 / uptimeMs / totalCores) * 100 * 100) / 100)
        : 0;

      this.cpuCache = { value: percent, ts: now };
      return percent;
    } catch {
      return 0;
    }
  }

  private getMemPercent(): number {
    const rss = process.memoryUsage().rss;
    const total = os.totalmem();
    return total > 0 ? Math.round((rss / total) * 100 * 100) / 100 : 0;
  }

  private getDiskMetrics(): { disk_percent: number; disk_used_bytes: number; disk_total_bytes: number } {
    try {
      const output = execSync('df -k /', { encoding: 'utf-8', timeout: 5000 });
      const lines = output.trim().split('\n');
      // Second line has the data; handle both macOS and Linux df output
      if (lines.length < 2) {
        return { disk_percent: 0, disk_used_bytes: 0, disk_total_bytes: 0 };
      }

      const parts = lines[1].split(/\s+/);
      // df -k output: Filesystem 1K-blocks Used Available Use% Mounted
      // macOS: Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted
      // We find the numeric columns
      const numericParts = parts.filter((p) => /^\d+$/.test(p));
      if (numericParts.length < 3) {
        return { disk_percent: 0, disk_used_bytes: 0, disk_total_bytes: 0 };
      }

      const totalKb = parseInt(numericParts[0], 10);
      const usedKb = parseInt(numericParts[1], 10);
      const totalBytes = totalKb * 1024;
      const usedBytes = usedKb * 1024;
      const percent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100 * 100) / 100 : 0;

      return {
        disk_percent: percent,
        disk_used_bytes: usedBytes,
        disk_total_bytes: totalBytes,
      };
    } catch {
      return { disk_percent: 0, disk_used_bytes: 0, disk_total_bytes: 0 };
    }
  }

  private getGitInfo(): { git_version: string; git_dirty: boolean } {
    if (this.gitCache) {
      return this.gitCache;
    }

    try {
      const raw = execSync('git describe --tags --always --dirty 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      const dirty = raw.endsWith('-dirty');
      const version = dirty ? raw.replace(/-dirty$/, '') : raw;

      this.gitCache = { git_version: version, git_dirty: dirty };
      return this.gitCache;
    } catch {
      this.gitCache = { git_version: 'unknown', git_dirty: false };
      return this.gitCache;
    }
  }

  /* ---------- Test helpers ---------- */

  /** @internal Reset all metrics (for testing) */
  _reset(): void {
    this.counters.clear();
    this.durationSamples = [];
    this.tokenEntries = [];
    this.messageTimestamps = [];
    this.gaugeProviders = {};
    this.store = null;
    this.cpuCache = null;
    this.gitCache = null;
  }
}

export const metrics = new MetricsCollector();
