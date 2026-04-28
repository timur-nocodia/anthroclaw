import type { Database } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const SCHEMA_VERSION = 1;

const __dirname = dirname(fileURLToPath(import.meta.url));

export function bootstrap(db: Database): void {
  // schema.sql lives alongside the compiled JS (copied during build)
  // For dev/test runs (tsx, vitest) it's at src/db/schema.sql; production is dist/db/schema.sql.
  // The path resolution is symmetric since both runtimes evaluate import.meta.url to the
  // same relative position vs schema.sql.
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
      `LCM database has newer schema version (${currentVersion}) than this plugin supports (${SCHEMA_VERSION}). ` +
      `Forward-compat upgrades are not supported — update the plugin.`
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

function setSchemaVersion(db: Database, v: number): void {
  db.prepare(`INSERT OR REPLACE INTO schema_meta(key, value) VALUES('schema_version', ?)`).run(String(v));
}

function runMigrations(db: Database, from: number, to: number): void {
  for (let v = from + 1; v <= to; v++) {
    const migration = MIGRATIONS[v];
    if (!migration) {
      throw new Error(`No migration registered for schema version ${v}`);
    }
    // Each migration runs in a transaction so partial failures don't corrupt state.
    // Future migrations should NOT manage their own transactions.
    db.transaction(migration)(db);
  }
}

const MIGRATIONS: Record<number, (db: Database) => void> = {
  // Future migrations: 2: (db) => { db.exec('ALTER TABLE messages ADD COLUMN foo TEXT') }
  // NOTE: each migration is automatically wrapped in a transaction by runMigrations.
  // Do NOT use db.transaction() inside the migration body.
};
