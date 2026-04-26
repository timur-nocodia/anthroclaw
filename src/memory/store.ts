import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { MemoryProvider } from './provider.js';

// ─── Types ────────────────────────────────────────────────────────

export interface Chunk {
  id: string;
  memoryEntryId?: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  contentHash: string;
}

export interface SearchResult {
  memoryEntryId?: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}

export type MemoryReviewStatus = 'pending' | 'approved' | 'rejected';

export interface MemoryProvenance {
  source?: 'memory_write' | 'memory_wiki' | 'dreaming' | 'index' | 'import' | 'post_run_candidate' | 'local_note_proposal';
  reviewStatus?: MemoryReviewStatus;
  runId?: string;
  traceId?: string;
  sessionKey?: string;
  agentId?: string;
  sdkSessionId?: string;
  sourceChannel?: string;
  sourcePeerHash?: string;
  toolName?: string;
  createdBy?: string;
  note?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryEntryRecord {
  id: string;
  path: string;
  contentHash: string;
  source: string;
  reviewStatus: MemoryReviewStatus;
  reviewNote?: string;
  provenance: MemoryProvenance;
  createdAt: number;
  updatedAt: number;
}

// ─── Internal: Markdown Chunking ──────────────────────────────────

interface RawChunk {
  startLine: number;
  endLine: number;
  text: string;
}

function chunkMarkdown(content: string, maxChars = 1600, overlap = 320): RawChunk[] {
  const lines = content.split('\n');
  const chunks: RawChunk[] = [];

  let currentLines: string[] = [];
  let currentChars = 0;
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentLines.push(line);
    currentChars += line.length + 1; // +1 for the newline

    if (currentChars >= maxChars && i < lines.length - 1) {
      const text = currentLines.join('\n');
      chunks.push({
        startLine,
        endLine: i,
        text,
      });

      // Overlap: find lines from the end of current chunk that fit within overlap chars
      const overlapLines: string[] = [];
      let overlapChars = 0;
      for (let j = currentLines.length - 1; j >= 0; j--) {
        const lineLen = currentLines[j].length + 1;
        if (overlapChars + lineLen > overlap && overlapLines.length > 0) break;
        overlapLines.unshift(currentLines[j]);
        overlapChars += lineLen;
      }

      // The overlap lines become the start of the next chunk
      const overlapLineCount = overlapLines.length;
      startLine = i - overlapLineCount + 2; // next chunk starts after overlap boundary
      currentLines = [...overlapLines];
      currentChars = overlapChars;
    }
  }

  // Flush remaining
  if (currentLines.length > 0) {
    chunks.push({
      startLine,
      endLine: lines.length - 1,
      text: currentLines.join('\n'),
    });
  }

  return chunks;
}

// ─── MemoryStore ──────────────────────────────────────────────────

interface ChunkRow {
  id: string;
  entry_id: string | null;
  path: string;
  start_line: number;
  end_line: number;
  text: string;
  content_hash: string;
}

function rowToChunk(r: ChunkRow): Chunk {
  return {
    id: r.id,
    memoryEntryId: r.entry_id ?? undefined,
    path: r.path,
    startLine: r.start_line,
    endLine: r.end_line,
    text: r.text,
    contentHash: r.content_hash,
  };
}

