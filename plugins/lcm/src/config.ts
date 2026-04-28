import { z } from 'zod';

// ─── Schema ───────────────────────────────────────────────────────────────────

export const LCMConfigSchema = z.object({
  enabled: z.boolean().default(false),
  tools: z.object({
    grep: z.boolean().default(true),
    describe: z.boolean().default(true),
    expand: z.boolean().default(true),
    expand_query: z.boolean().default(true),
    status: z.boolean().default(true),
    doctor: z.boolean().default(true),
  }).default({ grep: true, describe: true, expand: true, expand_query: true, status: true, doctor: true }),
  triggers: z.object({
    compress_threshold_tokens: z.number().int().positive().default(40_000),
    fresh_tail_count: z.number().int().nonnegative().default(64),
    assembly_cap_tokens: z.number().int().positive().default(160_000),
    reserve_tokens_floor: z.number().int().nonnegative().default(4_096),
  }).default({ compress_threshold_tokens: 40_000, fresh_tail_count: 64, assembly_cap_tokens: 160_000, reserve_tokens_floor: 4_096 }),
  summarizer: z.object({
    summary_model: z.string().optional(),
    expansion_model: z.string().optional(),
    summary_timeout_ms: z.number().int().positive().default(60_000),
    expansion_timeout_ms: z.number().int().positive().default(120_000),
    dynamic_leaf_chunk: z.object({
      enabled: z.boolean().default(false),
      max: z.number().int().positive().default(50_000),
    }).default({ enabled: false, max: 50_000 }),
  }).default({ summary_timeout_ms: 60_000, expansion_timeout_ms: 120_000, dynamic_leaf_chunk: { enabled: false, max: 50_000 } }),
  escalation: z.object({
    l1_budget_pct: z.number().min(0).max(1).default(0.20),
    l1_budget_min: z.number().int().positive().default(2_000),
    l1_budget_max: z.number().int().positive().default(12_000),
    l2_budget_ratio: z.number().min(0).max(1).default(0.5),
    l3_truncate_tokens: z.number().int().positive().default(512),
  }).default({ l1_budget_pct: 0.20, l1_budget_min: 2_000, l1_budget_max: 12_000, l2_budget_ratio: 0.5, l3_truncate_tokens: 512 }),
  dag: z.object({
    condensation_fanin: z.number().int().min(2).default(4),
    incremental_max_depth: z.number().int().min(0).default(1),
    cache_friendly_condensation: z.object({
      enabled: z.boolean().default(false),
      min_debt_groups: z.number().int().min(1).default(2),
    }).default({ enabled: false, min_debt_groups: 2 }),
  }).default({ condensation_fanin: 4, incremental_max_depth: 1, cache_friendly_condensation: { enabled: false, min_debt_groups: 2 } }),
  lifecycle: z.object({
    carry_over_on_session_reset: z.boolean().default(true),
    carry_over_retain_depth: z.number().int().min(0).default(2),
    deferred_maintenance: z.object({
      max_passes: z.number().int().min(0).default(4),
    }).default({ max_passes: 4 }),
  }).default({ carry_over_on_session_reset: true, carry_over_retain_depth: 2, deferred_maintenance: { max_passes: 4 } }),
  sessions: z.object({
    ignore_session_patterns: z.array(z.string()).default([]),
    stateless_session_patterns: z.array(z.string()).default([]),
  }).default({ ignore_session_patterns: [], stateless_session_patterns: [] }),
  pre_extraction: z.object({
    enabled: z.boolean().default(false),
    extraction_dir: z.string().optional(),
  }).default({ enabled: false }),
  externalization: z.object({
    large_output: z.object({
      enabled: z.boolean().default(false),
      threshold_chars: z.number().int().positive().default(12_000),
    }).default({ enabled: false, threshold_chars: 12_000 }),
    transcript_gc: z.object({
      enabled: z.boolean().default(false),
    }).default({ enabled: false }),
  }).default({ large_output: { enabled: false, threshold_chars: 12_000 }, transcript_gc: { enabled: false } }),
  operator: z.object({
    slash_command: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
    doctor: z.object({
      clean_apply: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
    }).default({ clean_apply: { enabled: false } }),
  }).default({ slash_command: { enabled: false }, doctor: { clean_apply: { enabled: false } } }),
});

export type LCMConfig = z.infer<typeof LCMConfigSchema>;

// ─── Deep merge helper ────────────────────────────────────────────────────────

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    const t = (target as Record<string, unknown>)[k];
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      t !== null &&
      typeof t === 'object' &&
      !Array.isArray(t)
    ) {
      out[k] = deepMerge(
        t as Record<string, unknown>,
        v as Record<string, unknown>,
      );
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

// ─── resolveConfig ────────────────────────────────────────────────────────────

/**
 * Merge global defaults with per-agent overrides. Override wins. Both args
 * are parsed via LCMConfigSchema before merge — invalid inputs throw ZodError.
 *
 * Deep merge: nested objects are merged recursively; arrays and primitives
 * are replaced atomically by the override value (override wins).
 */
export function resolveConfig(globalRaw: unknown, perAgentRaw: unknown): LCMConfig {
  const base = LCMConfigSchema.parse(globalRaw ?? {});
  if (!perAgentRaw || typeof perAgentRaw !== 'object') {
    return base;
  }
  const merged = deepMerge(base as Record<string, unknown>, perAgentRaw as Record<string, unknown>);
  return LCMConfigSchema.parse(merged);
}
