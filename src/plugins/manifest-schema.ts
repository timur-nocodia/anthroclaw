import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import type { PluginManifest } from './types.js';

const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?(\+[a-z0-9.-]+)?$/i;
const NAME_RE = /^[a-z][a-z0-9-]{1,63}$/;

export const PluginManifestSchema = z.object({
  name: z.string().regex(NAME_RE, 'plugin name must be lowercase alphanumeric/hyphens, 2-64 chars'),
  version: z.string().regex(SEMVER_RE, 'version must be valid semver'),
  description: z.string().max(500).optional(),
  entry: z.string().min(1),
  configSchema: z.string().min(1).optional(),
  mcpServers: z.string().min(1).optional(),
  skills: z.string().min(1).optional(),
  commands: z.string().min(1).optional(),
  hooks: z.record(z.string(), z.string().min(1)).optional(),
  requires: z.object({
    anthroclaw: z.string().min(1).optional(),
  }).optional(),
});

export async function parsePluginManifest(path: string): Promise<PluginManifest> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    throw new Error(`failed to read plugin manifest at ${path}: ${(err as Error).message}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON in plugin manifest at ${path}: ${(err as Error).message}`);
  }

  const result = PluginManifestSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid plugin manifest at ${path}: ${issues}`);
  }

  return result.data;
}
