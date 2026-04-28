import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { LCMConfigSchema, resolveConfig, toEngineConfig, type LCMConfig } from '../src/config.js';

// ─── Schema defaults ──────────────────────────────────────────────────────────

describe('LCMConfigSchema — defaults', () => {
  it('empty input {} → all defaults applied', () => {
    const cfg = LCMConfigSchema.parse({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.tools.grep).toBe(true);
    expect(cfg.tools.describe).toBe(true);
    expect(cfg.tools.expand).toBe(true);
    expect(cfg.tools.expand_query).toBe(true);
    expect(cfg.tools.status).toBe(true);
    expect(cfg.tools.doctor).toBe(true);
    expect(cfg.triggers.compress_threshold_tokens).toBe(40_000);
    expect(cfg.triggers.fresh_tail_count).toBe(64);
    expect(cfg.triggers.assembly_cap_tokens).toBe(160_000);
    expect(cfg.triggers.reserve_tokens_floor).toBe(4_096);
    expect(cfg.summarizer.summary_timeout_ms).toBe(60_000);
    expect(cfg.summarizer.expansion_timeout_ms).toBe(120_000);
    expect(cfg.summarizer.dynamic_leaf_chunk.enabled).toBe(false);
    expect(cfg.summarizer.dynamic_leaf_chunk.max).toBe(50_000);
    expect(cfg.escalation.l1_budget_pct).toBe(0.20);
    expect(cfg.escalation.l1_budget_min).toBe(2_000);
    expect(cfg.escalation.l1_budget_max).toBe(12_000);
    expect(cfg.escalation.l2_budget_ratio).toBe(0.5);
    expect(cfg.escalation.l3_truncate_tokens).toBe(512);
    expect(cfg.dag.condensation_fanin).toBe(4);
    expect(cfg.dag.incremental_max_depth).toBe(1);
    expect(cfg.dag.cache_friendly_condensation.enabled).toBe(false);
    expect(cfg.dag.cache_friendly_condensation.min_debt_groups).toBe(2);
    expect(cfg.lifecycle.carry_over_on_session_reset).toBe(true);
    expect(cfg.lifecycle.carry_over_retain_depth).toBe(2);
    expect(cfg.lifecycle.deferred_maintenance.max_passes).toBe(4);
    expect(cfg.sessions.ignore_session_patterns).toEqual([]);
    expect(cfg.sessions.stateless_session_patterns).toEqual([]);
    expect(cfg.pre_extraction.enabled).toBe(false);
    expect(cfg.externalization.large_output.enabled).toBe(false);
    expect(cfg.externalization.large_output.threshold_chars).toBe(12_000);
    expect(cfg.externalization.transcript_gc.enabled).toBe(false);
    expect(cfg.operator.slash_command.enabled).toBe(false);
    expect(cfg.operator.doctor.clean_apply.enabled).toBe(false);
  });

  it('{enabled: true} parses, all other fields defaulted', () => {
    const cfg = LCMConfigSchema.parse({ enabled: true });
    expect(cfg.enabled).toBe(true);
    expect(cfg.tools.grep).toBe(true);
    expect(cfg.triggers.compress_threshold_tokens).toBe(40_000);
  });

  it('partial input {tools: {grep: false}} → grep=false, others default-true', () => {
    const cfg = LCMConfigSchema.parse({ tools: { grep: false } });
    expect(cfg.tools.grep).toBe(false);
    expect(cfg.tools.describe).toBe(true);
    expect(cfg.tools.expand).toBe(true);
    expect(cfg.tools.expand_query).toBe(true);
    expect(cfg.tools.status).toBe(true);
    expect(cfg.tools.doctor).toBe(true);
  });
});

// ─── Numeric constraints ──────────────────────────────────────────────────────

describe('LCMConfigSchema — numeric constraints', () => {
  it('triggers.compress_threshold_tokens=-1 throws (must be positive)', () => {
    expect(() =>
      LCMConfigSchema.parse({ triggers: { compress_threshold_tokens: -1 } }),
    ).toThrow(ZodError);
  });

  it('triggers.compress_threshold_tokens=0 throws (must be positive)', () => {
    expect(() =>
      LCMConfigSchema.parse({ triggers: { compress_threshold_tokens: 0 } }),
    ).toThrow(ZodError);
  });

  it('dag.condensation_fanin=1 throws (min 2)', () => {
    expect(() =>
      LCMConfigSchema.parse({ dag: { condensation_fanin: 1 } }),
    ).toThrow(ZodError);
  });

  it('dag.condensation_fanin=2 accepted (boundary)', () => {
    const cfg = LCMConfigSchema.parse({ dag: { condensation_fanin: 2 } });
    expect(cfg.dag.condensation_fanin).toBe(2);
  });

  it('dag.incremental_max_depth=0 accepted (min 0)', () => {
    const cfg = LCMConfigSchema.parse({ dag: { incremental_max_depth: 0 } });
    expect(cfg.dag.incremental_max_depth).toBe(0);
  });

  it('dag.incremental_max_depth=-1 throws (min 0)', () => {
    expect(() =>
      LCMConfigSchema.parse({ dag: { incremental_max_depth: -1 } }),
    ).toThrow(ZodError);
  });

  it('escalation.l1_budget_pct=1.5 throws (max 1)', () => {
    expect(() =>
      LCMConfigSchema.parse({ escalation: { l1_budget_pct: 1.5 } }),
    ).toThrow(ZodError);
  });

  it('escalation.l1_budget_pct=0.5 accepted', () => {
    const cfg = LCMConfigSchema.parse({ escalation: { l1_budget_pct: 0.5 } });
    expect(cfg.escalation.l1_budget_pct).toBe(0.5);
  });

  it('escalation.l1_budget_pct=-0.1 throws (min 0)', () => {
    expect(() =>
      LCMConfigSchema.parse({ escalation: { l1_budget_pct: -0.1 } }),
    ).toThrow(ZodError);
  });

  it('lifecycle.carry_over_retain_depth=-1 throws (min 0)', () => {
    expect(() =>
      LCMConfigSchema.parse({ lifecycle: { carry_over_retain_depth: -1 } }),
    ).toThrow(ZodError);
  });

  it('lifecycle.carry_over_retain_depth=0 accepted (min 0)', () => {
    const cfg = LCMConfigSchema.parse({ lifecycle: { carry_over_retain_depth: 0 } });
    expect(cfg.lifecycle.carry_over_retain_depth).toBe(0);
  });

  it('externalization.large_output.threshold_chars=-1 throws (must be positive)', () => {
    expect(() =>
      LCMConfigSchema.parse({ externalization: { large_output: { threshold_chars: -1 } } }),
    ).toThrow(ZodError);
  });
});

// ─── Boolean fields ───────────────────────────────────────────────────────────

describe('LCMConfigSchema — boolean fields reject non-booleans', () => {
  it('enabled: "yes" throws', () => {
    expect(() =>
      LCMConfigSchema.parse({ enabled: 'yes' }),
    ).toThrow(ZodError);
  });

  it('tools.grep: 1 throws', () => {
    expect(() =>
      LCMConfigSchema.parse({ tools: { grep: 1 } }),
    ).toThrow(ZodError);
  });
});

// ─── Array fields ─────────────────────────────────────────────────────────────

describe('LCMConfigSchema — array fields', () => {
  it('sessions.ignore_session_patterns: array of strings accepted', () => {
    const cfg = LCMConfigSchema.parse({
      sessions: { ignore_session_patterns: ['foo', 'bar'] },
    });
    expect(cfg.sessions.ignore_session_patterns).toEqual(['foo', 'bar']);
  });

  it('sessions.ignore_session_patterns: non-array throws', () => {
    expect(() =>
      LCMConfigSchema.parse({ sessions: { ignore_session_patterns: 'not-array' } }),
    ).toThrow(ZodError);
  });
});

// ─── Optional fields ──────────────────────────────────────────────────────────

describe('LCMConfigSchema — optional fields', () => {
  it('pre_extraction.extraction_dir: string optional, not required', () => {
    const cfg = LCMConfigSchema.parse({});
    expect(cfg.pre_extraction.extraction_dir).toBeUndefined();
  });

  it('pre_extraction.extraction_dir: string value accepted', () => {
    const cfg = LCMConfigSchema.parse({ pre_extraction: { extraction_dir: '/tmp/lcm' } });
    expect(cfg.pre_extraction.extraction_dir).toBe('/tmp/lcm');
  });

  it('summarizer.summary_model: not required when absent', () => {
    const cfg = LCMConfigSchema.parse({});
    expect(cfg.summarizer.summary_model).toBeUndefined();
  });

  it('summarizer.expansion_model: string value accepted', () => {
    const cfg = LCMConfigSchema.parse({ summarizer: { expansion_model: 'claude-haiku' } });
    expect(cfg.summarizer.expansion_model).toBe('claude-haiku');
  });
});

// ─── resolveConfig ────────────────────────────────────────────────────────────

describe('resolveConfig', () => {
  it('global={enabled:true} + override={tools:{grep:false}} → merged correctly', () => {
    const result = resolveConfig({ enabled: true }, { tools: { grep: false } });
    expect(result.enabled).toBe(true);
    expect(result.tools.grep).toBe(false);
    expect(result.tools.describe).toBe(true);
    expect(result.tools.expand).toBe(true);
  });

  it('deep-merges nested groups: override.triggers.fresh_tail_count=10 leaves other triggers intact', () => {
    const global = { triggers: { compress_threshold_tokens: 1_000 } };
    const override = { triggers: { fresh_tail_count: 10 } };
    const result = resolveConfig(global, override);
    expect(result.triggers.compress_threshold_tokens).toBe(1_000);
    expect(result.triggers.fresh_tail_count).toBe(10);
    expect(result.triggers.assembly_cap_tokens).toBe(160_000); // default
  });

  it('array fields are replaced not concatenated on override', () => {
    const global = { sessions: { ignore_session_patterns: ['a'] } };
    const override = { sessions: { ignore_session_patterns: ['b'] } };
    const result = resolveConfig(global, override);
    expect(result.sessions.ignore_session_patterns).toEqual(['b']);
  });

  it('undefined override → returns global config as-is', () => {
    const result = resolveConfig({ enabled: true }, undefined);
    expect(result.enabled).toBe(true);
  });

  it('null override → returns global config as-is', () => {
    const result = resolveConfig({ enabled: true }, null);
    expect(result.enabled).toBe(true);
  });

  it('invalid override (compress_threshold_tokens=-1) → throws ZodError', () => {
    expect(() =>
      resolveConfig({}, { triggers: { compress_threshold_tokens: -1 } }),
    ).toThrow(ZodError);
  });

  it('override of optional field summarizer.summary_model → present in result', () => {
    const result = resolveConfig({}, { summarizer: { summary_model: 'claude-sonnet' } });
    expect(result.summarizer.summary_model).toBe('claude-sonnet');
  });

  it('override {enabled: undefined} does not overwrite global enabled', () => {
    const result = resolveConfig({ enabled: true }, { enabled: undefined });
    expect(result.enabled).toBe(true);
  });

  it('both global and override defaulted → all defaults', () => {
    const result = resolveConfig({}, {});
    expect(result.enabled).toBe(false);
    expect(result.triggers.compress_threshold_tokens).toBe(40_000);
  });

  it('global triggers override, then per-agent further overrides a subset', () => {
    const global = {
      enabled: true,
      triggers: { compress_threshold_tokens: 1_000 },
    };
    const override = { triggers: { fresh_tail_count: 8 } };
    const result = resolveConfig(global, override);
    expect(result.enabled).toBe(true);
    expect(result.triggers.compress_threshold_tokens).toBe(1_000);
    expect(result.triggers.fresh_tail_count).toBe(8);
  });

  it('override escalation deep-merges: only l1_budget_pct changes', () => {
    const global = { escalation: { l1_budget_min: 5_000 } };
    const override = { escalation: { l1_budget_pct: 0.3 } };
    const result = resolveConfig(global, override);
    expect(result.escalation.l1_budget_pct).toBe(0.3);
    expect(result.escalation.l1_budget_min).toBe(5_000);
    expect(result.escalation.l1_budget_max).toBe(12_000); // default
  });

  it('type check: LCMConfig has expected shape at compile time (structural assertion)', () => {
    const cfg: LCMConfig = LCMConfigSchema.parse({});
    // structural compile-time check via property access
    const _e: boolean = cfg.enabled;
    const _g: boolean = cfg.tools.grep;
    const _t: number = cfg.triggers.compress_threshold_tokens;
    const _s: string | undefined = cfg.summarizer.summary_model;
    const _p: string[] = cfg.sessions.ignore_session_patterns;
    expect(_e).toBeDefined();
    expect(_g).toBeDefined();
    expect(_t).toBeDefined();
    expect(_p).toBeInstanceOf(Array);
  });
});

// ─── toEngineConfig ───────────────────────────────────────────────────────────

describe('toEngineConfig', () => {
  it('maps all LCMConfig fields to engine ResolvedLCMConfig correctly', () => {
    const cfg = LCMConfigSchema.parse({
      triggers: {
        compress_threshold_tokens: 40_000,
        fresh_tail_count: 64,
        assembly_cap_tokens: 160_000,
      },
      escalation: {
        l3_truncate_tokens: 512,
        l2_budget_ratio: 0.5,
      },
      dag: {
        condensation_fanin: 4,
        cache_friendly_condensation: { enabled: false },
      },
      summarizer: {
        dynamic_leaf_chunk: { enabled: false },
      },
    });
    const ec = toEngineConfig(cfg);
    // leafChunkTokens = floor(40_000 / 16) = 2500
    expect(ec.leafChunkTokens).toBe(2500);
    expect(ec.condensationFanin).toBe(4);
    expect(ec.freshTailLength).toBe(64);
    expect(ec.assemblyCapTokens).toBe(160_000);
    // l3TruncateChars = 512 * 4 = 2048
    expect(ec.l3TruncateChars).toBe(2048);
    expect(ec.l2BudgetRatio).toBe(0.5);
    expect(ec.dynamicLeafChunk).toBe(false);
    expect(ec.cacheFriendlyCondensation).toBe(false);
  });

  it('dynamic leaf chunk and cache friendly condensation set to true when enabled', () => {
    const cfg = LCMConfigSchema.parse({
      summarizer: { dynamic_leaf_chunk: { enabled: true } },
      dag: { cache_friendly_condensation: { enabled: true } },
    });
    const ec = toEngineConfig(cfg);
    expect(ec.dynamicLeafChunk).toBe(true);
    expect(ec.cacheFriendlyCondensation).toBe(true);
  });

  it('custom compress_threshold_tokens produces correct leafChunkTokens', () => {
    const cfg = LCMConfigSchema.parse({ triggers: { compress_threshold_tokens: 32_000 } });
    const ec = toEngineConfig(cfg);
    expect(ec.leafChunkTokens).toBe(2000);
  });
});
