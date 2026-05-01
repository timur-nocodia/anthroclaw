import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { AgentConfigWriter, PatchContext } from '../../config/writer.js';
import type {
  NotificationRoute,
  NotificationSubscription,
} from '../../notifications/types.js';
import type { ToolDefinition } from './types.js';
import type { ToolMeta } from '../../security/types.js';

/**
 * Cross-agent permission check. Tool factory binds the caller's agentId at
 * construction; the target may come from the tool input. Self-targets
 * always pass without invoking this callback.
 */
export type CanManageFn = (callerId: string, targetId: string) => boolean;

/**
 * Optional callback the gateway wires to fire a one-shot test notification
 * down a configured route. Decoupled from `NotificationsEmitter` to avoid
 * extending its strongly-typed event union just for the test action.
 */
export type DispatchTestNotificationFn = (input: {
  agentId: string;
  routeName: string;
  route: NotificationRoute;
}) => Promise<void> | void;

export interface CreateManageNotificationsOptions {
  agentId: string;
  writer: AgentConfigWriter;
  canManage: CanManageFn;
  dispatchTest?: DispatchTestNotificationFn;
  /** Session key recorded in the audit log entry. */
  sessionKey?: string;
}

interface NotificationsBlockShape {
  enabled?: boolean;
  routes?: Record<string, NotificationRoute>;
  subscriptions?: NotificationSubscription[];
}

const NotificationRouteSchema = z.object({
  channel: z.enum(['telegram', 'whatsapp']),
  account_id: z.string().min(1),
  peer_id: z.string().min(1),
});

const NotificationEventNameSchema = z.enum([
  'peer_pause_started',
  'peer_pause_ended',
  'peer_pause_intervened_during_generation',
  'peer_pause_summary_daily',
  'agent_error',
  'iteration_budget_exhausted',
  'escalation_needed',
]);

const NotificationSubscriptionSchema = z.object({
  event: NotificationEventNameSchema,
  route: z.string().min(1),
  schedule: z.string().min(1).optional(),
  throttle: z.string().min(1).optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
});

const ActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set_enabled'), enabled: z.boolean() }),
  z.object({ kind: z.literal('add_route'), name: z.string().min(1), route: NotificationRouteSchema }),
  z.object({ kind: z.literal('remove_route'), name: z.string().min(1) }),
  z.object({ kind: z.literal('list_routes') }),
  z.object({ kind: z.literal('add_subscription'), subscription: NotificationSubscriptionSchema }),
  z.object({ kind: z.literal('remove_subscription'), index: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('list_subscriptions') }),
  z.object({ kind: z.literal('test'), route_name: z.string().min(1) }),
]);

const InputSchema = z.object({
  target_agent_id: z.string().min(1).optional(),
  action: ActionSchema,
});

type Input = z.infer<typeof InputSchema>;
type Action = z.infer<typeof ActionSchema>;

function asBlock(current: unknown): NotificationsBlockShape {
  if (!current || typeof current !== 'object') return {};
  return current as NotificationsBlockShape;
}

function ensureBlock(block: NotificationsBlockShape): Required<NotificationsBlockShape> {
  return {
    enabled: block.enabled ?? false,
    routes: { ...(block.routes ?? {}) },
    subscriptions: [...(block.subscriptions ?? [])],
  };
}

