import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { HumanTakeoverSchema } from '../../config/schema.js';
import type { AgentConfigWriter, PatchContext } from '../../config/writer.js';
import type { ToolDefinition } from './types.js';
import type { ToolMeta } from '../../security/types.js';
import type { CanManageFn } from './manage-notifications.js';

export interface CreateManageHumanTakeoverOptions {
  agentId: string;
  writer: AgentConfigWriter;
  canManage: CanManageFn;
  sessionKey?: string;
}

/**
 * Patch semantics:
 *   - undefined / omitted → keep current value (or seed default if missing)
 *   - null               → reset to schema default
 *   - concrete value      → set
 */
const ChannelSchema = z.enum(['whatsapp', 'telegram']);
const IgnoreSchema = z.enum(['reactions', 'receipts', 'typing', 'protocol']);

const InputSchema = z.object({
  target_agent_id: z.string().min(1).optional(),
  enabled: z.boolean().nullable().optional(),
  pause_ttl_minutes: z.number().int().positive().nullable().optional(),
  channels: z.array(ChannelSchema).nullable().optional(),
  ignore: z.array(IgnoreSchema).nullable().optional(),
  notification_throttle_minutes: z.number().int().nonnegative().nullable().optional(),
});

type Input = z.infer<typeof InputSchema>;

interface HumanTakeoverShape {
  enabled: boolean;
  pause_ttl_minutes: number;
  channels: ('whatsapp' | 'telegram')[];
  ignore: ('reactions' | 'receipts' | 'typing' | 'protocol')[];
  notification_throttle_minutes: number;
}

function defaults(): HumanTakeoverShape {
  return HumanTakeoverSchema.parse({}) as HumanTakeoverShape;
}

function asBlock(current: unknown): Partial<HumanTakeoverShape> {
  if (!current || typeof current !== 'object') return {};
  return current as Partial<HumanTakeoverShape>;
}

const PATCHABLE_FIELDS = [
  'enabled',
  'pause_ttl_minutes',
  'channels',
  'ignore',
  'notification_throttle_minutes',
] as const;

function applyPatch(current: Partial<HumanTakeoverShape>, input: Input): HumanTakeoverShape {
  const dflt = defaults();
  // Seed missing block with full defaults so we always emit a complete object.
  const seeded: HumanTakeoverShape = {
    enabled: current.enabled ?? dflt.enabled,
    pause_ttl_minutes: current.pause_ttl_minutes ?? dflt.pause_ttl_minutes,
    channels: current.channels ?? dflt.channels,
    ignore: current.ignore ?? dflt.ignore,
    notification_throttle_minutes:
      current.notification_throttle_minutes ?? dflt.notification_throttle_minutes,
  };
  const seededRec = seeded as unknown as Record<string, unknown>;
  const dfltRec = dflt as unknown as Record<string, unknown>;
  for (const field of PATCHABLE_FIELDS) {
    const v = input[field];
    if (v === undefined) continue;
    if (v === null) {
      // reset to default
      seededRec[field] = dfltRec[field];
    } else {
      seededRec[field] = v;
    }
  }
  return seeded;
}

function buildApplied(
  prev: Partial<HumanTakeoverShape>,
  next: HumanTakeoverShape,
  input: Input,
): Record<string, { prev: unknown; new: unknown }> {
  const applied: Record<string, { prev: unknown; new: unknown }> = {};
  for (const field of PATCHABLE_FIELDS) {
    if (input[field] === undefined) continue;
    applied[field] = {
      prev: prev[field],
      new: next[field],
    };
  }
  return applied;
}

export function createManageHumanTakeoverTool(
  opts: CreateManageHumanTakeoverOptions,
): ToolDefinition {
  const { agentId: callerId, writer, canManage, sessionKey } = opts;

  const sdkTool = tool(
    'manage_human_takeover',
    'Configure this agent (or a managed agent) human-takeover (auto-pause) subsystem. Omit a field to keep current; null to reset to default.',
    {
      target_agent_id: z.string().optional().describe('Agent to configure. Omit for self.'),
      enabled: z.boolean().nullable().optional(),
      pause_ttl_minutes: z.number().int().positive().nullable().optional(),
      channels: z.array(z.enum(['whatsapp', 'telegram'])).nullable().optional(),
      ignore: z.array(z.enum(['reactions', 'receipts', 'typing', 'protocol'])).nullable().optional(),
      notification_throttle_minutes: z.number().int().nonnegative().nullable().optional(),
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
      const input = parsed.data;
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
        action: 'human_takeover.patch',
      };

      try {
        let prevSnapshot: Partial<HumanTakeoverShape> = {};
        let nextSnapshot: HumanTakeoverShape | undefined;
        await writer.patchSection(
          targetId,
          'human_takeover',
          (current) => {
            const prev = asBlock(current);
            prevSnapshot = prev;
            const next = applyPatch(prev, input);
            nextSnapshot = next;
            return next;
          },
          patchContext,
        );
        const applied = nextSnapshot
          ? buildApplied(prevSnapshot, nextSnapshot, input)
          : {};
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
  description: 'Configure human-takeover (auto-pause) subsystem.',
  reasoning: 'Mutates agent config; risk of self-misconfiguration in public-facing agents.',
};
