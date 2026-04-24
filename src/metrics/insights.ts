export interface UsageRecord {
  sessionKey: string;
  agentId: string;
  platform: string;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  toolCalls: Record<string, number>;
  durationMs: number;
  model: string;
}

export interface InsightsReport {
  totalSessions: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  topTools: Array<{ name: string; count: number }>;
  topModels: Array<{ model: string; sessions: number }>;
  periodDays: number;
}

const MAX_RECORDS = 10_000;

export class InsightsEngine {
  private records: UsageRecord[] = [];

  record(usage: UsageRecord): void {
    this.records.push(usage);
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(this.records.length - MAX_RECORDS);
    }
  }

  report(days = 30): InsightsReport {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const filtered = this.records.filter((r) => r.timestamp >= cutoff);

    const sessionKeys = new Set<string>();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    const toolCounts = new Map<string, number>();
    const modelCounts = new Map<string, number>();

    for (const r of filtered) {
      sessionKeys.add(r.sessionKey);
      totalInputTokens += r.inputTokens;
      totalOutputTokens += r.outputTokens;
      totalCacheReadTokens += r.cacheReadTokens;

      for (const [tool, count] of Object.entries(r.toolCalls)) {
        toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + count);
      }

      modelCounts.set(r.model, (modelCounts.get(r.model) ?? 0) + 1);
    }

    const topTools = [...toolCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topModels = [...modelCounts.entries()]
      .map(([model, sessions]) => ({ model, sessions }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 5);

    return {
      totalSessions: sessionKeys.size,
      totalMessages: filtered.length,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      topTools,
      topModels,
      periodDays: days,
    };
  }
}
