import type { Query } from '@anthropic-ai/claude-agent-sdk';

type QueueMode = 'collect' | 'steer' | 'interrupt';

export interface ChannelDeliveryTarget {
  channel: string;
  peerId: string;
  accountId?: string;
  threadId?: string;
}

export interface ActiveQueryMetadata {
  traceId?: string;
  channelDeliveryTarget?: ChannelDeliveryTarget;
}

interface ActiveQuery {
  query: Query;
  abortController: AbortController;
  registeredAt: number;
  lastActivityAt: number;
  lastEventType: string;
  activeTaskIds: string[];
  traceId?: string;
  channelDeliveryTarget?: ChannelDeliveryTarget;
}

export interface ActiveQueryView {
  sessionKey: string;
  registeredAt: number;
  lastActivityAt: number;
  lastEventType: string;
  activeTaskIds: string[];
  traceId?: string;
  channelDeliveryTarget?: ChannelDeliveryTarget;
}

export class QueueManager {
  private active = new Map<string, ActiveQuery>();

  /** Register a running query for a session key */
  register(sessionKey: string, q: Query, abort: AbortController, metadata: ActiveQueryMetadata = {}): void {
    const now = Date.now();
    this.active.set(sessionKey, {
      query: q,
      abortController: abort,
      registeredAt: now,
      lastActivityAt: now,
      lastEventType: 'registered',
      activeTaskIds: [],
      traceId: metadata.traceId,
      channelDeliveryTarget: metadata.channelDeliveryTarget,
    });
  }

  /** Unregister when query completes */
  unregister(sessionKey: string): void {
    this.active.delete(sessionKey);
  }

  /** Check if there's an active query for this session */
  isActive(sessionKey: string): boolean {
    return this.active.has(sessionKey);
  }

  markActivity(sessionKey: string, eventType: string, taskId?: string): void {
    const entry = this.active.get(sessionKey);
    if (!entry) return;

    entry.lastActivityAt = Date.now();
    entry.lastEventType = eventType;
    if (taskId && !entry.activeTaskIds.includes(taskId)) {
      entry.activeTaskIds.push(taskId);
    }
  }

  markTaskFinished(sessionKey: string, taskId: string, eventType = 'task_finished'): void {
    const entry = this.active.get(sessionKey);
    if (!entry) return;

    entry.lastActivityAt = Date.now();
    entry.lastEventType = eventType;
    entry.activeTaskIds = entry.activeTaskIds.filter((id) => id !== taskId);
  }

  getActive(sessionKey: string): ActiveQueryView | null {
    const entry = this.active.get(sessionKey);
    return entry ? toActiveQueryView(sessionKey, entry) : null;
  }

  listActive(): ActiveQueryView[] {
    return [...this.active.entries()].map(([sessionKey, entry]) => toActiveQueryView(sessionKey, entry));
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

function toActiveQueryView(sessionKey: string, entry: ActiveQuery): ActiveQueryView {
  return {
    sessionKey,
    registeredAt: entry.registeredAt,
    lastActivityAt: entry.lastActivityAt,
    lastEventType: entry.lastEventType,
    activeTaskIds: [...entry.activeTaskIds],
    traceId: entry.traceId,
    channelDeliveryTarget: entry.channelDeliveryTarget ? { ...entry.channelDeliveryTarget } : undefined,
  };
}
