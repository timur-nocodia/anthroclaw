import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type {
  CreateDecisionParams,
  DecisionActor,
  DecisionAuditEvent,
  DecisionChannel,
  DecisionDeliveryRecord,
  DecisionRecord,
  DecisionStatus,
} from './types.js';

export class DecisionStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        short_code TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        scope TEXT NOT NULL,
        actor TEXT NOT NULL,
        status TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        learning_action_id TEXT,
        review_id TEXT,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        risk TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        origin_channel TEXT,
        origin_account_id TEXT,
        origin_peer_id TEXT,
        origin_sender_id TEXT,
        origin_thread_id TEXT,
        origin_message_id TEXT,
        delivery_json TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        decided_at INTEGER,
        decided_by TEXT,
        applied_at INTEGER,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS decision_audit_events (
        id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
        from_status TEXT,
        to_status TEXT NOT NULL,
        actor_sender_id TEXT,
        channel TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL,
        metadata_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS decision_deliveries (
        id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        account_id TEXT,
        peer_id TEXT,
        message_id TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_decisions_short_code
        ON decisions(short_code);
      CREATE INDEX IF NOT EXISTS idx_decisions_agent_status
        ON decisions(agent_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_decisions_origin_pending
        ON decisions(status, actor, origin_channel, origin_account_id, origin_peer_id, origin_sender_id, origin_thread_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_active_learning_action
        ON decisions(learning_action_id)
        WHERE learning_action_id IS NOT NULL AND status IN ('pending', 'approved');
      CREATE INDEX IF NOT EXISTS idx_decision_audit_decision
        ON decision_audit_events(decision_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_decision_deliveries_decision
        ON decision_deliveries(decision_id);
    `);
  }

  createDecision(params: CreateDecisionParams): DecisionRecord {
    if (params.learningActionId) {
      const active = this.getActiveDecisionForLearningAction(params.learningActionId);
      if (active) return active;
    }

    const id = params.id ?? randomUUID();
    const now = params.createdAt ?? Date.now();
    const shortCode = (params.shortCode ?? this.generateShortCode()).toUpperCase();
    const status = params.status ?? 'pending';
    this.db.prepare(`
      INSERT INTO decisions(
        id, short_code, kind, scope, actor, status, agent_id,
        learning_action_id, review_id, subject, body, risk, payload_json,
        origin_channel, origin_account_id, origin_peer_id, origin_sender_id,
        origin_thread_id, origin_message_id, delivery_json, expires_at,
        created_at, updated_at, decided_at, decided_by, applied_at, error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
    `).run(
      id,
      shortCode,
      params.kind,
      params.scope,
      params.actor,
      status,
      params.agentId,
      params.learningActionId ?? null,
      params.reviewId ?? null,
      params.subject,
      params.body,
      params.risk,
      JSON.stringify(params.payload ?? {}),
      params.originChannel ?? null,
      params.originAccountId ?? null,
      params.originPeerId ?? null,
      params.originSenderId ?? null,
      params.originThreadId ?? null,
      params.originMessageId ?? null,
      JSON.stringify(params.delivery ?? []),
      params.expiresAt ?? null,
      now,
      now,
    );
    this.addAuditEvent({
      decisionId: id,
      toStatus: status,
      reason: 'created',
      createdAt: now,
    });
    return this.getDecision(id) as DecisionRecord;
  }

  getDecision(decisionId: string): DecisionRecord | null {
    const row = this.db.prepare('SELECT * FROM decisions WHERE id = ?')
      .get(decisionId) as DecisionRow | undefined;
    return row ? rowToDecision(row) : null;
  }

  getDecisionByShortCode(shortCode: string): DecisionRecord | null {
    const row = this.db.prepare('SELECT * FROM decisions WHERE UPPER(short_code) = ?')
      .get(shortCode.toUpperCase()) as DecisionRow | undefined;
    return row ? rowToDecision(row) : null;
  }

  getActiveDecisionForLearningAction(learningActionId: string): DecisionRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM decisions
      WHERE learning_action_id = ?
        AND status IN ('pending', 'approved')
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `).get(learningActionId) as DecisionRow | undefined;
    return row ? rowToDecision(row) : null;
  }

  updateDecisionStatus(
    decisionId: string,
    status: DecisionStatus,
    params: {
      updatedAt?: number;
      decidedAt?: number;
      decidedBy?: string;
      appliedAt?: number;
      error?: string;
      actorSenderId?: string;
      channel?: DecisionChannel;
      reason?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): DecisionRecord | null {
    const current = this.getDecision(decisionId);
    if (!current) return null;
    if (!isValidStatusTransition(current.status, status)) return null;
    const now = params.updatedAt ?? Date.now();
    const decidedAt = params.decidedAt ?? (isDecidedStatus(status) ? now : current.decidedAt);
    const appliedAt = params.appliedAt ?? (status === 'applied' ? now : current.appliedAt);
    this.db.prepare(`
      UPDATE decisions
      SET status = ?, updated_at = ?, decided_at = ?, decided_by = ?, applied_at = ?, error = ?
      WHERE id = ?
    `).run(
      status,
      now,
      decidedAt ?? null,
      params.decidedBy ?? current.decidedBy ?? null,
      appliedAt ?? null,
      params.error ?? null,
      decisionId,
    );
    this.addAuditEvent({
      decisionId,
      fromStatus: current.status,
      toStatus: status,
      actorSenderId: params.actorSenderId,
      channel: params.channel,
      reason: params.reason,
      createdAt: now,
      metadata: params.metadata,
    });
    return this.getDecision(decisionId);
  }

  listPendingForOrigin(params: {
    actor?: DecisionActor;
    channel: DecisionChannel;
    accountId: string;
    peerId: string;
    senderId: string;
    threadId?: string;
    now?: number;
    limit?: number;
  }): DecisionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM decisions
      WHERE status = 'pending'
        AND actor = ?
        AND origin_channel = ?
        AND origin_account_id = ?
        AND origin_peer_id = ?
        AND origin_sender_id = ?
        AND (origin_thread_id IS NULL OR origin_thread_id = ?)
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC, id ASC
      LIMIT ?
    `).all(
      params.actor ?? 'originating_user',
      params.channel,
      params.accountId,
      params.peerId,
      params.senderId,
      params.threadId ?? null,
      params.now ?? Date.now(),
      params.limit ?? 10,
    ) as DecisionRow[];
    return rows.map(rowToDecision);
  }

  listDecisions(params: {
    agentId?: string;
    status?: DecisionStatus;
    kind?: DecisionRecord['kind'];
    actor?: DecisionActor;
    scope?: DecisionRecord['scope'];
    limit?: number;
    offset?: number;
  } = {}): DecisionRecord[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.agentId) {
      clauses.push('agent_id = ?');
      values.push(params.agentId);
    }
    if (params.status) {
      clauses.push('status = ?');
      values.push(params.status);
    }
    if (params.kind) {
      clauses.push('kind = ?');
      values.push(params.kind);
    }
    if (params.actor) {
      clauses.push('actor = ?');
      values.push(params.actor);
    }
    if (params.scope) {
      clauses.push('scope = ?');
      values.push(params.scope);
    }
    values.push(params.limit ?? 100, params.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM decisions
      ${where}
      ORDER BY created_at DESC, id ASC
      LIMIT ? OFFSET ?
    `).all(...values) as DecisionRow[];
    return rows.map(rowToDecision);
  }

  recordDelivery(
    decisionId: string,
    params: Omit<DecisionDeliveryRecord, 'id' | 'decisionId' | 'updatedAt'> & { updatedAt?: number },
  ): DecisionDeliveryRecord {
    const id = randomUUID();
    const createdAt = params.createdAt ?? Date.now();
    const updatedAt = params.updatedAt ?? createdAt;
    this.db.prepare(`
      INSERT INTO decision_deliveries(
        id, decision_id, channel, account_id, peer_id, message_id,
        status, error, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      decisionId,
      params.channel,
      params.accountId ?? null,
      params.peerId ?? null,
      params.messageId ?? null,
      params.status,
      params.error ?? null,
      createdAt,
      updatedAt,
    );
    const deliveries = this.listDeliveries(decisionId);
    this.db.prepare('UPDATE decisions SET delivery_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(deliveries), updatedAt, decisionId);
    return deliveries.find((delivery) => delivery.id === id) as DecisionDeliveryRecord;
  }

  listDeliveries(decisionId: string): DecisionDeliveryRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM decision_deliveries
      WHERE decision_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(decisionId) as DecisionDeliveryRow[];
    return rows.map(rowToDelivery);
  }

  listAuditEvents(decisionId: string): DecisionAuditEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM decision_audit_events
      WHERE decision_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(decisionId) as DecisionAuditRow[];
    return rows.map(rowToAuditEvent);
  }

  listTables(): string[] {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') ORDER BY name")
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  close(): void {
    this.db.close();
  }

  private addAuditEvent(params: {
    decisionId: string;
    fromStatus?: DecisionStatus;
    toStatus: DecisionStatus;
    actorSenderId?: string;
    channel?: DecisionChannel;
    reason?: string;
    createdAt?: number;
    metadata?: Record<string, unknown>;
  }): void {
    this.db.prepare(`
      INSERT INTO decision_audit_events(
        id, decision_id, from_status, to_status, actor_sender_id,
        channel, reason, created_at, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      params.decisionId,
      params.fromStatus ?? null,
      params.toStatus,
      params.actorSenderId ?? null,
      params.channel ?? null,
      params.reason ?? null,
      params.createdAt ?? Date.now(),
      JSON.stringify(params.metadata ?? {}),
    );
  }

  private generateShortCode(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const shortCode = randomBytes(4).toString('hex').toUpperCase();
      if (!this.getDecisionByShortCode(shortCode)) return shortCode;
    }
    return randomUUID().slice(0, 8).toUpperCase();
  }
}

interface DecisionRow {
  id: string;
  short_code: string;
  kind: DecisionRecord['kind'];
  scope: DecisionRecord['scope'];
  actor: DecisionRecord['actor'];
  status: DecisionRecord['status'];
  agent_id: string;
  learning_action_id: string | null;
  review_id: string | null;
  subject: string;
  body: string;
  risk: DecisionRecord['risk'];
  payload_json: string;
  origin_channel: string | null;
  origin_account_id: string | null;
  origin_peer_id: string | null;
  origin_sender_id: string | null;
  origin_thread_id: string | null;
  origin_message_id: string | null;
  delivery_json: string;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
  decided_at: number | null;
  decided_by: string | null;
  applied_at: number | null;
  error: string | null;
}

interface DecisionAuditRow {
  id: string;
  decision_id: string;
  from_status: DecisionStatus | null;
  to_status: DecisionStatus;
  actor_sender_id: string | null;
  channel: string | null;
  reason: string | null;
  created_at: number;
  metadata_json: string;
}

interface DecisionDeliveryRow {
  id: string;
  decision_id: string;
  channel: string;
  account_id: string | null;
  peer_id: string | null;
  message_id: string | null;
  status: DecisionDeliveryRecord['status'];
  error: string | null;
  created_at: number;
  updated_at: number;
}

function rowToDecision(row: DecisionRow): DecisionRecord {
  return {
    id: row.id,
    shortCode: row.short_code,
    kind: row.kind,
    scope: row.scope,
    actor: row.actor,
    status: row.status,
    agentId: row.agent_id,
    learningActionId: row.learning_action_id ?? undefined,
    reviewId: row.review_id ?? undefined,
    subject: row.subject,
    body: row.body,
    risk: row.risk,
    payload: parseJsonObject(row.payload_json),
    originChannel: row.origin_channel as DecisionChannel | null ?? undefined,
    originAccountId: row.origin_account_id ?? undefined,
    originPeerId: row.origin_peer_id ?? undefined,
    originSenderId: row.origin_sender_id ?? undefined,
    originThreadId: row.origin_thread_id ?? undefined,
    originMessageId: row.origin_message_id ?? undefined,
    delivery: parseJsonArray(row.delivery_json),
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at ?? undefined,
    decidedBy: row.decided_by ?? undefined,
    appliedAt: row.applied_at ?? undefined,
    error: row.error ?? undefined,
  };
}

function rowToAuditEvent(row: DecisionAuditRow): DecisionAuditEvent {
  return {
    id: row.id,
    decisionId: row.decision_id,
    fromStatus: row.from_status ?? undefined,
    toStatus: row.to_status,
    actorSenderId: row.actor_sender_id ?? undefined,
    channel: row.channel as DecisionChannel | null ?? undefined,
    reason: row.reason ?? undefined,
    createdAt: row.created_at,
    metadata: parseJsonObject(row.metadata_json),
  };
}

function rowToDelivery(row: DecisionDeliveryRow): DecisionDeliveryRecord {
  return {
    id: row.id,
    decisionId: row.decision_id,
    channel: row.channel as DecisionChannel,
    accountId: row.account_id ?? undefined,
    peerId: row.peer_id ?? undefined,
    messageId: row.message_id ?? undefined,
    status: row.status,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function parseJsonArray(raw: string): DecisionDeliveryRecord[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as DecisionDeliveryRecord[];
}

function isDecidedStatus(status: DecisionStatus): boolean {
  return status === 'approved'
    || status === 'rejected'
    || status === 'edit_requested'
    || status === 'expired';
}

function isValidStatusTransition(from: DecisionStatus, to: DecisionStatus): boolean {
  if (from === to) return false;
  switch (from) {
    case 'pending':
      return to === 'approved'
        || to === 'rejected'
        || to === 'edit_requested'
        || to === 'expired'
        || to === 'failed';
    case 'approved':
      return to === 'applied' || to === 'failed';
    default:
      return false;
  }
}
