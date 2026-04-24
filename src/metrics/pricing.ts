export interface PricingEntry {
  inputPerMillion: number;   // USD
  outputPerMillion: number;
  cacheReadPerMillion?: number;
}

const MODEL_PRICING: Record<string, PricingEntry> = {
  'claude-sonnet-4-6': { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3 },
  'claude-opus-4-6': { inputPerMillion: 15, outputPerMillion: 75, cacheReadPerMillion: 1.5 },
  'claude-haiku-4-5': { inputPerMillion: 0.8, outputPerMillion: 4, cacheReadPerMillion: 0.08 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens?: number,
): { costUsd: number; estimated: boolean } | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  let costUsd =
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion;

  if (cacheReadTokens && pricing.cacheReadPerMillion) {
    costUsd += (cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
  }

  return { costUsd, estimated: true };
}
