import { describe, it, expect } from 'vitest';
import { estimateCost } from '../../src/metrics/pricing.js';

describe('estimateCost', () => {
  // ─── Known models ──────────────────────────────────────────────

  it('calculates cost for claude-sonnet-4-6', () => {
    const result = estimateCost('claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(result).not.toBeNull();
    // 1M input * $3/M + 1M output * $15/M = $18
    expect(result!.costUsd).toBeCloseTo(18, 5);
    expect(result!.estimated).toBe(true);
  });

  it('calculates cost for claude-opus-4-6', () => {
    const result = estimateCost('claude-opus-4-6', 1_000_000, 1_000_000);
    expect(result).not.toBeNull();
    // 1M input * $15/M + 1M output * $75/M = $90
    expect(result!.costUsd).toBeCloseTo(90, 5);
  });

  it('calculates cost for claude-haiku-4-5', () => {
    const result = estimateCost('claude-haiku-4-5', 1_000_000, 1_000_000);
    expect(result).not.toBeNull();
    // 1M input * $0.8/M + 1M output * $4/M = $4.8
    expect(result!.costUsd).toBeCloseTo(4.8, 5);
  });

  // ─── Cache read tokens ─────────────────────────────────────────

  it('includes cache read cost when tokens provided', () => {
    const withCache = estimateCost('claude-sonnet-4-6', 1_000_000, 1_000_000, 1_000_000);
    const withoutCache = estimateCost('claude-sonnet-4-6', 1_000_000, 1_000_000);

    expect(withCache).not.toBeNull();
    expect(withoutCache).not.toBeNull();
    // Difference should be $0.3 (1M cache read tokens * $0.3/M)
    expect(withCache!.costUsd - withoutCache!.costUsd).toBeCloseTo(0.3, 5);
  });

  it('handles zero cache read tokens', () => {
    const result = estimateCost('claude-sonnet-4-6', 1_000_000, 1_000_000, 0);
    expect(result).not.toBeNull();
    // 0 cache tokens should not change the cost
    expect(result!.costUsd).toBeCloseTo(18, 5);
  });

  // ─── Unknown model ─────────────────────────────────────────────

  it('returns null for unknown model', () => {
    const result = estimateCost('gpt-4o', 1_000_000, 1_000_000);
    expect(result).toBeNull();
  });

  // ─── Small token counts ────────────────────────────────────────

  it('calculates cost for small token counts', () => {
    const result = estimateCost('claude-sonnet-4-6', 1000, 500);
    expect(result).not.toBeNull();
    // 1000 input * $3/M + 500 output * $15/M = $0.003 + $0.0075 = $0.0105
    expect(result!.costUsd).toBeCloseTo(0.0105, 5);
  });

  // ─── Zero tokens ───────────────────────────────────────────────

  it('returns zero cost for zero tokens', () => {
    const result = estimateCost('claude-sonnet-4-6', 0, 0);
    expect(result).not.toBeNull();
    expect(result!.costUsd).toBe(0);
    expect(result!.estimated).toBe(true);
  });

  // ─── estimated flag ────────────────────────────────────────────

  it('always sets estimated to true', () => {
    const result = estimateCost('claude-opus-4-6', 500, 200);
    expect(result).not.toBeNull();
    expect(result!.estimated).toBe(true);
  });
});
