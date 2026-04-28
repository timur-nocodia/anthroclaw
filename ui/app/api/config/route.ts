import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { GlobalConfigSchema } from '@backend/config/schema.js';
import {
  deepDiffOverlay,
  deepMergeOverlay,
  getOverlayPath,
  readBaseConfigRaw,
  readRuntimeOverlay,
  writeRuntimeOverlay,
} from '@backend/config/overlay.js';
import { ValidationError } from '@/lib/agents';

const CONFIG_PATH = resolve(process.cwd(), '..', 'config.yml');
const OVERLAY_PATH = getOverlayPath(resolve(process.cwd(), '..', 'data'));

const SENSITIVE_KEYS = /^(token|password|api_key|secret|auth_dir)$/i;

function maskSensitive(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map(maskSensitive);
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(key) && typeof value === 'string') {
        result[key] = '****';
      } else {
        result[key] = maskSensitive(value);
      }
    }
    return result;
  }

  return obj;
}

/**
 * Restore "****" placeholders to their corresponding values from `original`.
 */
function unmaskAgainst(
  original: Record<string, unknown>,
  updated: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...updated };

  for (const [key, value] of Object.entries(result)) {
    if (value === '****' && key in original) {
      result[key] = original[key];
    } else if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      original[key] !== null &&
      typeof original[key] === 'object' &&
      !Array.isArray(original[key])
    ) {
      result[key] = unmaskAgainst(
        original[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    }
  }

  return result;
}

/**
 * Walk a parsed config and collect dotted paths that still hold the "****"
 * placeholder. A leftover mask means the user moved/renamed a section so the
 * mask couldn't be resolved against the previous config — writing it would
 * literally replace the secret with the string "****".
 */
function findUnresolvedMasks(value: unknown, path: string[] = []): string[] {
  if (value === '****') return [path.join('.') || '<root>'];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => findUnresolvedMasks(v, [...path, String(i)]));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      findUnresolvedMasks(v, [...path, k]),
    );
  }
  return [];
}

export async function GET() {
  return withAuth(async () => {
    const base = readBaseConfigRaw(CONFIG_PATH);
    const overlay = readRuntimeOverlay(OVERLAY_PATH);
    const merged = deepMergeOverlay(base, overlay);
    const maskedYaml = stringifyYaml(maskSensitive(merged));
    return NextResponse.json({ raw: maskedYaml, masked: true });
  });
}

export async function PUT(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json();
    const { yaml: yamlStr } = body as { yaml: string };

    if (typeof yamlStr !== 'string') {
      throw new ValidationError('invalid_yaml', '"yaml" (string) is required');
    }

    let submitted: Record<string, unknown>;
    try {
      submitted = parseYaml(yamlStr) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid YAML';
      throw new ValidationError('invalid_yaml', message);
    }

    const base = readBaseConfigRaw(CONFIG_PATH);
    const currentOverlay = readRuntimeOverlay(OVERLAY_PATH);
    const currentMerged = deepMergeOverlay(base, currentOverlay);

    // The user is editing what GET returned (merged + masked). Restore secrets
    // from the merged view so unchanged "****" fields keep their real value.
    const target = unmaskAgainst(currentMerged, submitted);

    // If the user moved/renamed a masked section, "****" survives the unmask
    // and would be written as a literal secret. Reject before persisting.
    const unresolved = findUnresolvedMasks(target);
    if (unresolved.length > 0) {
      throw new ValidationError(
        'unresolved_secret_mask',
        `Secret values masked as "****" could not be resolved at: ${unresolved.join(', ')}. ` +
          'Re-enter the actual values for these fields.',
      );
    }

    const validated = GlobalConfigSchema.safeParse(target);
    if (!validated.success) {
      const issues = validated.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new ValidationError('invalid_yaml', issues);
    }

    const nextOverlay = deepDiffOverlay(base, target);
    writeRuntimeOverlay(OVERLAY_PATH, nextOverlay);

    return NextResponse.json({ ok: true });
  });
}
