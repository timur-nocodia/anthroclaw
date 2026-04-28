/**
 * Pre-compaction extraction — extract decisions and key findings before summarization.
 *
 * Best-effort: failures never block compaction. Extracted content is written to
 * daily note files so key decisions survive even if the LCM summary loses nuance.
 *
 * Design decisions:
 * - runSubagent is dependency-injected; no @anthropic-ai/sdk import here.
 * - runExtraction NEVER throws — all errors are caught and logged as warnings.
 * - File path uses UTC date to be consistent across timezones.
 * - Media blobs are stripped from the source before sending to the LLM.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export type RunSubagentFn = (opts: {
  prompt: string;
  systemPrompt?: string;
  timeoutMs?: number;
}) => Promise<string>;

export interface ExtractionDeps {
  runSubagent: RunSubagentFn;
  /** Absolute path to the extraction output directory; created if missing. */
  extractionDir: string;
  logger: {
    warn: (obj: unknown, msg: string) => void;
    debug: (obj: unknown, msg: string) => void;
    info?: (obj: unknown, msg: string) => void;
  };
  /** Optional: defaults to 60_000 ms. */
  timeoutMs?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 60_000;

const EXTRACTION_SYSTEM_PROMPT = `You are a context-extraction assistant. Read the provided
conversation segment and produce a concise markdown summary of:

- Decisions made (with date if mentioned)
- Files referenced or created
- Errors encountered (with stack traces if present)
- Key facts and values
- Open questions / TODOs

Format as a markdown bullet list grouped by category. Be exhaustive but terse.
If a category has no items, omit it.`;

// ─── Regexes ──────────────────────────────────────────────────────────────────

/** Matches inline data URIs: data:<mime>;base64,<chars> */
const MEDIA_REGEX = /data:[a-z0-9+/]+;base64,[A-Za-z0-9+/=]+/gi;

/** Matches JSON-string values of ≥200 base64-shaped characters. */
const BIG_B64_REGEX = /"([A-Za-z0-9+/=]{200,})"/g;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pre-compaction extraction. Calls runSubagent with an extraction system-prompt to
 * pull out structured findings (decisions, files, errors, etc.) from the source text,
 * then appends the result to {extractionDir}/{YYYY-MM-DD}.md (UTC date).
 *
 * Best-effort: never throws. On any error (subagent timeout, file write fail, etc.)
 * logs a warning and returns. Caller's compress flow should not be blocked.
 */
export async function runExtraction(
  deps: ExtractionDeps,
  sourceText: string
): Promise<void> {
  try {
    const sanitized = sanitizeMediaForLLM(sourceText);
    const result = await deps.runSubagent({
      prompt: sanitized,
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT,
    });
    if (!result || !result.trim()) {
      deps.logger.debug({}, 'extraction produced empty result; skipping write');
      return;
    }
    await appendToTodayFile(deps.extractionDir, result);
    deps.logger.info?.({}, `extraction written to ${deps.extractionDir}`);
  } catch (err) {
    deps.logger.warn({ err: String(err) }, 'extraction failed (best-effort, skipping)');
  }
}

/**
 * Strip base64 inline-data URLs (e.g. `data:image/png;base64,...`) from `content`,
 * replacing each with `[Media attachment]`. Used before sending content to the LLM
 * to avoid feeding huge base64 blobs into the context window.
 *
 * Pattern: `data:<mime>;base64,<b64-chars>`
 */
export function sanitizeMediaForLLM(content: string): string {
  return content.replace(MEDIA_REGEX, '[Media attachment]');
}

/**
 * Strip suspiciously long base64 strings from JSON-encoded tool_calls arguments.
 * Replaces any `"<base64-shaped-string>"` of length ≥ 200 with `"<binary-omitted: N chars>"`.
 *
 * Used by externalize.ts and engine.ts before sending tool_calls to the LLM.
 */
export function sanitizeToolArgsForLLM(toolCallsJson: string): string {
  return toolCallsJson.replace(
    BIG_B64_REGEX,
    (_match: string, blob: string) => `"<binary-omitted: ${blob.length} chars>"`
  );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function appendToTodayFile(dir: string, content: string): Promise<void> {
  const { mkdir, appendFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const file = join(dir, `${today}.md`);
  const ts = new Date().toISOString();
  const block = `\n---\n## ${ts}\n\n${content.trim()}\n`;
  await appendFile(file, block, 'utf8');
}
