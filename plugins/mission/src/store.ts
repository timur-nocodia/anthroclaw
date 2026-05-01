import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { MissionConfig } from './config.js';

export type MissionMode = 'lightweight' | 'lifecycle' | 'operations' | 'custom';
export type MissionPhase = 'define' | 'design' | 'build' | 'verify' | 'ship';
export type MissionStatus = 'active' | 'archived';
export type ObjectiveStatus = 'active' | 'validated' | 'rejected';
export type DecisionStatus = 'pending' | 'good' | 'revisit';

export interface MissionRow {
  id: string;
  agent_id: string;
  title: string;
  goal: string;
  mode: MissionMode;
  phase: MissionPhase;
  status: MissionStatus;
  current_state: string;
  next_actions_json: string;
  metadata_json: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

export interface ObjectiveRow {
  id: string;
  mission_id: string;
  content: string;
  status: ObjectiveStatus;
  rationale: string | null;
  created_at: number;
  updated_at: number;
}

export interface DecisionRow {
  id: string;
  mission_id: string;
  decision: string;
  rationale: string;
  outcome: string | null;
  status: DecisionStatus;
  created_at: number;
  updated_at: number;
}

export interface HandoffRow {
  id: string;
  mission_id: string;
  session_key: string | null;
  summary: string;
  next_actions_json: string;
  metadata_json: string;
  created_at: number;
}

export interface EventRow {
  id: number;
  mission_id: string | null;
  kind: string;
  payload_json: string;
  created_at: number;
}

export interface MissionSnapshot {
  mission: MissionRow;
  nextActions: string[];
  metadata: Record<string, unknown>;
  objectives: ObjectiveRow[];
  decisions: DecisionRow[];
  recentHandoffs: Array<HandoffRow & { nextActions: string[]; metadata: Record<string, unknown> }>;
  recentEvents: Array<EventRow & { payload: Record<string, unknown> }>;
}

function now(): number {
  return Date.now();
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function parseStringArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export interface CreateMissionInput {
  agentId: string;
  title: string;
  goal: string;
  mode: MissionMode;
  phase?: MissionPhase;
  currentState?: string;
  nextActions?: string[];
  metadata?: Record<string, unknown>;
}

export class MissionStore {
  constructor(private readonly db: Database) {}

  createMission(input: CreateMissionInput): MissionSnapshot {
    const ts = now();
    const missionId = id('mission');
    const phase = input.phase ?? 'define';
    const currentState = input.currentState ?? '';
    const nextActions = input.nextActions ?? [];
    const metadata = input.metadata ?? {};

    const create = this.db.transaction(() => {
      const existingActive = this.db.prepare(`
        SELECT id FROM missions
        WHERE agent_id = ? AND status = 'active'
      `).all(input.agentId) as Array<{ id: string }>;
      for (const existing of existingActive) {
        this.db.prepare(`
          UPDATE missions SET status = 'archived', archived_at = ?, updated_at = ?
          WHERE id = ? AND status = 'active'
        `).run(ts, ts, existing.id);
        this.appendEvent(existing.id, 'mission_archived', {
          reason: 'superseded_by_new_mission',
          supersededBy: missionId,
        }, ts);
      }

      this.db.prepare(`
        INSERT INTO missions(
          id, agent_id, title, goal, mode, phase, status, current_state,
          next_actions_json, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
      `).run(
        missionId,
        input.agentId,
        input.title,
        input.goal,
        input.mode,
        phase,
        currentState,
        json(nextActions),
        json(metadata),
        ts,
        ts,
      );
      this.appendEvent(missionId, 'mission_created', {
        agentId: input.agentId,
        title: input.title,
        goal: input.goal,
        mode: input.mode,
        phase,
      }, ts);
    });

    create();
    const snapshot = this.getMissionSnapshot(missionId);
    if (!snapshot) throw new Error(`mission ${missionId} was not created`);
    return snapshot;
  }

  getActiveMission(agentId: string): MissionSnapshot | null {
    const row = this.db.prepare(`
      SELECT * FROM missions
      WHERE agent_id = ? AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(agentId) as MissionRow | undefined;
    return row ? this.getMissionSnapshot(row.id) : null;
  }

  getMissionSnapshot(missionId: string): MissionSnapshot | null {
    const mission = this.db.prepare(`SELECT * FROM missions WHERE id = ?`).get(missionId) as MissionRow | undefined;
    if (!mission) return null;

    const objectives = this.db.prepare(`
      SELECT * FROM objectives WHERE mission_id = ?
      ORDER BY status = 'active' DESC, updated_at DESC
    `).all(missionId) as ObjectiveRow[];

    const decisions = this.db.prepare(`
      SELECT * FROM decisions WHERE mission_id = ?
      ORDER BY updated_at DESC
      LIMIT 20
    `).all(missionId) as DecisionRow[];

    const handoffRows = this.db.prepare(`
      SELECT * FROM handoffs WHERE mission_id = ?
      ORDER BY created_at DESC
      LIMIT 5
    `).all(missionId) as HandoffRow[];

    const eventRows = this.db.prepare(`
      SELECT * FROM events WHERE mission_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(missionId) as EventRow[];

    return {
      mission,
      nextActions: parseStringArray(mission.next_actions_json),
      metadata: parseObject(mission.metadata_json),
      objectives,
      decisions,
      recentHandoffs: handoffRows.map((row) => ({
        ...row,
        nextActions: parseStringArray(row.next_actions_json),
        metadata: parseObject(row.metadata_json),
      })),
      recentEvents: eventRows.map((row) => ({
        ...row,
        payload: parseObject(row.payload_json),
      })),
    };
  }

  updateState(missionId: string, currentState: string, nextActions: string[] = []): MissionSnapshot {
    const ts = now();
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE missions
        SET current_state = ?, next_actions_json = ?, updated_at = ?
        WHERE id = ? AND status = 'active'
      `).run(currentState, json(nextActions), ts, missionId);
      this.appendEvent(missionId, 'mission_state_updated', { currentState, nextActions }, ts);
    })();
    return this.requireSnapshot(missionId);
  }

  transitionPhase(missionId: string, phase: MissionPhase, note = ''): MissionSnapshot {
    const ts = now();
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE missions SET phase = ?, updated_at = ?
        WHERE id = ? AND status = 'active'
      `).run(phase, ts, missionId);
      this.appendEvent(missionId, 'mission_phase_transitioned', { phase, note }, ts);
    })();
    return this.requireSnapshot(missionId);
  }

