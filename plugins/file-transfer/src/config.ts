import { z } from 'zod';

export const FileTransferConfigSchema = z.object({
  enabled: z.boolean().default(false),
  roots: z.array(z.string().min(1)).default([]),
  allowWrite: z.boolean().default(false),
  maxFileBytes: z.number().int().positive().max(10 * 1024 * 1024).default(1024 * 1024),
  maxEntries: z.number().int().positive().max(500).default(100),
});

export type FileTransferConfig = z.infer<typeof FileTransferConfigSchema>;

export function parseFileTransferConfig(value: unknown): FileTransferConfig {
  return FileTransferConfigSchema.parse(value ?? {});
}

export default FileTransferConfigSchema;
