import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { InboundMessage } from '../channels/types.js';

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
  /**
   * Messages received during an active query in collect mode. Drained when the
   * active query completes and re-dispatched as a single merged turn — this is
   * what makes "collect" actually collect instead of silently dropping.
   */
  private pending = new Map<string, InboundMessage[]>();

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

  /**
   * Buffer a message that arrived during an active collect-mode query.
   * The caller is responsible for draining via {@link drainPending} once the
   * active query completes and re-dispatching the merged result.
   */
  enqueue(sessionKey: string, msg: InboundMessage): void {
    const list = this.pending.get(sessionKey) ?? [];
    list.push(msg);
    this.pending.set(sessionKey, list);
  }

  /**
   * Return and clear all messages buffered for this session via
   * {@link enqueue}. Returns an empty array if nothing was buffered.
   */
  drainPending(sessionKey: string): InboundMessage[] {
    const list = this.pending.get(sessionKey);
    if (!list) return [];
    this.pending.delete(sessionKey);
    return list;
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
    this.pending.clear();
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
