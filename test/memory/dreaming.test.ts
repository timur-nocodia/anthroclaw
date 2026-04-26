import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDreaming } from '../../src/memory/dreaming.js';
import type { MemoryStore } from '../../src/memory/store.js';

function makeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    textSearch: vi.fn(() => []),
    vectorSearch: vi.fn(() => []),
    indexFile: vi.fn(),
    getChunks: vi.fn(() => []),
    getAllChunks: vi.fn(() => []),
    removeFile: vi.fn(),
    setEmbedding: vi.fn(),
    listTables: vi.fn(() => []),
    close: vi.fn(),
    ...overrides,
  } as unknown as MemoryStore;
}

function createDailyFile(workspacePath: string, date: string, content: string): void {
  const [yyyy, mm] = date.split('-');
  const dir = join(workspacePath, 'memory', yyyy, mm);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${date}.md`), content, 'utf-8');
}

describe('runDreaming', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dreaming-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does nothing when no memory directory exists', async () => {
    const result = await runDreaming(tmpDir, makeStore(), vi.fn());
    expect(result.consolidated).toHaveLength(0);
    expect(result.summariesWritten).toHaveLength(0);
  });

  it('does nothing when files are too recent', async () => {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    createDailyFile(tmpDir, dateStr, 'Today entry');

    const result = await runDreaming(tmpDir, makeStore(), vi.fn(), { ageThresholdDays: 7 });
    expect(result.consolidated).toHaveLength(0);
  });

  it('consolidates old files into monthly summary', async () => {
    createDailyFile(tmpDir, '2024-01-05', 'Jan 5 entry');
    createDailyFile(tmpDir, '2024-01-10', 'Jan 10 entry');
    createDailyFile(tmpDir, '2024-01-15', 'Jan 15 entry');

    const summarize = vi.fn().mockResolvedValue('Summary of January entries');
    const indexFile = vi.fn();
    const store = makeStore({ indexFile });

    const result = await runDreaming(tmpDir, store, summarize, { ageThresholdDays: 1 });

    expect(result.summariesWritten).toHaveLength(1);
    expect(result.summariesWritten[0]).toBe('memory/summaries/2024-01.md');
    expect(result.consolidated).toHaveLength(3);

    const summaryPath = join(tmpDir, 'memory/summaries/2024-01.md');
    expect(existsSync(summaryPath)).toBe(true);

    const content = readFileSync(summaryPath, 'utf-8');
    expect(content).toContain('Memory Summary: 2024-01');
    expect(content).toContain('Summary of January entries');
    expect(content).toContain('3 daily entries');

    expect(indexFile).toHaveBeenCalledWith(
      'memory/summaries/2024-01.md',
      expect.stringContaining('Summary of January'),
      expect.objectContaining({
        source: 'dreaming',
        reviewStatus: 'approved',
        metadata: {
          month: '2024-01',
          filesConsolidated: 3,
        },
      }),
    );
  });

  it('skips months that already have a summary', async () => {
    createDailyFile(tmpDir, '2024-02-01', 'Feb entry');

    // Pre-create summary
    const summaryDir = join(tmpDir, 'memory/summaries');
    mkdirSync(summaryDir, { recursive: true });
    writeFileSync(join(summaryDir, '2024-02.md'), 'Existing summary', 'utf-8');

    const summarize = vi.fn();
    const result = await runDreaming(tmpDir, makeStore(), summarize, { ageThresholdDays: 1 });

    expect(summarize).not.toHaveBeenCalled();
    expect(result.summariesWritten).toHaveLength(0);
  });

  it('passes combined daily content to summarize function', async () => {
    createDailyFile(tmpDir, '2024-03-01', 'March day 1');
    createDailyFile(tmpDir, '2024-03-02', 'March day 2');

    const summarize = vi.fn().mockResolvedValue('March summary');

    await runDreaming(tmpDir, makeStore(), summarize, { ageThresholdDays: 1 });

    expect(summarize).toHaveBeenCalledTimes(1);
    const input = summarize.mock.calls[0][0] as string;
    expect(input).toContain('2024-03-01');
    expect(input).toContain('March day 1');
    expect(input).toContain('2024-03-02');
    expect(input).toContain('March day 2');
  });
});
