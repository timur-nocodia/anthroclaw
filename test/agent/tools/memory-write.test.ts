import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryWriteTool } from '../../../src/agent/tools/memory-write.js';
import type { MemoryEntryRecord, MemoryStore } from '../../../src/memory/store.js';

function memoryEntry(path: string): MemoryEntryRecord {
  return {
    id: `entry:${path}`,
    path,
    contentHash: 'hash-1',
    source: 'memory_write',
    reviewStatus: 'approved',
    provenance: {},
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    textSearch: vi.fn(() => []),
    vectorSearch: vi.fn(() => []),
    indexFile: vi.fn((path: string) => memoryEntry(path)),
    getChunks: vi.fn(() => []),
    getAllChunks: vi.fn(() => []),
    removeFile: vi.fn(),
    setEmbedding: vi.fn(),
    listTables: vi.fn(() => []),
    close: vi.fn(),
    ...overrides,
  } as unknown as MemoryStore;
}

describe('createMemoryWriteTool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'memwrite-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has correct name and description', () => {
    const tool = createMemoryWriteTool(tmpDir, makeStore());
    expect(tool.name).toBe('memory_write');
    expect(tool.description).toBeTruthy();
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it('append mode creates file with timestamp header', async () => {
    const store = makeStore();
    const tool = createMemoryWriteTool(tmpDir, store);

    const response = await tool.handler({
      content: 'Hello from test',
      file: 'notes/test.md',
    });

    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toBe('Written to notes/test.md');

    const written = readFileSync(join(tmpDir, 'notes/test.md'), 'utf-8');
    // Should contain ## HH:MM header
    expect(written).toMatch(/## \d{2}:\d{2}/);
    expect(written).toContain('Hello from test');
  });

  it('append mode appends to existing file', async () => {
    const store = makeStore();
    const tool = createMemoryWriteTool(tmpDir, store);

    await tool.handler({ content: 'First entry', file: 'notes/test.md' });
    await tool.handler({ content: 'Second entry', file: 'notes/test.md' });

    const written = readFileSync(join(tmpDir, 'notes/test.md'), 'utf-8');
    expect(written).toContain('First entry');
    expect(written).toContain('Second entry');
    // Should have two timestamp headers
    const headers = written.match(/## \d{2}:\d{2}/g);
    expect(headers).toHaveLength(2);
  });

  it('replace mode overwrites file', async () => {
    const store = makeStore();
    const tool = createMemoryWriteTool(tmpDir, store);

    await tool.handler({ content: 'First entry', file: 'notes/test.md' });
    await tool.handler({
      content: 'Replaced content',
      file: 'notes/test.md',
      mode: 'replace',
    });

    const written = readFileSync(join(tmpDir, 'notes/test.md'), 'utf-8');
    expect(written).toBe('Replaced content');
    expect(written).not.toContain('First entry');
  });

  it('uses default daily file path when no file specified', async () => {
    const store = makeStore();
    const tool = createMemoryWriteTool(tmpDir, store);

    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const expectedFile = `memory/${yyyy}/${mm}/${yyyy}-${mm}-${dd}.md`;

    const response = await tool.handler({ content: 'Daily note' });

    expect(response.content[0].text).toBe(`Written to ${expectedFile}`);
    expect(existsSync(join(tmpDir, expectedFile))).toBe(true);
  });

  it('reindexes file after write', async () => {
    const indexFile = vi.fn((path: string) => memoryEntry(path));
    const store = makeStore({ indexFile });
    const tool = createMemoryWriteTool(tmpDir, store);

    await tool.handler({ content: 'Index me', file: 'notes/test.md' });

    expect(indexFile).toHaveBeenCalledTimes(1);
    expect(indexFile).toHaveBeenCalledWith(
      'notes/test.md',
      expect.stringContaining('Index me'),
      expect.objectContaining({
        source: 'memory_write',
        reviewStatus: 'approved',
        toolName: 'memory_write',
        metadata: { mode: 'append' },
      }),
    );
  });

  it('emits memory write metadata after successful writes', async () => {
    const onMemoryWrite = vi.fn();
    const store = makeStore();
    const tool = createMemoryWriteTool(tmpDir, store, 'UTC', { onMemoryWrite });

    await tool.handler({ content: 'Index me without leaking full text', file: 'notes/test.md' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onMemoryWrite).toHaveBeenCalledWith({
      file: 'notes/test.md',
      mode: 'append',
      contentLength: 'Index me without leaking full text'.length,
      entry: expect.objectContaining({
        id: 'entry:notes/test.md',
        path: 'notes/test.md',
      }),
    });
  });

  it('returns isError on failure', async () => {
    const store = makeStore({
      indexFile: vi.fn(() => {
        throw new Error('DB write error');
      }),
    });
    const tool = createMemoryWriteTool(tmpDir, store);

    const response = await tool.handler({
      content: 'will fail',
      file: 'notes/test.md',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('DB write error');
  });
});
