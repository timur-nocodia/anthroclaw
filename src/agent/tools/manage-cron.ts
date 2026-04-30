import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { DynamicCronStore } from '../../cron/dynamic-store.js';
import type { ToolDefinition } from './types.js';
import type { ToolMeta } from '../../security/types.js';

export interface ManageCronDispatchContext {
  agentId: string;
  channel: string;
  peerId: string;
  senderId?: string;
  accountId?: string;
  threadId?: string;
}

export function createManageCronTool(
  agentId: string,
  store: DynamicCronStore,
  onUpdate: () => void,
  dispatchContext?: ManageCronDispatchContext,
): ToolDefinition {
  const sdkTool = tool(
    'manage_cron',
    'Create, list, delete, or toggle scheduled tasks for this agent. For create, provide only schedule and prompt; AnthroClaw binds delivery to the current chat automatically.',
    {
      action: z.enum(['create', 'list', 'delete', 'toggle']).describe('Action to perform'),
      id: z.string().optional().describe('Stable job ID. Optional for create; required for delete/toggle.'),
      schedule: z.string().optional().describe('Cron expression, e.g. "0 9 * * *" (required for create)'),
      prompt: z.string().optional().describe('User intent/prompt to give the agent when the job fires (required for create)'),
      run_once: z.boolean().optional().describe('Set true for one-off reminders/tasks. AnthroClaw removes the job after it fires.'),
      expires_at: z.union([z.string(), z.number()]).optional().describe('Optional expiration as epoch milliseconds or ISO timestamp. Expired jobs are not scheduled.'),
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
          const id = typeof args.id === 'string' && args.id.trim().length > 0
            ? args.id.trim()
            : buildCronId(args.prompt);
          const schedule = args.schedule as string | undefined;
          const prompt = args.prompt as string | undefined;
          if (!id || !schedule || !prompt) {
            return {
              content: [{ type: 'text', text: 'Error: schedule and prompt are required for create.' }],
              isError: true,
            };
          }
          if (!dispatchContext || !dispatchContext.channel || !dispatchContext.peerId) {
            return {
              content: [{ type: 'text', text: 'Error: create requires an active chat dispatch context.' }],
              isError: true,
            };
          }
          const expiresAt = parseExpiresAt(args.expires_at);
          const runOnce = typeof args.run_once === 'boolean'
            ? args.run_once
            : looksLikeOneShotSchedule(schedule);
          const job = store.create({
            id,
            agentId,
            schedule,
            prompt,
            deliverTo: {
              channel: dispatchContext.channel,
              peer_id: dispatchContext.peerId,
              ...(dispatchContext.accountId ? { account_id: dispatchContext.accountId } : {}),
              ...(dispatchContext.threadId ? { thread_id: dispatchContext.threadId } : {}),
            },
            createdBy: {
              channel: dispatchContext.channel,
              sender_id: dispatchContext.senderId ?? dispatchContext.peerId,
              peer_id: dispatchContext.peerId,
              ...(dispatchContext.accountId ? { account_id: dispatchContext.accountId } : {}),
              ...(dispatchContext.threadId ? { thread_id: dispatchContext.threadId } : {}),
            },
            runOnce,
            ...(expiresAt ? { expiresAt } : {}),
            enabled: true,
          });
          onUpdate();
          return {
            content: [{
              type: 'text',
              text: `Cron job created: **${job.id}** (\`${job.schedule}\`)${job.runOnce ? ' — run once' : ''}`,
            }],
          };
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

function buildCronId(prompt: unknown): string {
  const text = typeof prompt === 'string' ? prompt : 'scheduled-task';
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'scheduled-task';
  return `${slug}-${Date.now().toString(36)}`;
}

function parseExpiresAt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function looksLikeOneShotSchedule(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [, , dayOfMonth, month, dayOfWeek] = parts;
  return isConcreteCronField(dayOfMonth) && isConcreteCronField(month) && dayOfWeek === '*';
}

function isConcreteCronField(value: string): boolean {
  return /^\d+$/.test(value);
}

export const META: ToolMeta = {
  category: 'agent-config',
  safe_in_public: false, safe_in_trusted: true, safe_in_private: true,
  destructive: true, reads_only: false, hard_blacklist_in: [],
};
