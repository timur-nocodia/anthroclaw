export interface StreamConfig {
  editIntervalMs: number;
  bufferThreshold: number;
  cursor: string;
  maxFloodStrikes: number;
  maxMessageLength: number;
}

const DEFAULT_CONFIG: StreamConfig = {
  editIntervalMs: 1000,
  bufferThreshold: 40,
  cursor: ' \u2589',
  maxFloodStrikes: 3,
  maxMessageLength: 4096,
};

const THINKING_TAG_RE = /<(?:think|reasoning)>[\s\S]*?<\/(?:think|reasoning)>/g;

export class StreamConsumer {
  private buffer = '';
  private accumulated = '';
  private lastEditTime = 0;
  private floodStrikes = 0;
  private disabled = false;
  private currentEditInterval: number;
  private messageId: string | null = null;
  private config: StreamConfig;
  private editScheduled = false;
  private pendingEdit: Promise<void> | null = null;

  constructor(
    private sendFn: (text: string) => Promise<string>,
    private editFn: (messageId: string, text: string) => Promise<void>,
    config?: Partial<StreamConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentEditInterval = this.config.editIntervalMs;
  }

  onDelta(text: string): void {
    this.buffer += text;
    // Strip thinking tags from buffer
    this.buffer = this.buffer.replace(THINKING_TAG_RE, '');

    if (!this.messageId) {
      // First delta: send initial message
      this.messageId = '__pending__';
      const safeLen = this.config.maxMessageLength - this.config.cursor.length - 100;
      const display = this.buffer.length > safeLen ? this.buffer.slice(0, safeLen) : this.buffer;
      this.accumulated = this.buffer;

      this.pendingEdit = this.sendFn(display + this.config.cursor)
        .then((id) => {
          this.messageId = id;
          this.lastEditTime = Date.now();
        })
        .catch(() => {
          this.floodStrikes++;
          if (this.floodStrikes >= this.config.maxFloodStrikes) {
            this.disabled = true;
          }
          this.messageId = null;
        });
      return;
    }

    this.accumulated = this.buffer;
    this.maybeScheduleEdit();
  }

  private maybeScheduleEdit(): void {
    if (this.disabled || this.editScheduled) return;
    if (this.messageId === '__pending__') return;

    const now = Date.now();
    const elapsed = now - this.lastEditTime;
    const bufferLen = this.accumulated.length;

    if (elapsed >= this.currentEditInterval && bufferLen >= this.config.bufferThreshold) {
      this.doEdit();
    }
  }

  private doEdit(): void {
    if (!this.messageId || this.messageId === '__pending__' || this.disabled) return;
    this.editScheduled = true;

    const safeLen = this.config.maxMessageLength - this.config.cursor.length - 100;
    const display =
      this.accumulated.length > safeLen ? this.accumulated.slice(0, safeLen) : this.accumulated;

    this.pendingEdit = this.editFn(this.messageId, display + this.config.cursor)
      .then(() => {
        this.lastEditTime = Date.now();
        this.editScheduled = false;
      })
      .catch(() => {
        this.floodStrikes++;
        this.currentEditInterval = Math.min(this.currentEditInterval * 2, 10_000);
        this.editScheduled = false;
        if (this.floodStrikes >= this.config.maxFloodStrikes) {
          this.disabled = true;
        }
      });
  }

  async flush(): Promise<void> {
    // Wait for any pending operations
    if (this.pendingEdit) {
      await this.pendingEdit;
      this.pendingEdit = null;
    }

    // Strip thinking tags from final text
    this.accumulated = this.buffer.replace(THINKING_TAG_RE, '');

    if (!this.accumulated) return;

    const safeLen = this.config.maxMessageLength - 100;
    const display =
      this.accumulated.length > safeLen ? this.accumulated.slice(0, safeLen) : this.accumulated;

    if (this.disabled || !this.messageId) {
      // Send full text as new message
      await this.sendFn(display);
    } else {
      // Final edit without cursor
      try {
        await this.editFn(this.messageId, display);
      } catch {
        // If edit fails, send as new message
        await this.sendFn(display);
      }
    }

    this.buffer = '';
    this.accumulated = '';
  }

  get isDisabled(): boolean {
    return this.disabled;
  }

  get fullText(): string {
    return this.buffer.replace(THINKING_TAG_RE, '');
  }
}
