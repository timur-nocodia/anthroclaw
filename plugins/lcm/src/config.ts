import { z } from 'zod';
import type { ResolvedLCMConfig as EngineConfig } from './engine.js';

// ─── Schema ───────────────────────────────────────────────────────────────────
//
// Field `.describe()` text powers the `?` tooltips in the UI plugin form.
// Keep them short, plain-English, and oriented to what changing the value does.

export const LCMConfigSchema = z.object({
  enabled: z.boolean()
    .default(false)
    .describe('Master switch for the plugin on this agent. When off, no ingest, no compression, no MCP tools — the plugin is dormant.'),

  tools: z.object({
    grep: z.boolean().default(true).describe('Expose lcm_grep — keyword/FTS search over compressed history.'),
    describe: z.boolean().default(true).describe('Expose lcm_describe — render a node\'s summary tree.'),
    expand: z.boolean().default(true).describe('Expose lcm_expand — pull a leaf back to full text on demand.'),
    expand_query: z.boolean().default(true).describe('Expose lcm_expand_query — natural-language fetch of relevant context.'),
    status: z.boolean().default(true).describe('Expose lcm_status — token budget + DAG health summary.'),
    doctor: z.boolean().default(true).describe('Expose lcm_doctor — diagnostic + repair operations on the DAG.'),
  })
    .default({ grep: true, describe: true, expand: true, expand_query: true, status: true, doctor: true })
    .describe('Per-tool toggles. Disable any tool the agent shouldn\'t see.'),

  triggers: z.object({
    compress_threshold_tokens: z.number().int().positive()
      .default(40_000)
      .describe('Compress history once context exceeds this many tokens. Lower = compress more aggressively.'),
    fresh_tail_count: z.number().int().nonnegative()
      .default(64)
      .describe('Most-recent N messages always kept verbatim — never summarized.'),
    assembly_cap_tokens: z.number().int().positive()
      .default(160_000)
      .describe('Hard ceiling for the assembled prompt. Above this, deeper layers get truncated.'),
    reserve_tokens_floor: z.number().int().nonnegative()
      .default(4_096)
      .describe('Minimum tokens reserved for the model\'s response — never consumed by context.'),
  })
    .default({ compress_threshold_tokens: 40_000, fresh_tail_count: 64, assembly_cap_tokens: 160_000, reserve_tokens_floor: 4_096 })
    .describe('When and how aggressively to compress conversation history.'),

  summarizer: z.object({
    summary_model: z.string()
      .optional()
      .describe('Anthropic model used to produce summaries. Leave blank to inherit the agent\'s model.'),
    expansion_model: z.string()
      .optional()
      .describe('Anthropic model used to expand summaries back to detail. Leave blank to inherit the agent\'s model.'),
    summary_timeout_ms: z.number().int().positive()
      .default(60_000)
      .describe('Max time per summarization call before giving up (ms).'),
    expansion_timeout_ms: z.number().int().positive()
      .default(120_000)
      .describe('Max time per expansion call before giving up (ms).'),
    dynamic_leaf_chunk: z.object({
      enabled: z.boolean().default(false).describe('Adapt leaf chunk size based on actual content density.'),
      max: z.number().int().positive().default(50_000).describe('Upper bound on a dynamically-sized leaf (tokens).'),
    })
      .default({ enabled: false, max: 50_000 })
      .describe('Adaptive leaf sizing — overrides the static leafChunkTokens derived from compress_threshold_tokens.'),
  })
    .default({ summary_timeout_ms: 60_000, expansion_timeout_ms: 120_000, dynamic_leaf_chunk: { enabled: false, max: 50_000 } })
    .describe('Models and timeouts for the LLM that summarizes / expands history.'),

  escalation: z.object({
    l1_budget_pct: z.number().min(0).max(1)
      .default(0.20)
      .describe('Fraction of total context budget L1 (mid-detail) layer is allowed to occupy.'),
    l1_budget_min: z.number().int().positive()
      .default(2_000)
      .describe('Minimum tokens reserved for L1 even when total budget is small.'),
    l1_budget_max: z.number().int().positive()
      .default(12_000)
      .describe('Maximum tokens L1 may use even when budget is large.'),
    l2_budget_ratio: z.number().min(0).max(1)
      .default(0.5)
      .describe('L2 (coarser) budget as a fraction of the L1 budget. 0.5 = half of L1\'s tokens.'),
    l3_truncate_tokens: z.number().int().positive()
      .default(512)
      .describe('Hard cutoff on L3 (coarsest) entries — anything longer is truncated.'),
  })
    .default({ l1_budget_pct: 0.20, l1_budget_min: 2_000, l1_budget_max: 12_000, l2_budget_ratio: 0.5, l3_truncate_tokens: 512 })
    .describe('How much of the context budget each summary layer is allowed to consume.'),

  dag: z.object({
    condensation_fanin: z.number().int().min(2)
      .default(4)
      .describe('How many child nodes collapse into one parent during condensation. Higher = shallower DAG, lossier per step.'),
    incremental_max_depth: z.number().int().min(0)
      .default(1)
      .describe('Max DAG depth to refresh on each incremental update. Higher = more thorough, slower.'),
    cache_friendly_condensation: z.object({
      enabled: z.boolean().default(false).describe('Defer condensation until enough debt has accumulated, to keep the prompt cache warm.'),
      min_debt_groups: z.number().int().min(1).default(2).describe('Wait until at least this many condensation groups are pending before running.'),
    })
      .default({ enabled: false, min_debt_groups: 2 })
      .describe('Trade freshness for prompt-cache hit rate.'),
  })
    .default({ condensation_fanin: 4, incremental_max_depth: 1, cache_friendly_condensation: { enabled: false, min_debt_groups: 2 } })
    .describe('Hierarchical condensation graph behavior.'),

  lifecycle: z.object({
    carry_over_on_session_reset: z.boolean()
      .default(true)
      .describe('When the agent\'s session rotates, copy a slice of summarized context into the new session.'),
    carry_over_retain_depth: z.number().int().min(0)
      .default(2)
      .describe('How many levels of the DAG to carry into the next session. 0 = nothing.'),
    deferred_maintenance: z.object({
      max_passes: z.number().int().min(0).default(4).describe('Max background condensation passes per maintenance run.'),
    })
      .default({ max_passes: 4 })
      .describe('Background maintenance budget — runs when the agent is idle.'),
  })
    .default({ carry_over_on_session_reset: true, carry_over_retain_depth: 2, deferred_maintenance: { max_passes: 4 } })
    .describe('Cross-session memory and background upkeep.'),

  sessions: z.object({
    ignore_session_patterns: z.array(z.string())
      .default([])
      .describe('Glob patterns for session keys that should never be ingested (e.g. ephemeral debug sessions).'),
    stateless_session_patterns: z.array(z.string())
      .default([])
      .describe('Glob patterns for sessions ingested but never carried forward — fresh start each time.'),
  })
    .default({ ignore_session_patterns: [], stateless_session_patterns: [] })
    .describe('Filter which sessions LCM tracks.'),

  pre_extraction: z.object({
    enabled: z.boolean().default(false).describe('Pre-extract structured facts from incoming messages before storing.'),
    extraction_dir: z.string().optional().describe('Directory where extracted facts are persisted. Leave blank for default.'),
  })
    .default({ enabled: false })
    .describe('Optional pre-pass that pulls structured facts out of raw turns.'),

  externalization: z.object({
    large_output: z.object({
      enabled: z.boolean().default(false).describe('Spill very large tool outputs to disk and reference them by handle.'),
      threshold_chars: z.number().int().positive().default(12_000).describe('Output longer than this many chars gets externalized.'),
    })
      .default({ enabled: false, threshold_chars: 12_000 })
      .describe('Move oversized tool outputs out of the transcript.'),
    transcript_gc: z.object({
      enabled: z.boolean().default(false).describe('Garbage-collect old transcript entries no longer reachable from the DAG.'),
    })
      .default({ enabled: false })
      .describe('Reclaim disk by pruning unreferenced transcript blobs.'),
  })
    .default({ large_output: { enabled: false, threshold_chars: 12_000 }, transcript_gc: { enabled: false } })
    .describe('On-disk overflow + cleanup behavior.'),

  operator: z.object({
    slash_command: z.object({
      enabled: z.boolean().default(false).describe('Expose /lcm slash commands for manual operations from chat.'),
    })
      .default({ enabled: false })
      .describe('Operator slash-command surface.'),
    doctor: z.object({
      clean_apply: z.object({
        enabled: z.boolean().default(false).describe('Allow lcm_doctor to apply repairs automatically without prompting.'),
      })
        .default({ enabled: false })
        .describe('Auto-apply doctor repairs (dangerous — only with trusted operators).'),
    })
      .default({ clean_apply: { enabled: false } })
      .describe('Doctor (repair tool) behavior toggles.'),
  })
    .default({ slash_command: { enabled: false }, doctor: { clean_apply: { enabled: false } } })
    .describe('Manual-operations surface for trusted operators.'),
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

// ─── toEngineConfig ───────────────────────────────────────────────────────────

/**
 * Flatten the rich LCMConfig into the engine's narrower ResolvedLCMConfig shape.
 *
 * Field mapping:
 *   leafChunkTokens          ← floor(triggers.compress_threshold_tokens / 16) (default: ~2500)
 *   condensationFanin        ← dag.condensation_fanin
 *   freshTailLength          ← triggers.fresh_tail_count
 *   assemblyCapTokens        ← triggers.assembly_cap_tokens
 *   l3TruncateChars          ← escalation.l3_truncate_tokens * 4 (rough char-from-token conversion)
 *   l2BudgetRatio            ← escalation.l2_budget_ratio
 *   dynamicLeafChunk         ← summarizer.dynamic_leaf_chunk.enabled
 *   cacheFriendlyCondensation ← dag.cache_friendly_condensation.enabled
 */
export function toEngineConfig(c: LCMConfig): EngineConfig {
  return {
    leafChunkTokens: Math.floor(c.triggers.compress_threshold_tokens / 16),
    condensationFanin: c.dag.condensation_fanin,
    freshTailLength: c.triggers.fresh_tail_count,
    assemblyCapTokens: c.triggers.assembly_cap_tokens,
    l3TruncateChars: c.escalation.l3_truncate_tokens * 4,
    l2BudgetRatio: c.escalation.l2_budget_ratio,
    dynamicLeafChunk: c.summarizer.dynamic_leaf_chunk.enabled,
    cacheFriendlyCondensation: c.dag.cache_friendly_condensation.enabled,
  };
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
