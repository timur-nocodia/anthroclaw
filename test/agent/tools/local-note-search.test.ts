import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalNoteSearchTool } from '../../../src/agent/tools/local-note-search.js';

describe('createLocalNoteSearchTool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'local-note-search-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('searches bounded workspace note directories', async () => {
    mkdirSync(join(tmpDir, 'notes'), { recursive: true });
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'notes', 'product.md'), '# Product\n\nRemember calendar handoff rules.');
    writeFileSync(join(tmpDir, 'src', 'app.ts'), 'const secret = "calendar handoff";');

    const tool = createLocalNoteSearchTool(tmpDir);
    const result = await tool.handler({ query: 'calendar' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('<local-notes>');
    expect(result.content[0].text).toContain('notes/product.md:3');
    expect(result.content[0].text).toContain('calendar handoff rules');
    expect(result.content[0].text).not.toContain('src/app.ts');
  });

  it('returns a friendly miss for unmatched notes', async () => {
    mkdirSync(join(tmpDir, '.claude', 'notes'), { recursive: true });
    writeFileSync(join(tmpDir, '.claude', 'notes', 'ops.txt'), 'Only deployment notes here.');

    const tool = createLocalNoteSearchTool(tmpDir);
    const result = await tool.handler({ query: 'billing' });

    expect(result.content[0].text).toBe('No local notes matched the query.');
  });
});
