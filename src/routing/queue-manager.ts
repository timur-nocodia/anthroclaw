import type { Query } from '@anthropic-ai/claude-agent-sdk';

type QueueMode = 'collect' | 'steer' | 'interrupt';

interface ActiveQuery {
  query: Query;
  abortController: AbortController;
}

export class QueueManager {
  private active = new Map<string, ActiveQuery>();

  /** Register a running query for a session key */
  register(sessionKey: string, q: Query, abort: AbortController): void {
    this.active.set(sessionKey, { query: q, abortController: abort });
  }

  /** Unregister when query completes */
  unregister(sessionKey: string): void {
    this.active.delete(sessionKey);
  }

  /** Check if there's an active query for this session */
  isActive(sessionKey: string): boolean {
    return this.active.has(sessionKey);
  }

  /**
   * Handle a new incoming message for a session that has an active query.
   * Returns 'proceed' if the caller should start a new query,
   * 'skip' if the message should be dropped,
   * or 'queued' if it will be handled by the debouncer.
   */
  async handleConflict(sessionKey: string, mode: QueueMode): Promise<'proceed' | 'skip' | 'queued'> {
    if (!this.active.has(sessionKey)) return 'proceed';

    const entry = this.active.get(sessionKey)!;

    switch (mode) {
      case 'collect':
        // Debouncer handles this upstream — if we get here, just queue/skip
        return 'queued';

      case 'steer':
        // Interrupt current query, caller will restart with new message
        try {
          await entry.query.interrupt();
        } catch {
          // Query may have already finished
        }
        entry.abortController.abort();
        this.active.delete(sessionKey);
        return 'proceed';

      case 'interrupt':
        // Cancel current query, don't start new one
        try {
          await entry.query.interrupt();
        } catch {
          // Query may have already finished
        }
        entry.abortController.abort();
        this.active.delete(sessionKey);
        return 'skip';
    }
  }

  stop(): void {
    for (const [key, entry] of this.active) {
      entry.abortController.abort();
      this.active.delete(key);
    }
  }
}
