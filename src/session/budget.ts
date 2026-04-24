import { logger } from '../logger.js';

export interface BudgetConfig {
  maxToolCalls: number;
  timeoutMs: number;
  absoluteTimeoutMs?: number;
  graceMessage: boolean;
}

const DEFAULT_BUDGET: BudgetConfig = {
  maxToolCalls: 30,
  timeoutMs: 120_000,
  graceMessage: true,
};

export class IterationBudget {
  private config: BudgetConfig;
  private toolCallCount = 0;
  private startTime = 0;
  private lastActivityAt = 0;
  private lastEventType = 'start';
  private exhausted = false;

  constructor(config?: Partial<BudgetConfig>) {
    this.config = { ...DEFAULT_BUDGET, ...config };
  }

  start(): void {
    this.toolCallCount = 0;
    this.startTime = Date.now();
    this.lastActivityAt = this.startTime;
    this.lastEventType = 'start';
    this.exhausted = false;
  }

  recordActivity(eventType = 'activity'): void {
    this.lastActivityAt = Date.now();
    this.lastEventType = eventType;
  }

  recordToolCall(): boolean {
    this.toolCallCount++;
    this.recordActivity('tool_use');
    if (this.toolCallCount >= this.config.maxToolCalls) {
      this.exhausted = true;
      logger.info(
        { toolCalls: this.toolCallCount, max: this.config.maxToolCalls },
        'Iteration budget exhausted: tool call limit',
      );
      return true;
    }
    return false;
  }

  isTimeoutExceeded(): boolean {
    const now = Date.now();
    const idleMs = now - this.lastActivityAt;
    if (idleMs >= this.config.timeoutMs) {
      this.exhausted = true;
      logger.info(
        { idleMs, timeout: this.config.timeoutMs, lastEventType: this.lastEventType },
        'Iteration budget exhausted: inactivity timeout',
      );
      return true;
    }
    return false;
  }

  isAbsoluteTimeoutExceeded(): boolean {
    if (!this.config.absoluteTimeoutMs) return false;
    const elapsedMs = Date.now() - this.startTime;
    if (elapsedMs >= this.config.absoluteTimeoutMs) {
      this.exhausted = true;
      logger.info(
        { elapsedMs, timeout: this.config.absoluteTimeoutMs },
        'Iteration budget exhausted: absolute timeout',
      );
      return true;
    }
    return false;
  }

  shouldInterrupt(): boolean {
    return this.isTimeoutExceeded() || this.isAbsoluteTimeoutExceeded();
  }

  get timeUntilInterruptMs(): number {
    const now = Date.now();
    const inactivityRemaining = this.config.timeoutMs - (now - this.lastActivityAt);
    const absoluteRemaining = this.config.absoluteTimeoutMs
      ? this.config.absoluteTimeoutMs - (now - this.startTime)
      : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(inactivityRemaining, absoluteRemaining));
  }

  isExhausted(): boolean {
    return this.exhausted;
  }

  get graceMessage(): boolean {
    return this.config.graceMessage;
  }

  getPressureWarning(): string | null {
    const ratio = this.toolCallCount / this.config.maxToolCalls;
    if (ratio >= 0.9) return '⚠️ 90% of iteration budget used. Respond NOW with what you have.';
    if (ratio >= 0.7) return '⚠️ 70% of iteration budget used. Consolidate your work.';
    return null;
  }

  get stats(): { toolCalls: number; elapsedMs: number; idleMs: number; lastActivityAt: number; lastEventType: string } {
    const now = Date.now();
    return {
      toolCalls: this.toolCallCount,
      elapsedMs: now - this.startTime,
      idleMs: now - this.lastActivityAt,
      lastActivityAt: this.lastActivityAt,
      lastEventType: this.lastEventType,
    };
  }
}
