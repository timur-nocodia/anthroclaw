import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { MemoryProvider } from '../../memory/provider.js';
import type { ToolDefinition } from './types.js';

const WIKI_DIR = 'memory/wiki';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s-]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function createMemoryWikiTool(
  workspacePath: string,
  store: MemoryProvider,
): ToolDefinition {
  const wikiDir = join(workspacePath, WIKI_DIR);

  const sdkTool = tool(
    'memory_wiki',
    'Manage structured wiki pages in long-term memory. Use for facts, profiles, project notes, and any persistent structured knowledge. Actions: create, read, update, list, delete.',
    {
      action: z.enum(['create', 'read', 'update', 'list', 'delete']).describe('Action to perform'),
      title: z.string().optional().describe('Page title (required for create/read/update/delete)'),
      content: z.string().optional().describe('Page content in markdown (required for create, optional for update)'),
      section: z.string().optional().describe('Section name to update (for partial update). If omitted, replaces entire content.'),
      section_content: z.string().optional().describe('New content for the section (used with section parameter)'),
    },
    async (args: Record<string, unknown>) => {
      const action = args.action as string;
      const title = args.title as string | undefined;
      const content = args.content as string | undefined;
      const section = args.section as string | undefined;
      const sectionContent = args.section_content as string | undefined;

      try {
        mkdirSync(wikiDir, { recursive: true });

        switch (action) {
          case 'list': {
            if (!existsSync(wikiDir)) {
              return { content: [{ type: 'text', text: 'No wiki pages yet.' }] };
            }
            const files = readdirSync(wikiDir).filter((f) => f.endsWith('.md'));
            if (files.length === 0) {
              return { content: [{ type: 'text', text: 'No wiki pages yet.' }] };
            }
            const pages = files.map((f) => {
              const raw = readFileSync(join(wikiDir, f), 'utf-8');
              const titleLine = raw.split('\n')[0]?.replace(/^#\s*/, '') ?? f.replace('.md', '');
              return `- **${titleLine}** (${f})`;
            });
            return { content: [{ type: 'text', text: pages.join('\n') }] };
          }

          case 'create': {
            if (!title || !content) {
              return { content: [{ type: 'text', text: 'title and content are required for create' }], isError: true };
            }
            const slug = slugify(title);
            const filePath = join(wikiDir, `${slug}.md`);
            const fullContent = `# ${title}\n\n${content}`;
            writeFileSync(filePath, fullContent, 'utf-8');
            const relPath = `${WIKI_DIR}/${slug}.md`;
            store.indexFile(relPath, fullContent, {
              source: 'memory_wiki',
              reviewStatus: 'approved',
              toolName: 'memory_wiki',
              metadata: { action, title },
            });
            return { content: [{ type: 'text', text: `Created wiki page: ${title} (${relPath})` }] };
          }

          case 'read': {
            if (!title) {
              return { content: [{ type: 'text', text: 'title is required for read' }], isError: true };
            }
            const slug = slugify(title);
            const filePath = join(wikiDir, `${slug}.md`);
            if (!existsSync(filePath)) {
              return { content: [{ type: 'text', text: `Wiki page "${title}" not found.` }] };
            }
            const text = readFileSync(filePath, 'utf-8');
            return { content: [{ type: 'text', text }] };
          }

          case 'update': {
            if (!title) {
              return { content: [{ type: 'text', text: 'title is required for update' }], isError: true };
            }
            const slug = slugify(title);
            const filePath = join(wikiDir, `${slug}.md`);

            if (!existsSync(filePath)) {
              return { content: [{ type: 'text', text: `Wiki page "${title}" not found. Use create first.` }], isError: true };
            }

            let existing = readFileSync(filePath, 'utf-8');

            if (section && sectionContent !== undefined) {
              // Update a specific section
              const sectionRegex = new RegExp(
                `(## ${escapeRegExp(section)}\n)([\\s\\S]*?)(?=\n## |$)`,
              );
              if (sectionRegex.test(existing)) {
                existing = existing.replace(sectionRegex, `$1\n${sectionContent}\n`);
              } else {
                existing += `\n\n## ${section}\n\n${sectionContent}\n`;
              }
            } else if (content) {
              // Replace full content, keep the title line
              const titleLine = existing.split('\n')[0];
              existing = `${titleLine}\n\n${content}`;
            } else {
              return { content: [{ type: 'text', text: 'content or section+section_content required for update' }], isError: true };
            }

            writeFileSync(filePath, existing, 'utf-8');
            const relPath = `${WIKI_DIR}/${slug}.md`;
            store.indexFile(relPath, existing, {
              source: 'memory_wiki',
              reviewStatus: 'approved',
              toolName: 'memory_wiki',
              metadata: { action, title, section: section ?? null },
            });
            return { content: [{ type: 'text', text: `Updated wiki page: ${title}` }] };
          }

          case 'delete': {
            if (!title) {
              return { content: [{ type: 'text', text: 'title is required for delete' }], isError: true };
            }
            const slug = slugify(title);
            const filePath = join(wikiDir, `${slug}.md`);
            if (!existsSync(filePath)) {
              return { content: [{ type: 'text', text: `Wiki page "${title}" not found.` }] };
            }
            unlinkSync(filePath);
            const relPath = `${WIKI_DIR}/${slug}.md`;
            store.removeFile(relPath);
            return { content: [{ type: 'text', text: `Deleted wiki page: ${title}` }] };
          }

          default:
            return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Wiki operation failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  return sdkTool as unknown as ToolDefinition;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
