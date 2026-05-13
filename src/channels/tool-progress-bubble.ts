import { getToolEmoji, buildToolPreview } from './tool-display.js';

const THROTTLE_MS = 1500;
const MAX_FLOOD_STRIKES = 3;
const MAX_MESSAGE_LENGTH = 4096;

export interface ToolProgressBubbleDeps {
  sendFn: (text: string) => Promise<string | null>;
  editFn: (messageId: string, text: string) => Promise<boolean>;
  deleteFn?: (messageId: string) => Promise<void>;
  config: {
    mode: 'all' | 'new' | 'off';
    subagentTools: 'parent' | 'all' | 'indented';
    cleanupProgress: boolean;
    previewLength: number;
    toolEmojiOverrides?: Record<string, string>;
  };
}

interface BubbleLine {
  toolUseId: string;
  text: string;
  indented: boolean;
  errored: boolean;
  repeatCount: number;
}

interface ToolStartPayload {
  toolName: string;
  toolInput: unknown;
  toolUseId: string;
  parentToolUseId?: string | null;
}

interface ToolErrorPayload {
  toolUseId: string;
  toolName: string;
}

export class ToolProgressBubble {
  private currentBubbleMessageId: string | null = null;
  private lines: BubbleLine[] = [];
  private seenToolsInBubble = new Set<string>();
  private breadcrumbMessageIds: string[] = [];
  private lastFlushAt = 0;
  private pendingTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private disabled = false;
  private floodStrikes = 0;
  private pendingSend: Promise<void> | null = null;

  constructor(private readonly deps: ToolProgressBubbleDeps) {}

  onToolStart(payload: ToolStartPayload): void {
    if (this.disabled || this.deps.config.mode === 'off') return;

    const isSubagentChild = !!payload.parentToolUseId && payload.toolName !== 'Task';
    if (isSubagentChild) {
      if (this.deps.config.subagentTools === 'parent') return;
    }

    if (this.deps.config.mode === 'new' && this.seenToolsInBubble.has(payload.toolName)) {
      return;
    }

    const emoji = getToolEmoji(payload.toolName, this.deps.config.toolEmojiOverrides);
    const preview = buildToolPreview(payload.toolName, payload.toolInput, this.deps.config.previewLength);
    const indented = isSubagentChild && this.deps.config.subagentTools === 'indented';
    const text = preview
      ? `${emoji} ${payload.toolName}: ${preview}`
      : `${emoji} ${payload.toolName}`;

    const last = this.lines.at(-1);
    if (last && !last.errored && last.text === text && last.indented === indented) {
      last.repeatCount += 1;
    } else {
      this.lines.push({
        toolUseId: payload.toolUseId,
        text,
        indented,
        errored: false,
        repeatCount: 0,
      });
    }

    this.seenToolsInBubble.add(payload.toolName);
    this.scheduleFlush();
  }

  onToolError(payload: ToolErrorPayload): void {
    if (this.disabled) return;
    const line = this.lines.find((l) => l.toolUseId === payload.toolUseId);
    if (!line) return;
    line.errored = true;
    this.scheduleFlush();
  }

  onContentBreak(): void {
    if (this.disabled) return;
    if (this.lines.length === 0) return;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    // Snapshot state to flush, then reset synchronously so subsequent
    // onToolStart calls start a fresh bubble rather than appending to the
    // lines that are about to be flushed.
    const linesToFlush = this.lines;
    const messageIdToFlush = this.currentBubbleMessageId;
    this.currentBubbleMessageId = null;
    this.lines = [];
    this.seenToolsInBubble.clear();
    this.lastFlushAt = 0;
    this.pendingSend = (this.pendingSend ?? Promise.resolve()).then(() =>
      this.doFlushSnapshot(linesToFlush, messageIdToFlush),
    );
  }

