import { describe, it, expect } from 'vitest';
import { BUILTIN_META } from '../builtin-tool-meta.js';

describe('BUILTIN_META', () => {
  it('marks Read as read-only and safe in all profiles', () => {
    const m = BUILTIN_META.Read;
    expect(m.reads_only).toBe(true);
    expect(m.safe_in_public).toBe(true);
    expect(m.safe_in_trusted).toBe(true);
    expect(m.safe_in_private).toBe(true);
    expect(m.destructive).toBe(false);
  });

  it('marks Bash as destructive and forbidden in public via hard_blacklist', () => {
    const m = BUILTIN_META.Bash;
    expect(m.destructive).toBe(true);
    expect(m.safe_in_public).toBe(false);
    expect(m.hard_blacklist_in).toContain('public');
  });

  it('marks Write as destructive and not safe in public', () => {
    const m = BUILTIN_META.Write;
    expect(m.destructive).toBe(true);
    expect(m.safe_in_public).toBe(false);
    expect(m.safe_in_trusted).toBe(true);
  });

  it('covers all built-ins referenced by DEFAULT_ALLOWED_TOOLS', () => {
    const expected = ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'Bash', 'WebFetch', 'NotebookEdit', 'TodoWrite'];
    for (const name of expected) {
      expect(BUILTIN_META).toHaveProperty(name);
    }
  });
});
