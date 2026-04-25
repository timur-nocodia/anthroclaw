import type { Chunk, MemoryEntryRecord, MemoryProvenance, MemoryReviewStatus, SearchResult } from './store.js';

export interface MemoryProvider {
  indexFile(filePath: string, content: string, provenance?: MemoryProvenance): MemoryEntryRecord;
  getChunks(filePath: string): Chunk[];
  getAllChunks(): Chunk[];
  removeFile(filePath: string): void;
  textSearch(query: string, limit: number): SearchResult[];
  setEmbedding(chunkId: string, embedding: Float32Array, model: string): void;
  vectorSearch(queryEmbedding: Float32Array, limit: number): SearchResult[];
  getMemoryEntry(entryId: string): MemoryEntryRecord | null;
  getMemoryEntryByPath(filePath: string): MemoryEntryRecord | null;
  listMemoryEntries(params?: {
    path?: string;
    source?: string;
    reviewStatus?: MemoryReviewStatus;
    limit?: number;
    offset?: number;
  }): MemoryEntryRecord[];
  updateMemoryEntryReview(entryId: string, reviewStatus: MemoryReviewStatus, reviewNote?: string): boolean;
  listTables(): string[];
  close(): void;
}
