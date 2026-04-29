import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type {
  CreateLearningActionParams,
  CreateLearningArtifactParams,
  CreateLearningReviewParams,
  CreateSkillSnapshotParams,
  LearningActionRecord,
  LearningActionStatus,
  LearningActionType,
  LearningArtifactRecord,
  LearningReviewRecord,
  LearningReviewStatus,
  SkillSnapshotRecord,
} from './types.js';

export class LearningStore {
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
      CREATE TABLE IF NOT EXISTS learning_reviews (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_key TEXT,
        run_id TEXT,
        trace_id TEXT,
        sdk_session_id TEXT,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        model TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        input_json TEXT NOT NULL,
        output_json TEXT NOT NULL,
        error TEXT,
        metadata_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS learning_actions (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES learning_reviews(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence REAL,
        title TEXT NOT NULL,
        rationale TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        applied_at INTEGER,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS learning_artifacts (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES learning_reviews(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        run_id TEXT,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        reason TEXT,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skill_snapshots (
        id TEXT PRIMARY KEY,
        action_id TEXT REFERENCES learning_actions(id) ON DELETE SET NULL,
        agent_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        body TEXT NOT NULL,
        reason TEXT,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_learning_reviews_agent_started
        ON learning_reviews(agent_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_learning_reviews_run
        ON learning_reviews(run_id);
      CREATE INDEX IF NOT EXISTS idx_learning_reviews_status_started
        ON learning_reviews(status, started_at);
      CREATE INDEX IF NOT EXISTS idx_learning_actions_review
        ON learning_actions(review_id);
      CREATE INDEX IF NOT EXISTS idx_learning_actions_agent_status
        ON learning_actions(agent_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_learning_actions_type_status
        ON learning_actions(action_type, status);
      CREATE INDEX IF NOT EXISTS idx_learning_artifacts_review
        ON learning_artifacts(review_id);
      CREATE INDEX IF NOT EXISTS idx_learning_artifacts_run
        ON learning_artifacts(run_id);
      CREATE INDEX IF NOT EXISTS idx_skill_snapshots_action
        ON skill_snapshots(action_id);
      CREATE INDEX IF NOT EXISTS idx_skill_snapshots_agent_skill
        ON skill_snapshots(agent_id, skill_name, created_at);
    `);
  }

  createReview(params: CreateLearningReviewParams): LearningReviewRecord {
    const startedAt = params.startedAt ?? Date.now();
    const id = params.id ?? randomUUID();
    this.db.prepare(`
      INSERT INTO learning_reviews(
        id, agent_id, session_key, run_id, trace_id, sdk_session_id,
        trigger, status, mode, model, started_at, completed_at,
        input_json, output_json, error, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, NULL, ?, ?, NULL, ?)
    `).run(
      id,
      params.agentId,
      params.sessionKey ?? null,
      params.runId ?? null,
      params.traceId ?? null,
      params.sdkSessionId ?? null,
      params.trigger,
      params.mode,
      params.model ?? null,
      startedAt,
      JSON.stringify(params.input ?? {}),
      JSON.stringify({}),
      JSON.stringify(params.metadata ?? {}),
    );
    return this.getReview(id) as LearningReviewRecord;
  }

  completeReview(
    reviewId: string,
    params: {
      status?: Exclude<LearningReviewStatus, 'running'>;
      completedAt?: number;
      output?: Record<string, unknown>;
      error?: string;
    } = {},
  ): boolean {
    const result = this.db.prepare(`
      UPDATE learning_reviews
      SET status = ?, completed_at = ?, output_json = ?, error = ?
      WHERE id = ?
    `).run(
      params.status ?? (params.error ? 'failed' : 'completed'),
      params.completedAt ?? Date.now(),
      JSON.stringify(params.output ?? {}),
      params.error ?? null,
      reviewId,
    );
    return result.changes > 0;
  }

  getReview(reviewId: string): LearningReviewRecord | null {
    const row = this.db.prepare('SELECT * FROM learning_reviews WHERE id = ?')
      .get(reviewId) as LearningReviewRow | undefined;
    return row ? rowToReview(row) : null;
  }

  listReviews(params: {
    agentId?: string;
    runId?: string;
    status?: LearningReviewStatus;
    limit?: number;
    offset?: number;
  } = {}): LearningReviewRecord[] {
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
    if (params.status) {
      clauses.push('status = ?');
      values.push(params.status);
    }
    values.push(params.limit ?? 100, params.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM learning_reviews
      ${where}
      ORDER BY started_at DESC, id ASC
      LIMIT ? OFFSET ?
    `).all(...values) as LearningReviewRow[];
    return rows.map(rowToReview);
  }

  addAction(params: CreateLearningActionParams): LearningActionRecord {
    const now = params.createdAt ?? Date.now();
    const id = params.id ?? randomUUID();
    this.db.prepare(`
      INSERT INTO learning_actions(
        id, review_id, agent_id, action_type, status, confidence,
        title, rationale, payload_json, created_at, updated_at, applied_at, error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      id,
      params.reviewId,
      params.agentId,
      params.actionType,
      params.status ?? 'proposed',
      params.confidence ?? null,
      params.title ?? '',
      params.rationale ?? '',
      JSON.stringify(params.payload ?? {}),
      now,
      now,
    );
    return this.getAction(id) as LearningActionRecord;
  }

  getAction(actionId: string): LearningActionRecord | null {
    const row = this.db.prepare('SELECT * FROM learning_actions WHERE id = ?')
      .get(actionId) as LearningActionRow | undefined;
    return row ? rowToAction(row) : null;
  }

  updateActionStatus(
    actionId: string,
    status: LearningActionStatus,
    params: { updatedAt?: number; appliedAt?: number; error?: string } = {},
  ): boolean {
    const result = this.db.prepare(`
      UPDATE learning_actions
      SET status = ?, updated_at = ?, applied_at = ?, error = ?
      WHERE id = ?
    `).run(
      status,
      params.updatedAt ?? Date.now(),
      params.appliedAt ?? (status === 'applied' ? Date.now() : null),
      params.error ?? null,
      actionId,
    );
    return result.changes > 0;
  }

  listActions(params: {
    reviewId?: string;
    agentId?: string;
    actionType?: LearningActionType;
    status?: LearningActionStatus;
    limit?: number;
    offset?: number;
  } = {}): LearningActionRecord[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.reviewId) {
      clauses.push('review_id = ?');
      values.push(params.reviewId);
    }
    if (params.agentId) {
      clauses.push('agent_id = ?');
      values.push(params.agentId);
    }
    if (params.actionType) {
      clauses.push('action_type = ?');
      values.push(params.actionType);
    }
    if (params.status) {
      clauses.push('status = ?');
      values.push(params.status);
    }
    values.push(params.limit ?? 100, params.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM learning_actions
      ${where}
      ORDER BY created_at DESC, id ASC
      LIMIT ? OFFSET ?
    `).all(...values) as LearningActionRow[];
    return rows.map(rowToAction);
  }

  addArtifact(params: CreateLearningArtifactParams): LearningArtifactRecord {
    const id = params.id ?? randomUUID();
    this.db.prepare(`
      INSERT INTO learning_artifacts(
        id, review_id, agent_id, run_id, kind, path, content_hash,
        size_bytes, reason, metadata_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.reviewId,
      params.agentId,
      params.runId ?? null,
      params.kind,
      params.path,
      params.contentHash,
      params.sizeBytes,
      params.reason ?? null,
      JSON.stringify(params.metadata ?? {}),
      params.createdAt ?? Date.now(),
    );
    return this.getArtifact(id) as LearningArtifactRecord;
  }

  getArtifact(artifactId: string): LearningArtifactRecord | null {
    const row = this.db.prepare('SELECT * FROM learning_artifacts WHERE id = ?')
      .get(artifactId) as LearningArtifactRow | undefined;
    return row ? rowToArtifact(row) : null;
  }

  listArtifacts(params: { reviewId?: string; runId?: string; limit?: number; offset?: number } = {}): LearningArtifactRecord[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.reviewId) {
      clauses.push('review_id = ?');
      values.push(params.reviewId);
    }
    if (params.runId) {
      clauses.push('run_id = ?');
      values.push(params.runId);
    }
    values.push(params.limit ?? 100, params.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM learning_artifacts
      ${where}
      ORDER BY created_at DESC, id ASC
      LIMIT ? OFFSET ?
    `).all(...values) as LearningArtifactRow[];
    return rows.map(rowToArtifact);
  }

  addSkillSnapshot(params: CreateSkillSnapshotParams): SkillSnapshotRecord {
    const id = params.id ?? randomUUID();
    this.db.prepare(`
      INSERT INTO skill_snapshots(
        id, action_id, agent_id, skill_name, path, content_hash,
        body, reason, metadata_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.actionId ?? null,
      params.agentId,
      params.skillName,
      params.path,
      params.contentHash,
      params.body,
      params.reason ?? null,
      JSON.stringify(params.metadata ?? {}),
      params.createdAt ?? Date.now(),
    );
    return this.getSkillSnapshot(id) as SkillSnapshotRecord;
  }

  getSkillSnapshot(snapshotId: string): SkillSnapshotRecord | null {
    const row = this.db.prepare('SELECT * FROM skill_snapshots WHERE id = ?')
      .get(snapshotId) as SkillSnapshotRow | undefined;
    return row ? rowToSkillSnapshot(row) : null;
  }

  listSkillSnapshots(params: {
    actionId?: string;
    agentId?: string;
    skillName?: string;
    limit?: number;
    offset?: number;
  } = {}): SkillSnapshotRecord[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.actionId) {
      clauses.push('action_id = ?');
      values.push(params.actionId);
    }
    if (params.agentId) {
      clauses.push('agent_id = ?');
      values.push(params.agentId);
    }
    if (params.skillName) {
      clauses.push('skill_name = ?');
      values.push(params.skillName);
    }
    values.push(params.limit ?? 100, params.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM skill_snapshots
      ${where}
      ORDER BY created_at DESC, id ASC
      LIMIT ? OFFSET ?
    `).all(...values) as SkillSnapshotRow[];
    return rows.map(rowToSkillSnapshot);
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
}

interface LearningReviewRow {
  id: string;
  agent_id: string;
  session_key: string | null;
  run_id: string | null;
  trace_id: string | null;
  sdk_session_id: string | null;
  trigger: string;
  status: LearningReviewStatus;
  mode: 'off' | 'propose' | 'auto_private';
  model: string | null;
  started_at: number;
  completed_at: number | null;
  input_json: string;
  output_json: string;
  error: string | null;
  metadata_json: string;
}

interface LearningActionRow {
  id: string;
  review_id: string;
  agent_id: string;
  action_type: LearningActionType;
  status: LearningActionStatus;
  confidence: number | null;
  title: string;
  rationale: string;
  payload_json: string;
  created_at: number;
  updated_at: number;
  applied_at: number | null;
  error: string | null;
}

interface LearningArtifactRow {
  id: string;
  review_id: string;
  agent_id: string;
  run_id: string | null;
  kind: string;
  path: string;
  content_hash: string;
  size_bytes: number;
  reason: string | null;
  metadata_json: string;
  created_at: number;
}

interface SkillSnapshotRow {
  id: string;
  action_id: string | null;
  agent_id: string;
  skill_name: string;
  path: string;
  content_hash: string;
  body: string;
  reason: string | null;
  metadata_json: string;
  created_at: number;
}

function rowToReview(row: LearningReviewRow): LearningReviewRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    sessionKey: row.session_key ?? undefined,
    runId: row.run_id ?? undefined,
    traceId: row.trace_id ?? undefined,
    sdkSessionId: row.sdk_session_id ?? undefined,
    trigger: row.trigger,
    status: row.status,
    mode: row.mode,
    model: row.model ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    input: parseJsonObject(row.input_json),
    output: parseJsonObject(row.output_json),
    error: row.error ?? undefined,
    metadata: parseJsonObject(row.metadata_json),
  };
}

function rowToAction(row: LearningActionRow): LearningActionRecord {
  return {
    id: row.id,
    reviewId: row.review_id,
    agentId: row.agent_id,
    actionType: row.action_type,
    status: row.status,
    confidence: row.confidence ?? undefined,
    title: row.title,
    rationale: row.rationale,
    payload: parseJsonObject(row.payload_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedAt: row.applied_at ?? undefined,
    error: row.error ?? undefined,
  };
}

function rowToArtifact(row: LearningArtifactRow): LearningArtifactRecord {
  return {
    id: row.id,
    reviewId: row.review_id,
    agentId: row.agent_id,
    runId: row.run_id ?? undefined,
    kind: row.kind,
    path: row.path,
    contentHash: row.content_hash,
    sizeBytes: row.size_bytes,
    reason: row.reason ?? undefined,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
  };
}

function rowToSkillSnapshot(row: SkillSnapshotRow): SkillSnapshotRecord {
  return {
    id: row.id,
    actionId: row.action_id ?? undefined,
    agentId: row.agent_id,
    skillName: row.skill_name,
    path: row.path,
    contentHash: row.content_hash,
    body: row.body,
    reason: row.reason ?? undefined,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
  };
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
