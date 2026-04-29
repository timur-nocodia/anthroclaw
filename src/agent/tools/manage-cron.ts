import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { DynamicCronStore } from '../../cron/dynamic-store.js';
import type { ToolDefinition } from './types.js';

export function createManageCronTool(
  agentId: string,
  store: DynamicCronStore,
  onUpdate: () => void,
): ToolDefinition {
  const sdkTool = tool(
    'manage_cron',
    'Create, list, delete, or toggle cron jobs for this agent. Jobs persist across restarts.',
    {
      action: z.enum(['create', 'list', 'delete', 'toggle']).describe('Action to perform'),
      id: z.string().optional().describe('Job ID (required for create, delete, toggle)'),
      schedule: z.string().optional().describe('Cron expression, e.g. "0 9 * * *" (required for create)'),
      prompt: z.string().optional().describe('Prompt to send when job fires (required for create)'),
      deliver_to: z.object({
        channel: z.string(),
        peer_id: z.string(),
        account_id: z.string().optional(),
      }).optional().describe('Where to deliver the response'),
      enabled: z.boolean().optional().describe('For toggle: set enabled state'),
    },
    async (args: Record<string, unknown>) => {
      const action = args.action as string;

      try {
        if (action === 'list') {
          const jobs = store.list(agentId);
          if (jobs.length === 0) {
            return { content: [{ type: 'text', text: 'No dynamic cron jobs configured.' }] };
          }
          const formatted = jobs.map((j) =>
            `- **${j.id}**: \`${j.schedule}\` ${j.enabled ? '✅' : '⏸️'}\n  Prompt: ${j.prompt.slice(0, 100)}${j.prompt.length > 100 ? '…' : ''}`,
          ).join('\n');
          return { content: [{ type: 'text', text: `Dynamic cron jobs (${jobs.length}):\n\n${formatted}` }] };
        }

        if (action === 'create') {
          const id = args.id as string | undefined;
          const schedule = args.schedule as string | undefined;
          const prompt = args.prompt as string | undefined;
          if (!id || !schedule || !prompt) {
            return {
              content: [{ type: 'text', text: 'Error: id, schedule, and prompt are required for create.' }],
              isError: true,
            };
          }
          const deliverTo = args.deliver_to as { channel: string; peer_id: string; account_id?: string } | undefined;
          const job = store.create({
            id,
            agentId,
            schedule,
            prompt,
            deliverTo,
            enabled: true,
          });
          onUpdate();
          return { content: [{ type: 'text', text: `Cron job created: **${job.id}** (\`${job.schedule}\`)` }] };
        }

        if (action === 'delete') {
          const id = args.id as string | undefined;
          if (!id) {
            return { content: [{ type: 'text', text: 'Error: id is required for delete.' }], isError: true };
          }
          const deleted = store.delete(agentId, id);
          if (!deleted) {
            return { content: [{ type: 'text', text: `Cron job "${id}" not found.` }], isError: true };
          }
          onUpdate();
          return { content: [{ type: 'text', text: `Cron job "${id}" deleted.` }] };
        }

        if (action === 'toggle') {
          const id = args.id as string | undefined;
          const enabled = args.enabled as boolean | undefined;
          if (!id || enabled === undefined) {
            return { content: [{ type: 'text', text: 'Error: id and enabled are required for toggle.' }], isError: true };
          }
          const toggled = store.toggle(agentId, id, enabled);
          if (!toggled) {
            return { content: [{ type: 'text', text: `Cron job "${id}" not found.` }], isError: true };
          }
          onUpdate();
          return { content: [{ type: 'text', text: `Cron job "${id}" ${enabled ? 'enabled' : 'disabled'}.` }] };
        }

        return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  return sdkTool as unknown as ToolDefinition;
}

import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'agent-config',
  safe_in_public: false, safe_in_trusted: true, safe_in_private: true,
  destructive: true, reads_only: false, hard_blacklist_in: [],
};
