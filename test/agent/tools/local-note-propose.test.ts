import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalNoteProposeTool } from '../../../src/agent/tools/local-note-propose.js';
import { MemoryStore } from '../../../src/memory/store.js';

describe('createLocalNoteProposeTool', () => {
  let tmpDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'local-note-propose-'));
    store = new MemoryStore(join(tmpDir, 'memory.sqlite'));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a pending reviewed note proposal', async () => {
    const tool = createLocalNoteProposeTool(tmpDir, store);
    const result = await tool.handler({
      title: 'Calendar Handoff',
      content: 'Use the calendar daily brief before planning mornings.',
      reason: 'Operator wants this persisted after review.',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Proposed local note notes/review/');

    const [entry] = store.listMemoryEntries({ reviewStatus: 'pending' });
    expect(entry).toMatchObject({
      source: 'local_note_proposal',
      reviewStatus: 'pending',
      provenance: {
        source: 'local_note_proposal',
        reviewStatus: 'pending',
        toolName: 'local_note_propose',
        note: 'Operator wants this persisted after review.',
      },
    });
    expect(entry.path).toMatch(/^notes\/review\/.*calendar-handoff\.md$/);
    expect(existsSync(join(tmpDir, entry.path))).toBe(true);
    expect(store.textSearch('calendar', 5)).toEqual([]);

    store.updateMemoryEntryReview(entry.id, 'approved');
    expect(store.textSearch('calendar', 5).map((match) => match.path)).toEqual([entry.path]);
  });
});
