import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

// ─── Types ────────────────────────────────────────────────────────

export interface Chunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  contentHash: string;
}

export interface SearchResult {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
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
  path: string;
  start_line: number;
  end_line: number;
  text: string;
  content_hash: string;
}

function rowToChunk(r: ChunkRow): Chunk {
  return {
    id: r.id,
    path: r.path,
    startLine: r.start_line,
    endLine: r.end_line,
    text: r.text,
    contentHash: r.content_hash,
  };
}

export class MemoryStore {
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
        path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding BLOB,
        model TEXT,
        indexed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);

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

    this.stmtDeleteByPath = this.db.prepare('DELETE FROM chunks WHERE path = ?');
    this.stmtInsertChunk = this.db.prepare(`
      INSERT INTO chunks (id, path, start_line, end_line, text, content_hash, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
  }

  indexFile(filePath: string, content: string): void {
    const rawChunks = chunkMarkdown(content);
    const now = Date.now();

    const txn = this.db.transaction(() => {
      this.stmtDeleteByPath.run(filePath);

      for (const chunk of rawChunks) {
        const id = createHash('sha256')
          .update(`${filePath}:${chunk.startLine}:${chunk.endLine}`)
          .digest('hex');

        const contentHash = createHash('sha256')
          .update(chunk.text)
          .digest('hex');

        this.stmtInsertChunk.run(id, filePath, chunk.startLine, chunk.endLine, chunk.text, contentHash, now);
      }
    });

    txn();
  }

  getChunks(filePath: string): Chunk[] {
    const rows = this.db
      .prepare(
        'SELECT id, path, start_line, end_line, text, content_hash FROM chunks WHERE path = ? ORDER BY start_line',
      )
      .all(filePath) as ChunkRow[];

    return rows.map(rowToChunk);
  }

  getAllChunks(): Chunk[] {
    const rows = this.db
      .prepare(
        'SELECT id, path, start_line, end_line, text, content_hash FROM chunks ORDER BY path, start_line',
      )
      .all() as ChunkRow[];

    return rows.map(rowToChunk);
  }

  removeFile(filePath: string): void {
    this.db.prepare('DELETE FROM chunks WHERE path = ?').run(filePath);
  }

  textSearch(query: string, limit: number): SearchResult[] {
    const rows = this.db
      .prepare(
        `SELECT c.path, c.start_line, c.end_line, c.text, rank
         FROM chunks_fts fts
         JOIN chunks c ON c.rowid = fts.rowid
         WHERE chunks_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as Array<{
      path: string;
      start_line: number;
      end_line: number;
      text: string;
      rank: number;
    }>;

    return rows.map((r) => ({
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
        'SELECT id, path, start_line, end_line, text, embedding FROM chunks WHERE embedding IS NOT NULL LIMIT 2000',
      )
      .all() as Array<{
      id: string;
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
