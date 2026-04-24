import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { nowInTimezone, formatTime, dailyMemoryPath } from '../../util/time.js';
import type { MemoryStore } from '../../memory/store.js';
import type { ToolDefinition } from './types.js';

export function createMemoryWriteTool(
  workspacePath: string,
  store: MemoryStore,
  timezone = 'UTC',
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

        store.indexFile(file, fullContent);

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
