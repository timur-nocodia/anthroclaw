import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { resolveFileTransferPath } from '../policy.js';
import type { FileTransferConfig } from '../config.js';

export const DirFetchInputSchema = z.object({
  path: z.string().min(1),
  maxFiles: z.number().int().positive().max(50).default(20),
});

export async function dirFetch(input: unknown, config: Pick<FileTransferConfig, 'roots' | 'maxFileBytes'>): Promise<{
  path: string;
  files: Array<{ path: string; text: string; sizeBytes: number }>;
}> {
  const parsed = DirFetchInputSchema.parse(input);
  const resolved = resolveFileTransferPath({ requestedPath: parsed.path, roots: config.roots });
  if (!statSync(resolved.absolutePath).isDirectory()) throw new Error(`not a directory: ${parsed.path}`);
  const files: Array<{ path: string; text: string; sizeBytes: number }> = [];
  walk(resolved.absolutePath, resolved.absolutePath, parsed.maxFiles, config.maxFileBytes, files);
  return { path: resolved.absolutePath, files };
}

function walk(
  root: string,
  current: string,
  maxFiles: number,
  maxBytes: number,
  out: Array<{ path: string; text: string; sizeBytes: number }>,
): void {
  if (out.length >= maxFiles) return;
  for (const name of readdirSync(current).sort()) {
    if (out.length >= maxFiles) return;
    const abs = join(current, name);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      walk(root, abs, maxFiles, maxBytes, out);
      continue;
    }
    if (!stat.isFile() || stat.size > maxBytes) continue;
    const text = readFileSync(abs, 'utf8');
    out.push({ path: relative(root, abs).split('\\').join('/'), text, sizeBytes: Buffer.byteLength(text) });
  }
}
