import { describe, expect, it } from 'vitest';
import { Gateway } from '../src/gateway.js';
import { MemoryStore } from '../src/memory/store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Gateway memory review surface', () => {
  it('lists and updates memory review entries for an agent', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gw-memory-review-'));
    const store = new MemoryStore(join(tmpDir, 'memory.db'));
    try {
      const entry = store.indexFile('memory/pending.md', 'Owner: Alice', {
        source: 'post_run_candidate',
        reviewStatus: 'pending',
        runId: 'run-1',
      });
      const gw = new Gateway();
      gw._agents.set('agent-1', { id: 'agent-1', memoryStore: store } as any);

      expect(gw.listAgentMemoryEntries('agent-1', { reviewStatus: 'pending' })).toMatchObject([{
        id: entry.id,
        path: 'memory/pending.md',
        reviewStatus: 'pending',
      }]);

      const result = gw.updateAgentMemoryEntryReview('agent-1', entry.id, 'approved', 'looks good');
      expect(result).toMatchObject({
        entryId: entry.id,
        updated: true,
        entry: {
          id: entry.id,
          reviewStatus: 'approved',
          reviewNote: 'looks good',
        },
      });
    } finally {
      store.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runs memory doctor for an agent', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gw-memory-doctor-'));
    const store = new MemoryStore(join(tmpDir, 'memory.db'));
    try {
      store.indexFile('memory/a.md', 'Owner: Alice');
      store.indexFile('memory/b.md', 'Owner: Bob');
      const gw = new Gateway();
      gw._agents.set('agent-1', { id: 'agent-1', memoryStore: store } as any);

      const report = gw.runAgentMemoryDoctor('agent-1');

      expect(report.summary.conflictingFacts).toBe(1);
      expect(report.issues).toContainEqual(expect.objectContaining({
        kind: 'conflicting_fact',
        paths: ['memory/a.md', 'memory/b.md'],
      }));
    } finally {
      store.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('requires a known agent before exposing memory state', () => {
    const gw = new Gateway();
    expect(() => gw.listAgentMemoryEntries('missing')).toThrow('Agent "missing" not found');
    expect(() => gw.updateAgentMemoryEntryReview('missing', 'entry-1', 'approved')).toThrow('Agent "missing" not found');
    expect(() => gw.runAgentMemoryDoctor('missing')).toThrow('Agent "missing" not found');
  });
});
