import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { nowInTimezone, formatTime, dailyMemoryPath } from '../../util/time.js';
import type { MemoryProvider } from '../../memory/provider.js';
import type { MemoryEntryRecord } from '../../memory/store.js';
import { logger } from '../../logger.js';
import type { ToolDefinition } from './types.js';
import type { ToolMeta } from '../../security/types.js';

export interface MemoryWriteToolEvent {
  file: string;
  mode: 'append' | 'replace';
  contentLength: number;
  entry: MemoryEntryRecord;
}

export interface MemoryWriteToolOptions {
  onMemoryWrite?: (event: MemoryWriteToolEvent) => void | Promise<void>;
}

export function createMemoryWriteTool(
  workspacePath: string,
  store: MemoryProvider,
  timezone = 'UTC',
  options: MemoryWriteToolOptions = {},
): ToolDefinition {
  const sdkTool = tool(
    'memory_write',
    'Write content to the memory store. By default appends to a daily memory file with a timestamp header.',
    {
      content: z.string().describe('Content to write'),
      file: z.string().optional().describe('Relative file path (default: memory/YYYY/MM/YYYY-MM-DD.md)'),
      mode: z.enum(['append', 'replace']).optional().describe('Write mode (default: append)'),
    },
    async (args: Record<string, unknown>) => {
      const content = args.content as string;
      const mode = (args.mode as 'append' | 'replace') ?? 'append';

      const now = nowInTimezone(timezone);
      const timeStr = formatTime(now);
      const file = (args.file as string) ?? dailyMemoryPath(now);

      const fullPath = join(workspacePath, file);

      try {
        mkdirSync(dirname(fullPath), { recursive: true });

        let fullContent: string;

        if (mode === 'append') {
          const existing = existsSync(fullPath)
            ? readFileSync(fullPath, 'utf-8')
            : '';
          fullContent = existing + `\n\n## ${timeStr}\n\n${content}`;
        } else {
          fullContent = content;
        }

        writeFileSync(fullPath, fullContent, 'utf-8');

        const entry = store.indexFile(file, fullContent, {
          source: 'memory_write',
          reviewStatus: 'approved',
          toolName: 'memory_write',
          metadata: { mode },
        });

        if (options.onMemoryWrite) {
          void Promise.resolve(options.onMemoryWrite({
            file,
            mode,
            contentLength: content.length,
            entry,
          })).catch((err) => {
            logger.warn({ err, file }, 'Memory write hook failed');
          });
        }

        return {
          content: [{ type: 'text', text: `Written to ${file}` }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Write failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return sdkTool as unknown as ToolDefinition;
}

export const META: ToolMeta = {
  category: 'memory-write',
  safe_in_public: false, safe_in_trusted: true, safe_in_private: true,
  destructive: false, reads_only: false, hard_blacklist_in: [],
};
