import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../src/db/bootstrap.js';
import { MissionStore } from '../src/store.js';

describe('MissionStore', () => {
  let tmp: string;
  let db: InstanceType<typeof Database>;
  let store: MissionStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mission-store-'));
    db = new Database(join(tmp, 'mission.sqlite'));
    bootstrap(db);
    store = new MissionStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('creates and reads active mission snapshots', () => {
    const snapshot = store.createMission({
      agentId: 'agent-1',
      title: 'Release 0.6',
      goal: 'Ship Mission State',
      mode: 'lightweight',
      currentState: 'Research complete',
      nextActions: ['scaffold plugin'],
    });

    expect(snapshot.mission.title).toBe('Release 0.6');
    expect(snapshot.nextActions).toEqual(['scaffold plugin']);
    expect(store.getActiveMission('agent-1')?.mission.id).toBe(snapshot.mission.id);
  });

  it('records objectives, decisions, and session handoffs', () => {
    const snapshot = store.createMission({
      agentId: 'agent-1',
      title: 'Ops monitor',
      goal: 'Track recurring operations',
      mode: 'operations',
    });

    const objective = store.addObjective(snapshot.mission.id, 'Watch error budget', 'recurring SLO responsibility');
    const validated = store.setObjectiveStatus(objective.id, 'validated', 'dashboard exists');
    const decision = store.addDecision(snapshot.mission.id, 'Use SQLite canonical store', 'UI and tools need structured state', 'good');
    const handoff = store.wrapSession(snapshot.mission.id, 'session-1', 'Store MVP finished', ['add tools'], { tests: 3 });
    const updated = store.getMissionSnapshot(snapshot.mission.id)!;

    expect(validated.status).toBe('validated');
    expect(decision.status).toBe('good');
    expect(handoff.summary).toBe('Store MVP finished');
    expect(updated.mission.current_state).toBe('Store MVP finished');
    expect(updated.nextActions).toEqual(['add tools']);
    expect(updated.objectives[0].status).toBe('validated');
    expect(updated.decisions[0].decision).toBe('Use SQLite canonical store');
    expect(updated.recentEvents.some((event) => event.kind === 'session_wrapped')).toBe(true);
  });

  it('archives without deleting mission data', () => {
    const snapshot = store.createMission({
      agentId: 'agent-1',
      title: 'Temporary mission',
      goal: 'Demonstrate archive',
      mode: 'lightweight',
    });

    const archived = store.archiveMission(snapshot.mission.id, 'done');

    expect(archived.mission.status).toBe('archived');
    expect(store.getActiveMission('agent-1')).toBeNull();
    expect(store.getMissionSnapshot(snapshot.mission.id)?.mission.title).toBe('Temporary mission');
  });
});
