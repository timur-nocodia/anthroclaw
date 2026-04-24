import type { InboundMessage } from '../channels/types.js';
import { logger } from '../logger.js';

export interface DebouncerOptions {
  delayMs: number;
}

interface PendingBatch {
  messages: InboundMessage[];
  timer: ReturnType<typeof setTimeout>;
}

export class MessageDebouncer {
  private pending = new Map<string, PendingBatch>();
  private delayMs: number;
  private flush: (merged: InboundMessage) => Promise<void>;

  constructor(flush: (merged: InboundMessage) => Promise<void>, opts?: DebouncerOptions) {
    this.flush = flush;
    this.delayMs = opts?.delayMs ?? 1500;
  }

  add(msg: InboundMessage): void {
    const key = `${msg.channel}:${msg.accountId}:${msg.peerId}:${msg.senderId}`;
    const existing = this.pending.get(key);

    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push(msg);
      logger.debug(
        { key, buffered: existing.messages.length, delayMs: this.delayMs },
        'Debounce: buffering message, timer reset',
      );
      existing.timer = setTimeout(() => this.fire(key), this.delayMs);
    } else {
      logger.debug({ key, delayMs: this.delayMs }, 'Debounce: first message, starting timer');
      const timer = setTimeout(() => this.fire(key), this.delayMs);
      this.pending.set(key, { messages: [msg], timer });
    }
  }

  private fire(key: string): void {
    const batch = this.pending.get(key);
    if (!batch) return;
    this.pending.delete(key);

    logger.info(
      { key, count: batch.messages.length },
      'Debounce: flushing batch',
    );
    const merged = this.merge(batch.messages);
    void this.flush(merged);
  }

  private merge(messages: InboundMessage[]): InboundMessage {
    if (messages.length === 1) return messages[0];

    const first = messages[0];
    const last = messages[messages.length - 1];

    const textParts: string[] = [];
    let media = first.media;

    for (const m of messages) {
      if (m.text) textParts.push(m.text);
      if (m.media) media = m.media;
    }

    return {
      ...first,
      text: textParts.join('\n'),
      messageId: last.messageId,
      media,
      mentionedBot: messages.some((m) => m.mentionedBot),
    };
  }

  stop(): void {
    for (const batch of this.pending.values()) {
      clearTimeout(batch.timer);
    }
    this.pending.clear();
  }
}
