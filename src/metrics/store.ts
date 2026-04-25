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

export interface StoredIntegrationAuditEvent {
  id?: number;
  timestamp?: number;
  agentId?: string;
  sessionKey?: string;
  runId?: string;
  sdkSessionId?: string;
  toolName: string;
  provider: string;
  capabilityId: string;
  status: 'started' | 'completed' | 'failed';
  reason?: string;
}

export interface StoredDirectWebhookDelivery {
  id?: number;
  timestamp?: number;
  webhook: string;
  status: 'delivered' | 'not_found' | 'disabled' | 'unauthorized' | 'bad_payload' | 'channel_unavailable' | 'delivery_failed';
  delivered: boolean;
  channel?: string;
  accountId?: string;
  peerId?: string;
  threadId?: string;
  messageId?: string;
  error?: string;
}

export type StoredMemoryInfluenceSource = 'prefetch' | 'memory_search';

export interface StoredMemoryInfluenceRef {
  memoryEntryId?: string;
  path: string;
  startLine?: number;
  endLine?: number;
  score?: number;
}

export interface StoredMemoryInfluenceEvent {
  id?: number;
  timestamp?: number;
  agentId?: string;
  sessionKey?: string;
  runId?: string;
  sdkSessionId?: string;
  source: StoredMemoryInfluenceSource;
  query?: string;
  refs: StoredMemoryInfluenceRef[];
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

export type StoredAgentRunStatus = 'running' | 'succeeded' | 'failed' | 'interrupted';
export type StoredAgentRunSource = 'channel' | 'web' | 'cron';

export interface StoredAgentRunUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  totalCostUsd?: number;
  durationMs?: number;
  durationApiMs?: number;
  numTurns?: number;
}

export interface StoredAgentRunStart {
  runId: string;
  traceId?: string;
  startedAt?: number;
  agentId: string;
  sessionKey: string;
  sdkSessionId?: string;
  source: StoredAgentRunSource;
  channel: string;
  accountId?: string;
  peerId?: string;
  threadId?: string;
  messageId?: string;
  routeDecisionId?: string;
  status?: StoredAgentRunStatus;
  model?: string;
  budget?: Record<string, unknown>;
}

export interface StoredAgentRunFinish {
  runId: string;
  completedAt?: number;
  status: Exclude<StoredAgentRunStatus, 'running'>;
  sdkSessionId?: string;
  usage?: StoredAgentRunUsage;
  error?: string;
}

export interface StoredAgentRunRecord extends StoredAgentRunStart {
  traceId: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  status: StoredAgentRunStatus;
  usage: StoredAgentRunUsage;
  error?: string;
}

export interface StoredInterruptRecord {
  id?: number;
  timestamp?: number;
  agentId?: string;
  runId?: string;
  sessionKey?: string;
  sdkSessionId?: string;
  targetId: string;
  requestedBy?: string;
  result: 'interrupted' | 'failed';
  reason?: string;
}

export interface StoredFileOwnershipEvent {
  id?: number;
  timestamp?: number;
  agentId?: string;
  sessionKey: string;
  runId?: string;
  subagentId?: string;
  path: string;
  eventType: 'conflict' | 'denied_write' | 'override' | 'released';
  action?: 'allow' | 'deny';
  reason?: string;
}

export interface StoredRouteDecisionCandidate {
  agentId: string;
  channel: string;
  accountId: string;
  scope: string;
  peers?: string[];
  topics?: string[];
  mentionOnly: boolean;
  priority: number;
}

export interface StoredRouteDecision {
  id: string;
  timestamp?: number;
  messageId?: string;
  channel: string;
  accountId: string;
  chatType: string;
  peerId: string;
  senderId: string;
  threadId?: string;
  candidates: StoredRouteDecisionCandidate[];
  winnerAgentId?: string;
  accessAllowed?: boolean;
  accessReason?: string;
  queueAction?: string;
  sessionKey?: string;
  outcome: string;
}

export type StoredDiagnosticEventType =
  | 'run.received'
  | 'run.routed'
  | 'run.sdk_started'
  | 'run.first_output'
  | 'run.tool_started'
  | 'run.tool_completed'
  | 'run.tool_failed'
  | 'run.sdk_result'
  | 'run.interrupted'
  | 'run.failed'
  | 'run.completed';

