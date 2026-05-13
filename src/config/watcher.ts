import { watch, existsSync, type FSWatcher } from 'node:fs';
import { sep } from 'node:path';
import { logger } from '../logger.js';

export interface ConfigWatcherOptions {
  debounceMs?: number;
}

/**
 * Subdirectories that live under `agents/<id>/` for the agent's RUNTIME
 * state (its scratch workspace, memory store, downloaded credentials,
 * generated artifacts) and are NOT config. Any filesystem event whose
 * path crosses into one of these gets ignored — agents legitimately
 * write here mid-turn and we must not interpret that as a config change
 * worth hot-reloading every agent for. New entries here should match
 * any directory the agent or its tools own at runtime.
 *
 * Note: a top-level `agents/<dir-named-output>` (a hypothetical agent
 * literally called `output`) is unaffected because we only match the
 * pattern as a path SEGMENT inside an agent dir, not as the agent id.
 */
const AGENT_RUNTIME_DIRS = new Set([
  'output',
  'memory',
  'scripts',
  'credentials',
  'cache',
  '.cache',
  '.git',
  'node_modules',
  'venv',
  '.venv',
  '__pycache__',
]);

/**
 * Return true if the filesystem event under `agents/` is a config-level
 * change worth reloading for. Config-level changes are:
 *   - `agent.yml` modifications (the route + plugin config)
 *   - Markdown files inside the agent dir (`CLAUDE.md`, `SOUL.md`, etc.
 *     — these feed the system prompt resolver)
 *   - Top-level directory adds/removes (new or deleted agent)
 *
 * Returns false for paths that cross into one of `AGENT_RUNTIME_DIRS`
 * regardless of what's written there (the agent's own output dir, its
 * memory store, its credentials, its skill scripts).
 */
export function isConfigEvent(filename: string | null | undefined): boolean {
  // fs.watch sometimes fires with no filename (Linux IN_MOVE_SELF, errors)
  // — be conservative and reload so we don't miss a real change.
  if (!filename) return true;

  const segments = filename.split(/[\\/]/);
  // Skip events that traverse a known runtime dir at any depth past the
  // first segment (= the agent id). `agents/foo/output/...` is not
  // config; `agents/foo/agent.yml` is.
  for (let i = 1; i < segments.length; i++) {
    if (AGENT_RUNTIME_DIRS.has(segments[i] ?? '')) return false;
  }

  if (filename.endsWith('agent.yml')) return true;
  if (filename.endsWith('.md')) return true;

  // Top-level directory add/remove (new agent) — bare segment, no
  // separator AND no extension.
  if (!filename.includes(sep) && !filename.includes('.')) return true;

  return false;
}

/**
 * Watches the agents/ directory for config changes (agent.yml modifications,
 * new/removed agent directories) and calls onReload when changes are detected.
 *
 * Uses fs.watch with recursive: true (macOS/Windows) for efficiency.
 * Falls back gracefully if fs.watch is unavailable.
 */
export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;
  private onReload: () => void;
  private stopped = false;

  constructor(onReload: () => void, opts?: ConfigWatcherOptions) {
    this.onReload = onReload;
    this.debounceMs = opts?.debounceMs ?? 500;
  }

  start(agentsDir: string): void {
    if (this.watcher) return;
    if (!existsSync(agentsDir)) {
      logger.warn({ agentsDir }, 'ConfigWatcher: agents directory does not exist, skipping watch');
      return;
    }

    this.stopped = false;

    try {
      this.watcher = watch(agentsDir, { recursive: true }, (_eventType, filename) => {
        if (this.stopped) return;

        if (!isConfigEvent(filename)) return;

        logger.info({ filename }, 'ConfigWatcher: change detected');
        this.scheduleReload();
      });

      this.watcher.on('error', (err) => {
        logger.warn({ err }, 'ConfigWatcher: fs.watch error');
      });

      logger.info({ agentsDir, debounceMs: this.debounceMs }, 'ConfigWatcher: started');
    } catch (err) {
      logger.warn({ err }, 'ConfigWatcher: fs.watch failed to start (may not be supported in this environment)');
    }
  }

  stop(): void {
    this.stopped = true;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.stopped) {
        this.onReload();
      }
    }, this.debounceMs);
  }
}
