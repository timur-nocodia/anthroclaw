import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { MemoryProvider } from '../../memory/provider.js';
import type { ToolDefinition } from './types.js';

export function createLocalNoteProposeTool(
  workspacePath: string,
  store: MemoryProvider,
): ToolDefinition {
  const sdkTool = tool(
    'local_note_propose',
    'Propose a local note for operator review. Writes under notes/review/ and indexes it as pending, so it is not used by memory search until approved.',
    {
      title: z.string().min(1).max(120).describe('Short human-readable title for the proposed note.'),
      content: z.string().min(1).max(20_000).describe('Proposed note content. Treat as durable only after operator approval.'),
      reason: z.string().max(1000).optional().describe('Why this note should be kept.'),
    },
    async (args: Record<string, unknown>) => {
      const title = String(args.title ?? '').trim();
      const content = String(args.content ?? '').trim();
      const reason = typeof args.reason === 'string' ? args.reason.trim() : undefined;
      if (!title || !content) {
        return {
          content: [{ type: 'text', text: 'local_note_propose requires title and content.' }],
          isError: true,
        };
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const slug = slugify(title);
      const file = `notes/review/${stamp}-${slug}.md`;
      const fullPath = join(workspacePath, file);
      const body = [
        `# ${title}`,
        '',
        content,
        '',
        reason ? `Review reason: ${reason}` : undefined,
      ].filter((line): line is string => line !== undefined).join('\n');

      try {
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, body, 'utf-8');
        const entry = store.indexFile(file, body, {
          source: 'local_note_proposal',
          reviewStatus: 'pending',
          toolName: 'local_note_propose',
          note: reason,
          metadata: { title },
        });

        return {
          content: [{
            type: 'text',
            text: `Proposed local note ${file} for review (entry ${entry.id}). It remains pending until approved.`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `Local note proposal failed: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    },
  );

  return sdkTool as unknown as ToolDefinition;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'note';
}

import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'memory-write',
  safe_in_public: false, safe_in_trusted: true, safe_in_private: true,
  destructive: true, reads_only: false, hard_blacklist_in: [],
};
