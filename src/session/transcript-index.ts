import Database from 'better-sqlite3';

export interface TranscriptSnippet {
  sessionId: string;
  role: string;
  timestamp: string;
  text: string;
  score: number;
}

export interface TranscriptSessionResult {
  sessionId: string;
  lastModified: number;
  snippets: TranscriptSnippet[];
  score: number;
}

export interface IndexTranscriptSessionParams {
  sessionId: string;
  lastModified: number;
  snippets: Array<{
    role: string;
    timestamp: string;
    text: string;
  }>;
}

function buildFtsQuery(query: string): string {
  const terms = [...query.matchAll(/[\p{L}\p{N}_-]+/gu)]
    .map((match) => match[0].trim())
    .filter((term) => term.length >= 2);

  if (terms.length === 0) {
    return `"${query.trim().replaceAll('"', '""')}"`;
  }

  return terms
    .map((term) => `"${term.replaceAll('"', '""')}"*`)
    .join(' OR ');
}

export class TranscriptIndex {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transcript_sessions (
        session_id TEXT PRIMARY KEY,
        last_modified INTEGER NOT NULL,
        snippet_count INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transcript_snippets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        text TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transcript_snippets_session
        ON transcript_snippets(session_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS transcript_snippets_fts USING fts5(
        text,
        content='transcript_snippets',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS transcript_snippets_ai AFTER INSERT ON transcript_snippets BEGIN
        INSERT INTO transcript_snippets_fts(rowid, text) VALUES (new.id, new.text);
      END;

      CREATE TRIGGER IF NOT EXISTS transcript_snippets_ad AFTER DELETE ON transcript_snippets BEGIN
        INSERT INTO transcript_snippets_fts(transcript_snippets_fts, rowid, text)
        VALUES('delete', old.id, old.text);
      END;

      CREATE TRIGGER IF NOT EXISTS transcript_snippets_au AFTER UPDATE ON transcript_snippets BEGIN
        INSERT INTO transcript_snippets_fts(transcript_snippets_fts, rowid, text)
        VALUES('delete', old.id, old.text);
        INSERT INTO transcript_snippets_fts(rowid, text) VALUES (new.id, new.text);
      END;
    `);
  }

  getSessionMetadata(sessionId: string): { lastModified: number } | null {
    const row = this.db
      .prepare('SELECT last_modified FROM transcript_sessions WHERE session_id = ?')
      .get(sessionId) as { last_modified: number } | undefined;

    return row ? { lastModified: row.last_modified } : null;
  }

  indexSession(params: IndexTranscriptSessionParams): void {
    const now = Date.now();
    const insertSession = this.db.prepare(`
      INSERT INTO transcript_sessions(session_id, last_modified, snippet_count, indexed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        last_modified = excluded.last_modified,
        snippet_count = excluded.snippet_count,
        indexed_at = excluded.indexed_at
    `);
    const deleteSnippets = this.db.prepare('DELETE FROM transcript_snippets WHERE session_id = ?');
    const insertSnippet = this.db.prepare(`
      INSERT INTO transcript_snippets(session_id, role, timestamp, text)
      VALUES (?, ?, ?, ?)
    `);

    const tx = this.db.transaction(() => {
      deleteSnippets.run(params.sessionId);

      for (const snippet of params.snippets) {
        insertSnippet.run(params.sessionId, snippet.role, snippet.timestamp, snippet.text);
      }

      insertSession.run(params.sessionId, params.lastModified, params.snippets.length, now);
    });

    tx();
  }

  search(query: string, limitSessions: number, limitSnippetsPerSession: number): TranscriptSessionResult[] {
    const ftsQuery = buildFtsQuery(query);
    const rows = this.db.prepare(`
      SELECT
        snippets.session_id as session_id,
        snippets.role as role,
        snippets.timestamp as timestamp,
        snippets.text as text,
        sessions.last_modified as last_modified,
        bm25(transcript_snippets_fts) as rank
      FROM transcript_snippets_fts
      JOIN transcript_snippets snippets ON snippets.id = transcript_snippets_fts.rowid
      JOIN transcript_sessions sessions ON sessions.session_id = snippets.session_id
      WHERE transcript_snippets_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, Math.max(limitSessions * limitSnippetsPerSession * 4, 20)) as Array<{
      session_id: string;
      role: string;
      timestamp: string;
      text: string;
      last_modified: number;
      rank: number;
    }>;

    const grouped = new Map<string, TranscriptSessionResult>();

    for (const row of rows) {
      const score = -row.rank;
      let session = grouped.get(row.session_id);
      if (!session) {
        if (grouped.size >= limitSessions) continue;
        session = {
          sessionId: row.session_id,
          lastModified: row.last_modified,
          snippets: [],
          score: 0,
        };
        grouped.set(row.session_id, session);
      }

      if (session.snippets.length < limitSnippetsPerSession) {
        session.snippets.push({
          sessionId: row.session_id,
          role: row.role,
          timestamp: row.timestamp,
          text: row.text,
          score,
        });
      }
      session.score = Math.max(session.score, score);
    }

    return [...grouped.values()].sort((a, b) => b.score - a.score);
  }
}
