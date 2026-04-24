import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { InsightsReport, UsageRecord } from './insights.js';

export interface StoredToolEvent {
  timestamp?: number;
  agentId?: string;
  sessionKey?: string;
  toolName: string;
  status: 'started' | 'completed' | 'failed';
  durationMs?: number;
}

export interface StoredSessionEvent {
  timestamp?: number;
  agentId: string;
  sessionId?: string;
  sessionKey?: string;
  eventType: 'created' | 'resumed' | 'forked' | 'rewound' | 'deleted';
}

export interface StoredSubagentEvent {
  timestamp?: number;
  agentId: string;
  parentSessionId: string;
  subagentId: string;
  runId?: string;
  eventType: 'started' | 'completed' | 'interrupted';
  status?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)] ?? 0;
}

export class MetricsStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS counter_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        name TEXT NOT NULL,
        value REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS query_duration_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        duration_ms REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS token_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS message_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        session_key TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        duration_ms REAL NOT NULL,
        tool_calls_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        agent_id TEXT,
        session_key TEXT,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        duration_ms REAL
      );

      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT,
        session_key TEXT,
        event_type TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subagent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        parent_session_id TEXT NOT NULL,
        subagent_id TEXT NOT NULL,
        run_id TEXT,
        event_type TEXT NOT NULL,
        status TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_counter_events_name_ts ON counter_events(name, ts);
      CREATE INDEX IF NOT EXISTS idx_query_duration_events_ts ON query_duration_events(ts);
      CREATE INDEX IF NOT EXISTS idx_token_events_ts ON token_events(ts);
      CREATE INDEX IF NOT EXISTS idx_message_events_ts ON message_events(ts);
      CREATE INDEX IF NOT EXISTS idx_usage_events_ts ON usage_events(ts);
      CREATE INDEX IF NOT EXISTS idx_tool_events_ts ON tool_events(ts);
      CREATE INDEX IF NOT EXISTS idx_session_events_ts ON session_events(ts);
      CREATE INDEX IF NOT EXISTS idx_subagent_events_ts ON subagent_events(ts);
    `);
  }

  recordCounter(name: string, value = 1, timestamp = Date.now()): void {
    this.db.prepare('INSERT INTO counter_events(ts, name, value) VALUES (?, ?, ?)')
      .run(timestamp, name, value);
  }

  recordQueryDuration(durationMs: number, timestamp = Date.now()): void {
    this.db.prepare('INSERT INTO query_duration_events(ts, duration_ms) VALUES (?, ?)')
      .run(timestamp, durationMs);
  }

  recordTokens(model: string, input: number, output: number, cacheRead = 0, timestamp = Date.now()): void {
    this.db.prepare(`
      INSERT INTO token_events(ts, model, input_tokens, output_tokens, cache_read_tokens)
      VALUES (?, ?, ?, ?, ?)
    `).run(timestamp, model, input, output, cacheRead);
  }

  recordMessage(timestamp = Date.now()): void {
    this.db.prepare('INSERT INTO message_events(ts) VALUES (?)').run(timestamp);
  }

  recordUsage(usage: UsageRecord): void {
    this.db.prepare(`
      INSERT INTO usage_events(
        ts, session_key, agent_id, platform, model,
        input_tokens, output_tokens, cache_read_tokens, duration_ms, tool_calls_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      usage.timestamp,
      usage.sessionKey,
      usage.agentId,
      usage.platform,
      usage.model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens,
      usage.durationMs,
      JSON.stringify(usage.toolCalls),
    );
  }

  recordToolEvent(event: StoredToolEvent): void {
    this.db.prepare(`
      INSERT INTO tool_events(ts, agent_id, session_key, tool_name, status, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      event.timestamp ?? Date.now(),
      event.agentId ?? null,
      event.sessionKey ?? null,
      event.toolName,
      event.status,
      event.durationMs ?? null,
    );
  }

  recordSessionEvent(event: StoredSessionEvent): void {
    this.db.prepare(`
      INSERT INTO session_events(ts, agent_id, session_id, session_key, event_type)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      event.timestamp ?? Date.now(),
      event.agentId,
      event.sessionId ?? null,
      event.sessionKey ?? null,
      event.eventType,
    );
  }

  recordSubagentEvent(event: StoredSubagentEvent): void {
    this.db.prepare(`
      INSERT INTO subagent_events(ts, agent_id, parent_session_id, subagent_id, run_id, event_type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.timestamp ?? Date.now(),
      event.agentId,
      event.parentSessionId,
      event.subagentId,
      event.runId ?? null,
      event.eventType,
      event.status ?? null,
    );
  }

  counters(): Record<string, number> {
    const rows = this.db.prepare(`
      SELECT name, SUM(value) as value
      FROM counter_events
      GROUP BY name
    `).all() as Array<{ name: string; value: number }>;
    return Object.fromEntries(rows.map((row) => [row.name, row.value]));
  }

  queryDurationHistogram(limit = 1000): { p50: number; p95: number; p99: number; avg: number; count: number } {
    const rows = this.db.prepare(`
      SELECT duration_ms as duration
      FROM query_duration_events
      ORDER BY ts DESC, id DESC
      LIMIT ?
    `).all(limit) as Array<{ duration: number }>;
    const sorted = rows.map((row) => row.duration).sort((a, b) => a - b);
    if (sorted.length === 0) return { p50: 0, p95: 0, p99: 0, avg: 0, count: 0 };
    const sum = sorted.reduce((acc, value) => acc + value, 0);
    return {
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      avg: Math.round((sum / sorted.length) * 100) / 100,
      count: sorted.length,
    };
  }

  tokensSince(since: number): {
    input: number;
    output: number;
    cache_read: number;
    byModel: Record<string, { input: number; output: number; cache_read: number }>;
  } {
    const rows = this.db.prepare(`
      SELECT model, SUM(input_tokens) as input, SUM(output_tokens) as output, SUM(cache_read_tokens) as cache_read
      FROM token_events
      WHERE ts >= ?
      GROUP BY model
    `).all(since) as Array<{ model: string; input: number; output: number; cache_read: number }>;

    let input = 0;
    let output = 0;
    let cacheRead = 0;
    const byModel: Record<string, { input: number; output: number; cache_read: number }> = {};
    for (const row of rows) {
      const bucket = {
        input: row.input ?? 0,
        output: row.output ?? 0,
        cache_read: row.cache_read ?? 0,
      };
      byModel[row.model] = bucket;
      input += bucket.input;
      output += bucket.output;
      cacheRead += bucket.cache_read;
    }

    return { input, output, cache_read: cacheRead, byModel };
  }

  messagesSince(since: number): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM message_events WHERE ts >= ?')
      .get(since) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  eventsSince(since: number): {
    tools: Record<string, number>;
    sessions: Record<string, number>;
    subagents: Record<string, number>;
  } {
    const tools = this.countEventsBy('tool_events', 'status', since);
    const sessions = this.countEventsBy('session_events', 'event_type', since);
    const subagents = this.countEventsBy('subagent_events', 'event_type', since);
    return { tools, sessions, subagents };
  }

  private countEventsBy(table: string, column: string, since: number): Record<string, number> {
    const rows = this.db.prepare(`
      SELECT ${column} as name, COUNT(*) as count
      FROM ${table}
      WHERE ts >= ?
      GROUP BY ${column}
    `).all(since) as Array<{ name: string; count: number }>;
    return Object.fromEntries(rows.map((row) => [row.name, row.count]));
  }

  usageReport(days = 30): InsightsReport {
    const since = Date.now() - days * DAY_MS;
    const rows = this.db.prepare(`
      SELECT session_key, model, input_tokens, output_tokens, cache_read_tokens, tool_calls_json
      FROM usage_events
      WHERE ts >= ?
    `).all(since) as Array<{
      session_key: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      tool_calls_json: string;
    }>;

    const sessionKeys = new Set<string>();
    const toolCounts = new Map<string, number>();
    const modelCounts = new Map<string, number>();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;

    for (const row of rows) {
      sessionKeys.add(row.session_key);
      totalInputTokens += row.input_tokens;
      totalOutputTokens += row.output_tokens;
      totalCacheReadTokens += row.cache_read_tokens;
      modelCounts.set(row.model, (modelCounts.get(row.model) ?? 0) + 1);

      let toolCalls: Record<string, number> = {};
      try {
        toolCalls = JSON.parse(row.tool_calls_json) as Record<string, number>;
      } catch {
        toolCalls = {};
      }
      for (const [tool, count] of Object.entries(toolCalls)) {
        toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + count);
      }
    }

    const toolRows = this.db.prepare(`
      SELECT tool_name as name, COUNT(*) as count
      FROM tool_events
      WHERE ts >= ? AND status = 'started'
      GROUP BY tool_name
    `).all(since) as Array<{ name: string; count: number }>;

    for (const row of toolRows) {
      toolCounts.set(row.name, (toolCounts.get(row.name) ?? 0) + row.count);
    }

    return {
      totalSessions: sessionKeys.size,
      totalMessages: rows.length,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      topTools: [...toolCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topModels: [...modelCounts.entries()]
        .map(([model, sessions]) => ({ model, sessions }))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 5),
      periodDays: days,
    };
  }

  clear(): void {
    this.db.exec(`
      DELETE FROM counter_events;
      DELETE FROM query_duration_events;
      DELETE FROM token_events;
      DELETE FROM message_events;
      DELETE FROM usage_events;
      DELETE FROM tool_events;
      DELETE FROM session_events;
      DELETE FROM subagent_events;
    `);
  }

  close(): void {
    this.db.close();
  }
}
