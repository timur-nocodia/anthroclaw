import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '../../src/memory/store.js';
import { runMemoryDoctor } from '../../src/memory/doctor.js';

describe('runMemoryDoctor', () => {
  let tmpDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'memory-doctor-test-'));
    store = new MemoryStore(join(tmpDir, 'memory.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports duplicate content by memory entry hash', () => {
    store.indexFile('memory/a.md', 'Project: OpenClaw\nOwner: team');
    store.indexFile('memory/b.md', 'Project: OpenClaw\nOwner: team');

    const report = runMemoryDoctor(store);

    expect(report.summary.duplicateContent).toBe(1);
    expect(report.issues[0]).toMatchObject({
      kind: 'duplicate_content',
      paths: ['memory/a.md', 'memory/b.md'],
    });
  });

  it('reports stale entries while ignoring rejected entries by default', () => {
    const now = Date.now() + 365 * 24 * 60 * 60 * 1000;
    const stale = store.indexFile('memory/stale.md', 'old fact');
    const rejected = store.indexFile('memory/rejected.md', 'old rejected fact');

    store.updateMemoryEntryReview(stale.id, 'approved');
    store.updateMemoryEntryReview(rejected.id, 'rejected');

    const report = runMemoryDoctor(store, { now, staleAfterDays: 30 });

    expect(report.issues.some((issue) => issue.kind === 'stale_entry' && issue.paths.includes('memory/stale.md'))).toBe(true);
    expect(report.issues.some((issue) => issue.paths.includes('memory/rejected.md'))).toBe(false);
  });

  it('reports oversized files by character budget', () => {
    store.indexFile('memory/large.md', 'x'.repeat(200));

    const report = runMemoryDoctor(store, { maxFileChars: 100 });

    expect(report.summary.oversizedFiles).toBe(1);
    expect(report.issues).toContainEqual(expect.objectContaining({
      kind: 'oversized_file',
      paths: ['memory/large.md'],
    }));
  });

  it('reports conflicting simple fact lines across files', () => {
    store.indexFile('memory/profile-a.md', 'Owner: Alice\nRegion: EU');
    store.indexFile('memory/profile-b.md', 'Owner: Bob\nRegion: EU');

    const report = runMemoryDoctor(store);

    expect(report.summary.conflictingFacts).toBe(1);
    expect(report.issues).toContainEqual(expect.objectContaining({
      kind: 'conflicting_fact',
      paths: ['memory/profile-a.md', 'memory/profile-b.md'],
      evidence: expect.objectContaining({
        key: 'owner',
        values: ['alice', 'bob'],
      }),
    }));
  });
});
