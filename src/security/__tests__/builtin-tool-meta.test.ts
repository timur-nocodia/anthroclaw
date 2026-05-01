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

  describe('self-configuration tools', () => {
    it('manage_notifications is HARD_BLACKLIST in public', () => {
      const m = BUILTIN_META.manage_notifications;
      expect(m).toBeDefined();
      expect(m.hard_blacklist_in).toContain('public');
      expect(m.safe_in_public).toBe(false);
      expect(m.safe_in_trusted).toBe(true);
      expect(m.safe_in_private).toBe(true);
      expect(m.destructive).toBe(true);
      expect(m.reads_only).toBe(false);
      expect(m.category).toBe('agent-config');
      expect(m.reasoning).toBeTruthy();
    });

    it('manage_human_takeover is HARD_BLACKLIST in public', () => {
      const m = BUILTIN_META.manage_human_takeover;
      expect(m).toBeDefined();
      expect(m.hard_blacklist_in).toContain('public');
      expect(m.safe_in_public).toBe(false);
      expect(m.destructive).toBe(true);
      expect(m.category).toBe('agent-config');
      expect(m.reasoning).toBeTruthy();
    });

    it('manage_operator_console is HARD_BLACKLIST in public', () => {
      const m = BUILTIN_META.manage_operator_console;
      expect(m).toBeDefined();
      expect(m.hard_blacklist_in).toContain('public');
      expect(m.safe_in_public).toBe(false);
      expect(m.destructive).toBe(true);
      expect(m.category).toBe('agent-config');
      expect(m.reasoning).toBeTruthy();
    });

    it('show_config is allowed in all profiles (read-only)', () => {
      const m = BUILTIN_META.show_config;
      expect(m).toBeDefined();
      expect(m.hard_blacklist_in).toEqual([]);
      expect(m.safe_in_public).toBe(true);
      expect(m.safe_in_trusted).toBe(true);
      expect(m.safe_in_private).toBe(true);
      expect(m.destructive).toBe(false);
      expect(m.reads_only).toBe(true);
      expect(m.category).toBe('read-only');
    });
  });
});