  async finalize(success: boolean, options?: { silent?: boolean }): Promise<void> {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    // Chain any remaining flush through pendingSend to respect ordering with
    // any in-flight onContentBreak doFlushSnapshot.
    if (this.lines.length > 0 && !this.disabled) {
      this.pendingSend = (this.pendingSend ?? Promise.resolve()).then(() => this.doFlush());
    }
    if (this.pendingSend) {
      await this.pendingSend.catch(() => {});
    }

    const shouldDelete = options?.silent || (this.deps.config.cleanupProgress && success);
    if (shouldDelete && this.deps.deleteFn) {
      for (const mid of this.breadcrumbMessageIds) {
        await this.deps.deleteFn(mid).catch(() => {});
      }
      this.breadcrumbMessageIds = [];
    }
  }

  private renderLine(l: BubbleLine): string {
    let s = l.text;
    if (l.repeatCount > 0) s += ` (×${l.repeatCount + 1})`;
    if (l.errored) s += ' ❌';
    if (l.indented) s = '  ' + s;
    return s;
  }

  private renderBubble(): string {
    let s = this.lines.map((l) => this.renderLine(l)).join('\n');
    if (s.length > MAX_MESSAGE_LENGTH) {
      const cut = s.lastIndexOf('\n', MAX_MESSAGE_LENGTH - 1);
      s = cut > 0 ? s.slice(0, cut) : s.slice(0, MAX_MESSAGE_LENGTH);
    }
    return s;
  }

  private scheduleFlush(): void {
    if (this.pendingTimer || this.disabled || this.flushing) return;
    const elapsed = Date.now() - this.lastFlushAt;
    const wait = elapsed >= THROTTLE_MS ? 0 : THROTTLE_MS - elapsed;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      // Chain through pendingSend so that any in-progress onContentBreak reset
      // (which clears currentBubbleMessageId) completes before we flush.
      this.pendingSend = (this.pendingSend ?? Promise.resolve()).then(() => this.doFlush());
    }, wait);
  }

  private async doFlush(): Promise<void> {
    if (this.disabled || this.lines.length === 0) return;
    if (this.flushing) return;
    this.flushing = true;
    try {
      const text = this.renderBubble();
      if (this.currentBubbleMessageId) {
        const ok = await this.deps.editFn(this.currentBubbleMessageId, text).catch(() => false);
        if (!ok) {
          this.floodStrikes += 1;
          if (this.floodStrikes >= MAX_FLOOD_STRIKES) this.disabled = true;
        } else {
          this.floodStrikes = 0;
        }
      } else {
        const id = await this.deps.sendFn(text).catch(() => null);
        if (id) {
          this.currentBubbleMessageId = id;
          this.breadcrumbMessageIds.push(id);
          this.floodStrikes = 0;
        } else {
          this.floodStrikes += 1;
          if (this.floodStrikes >= MAX_FLOOD_STRIKES) this.disabled = true;
        }
      }
      this.lastFlushAt = Date.now();
    } finally {
      this.flushing = false;
    }
  }

  /** Flush a snapshot captured by onContentBreak (does not touch this.lines). */
  private async doFlushSnapshot(lines: BubbleLine[], messageId: string | null): Promise<void> {
    if (this.disabled || lines.length === 0) return;
    const text = lines.map((l) => this.renderLine(l)).join('\n').slice(0, MAX_MESSAGE_LENGTH);
    if (messageId) {
      const ok = await this.deps.editFn(messageId, text).catch(() => false);
      if (!ok) {
        this.floodStrikes += 1;
        if (this.floodStrikes >= MAX_FLOOD_STRIKES) this.disabled = true;
      } else {
        this.floodStrikes = 0;
      }
    } else {
      const id = await this.deps.sendFn(text).catch(() => null);
      if (id) {
        this.breadcrumbMessageIds.push(id);
        this.floodStrikes = 0;
      } else {
        this.floodStrikes += 1;
        if (this.floodStrikes >= MAX_FLOOD_STRIKES) this.disabled = true;
      }
    }
  }
}
