import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { resolveFileTransferPath } from '../policy.js';
import type { FileTransferConfig } from '../config.js';

export const FileWriteInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  overwrite: z.boolean().default(false),
});

export async function fileWrite(input: unknown, config: Pick<FileTransferConfig, 'roots' | 'allowWrite' | 'maxFileBytes'>): Promise<{
  path: string;
  sizeBytes: number;
}> {
  if (!config.allowWrite) throw new Error('file-transfer write disabled');
  const parsed = FileWriteInputSchema.parse(input);
  const sizeBytes = Buffer.byteLength(parsed.content);
  const maxFileBytes = config.maxFileBytes ?? 1024 * 1024;
  if (sizeBytes > maxFileBytes) throw new Error(`content exceeds maxFileBytes: ${sizeBytes} > ${maxFileBytes}`);
  const resolved = resolveFileTransferPath({ requestedPath: parsed.path, roots: config.roots });
  if (existsSync(resolved.absolutePath) && !parsed.overwrite) {
    throw new Error(`file exists and overwrite=false: ${parsed.path}`);
  }
  mkdirSync(dirname(resolved.absolutePath), { recursive: true });
  writeFileSync(resolved.absolutePath, parsed.content, 'utf8');
  return { path: resolved.absolutePath, sizeBytes };
}
