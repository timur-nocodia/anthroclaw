import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { z } from 'zod';

const PLUGINS_DIR = resolve(process.cwd(), '..', 'plugins');

/**
 * Resolve the directory for a plugin. Convention is `<repoRoot>/plugins/<name>`.
 * If the gateway exposes a `getResolvedPluginsDir()` we prefer that — but in
 * practice (UI workspace runs alongside the gateway) the convention holds.
 */
export function getPluginDir(pluginName: string, override?: string): string {
  const root = override ?? PLUGINS_DIR;
  return resolve(root, pluginName);
}

/**
 * Resolve the path to a plugin's compiled config-schema module given its
 * manifest's `configSchema` field (relative to the plugin dir).
 */
export function resolveConfigSchemaPath(
  pluginDir: string,
  manifestConfigSchema: string,
): string {
  return resolve(pluginDir, manifestConfigSchema);
}

/**
 * Dynamically import a plugin's config-schema module and return the first
 * Zod schema found among the conventional export names.
 *
 * Lookup order:
 *   1. `default`
 *   2. `configSchema` (camelCase named export)
 *   3. `<Name>ConfigSchema` (capitalised plugin name, e.g. lcm → LcmConfigSchema)
 *
 * Returns `null` if no Zod schema is found among those exports.
 */
export async function loadPluginConfigSchema(
  pluginName: string,
  configSchemaPath: string,
): Promise<z.ZodType | null> {
  if (!existsSync(configSchemaPath)) return null;

  const url = pathToFileURL(configSchemaPath).href;
  const mod = (await import(/* @vite-ignore */ /* webpackIgnore: true */ url)) as Record<string, unknown>;

  const candidates: unknown[] = [];
  if (mod.default !== undefined) candidates.push(mod.default);
  if (mod.configSchema !== undefined) candidates.push(mod.configSchema);

  // capitalised <Name>ConfigSchema (kebab-case → joined PascalCase, so
  // "operator-console" → "OperatorConsoleConfigSchema").
  const pascal = pluginName
    .split('-')
    .filter(Boolean)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');
  const capKey = `${pascal}ConfigSchema`;
  if (mod[capKey] !== undefined) candidates.push(mod[capKey]);

  // Some plugins (e.g. LCM) also export an upper-cased acronym form
  // (e.g. LCMConfigSchema). Try the all-caps variant too.
  const upperKey = `${pluginName.replace(/-/g, '').toUpperCase()}ConfigSchema`;
  if (upperKey !== capKey && mod[upperKey] !== undefined) candidates.push(mod[upperKey]);

  for (const c of candidates) {
    if (isZodSchema(c)) return c;
  }
  return null;
}

function isZodSchema(value: unknown): value is z.ZodType {
  if (!value || typeof value !== 'object') return false;
  // Zod 4: schemas are instances with a `_zod` (or `_def`) internals bag and
  // a `.parse` method. Sniff structurally so this stays decoupled from the
  // exact class identity (which differs across plugin builds).
  const v = value as Record<string, unknown>;
  return typeof v.parse === 'function' && typeof v.safeParse === 'function';
}
