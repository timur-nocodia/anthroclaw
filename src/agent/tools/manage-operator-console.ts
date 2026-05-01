import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { AgentConfigWriter, PatchContext } from '../../config/writer.js';
import type { ToolDefinition } from './types.js';
import type { ToolMeta } from '../../security/types.js';
import type { CanManageFn } from './manage-notifications.js';
import { CapabilityNameSchema } from '../../security/operator-console-capabilities.js';

const ManagesActionSchema = z.object({
  kind: z.enum(['add', 'remove']),
  agent_id: z.string().min(1),
});

const InputSchema = z
  .object({
    target_agent_id: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    manages: z.union([z.literal('*'), z.array(z.string().min(1))]).optional(),
    manages_action: ManagesActionSchema.optional(),
    capabilities: z.array(CapabilityNameSchema).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.manages !== undefined && val.manages_action !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: '`manages` and `manages_action` are mutually exclusive',
        path: ['manages_action'],
      });
    }
  });

type Input = z.infer<typeof InputSchema>;

interface OperatorConsoleShape {
  enabled?: boolean;
  manages?: string[] | '*';
  capabilities?: string[];
}

function asBlock(current: unknown): OperatorConsoleShape {
  if (!current || typeof current !== 'object') return {};
  return current as OperatorConsoleShape;
}

function applyManagesAction(
  current: string[] | '*' | undefined,
  action: { kind: 'add' | 'remove'; agent_id: string },
): string[] | '*' {
  // Super-admin is unchanged by either add or remove. Removing from '*' is
  // semantically nonsensical (you can't subtract one from "all"); adding
  // is redundant (already authorised for everyone).
  if (current === '*') return '*';
  const list = Array.isArray(current) ? [...current] : [];
  if (action.kind === 'add') {
    if (!list.includes(action.agent_id)) list.push(action.agent_id);
    return list;
  }
  // remove
  return list.filter((id) => id !== action.agent_id);
}

export interface CreateManageOperatorConsoleOptions {
  agentId: string;
  writer: AgentConfigWriter;
  canManage: CanManageFn;
  sessionKey?: string;
}

export function createManageOperatorConsoleTool(
  opts: CreateManageOperatorConsoleOptions,
): ToolDefinition {
  const { agentId: callerId, writer, canManage, sessionKey } = opts;

  const sdkTool = tool(
    'manage_operator_console',
    'Configure this agent (or a managed agent) operator-console: enabled flag, manages whitelist (full or incremental), capabilities.',
    {
      target_agent_id: z.string().optional().describe('Agent to configure. Omit for self.'),
      enabled: z.boolean().optional(),
      manages: z.union([z.literal('*'), z.array(z.string().min(1))]).optional()
        .describe('Full replacement of the manages list. Use "*" for super-admin. Mutually exclusive with manages_action.'),
      manages_action: ManagesActionSchema.optional()
        .describe('Incremental add/remove of one entry. Mutually exclusive with manages.'),
      capabilities: z.array(CapabilityNameSchema).optional(),
    },
    async (args: Record<string, unknown>) => {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        const summary = parsed.error.issues
          .map((i) => `${i.path.map(String).join('.') || '<root>'}: ${i.message}`)
          .join('; ');
        return {
          content: [{ type: 'text', text: `Invalid input: ${summary}` }],
          isError: true,
        };
      }
      const input: Input = parsed.data;
      const targetId = input.target_agent_id ?? callerId;

      if (targetId !== callerId && !canManage(callerId, targetId)) {
        return {
          content: [{ type: 'text', text: `Error: caller "${callerId}" is not authorized to manage agent "${targetId}".` }],
          isError: true,
        };
      }

      const patchContext: PatchContext = {
        caller: callerId,
        callerSession: sessionKey,
        source: 'chat',
        action: 'operator_console.patch',
      };

      try {
        let prevSnapshot: OperatorConsoleShape = {};
        let nextSnapshot: OperatorConsoleShape = {};
        await writer.patchSection(
          targetId,
          'operator_console',
          (current) => {
            const prev = asBlock(current);
            prevSnapshot = prev;
            const next: OperatorConsoleShape = { ...prev };
            if (input.enabled !== undefined) next.enabled = input.enabled;
            if (input.manages !== undefined) {
              next.manages = input.manages;
            } else if (input.manages_action !== undefined) {
              next.manages = applyManagesAction(prev.manages, input.manages_action);
            }
            if (input.capabilities !== undefined) next.capabilities = input.capabilities;
            nextSnapshot = next;
            return next;
          },
          patchContext,
        );

        const applied: Record<string, { prev: unknown; new: unknown }> = {};
        if (input.enabled !== undefined) {
          applied.enabled = { prev: prevSnapshot.enabled, new: nextSnapshot.enabled };
        }
        if (input.manages !== undefined || input.manages_action !== undefined) {
          applied.manages = { prev: prevSnapshot.manages, new: nextSnapshot.manages };
        }
        if (input.capabilities !== undefined) {
          applied.capabilities = { prev: prevSnapshot.capabilities, new: nextSnapshot.capabilities };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ ok: true, applied, value: nextSnapshot }),
          }],
        };
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

export const META: ToolMeta = {
  category: 'agent-config',
  safe_in_public: false, safe_in_trusted: true, safe_in_private: true,
  destructive: true, reads_only: false, hard_blacklist_in: ['public'],
  description: 'Configure operator-console plugin (manages list, capabilities).',
  reasoning: 'Mutates agent config; granting cross-agent management requires audit.',
};
