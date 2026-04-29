import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { logger } from '../../logger.js';
import type { ToolDefinition } from './types.js';

// ─── Brave Search ────────────────────────────────────────────────

export function createBraveSearchTool(apiKey: string): ToolDefinition {
  const sdkTool = tool(
    'web_search_brave',
    'Search the web using Brave Search API. Returns titles, URLs, and snippets.',
    {
      query: z.string().describe('Search query'),
      count: z.number().optional().describe('Number of results (default: 5, max: 20)'),
    },
    async (args: Record<string, unknown>) => {
      const query = args.query as string;
      const count = Math.min((args.count as number) ?? 5, 20);

      try {
        const params = new URLSearchParams({
          q: query,
          count: String(count),
        });

        const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': apiKey,
          },
        });

        if (!res.ok) {
          return {
            content: [{ type: 'text', text: `Brave search failed: HTTP ${res.status}` }],
            isError: true,
          };
        }

        const data = (await res.json()) as BraveResponse;
        const results = data.web?.results ?? [];

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No results found.' }] };
        }

        const formatted = results
          .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description ?? ''}`)
          .join('\n\n');

        return { content: [{ type: 'text', text: formatted }] };
      } catch (err) {
        logger.error({ err }, 'Brave search error');
        return {
          content: [{ type: 'text', text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  return sdkTool as unknown as ToolDefinition;
}

interface BraveResponse {
  web?: {
    results: Array<{
      title: string;
      url: string;
      description?: string;
    }>;
  };
}

// ─── Exa Search ──────────────────────────────────────────────────

export function createExaSearchTool(apiKey: string): ToolDefinition {
  const sdkTool = tool(
    'web_search_exa',
    'Search the web using Exa API. Good for finding specific content, research papers, and technical documentation. Supports neural and keyword search.',
    {
      query: z.string().describe('Search query'),
      num_results: z.number().optional().describe('Number of results (default: 5, max: 10)'),
      type: z.enum(['neural', 'keyword', 'auto']).optional().describe('Search type (default: auto)'),
      use_autoprompt: z.boolean().optional().describe('Let Exa optimize the query (default: true)'),
    },
    async (args: Record<string, unknown>) => {
      const query = args.query as string;
      const numResults = Math.min((args.num_results as number) ?? 5, 10);
      const type = (args.type as string) ?? 'auto';
      const useAutoprompt = (args.use_autoprompt as boolean) ?? true;

      try {
        const res = await fetch('https://api.exa.ai/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({
            query,
            numResults,
            type,
            useAutoprompt,
            contents: {
              text: { maxCharacters: 1000 },
            },
          }),
        });

        if (!res.ok) {
          return {
            content: [{ type: 'text', text: `Exa search failed: HTTP ${res.status}` }],
            isError: true,
          };
        }

        const data = (await res.json()) as ExaResponse;
        const results = data.results ?? [];

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No results found.' }] };
        }

        const formatted = results
          .map((r, i) => {
            const snippet = r.text ? `\n   ${r.text.slice(0, 300)}${r.text.length > 300 ? '…' : ''}` : '';
            return `${i + 1}. **${r.title ?? r.url}**\n   ${r.url}${snippet}`;
          })
          .join('\n\n');

        return { content: [{ type: 'text', text: formatted }] };
      } catch (err) {
        logger.error({ err }, 'Exa search error');
        return {
          content: [{ type: 'text', text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  return sdkTool as unknown as ToolDefinition;
}

interface ExaResponse {
  results: Array<{
    title?: string;
    url: string;
    text?: string;
    score?: number;
  }>;
}

import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'network',
  safe_in_public: true, safe_in_trusted: true, safe_in_private: true,
  destructive: false, reads_only: true, hard_blacklist_in: [],
};
