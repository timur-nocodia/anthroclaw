import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { GlobalConfigSchema } from './schema.js';
import type { GlobalConfig } from './schema.js';
import { substituteEnvVars } from './loader.js';

export type Overlay = Record<string, unknown>;

export const RUNTIME_OVERLAY_FILENAME = 'runtime-overrides.yml';

/** Path to the writable runtime overlay inside the data directory. */
export function getOverlayPath(dataDir: string): string {
  return join(dataDir, RUNTIME_OVERLAY_FILENAME);
}

/**
 * Read and parse the base config.yml without applying env-var substitution
 * or schema validation. Returns {} on missing file or parse error.
 *
 * Used by UI handlers that need the raw declarative base for diff/merge
 * computation. For runtime use, prefer loadGlobalConfigWithOverlay.
 */
export function readBaseConfigRaw(basePath: string): Record<string, unknown> {
  if (!existsSync(basePath)) return {};
  try {
    const raw = readFileSync(basePath, 'utf-8');
    const parsed = parseYaml(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge `overlay` into `base`. Returns a new object — does not mutate.
 *
 * Rules:
 * - Plain objects are merged recursively
 * - `null` in overlay deletes the corresponding key from base
 * - Arrays in overlay replace base arrays
 * - All other values (primitives) in overlay win over base
 */
export function deepMergeOverlay(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, overlayVal] of Object.entries(overlay)) {
    if (overlayVal === null) {
      delete result[key];
      continue;
    }
    const baseVal = result[key];
    if (isPlainObject(overlayVal) && isPlainObject(baseVal)) {
      result[key] = deepMergeOverlay(baseVal, overlayVal);
    } else {
      result[key] = overlayVal;
    }
  }

  return result;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Compute the smallest overlay such that
 * `deepMergeOverlay(base, deepDiffOverlay(base, target)) === target`.
 *
 * - Keys present in base but absent in target become `null` (tombstone).
 * - Keys whose values match base are omitted.
 * - Object values recurse; only the differing subtree is kept.
 */
export function deepDiffOverlay(
  base: Record<string, unknown>,
  target: Record<string, unknown>,
): Overlay {
  const out: Overlay = {};

  for (const [key, baseVal] of Object.entries(base)) {
    if (!(key in target)) {
      out[key] = null;
    }
  }

  for (const [key, targetVal] of Object.entries(target)) {
    const baseVal = base[key];
    if (deepEqual(baseVal, targetVal)) continue;

    if (isPlainObject(baseVal) && isPlainObject(targetVal)) {
      const sub = deepDiffOverlay(baseVal, targetVal);
      if (Object.keys(sub).length > 0) out[key] = sub;
    } else {
      out[key] = targetVal;
    }
  }

  return out;
}

/**
 * Read overlay YAML from disk. Returns {} on missing file or parse error.
 * Overlay is a *partial* config — never validated alone, only after merge.
 */
export function readRuntimeOverlay(path: string): Overlay {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = parseYaml(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Write overlay YAML to disk. Creates parent dir if needed.
 */
export function writeRuntimeOverlay(path: string, overlay: Overlay): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyYaml(overlay), 'utf-8');
}

/**
 * Load base config.yml + apply runtime overlay, validate the merged result.
 * Base file is read read-only; the overlay file is the only writable surface.
 */
export function loadGlobalConfigWithOverlay(
  basePath: string,
  overlayPath: string,
): GlobalConfig {
  const baseRaw = readFileSync(basePath, 'utf-8');
  const baseSubstituted = substituteEnvVars(baseRaw);
  const baseParsed = parseYaml(baseSubstituted);
  const base = isPlainObject(baseParsed) ? baseParsed : {};

  const overlay = readRuntimeOverlay(overlayPath);
  const merged = deepMergeOverlay(base, overlay);

  return GlobalConfigSchema.parse(merged);
}
