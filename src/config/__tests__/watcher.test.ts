import { describe, expect, it } from 'vitest';
import { isConfigEvent } from '../watcher.js';

describe('ConfigWatcher.isConfigEvent', () => {
  it('reloads on agent.yml changes', () => {
    expect(isConfigEvent('content_sm/agent.yml')).toBe(true);
  });

  it('reloads on agent CLAUDE.md / SOUL.md changes (system-prompt resolver inputs)', () => {
    expect(isConfigEvent('content_sm/CLAUDE.md')).toBe(true);
    expect(isConfigEvent('content_sm/SOUL.md')).toBe(true);
    expect(isConfigEvent('content_sm/STRATEGY.md')).toBe(true);
  });

  it('reloads on top-level directory adds/removes (new or deleted agent)', () => {
    expect(isConfigEvent('new_agent')).toBe(true);
  });

  it('reloads when filename is missing (fs.watch quirks — be conservative)', () => {
    expect(isConfigEvent(null)).toBe(true);
    expect(isConfigEvent(undefined)).toBe(true);
    expect(isConfigEvent('')).toBe(true);
  });

  it('ignores writes under the agent\'s own runtime dirs', () => {
    // Reproduces the 2026-05-14 prod incident: group_content_agent wrote
    // a carousel render dir under output/ mid-turn and ConfigWatcher
    // false-fired a global hot-reload of every agent.
    expect(isConfigEvent('content_sm/output/carousels/renders/2026-05-14-roman-claude-style')).toBe(false);
    expect(isConfigEvent('content_sm/memory/2026/05/2026-05-14.md')).toBe(false);
    expect(isConfigEvent('content_sm/scripts/feeds/run_collectors.sh')).toBe(false);
    expect(isConfigEvent('content_sm/credentials/mcp:linear.enc')).toBe(false);
    expect(isConfigEvent('content_sm/cache/anything')).toBe(false);
    expect(isConfigEvent('content_sm/node_modules/foo/index.js')).toBe(false);
  });

  it('ignores non-md files at agent root (binaries, lockfiles, tmp)', () => {
    expect(isConfigEvent('content_sm/foo.tmp')).toBe(false);
    expect(isConfigEvent('content_sm/state.sqlite')).toBe(false);
  });

  it('still reloads on nested .md docs (e.g. SOUL.md moved into a sub-dir)', () => {
    // We deliberately don\'t require .md files to be at the agent root —
    // operators sometimes organize big prompts into subfolders.
    expect(isConfigEvent('content_sm/prompts/SOUL.md')).toBe(true);
  });
});
