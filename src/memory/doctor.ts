import type { MemoryEntryRecord, MemoryReviewStatus } from './store.js';
import type { MemoryProvider } from './provider.js';

export type MemoryDoctorIssueKind =
  | 'duplicate_content'
  | 'stale_entry'
  | 'oversized_file'
  | 'conflicting_fact';

export interface MemoryDoctorIssue {
  kind: MemoryDoctorIssueKind;
  severity: 'info' | 'warn' | 'error';
  message: string;
  paths: string[];
  entryIds: string[];
  evidence?: Record<string, unknown>;
}

export interface MemoryDoctorOptions {
  now?: number;
  staleAfterDays?: number;
  maxFileChars?: number;
  maxChunksPerFile?: number;
  includeStatuses?: MemoryReviewStatus[];
  limit?: number;
}

export interface MemoryDoctorReport {
  checkedAt: number;
  entriesChecked: number;
  chunksChecked: number;
  issues: MemoryDoctorIssue[];
  summary: {
    duplicateContent: number;
    staleEntries: number;
    oversizedFiles: number;
    conflictingFacts: number;
  };
}

interface FileStats {
  path: string;
  chars: number;
  chunks: number;
  entryIds: Set<string>;
}

interface ParsedFact {
  key: string;
  value: string;
  path: string;
  entryId?: string;
}

const DEFAULT_STALE_AFTER_DAYS = 180;
const DEFAULT_MAX_FILE_CHARS = 64_000;
const DEFAULT_MAX_CHUNKS_PER_FILE = 80;
const DEFAULT_LIMIT = 1000;

export function runMemoryDoctor(
  provider: MemoryProvider,
  options: MemoryDoctorOptions = {},
): MemoryDoctorReport {
  const checkedAt = options.now ?? Date.now();
  const includeStatuses = options.includeStatuses ?? ['approved', 'pending'];
  const entries = provider
    .listMemoryEntries({ limit: options.limit ?? DEFAULT_LIMIT })
    .filter((entry) => includeStatuses.includes(entry.reviewStatus));
  const chunks = provider
    .getAllChunks()
    .filter((chunk) => !chunk.memoryEntryId || entries.some((entry) => entry.id === chunk.memoryEntryId));

  const issues: MemoryDoctorIssue[] = [];
  issues.push(...findDuplicateContent(entries));
  issues.push(...findStaleEntries(entries, checkedAt, options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS));
  issues.push(...findOversizedFiles(
    chunks,
    options.maxFileChars ?? DEFAULT_MAX_FILE_CHARS,
    options.maxChunksPerFile ?? DEFAULT_MAX_CHUNKS_PER_FILE,
  ));
  issues.push(...findConflictingFacts(chunks));

  return {
    checkedAt,
    entriesChecked: entries.length,
    chunksChecked: chunks.length,
    issues,
    summary: {
      duplicateContent: issues.filter((issue) => issue.kind === 'duplicate_content').length,
      staleEntries: issues.filter((issue) => issue.kind === 'stale_entry').length,
      oversizedFiles: issues.filter((issue) => issue.kind === 'oversized_file').length,
      conflictingFacts: issues.filter((issue) => issue.kind === 'conflicting_fact').length,
    },
  };
}

function findDuplicateContent(entries: MemoryEntryRecord[]): MemoryDoctorIssue[] {
  const byHash = new Map<string, MemoryEntryRecord[]>();
  for (const entry of entries) {
    const existing = byHash.get(entry.contentHash) ?? [];
    existing.push(entry);
    byHash.set(entry.contentHash, existing);
  }

  return [...byHash.entries()]
    .filter(([, grouped]) => grouped.length > 1)
    .map(([contentHash, grouped]) => {
      const sorted = [...grouped].sort((a, b) => a.path.localeCompare(b.path));
      return {
        kind: 'duplicate_content' as const,
        severity: 'warn' as const,
        message: `Duplicate memory content appears in ${sorted.length} files.`,
        paths: sorted.map((entry) => entry.path),
        entryIds: sorted.map((entry) => entry.id),
        evidence: { contentHash },
      };
    });
}

function findStaleEntries(
  entries: MemoryEntryRecord[],
  now: number,
  staleAfterDays: number,
): MemoryDoctorIssue[] {
  const thresholdMs = staleAfterDays * 24 * 60 * 60 * 1000;
  return entries
    .filter((entry) => now - entry.updatedAt > thresholdMs)
    .map((entry) => ({
      kind: 'stale_entry' as const,
      severity: 'info' as const,
      message: `Memory entry has not been updated for more than ${staleAfterDays} days.`,
      paths: [entry.path],
      entryIds: [entry.id],
      evidence: {
        updatedAt: entry.updatedAt,
        staleAfterDays,
      },
    }));
}

function findOversizedFiles(
  chunks: Array<{ path: string; text: string; memoryEntryId?: string }>,
  maxFileChars: number,
  maxChunksPerFile: number,
): MemoryDoctorIssue[] {
  const stats = new Map<string, FileStats>();

  for (const chunk of chunks) {
    const current = stats.get(chunk.path) ?? {
      path: chunk.path,
      chars: 0,
      chunks: 0,
      entryIds: new Set<string>(),
    };
    current.chars += chunk.text.length;
    current.chunks += 1;
    if (chunk.memoryEntryId) current.entryIds.add(chunk.memoryEntryId);
    stats.set(chunk.path, current);
  }

  return [...stats.values()]
    .filter((item) => item.chars > maxFileChars || item.chunks > maxChunksPerFile)
    .map((item) => ({
      kind: 'oversized_file' as const,
      severity: 'warn' as const,
      message: 'Memory file is large enough to hurt recall quality and reviewability.',
      paths: [item.path],
      entryIds: [...item.entryIds],
      evidence: {
        chars: item.chars,
        chunks: item.chunks,
        maxFileChars,
        maxChunksPerFile,
      },
    }));
}

function findConflictingFacts(
  chunks: Array<{ path: string; text: string; memoryEntryId?: string }>,
): MemoryDoctorIssue[] {
  const factsByKey = new Map<string, ParsedFact[]>();

  for (const chunk of chunks) {
    for (const fact of parseFactLines(chunk.text, chunk.path, chunk.memoryEntryId)) {
      const existing = factsByKey.get(fact.key) ?? [];
      existing.push(fact);
      factsByKey.set(fact.key, existing);
    }
  }

  const issues: MemoryDoctorIssue[] = [];
  for (const [key, facts] of factsByKey.entries()) {
    const values = new Set(facts.map((fact) => fact.value));
    if (values.size <= 1) continue;

    const paths = [...new Set(facts.map((fact) => fact.path))];
    if (paths.length <= 1) continue;

    issues.push({
      kind: 'conflicting_fact',
      severity: 'warn',
      message: `Memory contains conflicting values for "${key}".`,
      paths,
      entryIds: [...new Set(facts.flatMap((fact) => fact.entryId ? [fact.entryId] : []))],
      evidence: {
        key,
        values: [...values],
      },
    });
  }

  return issues;
}

function parseFactLines(text: string, path: string, entryId?: string): ParsedFact[] {
  const facts: ParsedFact[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim().replace(/^[-*]\s+/, '');
    const match = /^([A-Za-z][A-Za-z0-9 _./-]{2,80}):\s*(.{1,240})$/.exec(line);
    if (!match) continue;

    const key = normalizeFactKey(match[1]);
    const value = normalizeFactValue(match[2]);
    if (!key || !value) continue;

    facts.push({ key, value, path, entryId });
  }
  return facts;
}

function normalizeFactKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFactValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.。]+$/u, '')
    .trim();
}
