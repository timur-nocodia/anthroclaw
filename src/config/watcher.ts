import { watch, existsSync, type FSWatcher } from 'node:fs';
import { logger } from '../logger.js';

export interface ConfigWatcherOptions {
  debounceMs?: number;
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

        // Only care about agent.yml files or directory-level changes
        const relevant =
          !filename ||
          filename.endsWith('agent.yml') ||
          // Directory add/remove shows up as a bare directory name (no separator)
          !filename.includes('.');

        if (!relevant) return;

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
