import type { ToolMeta } from './types.js';

export const BUILTIN_META: Record<string, ToolMeta> = {
  // Read-only filesystem
  Read:    { category: 'read-only', safe_in_public: true,  safe_in_trusted: true, safe_in_private: true, destructive: false, reads_only: true,  hard_blacklist_in: [] },
  Glob:    { category: 'read-only', safe_in_public: true,  safe_in_trusted: true, safe_in_private: true, destructive: false, reads_only: true,  hard_blacklist_in: [] },
  Grep:    { category: 'read-only', safe_in_public: true,  safe_in_trusted: true, safe_in_private: true, destructive: false, reads_only: true,  hard_blacklist_in: [] },
  LS:      { category: 'read-only', safe_in_public: true,  safe_in_trusted: true, safe_in_private: true, destructive: false, reads_only: true,  hard_blacklist_in: [] },

  // Filesystem writes (destructive in trusted, allowed in private)
  Write:        { category: 'code-exec', safe_in_public: false, safe_in_trusted: true, safe_in_private: true, destructive: true, reads_only: false, hard_blacklist_in: ['public'] },
  Edit:         { category: 'code-exec', safe_in_public: false, safe_in_trusted: true, safe_in_private: true, destructive: true, reads_only: false, hard_blacklist_in: ['public'] },
  MultiEdit:    { category: 'code-exec', safe_in_public: false, safe_in_trusted: true, safe_in_private: true, destructive: true, reads_only: false, hard_blacklist_in: ['public'] },
  NotebookEdit: { category: 'code-exec', safe_in_public: false, safe_in_trusted: false, safe_in_private: true, destructive: true, reads_only: false, hard_blacklist_in: ['public', 'trusted'] },

  // Code execution (only private)
  Bash: { category: 'code-exec', safe_in_public: false, safe_in_trusted: false, safe_in_private: true, destructive: true, reads_only: false, hard_blacklist_in: ['public', 'trusted'] },

  // Arbitrary network (SSRF risk)
  WebFetch: { category: 'network', safe_in_public: false, safe_in_trusted: false, safe_in_private: true, destructive: true, reads_only: false, hard_blacklist_in: ['public'] },

  // Harmless ephemeral tracking
  TodoWrite: { category: 'session-introspect', safe_in_public: false, safe_in_trusted: true, safe_in_private: true, destructive: false, reads_only: false, hard_blacklist_in: ['public'] },
};
