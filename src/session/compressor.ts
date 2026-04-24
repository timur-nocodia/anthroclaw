import { logger } from '../logger.js';

export interface CompressConfig {
  enabled: boolean;
  thresholdMessages: number;
}

const DEFAULT_CONFIG: CompressConfig = {
  enabled: true,
  thresholdMessages: 30,
};

export class SessionCompressor {
  private config: CompressConfig;

  constructor(config?: Partial<CompressConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  shouldCompress(messageCount: number): boolean {
    if (!this.config.enabled) return false;
    return messageCount >= this.config.thresholdMessages;
  }

  getPressureLevel(messageCount: number): 'green' | 'yellow' | 'orange' | 'red' {
    if (!this.config.enabled) return 'green';
    const ratio = messageCount / this.config.thresholdMessages;
    if (ratio >= 0.95) return 'red';
    if (ratio >= 0.80) return 'orange';
    if (ratio >= 0.50) return 'yellow';
    return 'green';
  }

  getPressureWarning(messageCount: number): string | null {
    const level = this.getPressureLevel(messageCount);
    const pct = Math.round((messageCount / this.config.thresholdMessages) * 100);
    if (level === 'red') return `🔴 Context ${pct}% full — compression imminent`;
    if (level === 'orange') return `🟠 Context ${pct}% full — consider wrapping up`;
    return null;
  }

  get summaryPrompt(): string {
    return [
      '[system] Session context is getting large. Summarize this conversation for memory storage.',
      'Format as structured bullets under these headers:',
      '- KEY DECISIONS made',
      '- PENDING questions/tasks',
      '- IMPORTANT FACTS learned',
      '- REMAINING WORK to do',
      'Be concise. Use the language of the conversation.',
      'Use tool memory_write to save the summary.',
    ].join('\n');
  }
}