export interface StoredDiagnosticEvent {
  id?: number;
  timestamp?: number;
  traceId: string;
  runId?: string;
  agentId?: string;
  sessionKey?: string;
  sdkSessionId?: string;
  eventType: StoredDiagnosticEventType;
  detail?: Record<string, unknown>;
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

      CREATE TABLE IF NOT EXISTS agent_runs (
        run_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        agent_id TEXT NOT NULL,
        session_key TEXT NOT NULL,
        sdk_session_id TEXT,
        source TEXT NOT NULL,
        channel TEXT NOT NULL,
        account_id TEXT,
        peer_id TEXT,
        thread_id TEXT,
        message_id TEXT,
        route_decision_id TEXT,
        status TEXT NOT NULL,
        model TEXT,
        budget_json TEXT NOT NULL,
        usage_json TEXT NOT NULL,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS diagnostic_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        trace_id TEXT NOT NULL,
        run_id TEXT,
        agent_id TEXT,
        session_key TEXT,
        sdk_session_id TEXT,
        event_type TEXT NOT NULL,
        detail_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS route_decisions (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        message_id TEXT,
        channel TEXT NOT NULL,
        account_id TEXT NOT NULL,
        chat_type TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        thread_id TEXT,
        candidates_json TEXT NOT NULL,
        winner_agent_id TEXT,
        access_allowed INTEGER,
        access_reason TEXT,
        queue_action TEXT,
        session_key TEXT,
        outcome TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS interrupt_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        agent_id TEXT,
        run_id TEXT,
        session_key TEXT,
        sdk_session_id TEXT,
        target_id TEXT NOT NULL,
        requested_by TEXT,
        result TEXT NOT NULL,
        reason TEXT
      );

      CREATE TABLE IF NOT EXISTS file_ownership_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        agent_id TEXT,
        session_key TEXT NOT NULL,
        run_id TEXT,
        subagent_id TEXT,
        path TEXT NOT NULL,
        event_type TEXT NOT NULL,
        action TEXT,
        reason TEXT
      );