export function createManageNotificationsTool(
  opts: CreateManageNotificationsOptions,
): ToolDefinition {
  const { agentId: callerId, writer, canManage, dispatchTest, sessionKey } = opts;

  const sdkTool = tool(
    'manage_notifications',
    'Configure this agent (or a managed agent) notifications subsystem: routes, subscriptions, on/off, and test dispatch.',
    {
      target_agent_id: z.string().optional().describe('Agent to configure. Omit for self.'),
      action: ActionSchema.describe('Action to perform. Discriminated union; one of set_enabled, add_route, remove_route, list_routes, add_subscription, remove_subscription, list_subscriptions, test.'),
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

      try {
        return await runAction(input.action, {
          callerId,
          targetId,
          writer,
          dispatchTest,
          sessionKey,
        });
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

interface RunActionContext {
  callerId: string;
  targetId: string;
  writer: AgentConfigWriter;
  dispatchTest?: DispatchTestNotificationFn;
  sessionKey?: string;
}

async function runAction(
  action: Action,
  ctx: RunActionContext,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const { callerId, targetId, writer, dispatchTest, sessionKey } = ctx;
  const patchContext: PatchContext = {
    caller: callerId,
    callerSession: sessionKey,
    source: 'chat',
    action: `notifications.${action.kind}`,
  };

  switch (action.kind) {
    case 'list_routes': {
      const block = asBlock(writer.readSection(targetId, 'notifications'));
      const routes = block.routes ?? {};
      const result = JSON.stringify({ ok: true, result: routes }, null, 2);
      return { content: [{ type: 'text', text: result }] };
    }
    case 'list_subscriptions': {
      const block = asBlock(writer.readSection(targetId, 'notifications'));
      const subs = block.subscriptions ?? [];
      const result = JSON.stringify({ ok: true, result: subs }, null, 2);
      return { content: [{ type: 'text', text: result }] };
    }
    case 'set_enabled': {
      const target = action.enabled;
      const result = await writer.patchSection(
        targetId,
        'notifications',
        (current) => {
          const next = ensureBlock(asBlock(current));
          next.enabled = target;
          return next;
        },
        patchContext,
      );
      const prev = (asBlock(result.prevValue).enabled ?? false) === target;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ok: true, changed: !prev, enabled: target }),
        }],
      };
    }
    case 'add_route': {
      const { name, route } = action;
      await writer.patchSection(
        targetId,
        'notifications',
        (current) => {
          const next = ensureBlock(asBlock(current));
          next.routes[name] = route;
          return next;
        },
        patchContext,
      );
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ok: true, changed: true, route: { name, ...route } }),
        }],
      };
    }
    case 'remove_route': {
      const { name } = action;
      let existed = false;
      await writer.patchSection(
        targetId,
        'notifications',
        (current) => {
          const next = ensureBlock(asBlock(current));
          existed = name in next.routes;
          if (existed) delete next.routes[name];
          return next;
        },
        patchContext,
      );
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ok: true, changed: existed, name }),
        }],
      };
    }
    case 'add_subscription': {
      const { subscription } = action;
      let appendedIndex = -1;
      await writer.patchSection(
        targetId,
        'notifications',
        (current) => {
          const next = ensureBlock(asBlock(current));
          appendedIndex = next.subscriptions.length;
          next.subscriptions.push(subscription);
          return next;
        },
        patchContext,
      );
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ok: true, changed: true, index: appendedIndex }),
        }],
      };
    }
    case 'remove_subscription': {
      const { index } = action;
      let removed = false;
      await writer.patchSection(
        targetId,
        'notifications',
        (current) => {
          const next = ensureBlock(asBlock(current));
          if (index >= 0 && index < next.subscriptions.length) {
            next.subscriptions.splice(index, 1);
            removed = true;
          }
          return next;
        },
        patchContext,
      );
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ok: true, changed: removed, index }),
        }],
      };
    }
    case 'test': {
      const block = asBlock(writer.readSection(targetId, 'notifications'));
      const route = block.routes?.[action.route_name];
      if (!route) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ ok: false, error: `route "${action.route_name}" not found` }),
          }],
          isError: true,
        };
      }
      if (dispatchTest) {
        await dispatchTest({ agentId: targetId, routeName: action.route_name, route });
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            dispatched: Boolean(dispatchTest),
            route_name: action.route_name,
          }),
        }],
      };
    }
  }
}

export const META: ToolMeta = {
  category: 'agent-config',
  safe_in_public: false, safe_in_trusted: true, safe_in_private: true,
  destructive: true, reads_only: false, hard_blacklist_in: ['public'],
  description: 'Configure notifications subsystem (routes, subscriptions, enabled).',
  reasoning: 'Mutates agent config; risk of self-misconfiguration in public-facing agents.',
};
