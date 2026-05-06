import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { resolveFileTransferPath } from '../policy.js';
import type { FileTransferConfig } from '../config.js';

export const DirListInputSchema = z.object({
  path: z.string().min(1),
  maxEntries: z.number().int().positive().optional(),
});

export async function dirList(input: unknown, config: Pick<FileTransferConfig, 'roots' | 'maxEntries'>): Promise<{
  path: string;
  entries: Array<{ name: string; type: 'file' | 'directory' | 'other'; sizeBytes: number }>;
}> {
  const parsed = DirListInputSchema.parse(input);
  const resolved = resolveFileTransferPath({ requestedPath: parsed.path, roots: config.roots });
  const stat = statSync(resolved.absolutePath);
  if (!stat.isDirectory()) throw new Error(`not a directory: ${parsed.path}`);
  const configuredMax = config.maxEntries ?? 100;
  const maxEntries = Math.min(parsed.maxEntries ?? configuredMax, configuredMax);
  const entries = readdirSync(resolved.absolutePath)
    .sort()
    .slice(0, maxEntries)
    .map((name) => {
      const entryStat = statSync(join(resolved.absolutePath, name));
      return {
        name,
        type: entryStat.isFile() ? 'file' as const : entryStat.isDirectory() ? 'directory' as const : 'other' as const,
        sizeBytes: entryStat.size,
      };
    });
  return { path: resolved.absolutePath, entries };
}
