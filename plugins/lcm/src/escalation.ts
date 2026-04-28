/**
 * Three-level summarization escalation.
 *
 * L1 — detailed LLM summary preserving decisions, files, commands, values.
 * L2 — aggressive bullet-only LLM summary at a reduced token budget.
 * L3 — deterministic head+tail truncation; no LLM; always succeeds.
 *
 * Each LLM level is "successful" if its cleaned output is shorter than the
 * source. On failure (too long or throws), the next level is attempted.
 *
 * No imports from @anthropic-ai/sdk or @anthropic-ai/claude-agent-sdk.
 * LLM calls are delegated to the caller-supplied `runSubagent` callback.
 */

// ── Thinking-block patterns ────────────────────────────────────────────────

const THINKING_PATTERNS = [
  /<think\b[^>]*>[\s\S]*?(<\/think>|$)/gi,
  /<thinking\b[^>]*>[\s\S]*?(<\/thinking>|$)/gi,
  /<reasoning\b[^>]*>[\s\S]*?(<\/reasoning>|$)/gi,
  /<thought\b[^>]*>[\s\S]*?(<\/thought>|$)/gi,
  /<REASONING_SCRATCHPAD\b[^>]*>[\s\S]*?(<\/REASONING_SCRATCHPAD>|$)/gi,
];

/**
 * Strip thinking-style markup blocks. Removes content (including tags) of:
 *   <think>...</think>
 *   <thinking>...</thinking>
 *   <reasoning>...</reasoning>
 *   <thought>...</thought>
 *   <REASONING_SCRATCHPAD>...</REASONING_SCRATCHPAD>
 * Case-insensitive. Multi-line. Unclosed tags are truncated at end-of-string.
 */
export function sanitizeThinkingBlocks(text: string): string {
  let out = text;
  for (const p of THINKING_PATTERNS) {
    // Reset lastIndex between calls on the same regex (global flag is stateful)
    p.lastIndex = 0;
    out = out.replace(p, '');
  }
  return out;
}

// ── Prompt templates ───────────────────────────────────────────────────────

const L1_PROMPT = (source: string, budget: number): string =>
  `Summarize this conversation segment, preserving key decisions, files, commands, and values. Stay below ${budget} tokens.\n\n---\n\n${source}`;

const L2_PROMPT = (source: string, budget: number): string =>
  `Produce an aggressive summary as bullets only. Preserve only: decisions, files, errors, state. Below ${budget} tokens.\n\n---\n\n${source}`;

// ── L3 deterministic truncation ────────────────────────────────────────────

function l3Truncate(source: string, totalCharBudget: number): string {
  if (source.length <= totalCharBudget) return source;
  const headLen = Math.floor(totalCharBudget * 0.4);
  const tailLen = Math.floor(totalCharBudget * 0.4);
  const head = source.slice(0, headLen);
  const tail = source.slice(source.length - tailLen);
  const omitted = source.length - headLen - tailLen;
  return `${head}\n[truncation: omitted ${omitted} chars]\n${tail}`;
}

// ── Public types ───────────────────────────────────────────────────────────

export interface EscalationOpts {
  /** Source text to summarize. */
  source: string;
  /** Hard char-truncation budget for L3 fallback (default 2048). */
  l3TruncateChars?: number;
  /** Token budget hint for L1. Used in the L1 prompt template. */
  l1TokenBudget: number;
  /** Multiplier for L2 budget relative to L1 (default 0.5). */
  l2BudgetRatio?: number;
  /** Caller's subagent runner. May be invoked by L1 and L2. */
  runSubagent: (args: {
    prompt: string;
    systemPrompt?: string;
    timeoutMs?: number;
  }) => Promise<string>;
  /** Logger; warn is required, debug optional. */
  logger?: {
    warn: (obj: unknown, msg: string) => void;
    debug?: (obj: unknown, msg: string) => void;
  };
}

export interface EscalationResult {
  summary: string;
  level: 'L1' | 'L2' | 'L3';
  /** Total LLM calls made (0 for pure L3, 1 for L1-only-success, 2 for L2-success). */
  attempts: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_L3_CHARS = 2048;
const DEFAULT_L2_RATIO = 0.5;

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Summarize `source` via cascading levels: L1 → L2 → L3.
 *
 * Each level is "successful" if the cleaned output is non-empty AND shorter
 * than the source. Thinking blocks are stripped before the length check.
 * L3 is deterministic and always succeeds.
 */
export async function summarizeWithEscalation(
  opts: EscalationOpts,
): Promise<EscalationResult> {
  const l3Chars = opts.l3TruncateChars ?? DEFAULT_L3_CHARS;
  const l2Ratio = opts.l2BudgetRatio ?? DEFAULT_L2_RATIO;
  const l1Budget = opts.l1TokenBudget;
  const l2Budget = Math.max(1, Math.floor(l1Budget * l2Ratio));
  let attempts = 0;

  // ── L1 ───────────────────────────────────────────────────────────────────
  try {
    attempts++;
    const raw = await opts.runSubagent({
      prompt: L1_PROMPT(opts.source, l1Budget),
      timeoutMs: 60_000,
    });
    const cleaned = sanitizeThinkingBlocks(raw).trim();
    if (cleaned.length > 0 && cleaned.length < opts.source.length) {
      opts.logger?.debug?.({ level: 'L1', outLen: cleaned.length }, 'L1 summarization succeeded');
      return { summary: cleaned, level: 'L1', attempts };
    }
    opts.logger?.warn?.(
      { level: 'L1', outLen: cleaned.length, srcLen: opts.source.length },
      'L1 summary not shorter than source — escalating',
    );
  } catch (err) {
    opts.logger?.warn?.({ err: String(err) }, 'L1 runSubagent threw — escalating');
  }

  // ── L2 ───────────────────────────────────────────────────────────────────
  try {
    attempts++;
    const raw = await opts.runSubagent({
      prompt: L2_PROMPT(opts.source, l2Budget),
      timeoutMs: 60_000,
    });
    const cleaned = sanitizeThinkingBlocks(raw).trim();
    if (cleaned.length > 0 && cleaned.length < opts.source.length) {
      opts.logger?.debug?.({ level: 'L2', outLen: cleaned.length }, 'L2 summarization succeeded');
      return { summary: cleaned, level: 'L2', attempts };
    }
    opts.logger?.warn?.(
      { level: 'L2', outLen: cleaned.length, srcLen: opts.source.length },
      'L2 summary not shorter than source — escalating',
    );
  } catch (err) {
    opts.logger?.warn?.({ err: String(err) }, 'L2 runSubagent threw — escalating');
  }

  // ── L3 — deterministic, always succeeds ─────────────────────────────────
  const summary = l3Truncate(opts.source, l3Chars);
  opts.logger?.debug?.({ level: 'L3', outLen: summary.length }, 'L3 deterministic truncation');
  return { summary, level: 'L3', attempts };
}