      CREATE TABLE IF NOT EXISTS integration_audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        agent_id TEXT,
        session_key TEXT,
        run_id TEXT,
        sdk_session_id TEXT,
        tool_name TEXT NOT NULL,
        provider TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT
      );

      CREATE TABLE IF NOT EXISTS direct_webhook_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        webhook TEXT NOT NULL,
        status TEXT NOT NULL,
        delivered INTEGER NOT NULL,
        channel TEXT,
        account_id TEXT,
        peer_id TEXT,
        thread_id TEXT,
        message_id TEXT,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS memory_influence_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        agent_id TEXT,
        session_key TEXT,
        run_id TEXT,
        sdk_session_id TEXT,
        source TEXT NOT NULL,
        query TEXT,
        refs_json TEXT NOT NULL
      );

    `);

    // Legacy-column migrations must run before index creation so that
    // upgrading an older DB doesn't fail on indexes that reference columns
    // added later (e.g. agent_runs.trace_id).
    this.ensureColumn('agent_runs', 'route_decision_id', 'TEXT');
    this.ensureColumn('agent_runs', 'trace_id', 'TEXT NOT NULL DEFAULT ""');
    this.ensureColumn('integration_audit_events', 'run_id', 'TEXT');

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_counter_events_name_ts ON counter_events(name, ts);
      CREATE INDEX IF NOT EXISTS idx_query_duration_events_ts ON query_duration_events(ts);
      CREATE INDEX IF NOT EXISTS idx_token_events_ts ON token_events(ts);
      CREATE INDEX IF NOT EXISTS idx_message_events_ts ON message_events(ts);
      CREATE INDEX IF NOT EXISTS idx_usage_events_ts ON usage_events(ts);
      CREATE INDEX IF NOT EXISTS idx_tool_events_ts ON tool_events(ts);
      CREATE INDEX IF NOT EXISTS idx_session_events_ts ON session_events(ts);
      CREATE INDEX IF NOT EXISTS idx_subagent_events_ts ON subagent_events(ts);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_started ON agent_runs(agent_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(sdk_session_id);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_status_started ON agent_runs(status, started_at);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_trace ON agent_runs(trace_id);
      CREATE INDEX IF NOT EXISTS idx_diagnostic_events_trace_ts ON diagnostic_events(trace_id, ts);
      CREATE INDEX IF NOT EXISTS idx_diagnostic_events_run_ts ON diagnostic_events(run_id, ts);
      CREATE INDEX IF NOT EXISTS idx_route_decisions_agent_ts ON route_decisions(winner_agent_id, ts);
      CREATE INDEX IF NOT EXISTS idx_route_decisions_session_ts ON route_decisions(session_key, ts);
      CREATE INDEX IF NOT EXISTS idx_route_decisions_outcome_ts ON route_decisions(outcome, ts);
      CREATE INDEX IF NOT EXISTS idx_interrupt_events_target_ts ON interrupt_events(target_id, ts);
      CREATE INDEX IF NOT EXISTS idx_interrupt_events_run_ts ON interrupt_events(run_id, ts);
      CREATE INDEX IF NOT EXISTS idx_file_ownership_events_session_ts ON file_ownership_events(session_key, ts);
      CREATE INDEX IF NOT EXISTS idx_file_ownership_events_path_ts ON file_ownership_events(path, ts);
      CREATE INDEX IF NOT EXISTS idx_file_ownership_events_type_ts ON file_ownership_events(event_type, ts);
      CREATE INDEX IF NOT EXISTS idx_integration_audit_provider_ts ON integration_audit_events(provider, ts);
      CREATE INDEX IF NOT EXISTS idx_integration_audit_agent_ts ON integration_audit_events(agent_id, ts);
      CREATE INDEX IF NOT EXISTS idx_direct_webhook_deliveries_webhook_ts ON direct_webhook_deliveries(webhook, ts);
      CREATE INDEX IF NOT EXISTS idx_direct_webhook_deliveries_status_ts ON direct_webhook_deliveries(status, ts);
      CREATE INDEX IF NOT EXISTS idx_memory_influence_agent_ts ON memory_influence_events(agent_id, ts);
      CREATE INDEX IF NOT EXISTS idx_memory_influence_run_ts ON memory_influence_events(run_id, ts);
      CREATE INDEX IF NOT EXISTS idx_memory_influence_session_ts ON memory_influence_events(session_key, ts);
    `);
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!rows.some((row) => row.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
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

  recordIntegrationAuditEvent(event: StoredIntegrationAuditEvent): void {
    this.db.prepare(`
      INSERT INTO integration_audit_events(
        ts, agent_id, session_key, run_id, sdk_session_id, tool_name, provider, capability_id, status, reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.timestamp ?? Date.now(),
      event.agentId ?? null,
      event.sessionKey ?? null,
      event.runId ?? null,
      event.sdkSessionId ?? null,
      event.toolName,
      event.provider,
      event.capabilityId,
      event.status,
      event.reason ?? null,
    );
  }

  recordDirectWebhookDelivery(event: StoredDirectWebhookDelivery): void {
    this.db.prepare(`
      INSERT INTO direct_webhook_deliveries(
        ts, webhook, status, delivered, channel, account_id, peer_id, thread_id, message_id, error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.timestamp ?? Date.now(),
      event.webhook,
      event.status,
      event.delivered ? 1 : 0,
      event.channel ?? null,
      event.accountId ?? null,
      event.peerId ?? null,
      event.threadId ?? null,
      event.messageId ?? null,
      event.error ?? null,
    );
  }

  recordMemoryInfluenceEvent(event: StoredMemoryInfluenceEvent): void {
    this.db.prepare(`
      INSERT INTO memory_influence_events(
        ts, agent_id, session_key, run_id, sdk_session_id, source, query, refs_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.timestamp ?? Date.now(),
      event.agentId ?? null,
      event.sessionKey ?? null,
      event.runId ?? null,
      event.sdkSessionId ?? null,
      event.source,
      event.query ?? null,
      JSON.stringify(event.refs),
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

  recordAgentRunStart(run: StoredAgentRunStart): void {
    const startedAt = run.startedAt ?? Date.now();
    const traceId = run.traceId ?? run.runId;
    this.db.prepare(`
      INSERT INTO agent_runs(
        run_id, trace_id, started_at, updated_at, completed_at,
        agent_id, session_key, sdk_session_id, source, channel,
        account_id, peer_id, thread_id, message_id, route_decision_id,
        status, model, budget_json, usage_json, error
      )
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(run_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        trace_id = excluded.trace_id,
        sdk_session_id = COALESCE(excluded.sdk_session_id, agent_runs.sdk_session_id),
        route_decision_id = COALESCE(excluded.route_decision_id, agent_runs.route_decision_id),
        status = excluded.status,
        model = COALESCE(excluded.model, agent_runs.model),
        budget_json = excluded.budget_json
    `).run(
      run.runId,
      traceId,
      startedAt,
      startedAt,
      run.agentId,
      run.sessionKey,
      run.sdkSessionId ?? null,
      run.source,
      run.channel,
      run.accountId ?? null,
      run.peerId ?? null,
      run.threadId ?? null,
      run.messageId ?? null,
      run.routeDecisionId ?? null,
      run.status ?? 'running',
      run.model ?? null,
      JSON.stringify(run.budget ?? {}),
      JSON.stringify({}),
    );
    this.recordDiagnosticEvent({
      timestamp: startedAt,
      traceId,
      runId: run.runId,
      agentId: run.agentId,
      sessionKey: run.sessionKey,
      sdkSessionId: run.sdkSessionId,
      eventType: 'run.sdk_started',
      detail: {
        source: run.source,
        channel: run.channel,
        routeDecisionId: run.routeDecisionId,
        model: run.model,
      },
    });
  }

  recordAgentRunFinish(run: StoredAgentRunFinish): void {
    const completedAt = run.completedAt ?? Date.now();
    const existing = this.getAgentRun(run.runId);
    this.db.prepare(`
      UPDATE agent_runs
      SET
        updated_at = ?,
        completed_at = ?,
        status = ?,
        sdk_session_id = COALESCE(?, sdk_session_id),
        usage_json = ?,
        error = ?
      WHERE run_id = ?
    `).run(
      completedAt,
      completedAt,
      run.status,
      run.sdkSessionId ?? null,
      JSON.stringify(run.usage ?? {}),
      run.error ?? null,
      run.runId,
    );
    const traceId = existing?.traceId ?? run.runId;
    this.recordDiagnosticEvent({
      timestamp: completedAt,
      traceId,
      runId: run.runId,
      agentId: existing?.agentId,
      sessionKey: existing?.sessionKey,
      sdkSessionId: run.sdkSessionId ?? existing?.sdkSessionId,
      eventType: run.status === 'succeeded'
        ? 'run.completed'
        : run.status === 'interrupted'
          ? 'run.interrupted'
          : 'run.failed',
      detail: {
        usage: run.usage ?? {},
        error: run.error,
      },
    });
  }

  recordDiagnosticEvent(event: StoredDiagnosticEvent): void {
    this.db.prepare(`
      INSERT INTO diagnostic_events(
        ts, trace_id, run_id, agent_id, session_key, sdk_session_id, event_type, detail_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.timestamp ?? Date.now(),
      event.traceId,
      event.runId ?? null,
      event.agentId ?? null,
      event.sessionKey ?? null,
      event.sdkSessionId ?? null,
      event.eventType,
      JSON.stringify(event.detail ?? {}),
    );
  }

  listDiagnosticEvents(params: {
    traceId?: string;
    runId?: string;
    agentId?: string;
    sessionKey?: string;
    limit?: number;
    offset?: number;
  } = {}): StoredDiagnosticEvent[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.traceId) {
      clauses.push('trace_id = ?');
      values.push(params.traceId);
    }
    if (params.runId) {
      clauses.push('run_id = ?');
      values.push(params.runId);
    }
    if (params.agentId) {
      clauses.push('agent_id = ?');
      values.push(params.agentId);
    }
    if (params.sessionKey) {
      clauses.push('session_key = ?');
      values.push(params.sessionKey);
    }
    values.push(params.limit ?? 500, params.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM diagnostic_events
      ${where}
      ORDER BY ts DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...values) as DiagnosticEventRow[];
    return rows.map(parseDiagnosticEventRow);
  }

  recordRouteDecision(decision: StoredRouteDecision): void {
    this.db.prepare(`
      INSERT INTO route_decisions(
        id, ts, message_id, channel, account_id, chat_type, peer_id, sender_id,
        thread_id, candidates_json, winner_agent_id, access_allowed, access_reason,
        queue_action, session_key, outcome
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        ts = excluded.ts,
        message_id = excluded.message_id,
        candidates_json = excluded.candidates_json,
        winner_agent_id = excluded.winner_agent_id,
        access_allowed = excluded.access_allowed,
        access_reason = excluded.access_reason,
        queue_action = excluded.queue_action,
        session_key = excluded.session_key,
        outcome = excluded.outcome
    `).run(
      decision.id,
      decision.timestamp ?? Date.now(),
      decision.messageId ?? null,
      decision.channel,
      decision.accountId,
      decision.chatType,
      decision.peerId,
      decision.senderId,
      decision.threadId ?? null,
      JSON.stringify(decision.candidates),
      decision.winnerAgentId ?? null,
      decision.accessAllowed === undefined ? null : (decision.accessAllowed ? 1 : 0),
      decision.accessReason ?? null,
      decision.queueAction ?? null,
      decision.sessionKey ?? null,
      decision.outcome,
    );
  }

  recordInterrupt(record: StoredInterruptRecord): void {
    this.db.prepare(`
      INSERT INTO interrupt_events(
        ts, agent_id, run_id, session_key, sdk_session_id, target_id, requested_by, result, reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.timestamp ?? Date.now(),
      record.agentId ?? null,
      record.runId ?? null,
      record.sessionKey ?? null,
      record.sdkSessionId ?? null,
      record.targetId,
      record.requestedBy ?? null,
      record.result,
      record.reason ?? null,
    );
  }

  recordFileOwnershipEvent(event: StoredFileOwnershipEvent): void {
    this.db.prepare(`
      INSERT INTO file_ownership_events(
        ts, agent_id, session_key, run_id, subagent_id, path, event_type, action, reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.timestamp ?? Date.now(),
      event.agentId ?? null,
      event.sessionKey,
      event.runId ?? null,
      event.subagentId ?? null,
      event.path,
      event.eventType,
      event.action ?? null,
      event.reason ?? null,
    );
  }

  getAgentRun(runId: string): StoredAgentRunRecord | undefined {
    const row = this.db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId) as AgentRunRow | undefined;
    return row ? parseAgentRunRow(row) : undefined;
  }

  listAgentRuns(params: {
    agentId?: string;
    sessionKey?: string;
    sdkSessionId?: string;
    status?: StoredAgentRunStatus;
    limit?: number;
    offset?: number;
  } = {}): StoredAgentRunRecord[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.agentId) {
      clauses.push('agent_id = ?');
      values.push(params.agentId);
    }
    if (params.sessionKey) {
      clauses.push('session_key = ?');
      values.push(params.sessionKey);
    }
    if (params.sdkSessionId) {
      clauses.push('sdk_session_id = ?');
      values.push(params.sdkSessionId);
    }
    if (params.status) {
      clauses.push('status = ?');
      values.push(params.status);
    }
    values.push(params.limit ?? 100, params.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM agent_runs
      ${where}
      ORDER BY started_at DESC
      LIMIT ? OFFSET ?
    `).all(...values) as AgentRunRow[];
    return rows.map(parseAgentRunRow);
  }

  listRouteDecisions(params: {
    id?: string;
    agentId?: string;
    sessionKey?: string;
    outcome?: string;
    limit?: number;
    offset?: number;
  } = {}): StoredRouteDecision[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.id) {
      clauses.push('id = ?');
      values.push(params.id);
    }
    if (params.agentId) {
      clauses.push('winner_agent_id = ?');
      values.push(params.agentId);
    }
    if (params.sessionKey) {
      clauses.push('session_key = ?');
      values.push(params.sessionKey);
    }
    if (params.outcome) {
      clauses.push('outcome = ?');
      values.push(params.outcome);
    }
    values.push(params.limit ?? 100, params.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM route_decisions
      ${where}
      ORDER BY ts DESC
      LIMIT ? OFFSET ?
    `).all(...values) as RouteDecisionRow[];
    return rows.map(parseRouteDecisionRow);
  }

  listInterrupts(params: {
    agentId?: string;
    runId?: string;
    targetId?: string;
    limit?: number;
    offset?: number;
  } = {}): StoredInterruptRecord[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.agentId) {
      clauses.push('agent_id = ?');
      values.push(params.agentId);
    }
    if (params.runId) {
      clauses.push('run_id = ?');
      values.push(params.runId);
    }
    if (params.targetId) {
      clauses.push('target_id = ?');
      values.push(params.targetId);
    }
    values.push(params.limit ?? 100, params.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM interrupt_events
      ${where}
      ORDER BY ts DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...values) as InterruptEventRow[];
    return rows.map(parseInterruptEventRow);
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
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.agentId) {
      clauses.push('agent_id = ?');
      values.push(params.agentId);
    }
    if (params.sessionKey) {
      clauses.push('session_key = ?');
      values.push(params.sessionKey);
    }
    if (params.runId) {
      clauses.push('run_id = ?');
      values.push(params.runId);
    }
    if (params.subagentId) {
      clauses.push('subagent_id = ?');
      values.push(params.subagentId);
    }
    if (params.path) {
      clauses.push('path = ?');
      values.push(params.path);
    }
    if (params.eventType) {
      clauses.push('event_type = ?');
      values.push(params.eventType);
    }
    if (params.action) {
      clauses.push('action = ?');
      values.push(params.action);
    }
    values.push(params.limit ?? 100, params.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM file_ownership_events
      ${where}
      ORDER BY ts DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...values) as FileOwnershipEventRow[];
    return rows.map(parseFileOwnershipEventRow);
  }

  listIntegrationAuditEvents(params: {
    agentId?: string;
    sessionKey?: string;
    runId?: string;
    provider?: string;
    capabilityId?: string;
    toolName?: string;
    status?: StoredIntegrationAuditEvent['status'];
    limit?: number;
    offset?: number;
  } = {}): StoredIntegrationAuditEvent[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.agentId) {
      clauses.push('agent_id = ?');
      values.push(params.agentId);
    }
    if (params.sessionKey) {
      clauses.push('session_key = ?');
      values.push(params.sessionKey);
    }
    if (params.runId) {
      clauses.push('run_id = ?');
      values.push(params.runId);
    }
    if (params.provider) {
      clauses.push('provider = ?');
      values.push(params.provider);
    }
    if (params.capabilityId) {
      clauses.push('capability_id = ?');
      values.push(params.capabilityId);
    }
    if (params.toolName) {
      clauses.push('tool_name = ?');
      values.push(params.toolName);
    }
    if (params.status) {
      clauses.push('status = ?');
      values.push(params.status);
    }
    values.push(params.limit ?? 100, params.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM integration_audit_events
      ${where}
      ORDER BY ts DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...values) as IntegrationAuditEventRow[];
    return rows.map(parseIntegrationAuditEventRow);
  }

  listDirectWebhookDeliveries(params: {
    webhook?: string;
    status?: StoredDirectWebhookDelivery['status'];
    delivered?: boolean;
    limit?: number;
    offset?: number;
  } = {}): StoredDirectWebhookDelivery[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.webhook) {
      clauses.push('webhook = ?');
      values.push(params.webhook);
    }
    if (params.status) {
      clauses.push('status = ?');
      values.push(params.status);
    }
    if (params.delivered !== undefined) {
      clauses.push('delivered = ?');
      values.push(params.delivered ? 1 : 0);
    }
    values.push(params.limit ?? 100, params.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM direct_webhook_deliveries
      ${where}
      ORDER BY ts DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...values) as DirectWebhookDeliveryRow[];
    return rows.map(parseDirectWebhookDeliveryRow);
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
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.agentId) {
      clauses.push('agent_id = ?');
      values.push(params.agentId);
    }
    if (params.sessionKey) {
      clauses.push('session_key = ?');
      values.push(params.sessionKey);
    }
    if (params.runId) {
      clauses.push('run_id = ?');
      values.push(params.runId);
    }
    if (params.sdkSessionId) {
      clauses.push('sdk_session_id = ?');
      values.push(params.sdkSessionId);
    }
    if (params.source) {
      clauses.push('source = ?');
      values.push(params.source);
    }
    values.push(params.limit ?? 100, params.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM memory_influence_events
      ${where}
      ORDER BY ts DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...values) as MemoryInfluenceEventRow[];
    return rows.map(parseMemoryInfluenceEventRow);
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
    fileOwnership: Record<string, number>;
  } {
    const tools = this.countEventsBy('tool_events', 'status', since);
    const sessions = this.countEventsBy('session_events', 'event_type', since);
    const subagents = this.countEventsBy('subagent_events', 'event_type', since);
    const fileOwnership = this.countEventsBy('file_ownership_events', 'event_type', since);
    return { tools, sessions, subagents, fileOwnership };
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
      DELETE FROM agent_runs;
      DELETE FROM diagnostic_events;
      DELETE FROM route_decisions;
      DELETE FROM interrupt_events;
      DELETE FROM file_ownership_events;
    `);
  }

  close(): void {
    this.db.close();
  }
}

interface AgentRunRow {
  run_id: string;
  trace_id: string;
  started_at: number;
  updated_at: number;
  completed_at: number | null;
  agent_id: string;
  session_key: string;
  sdk_session_id: string | null;
  source: StoredAgentRunSource;
  channel: string;
  account_id: string | null;
  peer_id: string | null;
  thread_id: string | null;
  message_id: string | null;
  route_decision_id: string | null;
  status: StoredAgentRunStatus;
  model: string | null;
  budget_json: string;
  usage_json: string;
  error: string | null;
}

interface RouteDecisionRow {
  id: string;
  ts: number;
  message_id: string | null;
  channel: string;
  account_id: string;
  chat_type: string;
  peer_id: string;
  sender_id: string;
  thread_id: string | null;
  candidates_json: string;
  winner_agent_id: string | null;
  access_allowed: number | null;
  access_reason: string | null;
  queue_action: string | null;
  session_key: string | null;
  outcome: string;
}

interface InterruptEventRow {
  id: number;
  ts: number;
  agent_id: string | null;
  run_id: string | null;
  session_key: string | null;
  sdk_session_id: string | null;
  target_id: string;
  requested_by: string | null;
  result: 'interrupted' | 'failed';
  reason: string | null;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseRouteCandidates(value: string): StoredRouteDecisionCandidate[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as StoredRouteDecisionCandidate[] : [];
  } catch {
    return [];
  }
}

function parseAgentRunRow(row: AgentRunRow): StoredAgentRunRecord {
  return {
    runId: row.run_id,
    traceId: row.trace_id || row.run_id,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    agentId: row.agent_id,
    sessionKey: row.session_key,
    sdkSessionId: row.sdk_session_id ?? undefined,
    source: row.source,
    channel: row.channel,
    accountId: row.account_id ?? undefined,
    peerId: row.peer_id ?? undefined,
    threadId: row.thread_id ?? undefined,
    messageId: row.message_id ?? undefined,
    routeDecisionId: row.route_decision_id ?? undefined,
    status: row.status,
    model: row.model ?? undefined,
    budget: parseJsonObject(row.budget_json),
    usage: parseJsonObject(row.usage_json) as StoredAgentRunUsage,
    error: row.error ?? undefined,
  };
}

interface DiagnosticEventRow {
  id: number;
  ts: number;
  trace_id: string;
  run_id: string | null;
  agent_id: string | null;
  session_key: string | null;
  sdk_session_id: string | null;
  event_type: StoredDiagnosticEventType;
  detail_json: string;
}

interface FileOwnershipEventRow {
  id: number;
  ts: number;
  agent_id: string | null;
  session_key: string;
  run_id: string | null;
  subagent_id: string | null;
  path: string;
  event_type: StoredFileOwnershipEvent['eventType'];
  action: StoredFileOwnershipEvent['action'] | null;
  reason: string | null;
}

interface IntegrationAuditEventRow {
  id: number;
  ts: number;
  agent_id: string | null;
  session_key: string | null;
  run_id: string | null;
  sdk_session_id: string | null;
  tool_name: string;
  provider: string;
  capability_id: string;
  status: StoredIntegrationAuditEvent['status'];
  reason: string | null;
}

interface DirectWebhookDeliveryRow {
  id: number;
  ts: number;
  webhook: string;
  status: StoredDirectWebhookDelivery['status'];
  delivered: number;
  channel: string | null;
  account_id: string | null;
  peer_id: string | null;
  thread_id: string | null;
  message_id: string | null;
  error: string | null;
}

interface MemoryInfluenceEventRow {
  id: number;
  ts: number;
  agent_id: string | null;
  session_key: string | null;
  run_id: string | null;
  sdk_session_id: string | null;
  source: StoredMemoryInfluenceSource;
  query: string | null;
  refs_json: string;
}

function parseDiagnosticEventRow(row: DiagnosticEventRow): StoredDiagnosticEvent {
  return {
    id: row.id,
    timestamp: row.ts,
    traceId: row.trace_id,
    runId: row.run_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    sessionKey: row.session_key ?? undefined,
    sdkSessionId: row.sdk_session_id ?? undefined,
    eventType: row.event_type,
    detail: parseJsonObject(row.detail_json),
  };
}

function parseMemoryInfluenceEventRow(row: MemoryInfluenceEventRow): StoredMemoryInfluenceEvent {
  return {
    id: row.id,
    timestamp: row.ts,
    agentId: row.agent_id ?? undefined,
    sessionKey: row.session_key ?? undefined,
    runId: row.run_id ?? undefined,
    sdkSessionId: row.sdk_session_id ?? undefined,
    source: row.source,
    query: row.query ?? undefined,
    refs: parseMemoryInfluenceRefs(row.refs_json),
  };
}

function parseMemoryInfluenceRefs(value: string): StoredMemoryInfluenceRef[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as StoredMemoryInfluenceRef[] : [];
  } catch {
    return [];
  }
}

function parseRouteDecisionRow(row: RouteDecisionRow): StoredRouteDecision {
  return {
    id: row.id,
    timestamp: row.ts,
    messageId: row.message_id ?? undefined,
    channel: row.channel,
    accountId: row.account_id,
    chatType: row.chat_type,
    peerId: row.peer_id,
    senderId: row.sender_id,
    threadId: row.thread_id ?? undefined,
    candidates: parseRouteCandidates(row.candidates_json),
    winnerAgentId: row.winner_agent_id ?? undefined,
    accessAllowed: row.access_allowed === null ? undefined : row.access_allowed === 1,
    accessReason: row.access_reason ?? undefined,
    queueAction: row.queue_action ?? undefined,
    sessionKey: row.session_key ?? undefined,
    outcome: row.outcome,
  };
}

function parseInterruptEventRow(row: InterruptEventRow): StoredInterruptRecord {
  return {
    id: row.id,
    timestamp: row.ts,
    agentId: row.agent_id ?? undefined,
    runId: row.run_id ?? undefined,
    sessionKey: row.session_key ?? undefined,
    sdkSessionId: row.sdk_session_id ?? undefined,
    targetId: row.target_id,
    requestedBy: row.requested_by ?? undefined,
    result: row.result,
    reason: row.reason ?? undefined,
  };
}

function parseFileOwnershipEventRow(row: FileOwnershipEventRow): StoredFileOwnershipEvent {
  return {
    id: row.id,
    timestamp: row.ts,
    agentId: row.agent_id ?? undefined,
    sessionKey: row.session_key,
    runId: row.run_id ?? undefined,
    subagentId: row.subagent_id ?? undefined,
    path: row.path,
    eventType: row.event_type,
    action: row.action ?? undefined,
    reason: row.reason ?? undefined,
  };
}

function parseIntegrationAuditEventRow(row: IntegrationAuditEventRow): StoredIntegrationAuditEvent {
  return {
    id: row.id,
    timestamp: row.ts,
    agentId: row.agent_id ?? undefined,
    sessionKey: row.session_key ?? undefined,
    runId: row.run_id ?? undefined,
    sdkSessionId: row.sdk_session_id ?? undefined,
    toolName: row.tool_name,
    provider: row.provider,
    capabilityId: row.capability_id,
    status: row.status,
    reason: row.reason ?? undefined,
  };
}

function parseDirectWebhookDeliveryRow(row: DirectWebhookDeliveryRow): StoredDirectWebhookDelivery {
  return {
    id: row.id,
    timestamp: row.ts,
    webhook: row.webhook,
    status: row.status,
    delivered: row.delivered === 1,
    channel: row.channel ?? undefined,
    accountId: row.account_id ?? undefined,
    peerId: row.peer_id ?? undefined,
    threadId: row.thread_id ?? undefined,
    messageId: row.message_id ?? undefined,
    error: row.error ?? undefined,
  };
}
