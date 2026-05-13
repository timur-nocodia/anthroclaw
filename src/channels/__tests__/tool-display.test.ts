import { describe, it, expect } from 'vitest';
import { getToolEmoji, buildToolPreview } from '../tool-display.js';

describe('getToolEmoji', () => {
  it('returns the right emoji for built-in tools', () => {
    expect(getToolEmoji('Bash')).toBe('💻');
    expect(getToolEmoji('Read')).toBe('📖');
    expect(getToolEmoji('Write')).toBe('✏️');
    expect(getToolEmoji('Edit')).toBe('✏️');
    expect(getToolEmoji('Grep')).toBe('🔎');
    expect(getToolEmoji('Glob')).toBe('🔍');
    expect(getToolEmoji('Task')).toBe('🎯');
    expect(getToolEmoji('TodoWrite')).toBe('✅');
    expect(getToolEmoji('WebFetch')).toBe('🌐');
    expect(getToolEmoji('WebSearch')).toBe('🔎');
  });

  it('returns the right emoji for AnthroClaw built-ins', () => {
    expect(getToolEmoji('memory_search')).toBe('🧠');
    expect(getToolEmoji('memory_write')).toBe('🧠');
    expect(getToolEmoji('memory_wiki')).toBe('🧠');
    expect(getToolEmoji('web_search_brave')).toBe('🔎');
    expect(getToolEmoji('web_search_exa')).toBe('🔎');
    expect(getToolEmoji('list_skills')).toBe('📚');
    expect(getToolEmoji('manage_cron')).toBe('⏰');
    expect(getToolEmoji('send_message')).toBe('📤');
    expect(getToolEmoji('send_media')).toBe('📤');
    expect(getToolEmoji('access_control')).toBe('🔐');
  });

  it('returns plug emoji for any MCP tool', () => {
    expect(getToolEmoji('mcp__notion__search')).toBe('🔌');
    expect(getToolEmoji('mcp__custom__do_thing')).toBe('🔌');
  });

  it('returns fallback for unknown tools', () => {
    expect(getToolEmoji('unknown_tool')).toBe('⚡');
    expect(getToolEmoji('foo_bar')).toBe('⚡');
  });

  it('respects override map', () => {
    expect(getToolEmoji('Bash', { Bash: '🚀' })).toBe('🚀');
    expect(getToolEmoji('Read', { Bash: '🚀' })).toBe('📖');
  });
});

describe('buildToolPreview', () => {
  it('uses command for Bash', () => {
    expect(buildToolPreview('Bash', { command: 'ls -la' }, 40)).toBe('ls -la');
  });

  it('uses file_path tail for Read/Write/Edit', () => {
    expect(buildToolPreview('Read', { file_path: '/Users/x/project/src/app.ts' }, 40))
      .toBe('app.ts');
    expect(buildToolPreview('Write', { file_path: '/very/long/path/to/file.md' }, 40))
      .toBe('file.md');
  });

  it('uses pattern for Grep/Glob', () => {
    expect(buildToolPreview('Grep', { pattern: 'foo.*bar' }, 40)).toBe('foo.*bar');
    expect(buildToolPreview('Glob', { pattern: '**/*.ts' }, 40)).toBe('**/*.ts');
  });

  it('uses query for search tools', () => {
    expect(buildToolPreview('WebSearch', { query: 'how to fix X' }, 40)).toBe('how to fix X');
    expect(buildToolPreview('web_search_brave', { query: 'foo' }, 40)).toBe('foo');
    expect(buildToolPreview('memory_search', { query: 'baz' }, 40)).toBe('baz');
  });

  it('uses url for WebFetch', () => {
    expect(buildToolPreview('WebFetch', { url: 'https://example.com' }, 40))
      .toBe('https://example.com');
  });

  it('uses content for memory_write (truncated)', () => {
    const long = 'a'.repeat(100);
    const out = buildToolPreview('memory_write', { content: long }, 40);
    expect(out?.length).toBeLessThanOrEqual(40);
    expect(out?.endsWith('…')).toBe(true);
  });

  it('uses description for Task, falls back to prompt', () => {
    expect(buildToolPreview('Task', { description: 'investigate X' }, 40))
      .toBe('investigate X');
    expect(buildToolPreview('Task', { prompt: 'do Y', subagent_type: 'general-purpose' }, 40))
      .toBe('do Y');
  });

  it('uses action for manage_cron', () => {
    expect(buildToolPreview('manage_cron', { action: 'create', cron: '0 9 * * *' }, 40))
      .toBe('create');
  });

  it('truncates to maxLen with ellipsis', () => {
    const longCommand = 'a'.repeat(100);
    const out = buildToolPreview('Bash', { command: longCommand }, 20);
    expect(out?.length).toBeLessThanOrEqual(20);
    expect(out?.endsWith('…')).toBe(true);
  });

  it('returns null when maxLen is 0', () => {
    expect(buildToolPreview('Bash', { command: 'ls' }, 0)).toBeNull();
  });

  it('collapses newlines/whitespace into single spaces', () => {
    expect(buildToolPreview('Bash', { command: 'foo\n\n  bar\tbaz' }, 40))
      .toBe('foo bar baz');
  });

  it('falls back to first string field for unknown tools', () => {
    expect(buildToolPreview('unknown', { thing: 'value', other: 42 }, 40)).toBe('value');
  });

  it('handles MCP tools (first string in input)', () => {
    expect(buildToolPreview('mcp__notion__search', { query: 'cats', limit: 5 }, 40))
      .toBe('cats');
  });

  it('returns null when no string fields', () => {
    expect(buildToolPreview('unknown', { count: 5, ok: true }, 40)).toBeNull();
  });

  it('returns null when input is not an object', () => {
    expect(buildToolPreview('Bash', null, 40)).toBeNull();
    expect(buildToolPreview('Bash', 'string', 40)).toBeNull();
  });
});
