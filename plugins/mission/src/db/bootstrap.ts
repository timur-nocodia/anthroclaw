import type { Database } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_VERSION = 1;

const __dirname = dirname(fileURLToPath(import.meta.url));

export function bootstrap(db: Database): void {
  const schemaPath = join(__dirname, 'schema.sql');
  const schemaSql = readFileSync(schemaPath, 'utf-8');

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);

  const currentVersion = getSchemaVersion(db);
  if (currentVersion === 0) {
    setSchemaVersion(db, SCHEMA_VERSION);
  } else if (currentVersion < SCHEMA_VERSION) {
    runMigrations(db, currentVersion, SCHEMA_VERSION);
    setSchemaVersion(db, SCHEMA_VERSION);
  } else if (currentVersion > SCHEMA_VERSION) {
    throw new Error(
      `Mission database has newer schema version (${currentVersion}) than this plugin supports (${SCHEMA_VERSION}). ` +
      'Update the plugin before opening this database.',
    );
  }
}

export function getSchemaVersion(db: Database): number {
  try {
    const row = db.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    return 0;
  }
}

function setSchemaVersion(db: Database, version: number): void {
  db.prepare(`INSERT OR REPLACE INTO schema_meta(key, value) VALUES('schema_version', ?)`).run(String(version));
}

function runMigrations(db: Database, from: number, to: number): void {
  for (let v = from + 1; v <= to; v++) {
    const migration = MIGRATIONS[v];
    if (!migration) throw new Error(`No migration registered for schema version ${v}`);
    db.transaction(migration)(db);
  }
}

const MIGRATIONS: Record<number, (db: Database) => void> = {};
