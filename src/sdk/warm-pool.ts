import { startup, type Options, type WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import { logger } from '../logger.js';

export class WarmQueryPool {
  private handles = new Map<string, WarmQuery>();
  private pending = new Map<string, Promise<void>>();

  async prewarm(key: string, options: Options): Promise<void> {
    if (this.handles.has(key) || this.pending.has(key)) return;

    const pending = startup({ options })
      .then((handle) => {
        this.handles.set(key, handle);
        logger.debug({ key }, 'SDK warm query prepared');
      })
      .catch((err) => {
        logger.warn({ err, key }, 'SDK warm query prewarm failed');
      })
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, pending);
    await pending;
  }

  take(key: string): WarmQuery | undefined {
    const handle = this.handles.get(key);
    if (handle) {
      this.handles.delete(key);
    }
    return handle;
  }

  discard(key: string): void {
    const handle = this.handles.get(key);
    if (!handle) return;

    this.handles.delete(key);
    handle.close();
  }

  closeAll(): void {
    for (const handle of this.handles.values()) {
      handle.close();
    }
    this.handles.clear();
    this.pending.clear();
  }

  hasWarmQuery(key: string): boolean {
    return this.handles.has(key);
  }
}
