// System prompt resolver — resolve `@<path>` import lines in agent CLAUDE.md
// files (and in files they recursively import).
//
// Spec: docs/superpowers/specs/2026-05-05-system-prompt-resolution-design.md
// (sections "Resolver — exact rules" and "Logging" are load-bearing).
//
// This module is pure (no Agent / profile awareness) — it just walks the import
// graph, with the safety policy spelled out in the spec.

import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { logger } from '../logger.js';

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export interface ResolveImportsOptions {
  /** Absolute path; resolved imports must not escape this directory. */
  workspaceRoot: string;
  /** Maximum recursion depth. Default 5. */
  maxDepth?: number;
  /** Optional — if provided, included as `agent_id` in every log entry. */
  agentId?: string;
}

/**
 * Replace whole-line `@<path>` import directives in `content` with the contents
 * of the referenced files (recursively). Cycles are dropped silently after the
 * first occurrence; diamond imports are de-duped (the second reference is
 * dropped without a log entry beyond a debug). Path-policy violations
 * (absolute, URL, workspace escape, oversize) keep the original line as-is.
 *
 * `fromFile` is the absolute path of the file containing `content` — it
 * anchors relative imports.
 */
export function resolveImports(
  content: string,
  fromFile: string,
  opts: ResolveImportsOptions,
): string {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const visited = new Set<string>();
  // Canonicalise workspaceRoot via realpath so that comparisons against
  // realpath'd import targets work on platforms where tmpdirs are themselves
  // symlinks (macOS: `/var` → `/private/var`, Linux: `/tmp` may be a symlink
  // to `/private/tmp`). Falls back to the literal path if it doesn't exist.
  let canonicalRoot = opts.workspaceRoot;
  try {
    canonicalRoot = realpathSync.native(opts.workspaceRoot);
  } catch {
    // Workspace root doesn't exist as-is; keep the literal path. The path
    // policy below will reject everything since nothing resolves under a
    // missing root, which is the right behaviour.
  }
  // Per-invocation log counter — caps non-debug log output to a sane budget
  // so a pathological CLAUDE.md with thousands of broken imports cannot
  // flood the log buffer / stdout. Reset on every top-level call.
  const logCounter = { count: 0 };
  return resolveContent(content, fromFile, {
    workspaceRoot: canonicalRoot,
    maxDepth,
    visited,
    depth: 0,
    agentId: opts.agentId,
    logCounter,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_DEPTH = 5;
const MAX_FILE_BYTES = 1024 * 1024; // 1 MiB
/** Cap on non-debug log entries per top-level resolveImports call. Debug-level
 * entries are uncapped — they're already gated by LOG_LEVEL in production. */
const MAX_LOGS_PER_RESOLUTION = 50;

/** Whole-line `@<path>` — leading/trailing spaces or tabs OK, no other chars. */
const IMPORT_LINE_RE = /^[ \t]*@(\S+)[ \t]*$/;

interface InternalCtx {
  workspaceRoot: string;
  maxDepth: number;
  visited: Set<string>;
  depth: number;
  agentId?: string;
  /** Shared across recursion so the cap is per top-level call, not per file. */
  logCounter: { count: number };
}

/**
 * Emit a structured log entry, threading `agent_id` from the context and
 * enforcing the per-invocation cap on non-debug levels.
 *
 * The 50th non-debug entry carries `suppressed_after: MAX_LOGS_PER_RESOLUTION`
 * to make truncation visible in log analysis. Subsequent entries at warn/info
 * level are silently dropped. Debug-level entries are always emitted (they're
 * gated by LOG_LEVEL anyway and are useful for diagnosing the cap itself).
 */
function emitLog(
  ctx: InternalCtx,
  level: 'warn' | 'info' | 'debug',
  payload: Record<string, unknown>,
): void {
  const enriched =
    ctx.agentId !== undefined ? { ...payload, agent_id: ctx.agentId } : payload;

  if (level === 'debug') {
    logger.debug(enriched);
    return;
  }

  if (ctx.logCounter.count >= MAX_LOGS_PER_RESOLUTION) {
    return;
  }
  ctx.logCounter.count += 1;
  if (ctx.logCounter.count === MAX_LOGS_PER_RESOLUTION) {
    logger[level]({ ...enriched, suppressed_after: MAX_LOGS_PER_RESOLUTION });
  } else {
    logger[level](enriched);
  }
}

/**
 * Recursively resolve imports in `content`. Lines are processed independently;
 * non-import lines are passed through unchanged (preserving their original
 * line endings, including CRLF).
 *
 * The `\n`-only join below works because we split on `\n` — any `\r` that
 * preceded the `\n` stays attached to the prior segment.
 */
function resolveContent(content: string, fromFile: string, ctx: InternalCtx): string {
  const segments = content.split('\n');

  // Walk segments. Each segment is either:
  //  - kept verbatim (non-import or KEEP_AS_IS),
  //  - replaced with the resolved body (import → inlined content), or
  //  - dropped (cycle / depth / dedupe → segment AND its line boundary go).
  //
  // For drops we simply skip the segment; the surrounding `\n` separators
  // collapse into one when we re-join with `\n`. For empty-file replacements
  // we keep the empty segment, so the resulting output has a blank line in
  // place of the original import line — preserving neighbour positions.
  const kept: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // For matching: trim a trailing \r so CRLF input still matches the regex.
    const hadCr = seg.endsWith('\r');
    const forMatch = hadCr ? seg.slice(0, -1) : seg;
    const m = IMPORT_LINE_RE.exec(forMatch);

    if (!m) {
      kept.push(seg);
      continue;
    }

    const importPath = m[1];
    const replacement = resolveSingleImport(importPath, fromFile, ctx);

    if (replacement === DROP_LINE) {
      // Skip this segment entirely.
      continue;
    }

    if (replacement === KEEP_AS_IS) {
      kept.push(seg);
      continue;
    }

    // Replacement is a string body. Inline it verbatim. If the original
    // import line ended with \r (CRLF input) and the replacement is non-empty
    // and doesn't already end with \r, append \r so surrounding line-ending
    // style is preserved.
    let text = replacement;
    if (hadCr && text.length > 0 && !text.endsWith('\r')) {
      text = `${text}\r`;
    }
    kept.push(text);
  }

  return kept.join('\n');
}

const DROP_LINE = Symbol('drop-line');
const KEEP_AS_IS = Symbol('keep-as-is');

type SingleImportResult = string | typeof DROP_LINE | typeof KEEP_AS_IS;

function resolveSingleImport(
  importPath: string,
  fromFile: string,
  ctx: InternalCtx,
): SingleImportResult {
  const policy = validateImportPath(importPath, fromFile, ctx.workspaceRoot);

  if (policy.kind === 'reject') {
    // `escape` / `absolute` / `url` → keep line, log warn.
    emitLog(ctx, 'warn', {
      msg: 'system-prompt resolver rejected import',
      reason: policy.reason,
      from_file: fromFile,
      import_path: importPath,
    });
    return KEEP_AS_IS;
  }

  if (policy.kind === 'missing') {
    emitLog(ctx, 'info', {
      msg: 'system-prompt resolver: import target missing',
      reason: 'missing',
      from_file: fromFile,
      import_path: importPath,
    });
    return KEEP_AS_IS;
  }

  // policy.kind === 'ok' — `policy.absResolved` is the workspace-relative
  // path joined under workspaceRoot, `policy.absReal` is the canonical
  // realpath we use for cycle detection.
  const absReal = policy.absReal;

  // Cycle / diamond de-dupe.
  if (ctx.visited.has(absReal)) {
    emitLog(ctx, 'info', {
      msg: 'system-prompt resolver: cycle / dedupe — dropping repeated import',
      reason: 'cycle',
      from_file: fromFile,
      import_path: importPath,
    });
    return DROP_LINE;
  }

  // Depth check (recursing into this file would exceed maxDepth).
  if (ctx.depth + 1 > ctx.maxDepth) {
    emitLog(ctx, 'warn', {
      msg: 'system-prompt resolver: max import depth exceeded',
      reason: 'depth',
      from_file: fromFile,
      import_path: importPath,
      max_depth: ctx.maxDepth,
    });
    return DROP_LINE;
  }

  // Pre-read size check (cheap). NOTE: statSync().size returns *apparent* size
  // and lies for sparse / /proc-style files (zero-size stat, gigabytes on read).
  // We keep this as a fast-path reject and re-check the actual length after
  // readFileSync below — the post-read cap is the authoritative defence.
  let size: number;
  try {
    size = statSync(absReal).size;
  } catch (err) {
    // statSync should not fail (existsSync guarded earlier) but be defensive.
    emitLog(ctx, 'warn', {
      msg: 'system-prompt resolver: stat failed',
      reason: 'missing',
      from_file: fromFile,
      import_path: importPath,
      err: err instanceof Error ? err.message : String(err),
    });
    return KEEP_AS_IS;
  }
  if (size > MAX_FILE_BYTES) {
    emitLog(ctx, 'warn', {
      msg: 'system-prompt resolver: import file exceeds 1 MiB',
      reason: 'oversize',
      from_file: fromFile,
      import_path: importPath,
      size,
    });
    return KEEP_AS_IS;
  }

  // Mark visited BEFORE recursing — covers the cycle and diamond cases.
  ctx.visited.add(absReal);

  let imported: string;
  try {
    imported = readFileSync(absReal, 'utf-8');
  } catch (err) {
    emitLog(ctx, 'warn', {
      msg: 'system-prompt resolver: read failed',
      reason: 'missing',
      from_file: fromFile,
      import_path: importPath,
      err: err instanceof Error ? err.message : String(err),
    });
    return KEEP_AS_IS;
  }

  // Post-read length cap — defence-in-depth against sparse / /proc-style
  // files where statSync().size lied. Whatever readFileSync actually returned
  // is what would be inlined; reject if it exceeds MAX_FILE_BYTES.
  if (imported.length > MAX_FILE_BYTES) {
    emitLog(ctx, 'warn', {
      msg: 'system-prompt resolver: import body exceeds 1 MiB after read',
      reason: 'oversize',
      from_file: fromFile,
      import_path: importPath,
      size: imported.length,
    });
    return KEEP_AS_IS;
  }

  emitLog(ctx, 'debug', {
    msg: 'system-prompt resolver: import resolved',
    from_file: fromFile,
    import_path: importPath,
    bytes: imported.length,
    depth: ctx.depth + 1,
  });

  // Recursively resolve imports inside the imported file BEFORE inlining.
  const resolved = resolveContent(imported, absReal, {
    ...ctx,
    depth: ctx.depth + 1,
  });

  // Empty imported file → emit empty string. After join('\n') this manifests as
  // a blank line where the @<path> import was — preserves neighbouring lines'
  // vertical positions.
  return resolved;
}

// ──────────────────────────────────────────────────────────────────────────────
// Path policy
// ──────────────────────────────────────────────────────────────────────────────

type PolicyResult =
  | {
      kind: 'reject';
      reason: 'escape' | 'absolute' | 'url';
    }
  | { kind: 'missing' }
  | { kind: 'ok'; absResolved: string; absReal: string };

function validateImportPath(
  importPath: string,
  fromFile: string,
  workspaceRoot: string,
): PolicyResult {
  // 1. URL-ish — reject before any path math.
  if (
    /^https?:\/\//i.test(importPath) ||
    /^file:\/\//i.test(importPath) ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(importPath)
  ) {
    return { kind: 'reject', reason: 'url' };
  }

  // 2. Absolute paths — including Windows drive letters (`C:\...`).
  if (isAbsolute(importPath) || /^[A-Za-z]:[\\/]/.test(importPath)) {
    return { kind: 'reject', reason: 'absolute' };
  }

  // 3. Resolve relative to dirname(fromFile). We canonicalise the parent
  //    directory through realpath so paths land in the same "namespace" as
  //    the canonicalised workspaceRoot — without this, on macOS a tmpdir at
  //    /var/folders/... vs its realpath /private/var/folders/... would make
  //    every workspace check fail.
  const baseDirLiteral = dirname(fromFile);
  let baseDir = baseDirLiteral;
  try {
    baseDir = realpathSync.native(baseDirLiteral);
  } catch {
    // Parent dir doesn't exist (very unusual — we got passed a fromFile
    // whose parent is gone). Fall through with the literal — the workspace
    // check below will likely reject.
  }
  const absResolved = resolve(baseDir, importPath);

  // 4. Pre-existence escape check on the resolved path. If the import would
  //    land outside the workspace even before any symlink games, reject as
  //    `escape`. This catches `@../../etc/passwd` style probes regardless of
  //    whether the underlying file happens to exist on the host.
  const preRel = relative(workspaceRoot, absResolved);
  if (preRel === '' || preRel.startsWith('..') || isAbsolute(preRel)) {
    return { kind: 'reject', reason: 'escape' };
  }

  // 5. Existence check — if missing, return early before realpath on the
  //    target.
  if (!existsSync(absResolved)) {
    return { kind: 'missing' };
  }

  // 6. Realpath the target, collapses symlinks. If the underlying file is
  //    gone (race), treat as missing.
  let absReal: string;
  try {
    absReal = realpathSync.native(absResolved);
  } catch {
    return { kind: 'missing' };
  }

  // 7. Realpath escapes workspace? Compute path.relative; if it starts with
  //    `..` or is absolute (e.g. cross-volume), it's outside the workspace.
  //    This catches symlink-escape attacks where the resolved path was
  //    inside the workspace but the real underlying file is not.
  const rel = relative(workspaceRoot, absReal);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    // rel === '' would mean the target equals the workspace root itself
    // (a directory, not a file) — treat as escape for safety.
    return { kind: 'reject', reason: 'escape' };
  }

  return { kind: 'ok', absResolved, absReal };
}
