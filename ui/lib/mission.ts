import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MissionStore } from '../../plugins/mission/dist/store.js';
import { bootstrap } from '../../plugins/mission/dist/db/bootstrap.js';

export { MissionStore } from '../../plugins/mission/dist/store.js';
export type { MissionSnapshot } from '../../plugins/mission/dist/store.js';

export interface MissionHandle {
  db: Database.Database;
  store: MissionStore;
}

export function missionDbPath(agentId: string): string {
  return resolve(process.cwd(), '..', 'data', 'mission', 'mission-state-db', `${agentId}.sqlite`);
}

export function openMissionReadOnly(agentId: string): MissionHandle | null {
  const dbPath = missionDbPath(agentId);
  if (!existsSync(dbPath)) return null;

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return { db, store: new MissionStore(db) };
  } catch {
    return null;
  }
}

export function openMissionWritable(agentId: string): MissionHandle {
  const dbPath = missionDbPath(agentId);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  bootstrap(db);
  return { db, store: new MissionStore(db) };
}
