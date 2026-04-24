import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { GlobalConfigSchema } from '@backend/config/schema.js';
import { ValidationError } from '@/lib/agents';

const CONFIG_PATH = resolve(process.cwd(), '..', 'config.yml');

const SENSITIVE_KEYS = /^(token|password|api_key|secret|auth_dir)$/i;

/**
 * Recursively mask sensitive values in a config object.
 */
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
 * Merge masked values -- only update fields that actually changed.
 * If a value in the new config is "****", preserve the original value.
 */
function mergeMasked(
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
      result[key] = mergeMasked(
        original[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    }
  }

  return result;
}

export async function GET() {
  return withAuth(async () => {
    if (!existsSync(CONFIG_PATH)) {
      return NextResponse.json({ raw: '', masked: true });
    }

    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const maskedYaml = stringifyYaml(maskSensitive(parsed));

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

    let newData: Record<string, unknown>;
    try {
      newData = parseYaml(yamlStr) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid YAML';
      throw new ValidationError('invalid_yaml', message);
    }

    // If config exists, merge masked values from original
    if (existsSync(CONFIG_PATH)) {
      const originalRaw = readFileSync(CONFIG_PATH, 'utf-8');
      const originalData = parseYaml(originalRaw) as Record<string, unknown>;
      newData = mergeMasked(originalData, newData);
    }

    const result = GlobalConfigSchema.safeParse(newData);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new ValidationError('invalid_yaml', issues);
    }

    writeFileSync(CONFIG_PATH, stringifyYaml(newData), 'utf-8');
    return NextResponse.json({ ok: true });
  });
}
