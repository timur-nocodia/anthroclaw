import { logger } from '../logger.js';

export interface BudgetConfig {
  maxToolCalls: number;
  timeoutMs: number;
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
  private exhausted = false;

  constructor(config?: Partial<BudgetConfig>) {
    this.config = { ...DEFAULT_BUDGET, ...config };
  }

  start(): void {
    this.toolCallCount = 0;
    this.startTime = Date.now();
    this.exhausted = false;
  }

  recordToolCall(): boolean {
    this.toolCallCount++;
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
    if (Date.now() - this.startTime >= this.config.timeoutMs) {
      this.exhausted = true;
      logger.info(
        { elapsed: Date.now() - this.startTime, timeout: this.config.timeoutMs },
        'Iteration budget exhausted: timeout',
      );
      return true;
    }
    return false;
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

  get stats(): { toolCalls: number; elapsedMs: number } {
    return {
      toolCalls: this.toolCallCount,
      elapsedMs: Date.now() - this.startTime,
    };
  }
}
