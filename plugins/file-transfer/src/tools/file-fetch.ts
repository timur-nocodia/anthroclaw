import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';
import { resolveFileTransferPath } from '../policy.js';
import type { FileTransferConfig } from '../config.js';

export const FileFetchInputSchema = z.object({
  path: z.string().min(1),
  maxBytes: z.number().int().positive().optional(),
});

export async function fileFetch(input: unknown, config: Pick<FileTransferConfig, 'roots' | 'maxFileBytes'>): Promise<{
  path: string;
  text: string;
  sizeBytes: number;
}> {
  const parsed = FileFetchInputSchema.parse(input);
  const resolved = resolveFileTransferPath({ requestedPath: parsed.path, roots: config.roots });
  const stat = statSync(resolved.absolutePath);
  if (!stat.isFile()) throw new Error(`not a file: ${parsed.path}`);
  const configuredMax = config.maxFileBytes ?? 1024 * 1024;
  const maxBytes = Math.min(parsed.maxBytes ?? configuredMax, configuredMax);
  if (stat.size > maxBytes) throw new Error(`file exceeds maxBytes: ${stat.size} > ${maxBytes}`);
  const text = readFileSync(resolved.absolutePath, 'utf8');
  return { path: resolved.absolutePath, text, sizeBytes: Buffer.byteLength(text) };
}
