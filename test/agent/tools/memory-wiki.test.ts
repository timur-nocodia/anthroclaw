import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryWikiTool } from '../../../src/agent/tools/memory-wiki.js';
import type { MemoryStore } from '../../../src/memory/store.js';

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

describe('createMemoryWikiTool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wiki-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has correct name', () => {
    const tool = createMemoryWikiTool(tmpDir, makeStore());
    expect(tool.name).toBe('memory_wiki');
  });

  it('create: creates a wiki page', async () => {
    const store = makeStore();
    const tool = createMemoryWikiTool(tmpDir, store);

    const res = await tool.handler({
      action: 'create',
      title: 'Test Page',
      content: 'Some content here.',
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain('Created wiki page');

    const filePath = join(tmpDir, 'memory/wiki/test-page.md');
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('# Test Page');
    expect(content).toContain('Some content here.');
  });

  it('create: indexes the page in store', async () => {
    const indexFile = vi.fn();
    const store = makeStore({ indexFile });
    const tool = createMemoryWikiTool(tmpDir, store);

    await tool.handler({ action: 'create', title: 'My Page', content: 'data' });

    expect(indexFile).toHaveBeenCalledTimes(1);
    expect(indexFile).toHaveBeenCalledWith(
      'memory/wiki/my-page.md',
      expect.stringContaining('data'),
    );
  });

  it('read: returns page content', async () => {
    const tool = createMemoryWikiTool(tmpDir, makeStore());

    await tool.handler({ action: 'create', title: 'Read Me', content: 'hello world' });
    const res = await tool.handler({ action: 'read', title: 'Read Me' });

    expect(res.content[0].text).toContain('# Read Me');
    expect(res.content[0].text).toContain('hello world');
  });

  it('read: returns not found for missing page', async () => {
    const tool = createMemoryWikiTool(tmpDir, makeStore());
    const res = await tool.handler({ action: 'read', title: 'Nonexistent' });
    expect(res.content[0].text).toContain('not found');
  });

  it('update: replaces full content', async () => {
    const tool = createMemoryWikiTool(tmpDir, makeStore());

    await tool.handler({ action: 'create', title: 'Updatable', content: 'old' });
    await tool.handler({ action: 'update', title: 'Updatable', content: 'new content' });

    const res = await tool.handler({ action: 'read', title: 'Updatable' });
    expect(res.content[0].text).toContain('new content');
    expect(res.content[0].text).not.toContain('\nold\n');
  });

  it('update: updates a section', async () => {
    const tool = createMemoryWikiTool(tmpDir, makeStore());

    await tool.handler({
      action: 'create',
      title: 'Sectioned',
      content: '## Notes\n\nOld notes\n\n## Links\n\nSome links',
    });

    await tool.handler({
      action: 'update',
      title: 'Sectioned',
      section: 'Notes',
      section_content: 'Updated notes here',
    });

    const res = await tool.handler({ action: 'read', title: 'Sectioned' });
    expect(res.content[0].text).toContain('Updated notes here');
    expect(res.content[0].text).toContain('Some links');
  });

  it('list: returns all pages', async () => {
    const tool = createMemoryWikiTool(tmpDir, makeStore());

    await tool.handler({ action: 'create', title: 'Alpha', content: 'a' });
    await tool.handler({ action: 'create', title: 'Beta', content: 'b' });

    const res = await tool.handler({ action: 'list' });
    expect(res.content[0].text).toContain('Alpha');
    expect(res.content[0].text).toContain('Beta');
  });

  it('list: returns empty message when no pages', async () => {
    const tool = createMemoryWikiTool(tmpDir, makeStore());
    const res = await tool.handler({ action: 'list' });
    expect(res.content[0].text).toContain('No wiki pages');
  });

  it('delete: removes page and deindexes', async () => {
    const removeFile = vi.fn();
    const store = makeStore({ removeFile });
    const tool = createMemoryWikiTool(tmpDir, store);

    await tool.handler({ action: 'create', title: 'To Delete', content: 'bye' });
    const res = await tool.handler({ action: 'delete', title: 'To Delete' });

    expect(res.content[0].text).toContain('Deleted');
    expect(removeFile).toHaveBeenCalledWith('memory/wiki/to-delete.md');
  });
});