export class MemoryStore implements MemoryProvider {
  private db: Database.Database;
  private stmtDeleteByPath!: Database.Statement;
  private stmtInsertChunk!: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        entry_id TEXT,
        path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding BLOB,
        model TEXT,
        indexed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        content_hash TEXT NOT NULL,
        source TEXT NOT NULL,
        review_status TEXT NOT NULL,
        review_note TEXT,
        provenance_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        text,
        content='chunks',
        content_rowid='rowid'
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
        INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
    `);

    // Legacy-column migration must run before index creation so indexes that
    // reference columns added later (chunks.entry_id) don't fail on old DBs.
    this.ensureColumn('chunks', 'entry_id', 'TEXT');

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
      CREATE INDEX IF NOT EXISTS idx_chunks_entry ON chunks(entry_id);
      CREATE INDEX IF NOT EXISTS idx_memory_entries_path ON memory_entries(path);
      CREATE INDEX IF NOT EXISTS idx_memory_entries_source_updated ON memory_entries(source, updated_at);
      CREATE INDEX IF NOT EXISTS idx_memory_entries_review_updated ON memory_entries(review_status, updated_at);
    `);

    this.stmtDeleteByPath = this.db.prepare('DELETE FROM chunks WHERE path = ?');
    this.stmtInsertChunk = this.db.prepare(`
      INSERT INTO chunks (id, entry_id, path, start_line, end_line, text, content_hash, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) return;
    this.db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }

  indexFile(filePath: string, content: string, provenance: MemoryProvenance = {}): MemoryEntryRecord {
    const rawChunks = chunkMarkdown(content);
    const now = Date.now();
    const fileContentHash = createHash('sha256')
      .update(content)
      .digest('hex');
    const existingEntry = this.getMemoryEntryByPath(filePath);
    const entryId = existingEntry?.id ?? createHash('sha256')
      .update(`memory-entry:${filePath}`)
      .digest('hex');
    const source = provenance.source ?? existingEntry?.provenance.source ?? 'index';
    const reviewStatus = provenance.reviewStatus ?? existingEntry?.reviewStatus ?? 'approved';
    const reviewNote = existingEntry?.reviewNote;
    const createdAt = existingEntry?.createdAt ?? now;
    const storedProvenance: MemoryProvenance = {
      ...existingEntry?.provenance,
      ...provenance,
      source,
      reviewStatus,
    };

    const txn = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO memory_entries(
          id, path, content_hash, source, review_status, review_note, provenance_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          content_hash = excluded.content_hash,
          source = excluded.source,
          review_status = excluded.review_status,
          provenance_json = excluded.provenance_json,
          updated_at = excluded.updated_at
      `).run(
        entryId,
        filePath,
        fileContentHash,
        source,
        reviewStatus,
        reviewNote ?? null,
        JSON.stringify(storedProvenance),
        createdAt,
        now,
      );

      this.stmtDeleteByPath.run(filePath);

      for (const chunk of rawChunks) {
        const id = createHash('sha256')
          .update(`${filePath}:${chunk.startLine}:${chunk.endLine}`)
          .digest('hex');

        const contentHash = createHash('sha256')
          .update(chunk.text)
          .digest('hex');

        this.stmtInsertChunk.run(id, entryId, filePath, chunk.startLine, chunk.endLine, chunk.text, contentHash, now);
      }
    });

    txn();
    return this.getMemoryEntry(entryId) ?? {
      id: entryId,
      path: filePath,
      contentHash: fileContentHash,
      source,
      reviewStatus,
      reviewNote,
      provenance: storedProvenance,
      createdAt,
      updatedAt: now,
    };
  }

  getChunks(filePath: string): Chunk[] {
    const rows = this.db
      .prepare(
        'SELECT id, entry_id, path, start_line, end_line, text, content_hash FROM chunks WHERE path = ? ORDER BY start_line',
      )
      .all(filePath) as ChunkRow[];

    return rows.map(rowToChunk);
  }

  getAllChunks(): Chunk[] {
    const rows = this.db
      .prepare(
        'SELECT id, entry_id, path, start_line, end_line, text, content_hash FROM chunks ORDER BY path, start_line',
      )
      .all() as ChunkRow[];

    return rows.map(rowToChunk);
  }

  removeFile(filePath: string): void {
    const txn = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chunks WHERE path = ?').run(filePath);
      this.db.prepare('DELETE FROM memory_entries WHERE path = ?').run(filePath);
    });
    txn();
  }

  textSearch(query: string, limit: number): SearchResult[] {
    const rows = this.db
      .prepare(
        `SELECT c.entry_id, c.path, c.start_line, c.end_line, c.text, rank
         FROM chunks_fts fts
         JOIN chunks c ON c.rowid = fts.rowid
         LEFT JOIN memory_entries e ON e.id = c.entry_id
         WHERE chunks_fts MATCH ?
           AND (c.entry_id IS NULL OR e.review_status = 'approved')
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as Array<{
      entry_id: string | null;
      path: string;
      start_line: number;
      end_line: number;
      text: string;
      rank: number;
    }>;

    return rows.map((r) => ({
      memoryEntryId: r.entry_id ?? undefined,
      path: r.path,
      startLine: r.start_line,
      endLine: r.end_line,
      text: r.text,
      score: -r.rank, // FTS5 rank is negative (lower = better), flip sign
    }));
  }

  setEmbedding(chunkId: string, embedding: Float32Array, model: string): void {
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    this.db
      .prepare('UPDATE chunks SET embedding = ?, model = ? WHERE id = ?')
      .run(buffer, model, chunkId);
  }

  vectorSearch(queryEmbedding: Float32Array, limit: number): SearchResult[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.entry_id, c.path, c.start_line, c.end_line, c.text, c.embedding
         FROM chunks c
         LEFT JOIN memory_entries e ON e.id = c.entry_id
         WHERE c.embedding IS NOT NULL
           AND (c.entry_id IS NULL OR e.review_status = 'approved')
         LIMIT 2000`,
      )
      .all() as Array<{
      id: string;
      entry_id: string | null;
      path: string;
      start_line: number;
      end_line: number;
      text: string;
      embedding: Buffer;
    }>;

    const scored: SearchResult[] = [];

    for (const row of rows) {
      const stored = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT,
      );

      const sim = cosineSimilarity(queryEmbedding, stored);

      scored.push({
        memoryEntryId: row.entry_id ?? undefined,
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        text: row.text,
        score: sim,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  getMemoryEntry(entryId: string): MemoryEntryRecord | null {
    const row = this.db
      .prepare('SELECT * FROM memory_entries WHERE id = ?')
      .get(entryId) as MemoryEntryRow | undefined;
    return row ? rowToMemoryEntry(row) : null;
  }

  getMemoryEntryByPath(filePath: string): MemoryEntryRecord | null {
    const row = this.db
      .prepare('SELECT * FROM memory_entries WHERE path = ?')
      .get(filePath) as MemoryEntryRow | undefined;
    return row ? rowToMemoryEntry(row) : null;
  }

  listMemoryEntries(params: {
    path?: string;
    source?: string;
    reviewStatus?: MemoryReviewStatus;
    limit?: number;
    offset?: number;
  } = {}): MemoryEntryRecord[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.path) {
      clauses.push('path = ?');
      values.push(params.path);
    }
    if (params.source) {
      clauses.push('source = ?');
      values.push(params.source);
    }
    if (params.reviewStatus) {
      clauses.push('review_status = ?');
      values.push(params.reviewStatus);
    }
    values.push(params.limit ?? 100, params.offset ?? 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM memory_entries
      ${where}
      ORDER BY updated_at DESC, path ASC
      LIMIT ? OFFSET ?
    `).all(...values) as MemoryEntryRow[];
    return rows.map(rowToMemoryEntry);
  }

  updateMemoryEntryReview(entryId: string, reviewStatus: MemoryReviewStatus, reviewNote?: string): boolean {
    const result = this.db.prepare(`
      UPDATE memory_entries
      SET review_status = ?, review_note = ?, updated_at = ?
      WHERE id = ?
    `).run(reviewStatus, reviewNote ?? null, Date.now(), entryId);
    return result.changes > 0;
  }

  listTables(): string[] {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') ORDER BY name")
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  close(): void {
    this.db.close();
  }
}

interface MemoryEntryRow {
  id: string;
  path: string;
  content_hash: string;
  source: string;
  review_status: MemoryReviewStatus;
  review_note: string | null;
  provenance_json: string;
  created_at: number;
  updated_at: number;
}

function rowToMemoryEntry(row: MemoryEntryRow): MemoryEntryRecord {
  return {
    id: row.id,
    path: row.path,
    contentHash: row.content_hash,
    source: row.source,
    reviewStatus: row.review_status,
    reviewNote: row.review_note ?? undefined,
    provenance: parseProvenance(row.provenance_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseProvenance(value: string): MemoryProvenance {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as MemoryProvenance
      : {};
  } catch {
    return {};
  }
}

// ─── Cosine Similarity ───────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