  archiveMission(missionId: string, reason = ''): MissionSnapshot {
    const ts = now();
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE missions SET status = 'archived', archived_at = ?, updated_at = ?
        WHERE id = ? AND status = 'active'
      `).run(ts, ts, missionId);
      this.appendEvent(missionId, 'mission_archived', { reason }, ts);
    })();
    return this.requireSnapshot(missionId);
  }

  addObjective(missionId: string, content: string, rationale = ''): ObjectiveRow {
    const ts = now();
    const objectiveId = id('objective');
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO objectives(id, mission_id, content, status, rationale, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?)
      `).run(objectiveId, missionId, content, rationale || null, ts, ts);
      this.touchMission(missionId, ts);
      this.appendEvent(missionId, 'objective_added', { objectiveId, content, rationale }, ts);
    })();
    return this.db.prepare(`SELECT * FROM objectives WHERE id = ?`).get(objectiveId) as ObjectiveRow;
  }

  setObjectiveStatus(objectiveId: string, status: ObjectiveStatus, rationale = ''): ObjectiveRow {
    const ts = now();
    const row = this.db.prepare(`SELECT * FROM objectives WHERE id = ?`).get(objectiveId) as ObjectiveRow | undefined;
    if (!row) throw new Error(`objective not found: ${objectiveId}`);
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE objectives SET status = ?, rationale = COALESCE(NULLIF(?, ''), rationale), updated_at = ?
        WHERE id = ?
      `).run(status, rationale, ts, objectiveId);
      this.touchMission(row.mission_id, ts);
      this.appendEvent(row.mission_id, `objective_${status}`, { objectiveId, rationale }, ts);
    })();
    return this.db.prepare(`SELECT * FROM objectives WHERE id = ?`).get(objectiveId) as ObjectiveRow;
  }

  addDecision(
    missionId: string,
    decision: string,
    rationale = '',
    status: DecisionStatus = 'pending',
    outcome?: string,
  ): DecisionRow {
    const ts = now();
    const decisionId = id('decision');
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO decisions(id, mission_id, decision, rationale, outcome, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(decisionId, missionId, decision, rationale, outcome ?? null, status, ts, ts);
      this.touchMission(missionId, ts);
      this.appendEvent(missionId, 'decision_added', { decisionId, decision, rationale, status, outcome }, ts);
    })();
    return this.db.prepare(`SELECT * FROM decisions WHERE id = ?`).get(decisionId) as DecisionRow;
  }

  wrapSession(
    missionId: string,
    sessionKey: string | null,
    summary: string,
    nextActions: string[] = [],
    metadata: Record<string, unknown> = {},
  ): HandoffRow {
    const ts = now();
    const handoffId = id('handoff');
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO handoffs(id, mission_id, session_key, summary, next_actions_json, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(handoffId, missionId, sessionKey, summary, json(nextActions), json(metadata), ts);
      this.db.prepare(`
        UPDATE missions SET current_state = ?, next_actions_json = ?, updated_at = ?
        WHERE id = ? AND status = 'active'
      `).run(summary, json(nextActions), ts, missionId);
      this.appendEvent(missionId, 'session_wrapped', { handoffId, sessionKey, summary, nextActions, metadata }, ts);
    })();
    return this.db.prepare(`SELECT * FROM handoffs WHERE id = ?`).get(handoffId) as HandoffRow;
  }

  private requireSnapshot(missionId: string): MissionSnapshot {
    const snapshot = this.getMissionSnapshot(missionId);
    if (!snapshot) throw new Error(`mission not found: ${missionId}`);
    return snapshot;
  }

  private touchMission(missionId: string, ts: number): void {
    this.db.prepare(`UPDATE missions SET updated_at = ? WHERE id = ?`).run(ts, missionId);
  }

  private appendEvent(missionId: string | null, kind: string, payload: Record<string, unknown>, ts = now()): void {
    this.db.prepare(`
      INSERT INTO events(mission_id, kind, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(missionId, kind, json(payload), ts);
  }
}

export function missionIdFromSnapshot(snapshot: MissionSnapshot | null): string | null {
  return snapshot?.mission.id ?? null;
}

export function resolveMissionMode(config: MissionConfig, explicit?: MissionMode): MissionMode {
  return explicit ?? config.mode;
}
