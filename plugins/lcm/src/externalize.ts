/**
 * externalize.ts — large tool output → JSON file (opt-in).
 *
 * When a tool result exceeds `thresholdChars`, write it to a content-addressed
 * JSON file and return a compact placeholder string + ref filename.
 * Callers can reconstruct the full payload via `readExternalizedPayload`.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface ExternalizeDeps {
  /** Absolute path to directory where large output JSON files are stored. */
  largeOutputsDir: string;
  /** Content length threshold (exclusive): content.length > thresholdChars triggers externalization. */
  thresholdChars: number;
  logger: { warn: (obj: unknown, msg: string) => void; debug?: (obj: unknown, msg: string) => void };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sha256Prefix(text: string, len = 16): string {
  return createHash('sha256').update(text).digest('hex').slice(0, len);
}

function formatPlaceholder(
  content: string,
  toolCallId: string | undefined,
  filename: string,
): string {
  const chars = content.length;
  const bytes = Buffer.byteLength(content, 'utf8');
  const tcid = toolCallId ?? '';
  return `[Externalized tool output: tool_call_id=${tcid}; chars=${chars}; bytes=${bytes}; ref=${filename}]`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * If `content.length` exceeds `thresholdChars`, write content + metadata as JSON
 * to `{largeOutputsDir}/{sha256_prefix}-{tool_call_id_or_hash}.json` and return
 * a placeholder + ref.  Else returns null.
 *
 * Placeholder format:
 *   `[Externalized tool output: tool_call_id=X; chars=N; bytes=M; ref=filename]`
 *
 * `ref` is the filename (relative, not absolute) — caller uses
 * `readExternalizedPayload` to fetch.
 */
export function maybeExternalize(
  deps: ExternalizeDeps,
  content: string,
  toolCallId: string | undefined,
  toolName: string | undefined,
): { placeholder: string; ref: string } | null {
  if (!content || content.length <= deps.thresholdChars) return null;

  try {
    mkdirSync(deps.largeOutputsDir, { recursive: true });

    const hashPrefix = sha256Prefix(content, 16);
    const safeId = (toolCallId ?? hashPrefix)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 32);
    const filename = `${hashPrefix}-${safeId}.json`;
    const filePath = join(deps.largeOutputsDir, filename);

    // Content-addressed: if the file already exists the payload is identical.
    if (!existsSync(filePath)) {
      const payload = {
        tool_call_id: toolCallId ?? null,
        tool_name: toolName ?? null,
        content,
        ts: Date.now(),
        sha256: createHash('sha256').update(content).digest('hex'),
        bytes: Buffer.byteLength(content, 'utf8'),
      };
      writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    }

    const placeholder = formatPlaceholder(content, toolCallId, filename);
    return { placeholder, ref: filename };
  } catch (err) {
    deps.logger.warn(
      { err: String(err) },
      'externalize failed (best-effort, returning null)',
    );
    return null;
  }
}

/** Read externalized payload by ref (filename only). Returns null if not found. */
export function readExternalizedPayload(
  deps: ExternalizeDeps,
  ref: string,
): { content: string; metadata: Record<string, unknown> } | null {
  try {
    const filePath = join(deps.largeOutputsDir, ref);
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf8');
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return { content: obj['content'] as string, metadata: obj };
  } catch (err) {
    deps.logger.warn({ err: String(err), ref }, 'readExternalizedPayload failed');
    return null;
  }
}

/**
 * Find existing externalized payload by content match (sha256 hash + optional toolCallId).
 * Returns ref if existing file is found; null otherwise.
 * Used to dedupe repeated tool outputs.
 */
export function findExternalizedPayload(
  deps: ExternalizeDeps,
  content: string,
  toolCallId?: string,
): string | null {
  try {
    if (!existsSync(deps.largeOutputsDir)) return null;
    const hashPrefix = sha256Prefix(content, 16);
    const files = readdirSync(deps.largeOutputsDir);
    // Filter by hash prefix; if multiple, prefer one matching toolCallId.
    const candidates = files.filter((f) => f.startsWith(`${hashPrefix}-`));
    if (candidates.length === 0) return null;
    if (toolCallId) {
      const safeId = toolCallId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
      const exact = candidates.find((f) => f === `${hashPrefix}-${safeId}.json`);
      if (exact) return exact;
    }
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}
