/**
 * operator_console.escalate — emit an `escalation_needed` notification for
 * the calling agent (no target). The agent uses this when it judges the
 * situation is beyond its scope and a human operator should step in.
 *
 * Unlike the other operator-console tools, escalate does NOT take a
 * target_agent_id — it always operates on the calling agent (ctx.agentId)
 * and routes through that agent's own notifications subscription.
 */

import { z } from 'zod';
import type { McpToolContext, PluginMcpTool } from '../types-shim.js';

// Minimal interface — only `emit` is needed.
export interface NotificationsEmitterLike {
  emit(
    event: 'escalation_needed',
    payload: { agentId: string; message: string; priority: 'low' | 'medium' | 'high' } & Record<string, unknown>,
  ): Promise<void>;
}

export interface EscalateDeps {
  notificationsEmitter: NotificationsEmitterLike | null;
  /**
   * Required when the plugin is enabled — without it the tool no-ops.
   * `enabled` from OperatorConsoleConfig still gates whether the tool is
   * registered at all.
   */
  enabled: boolean;
  logger?: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void };
}

export const INPUT_SCHEMA = z.object({
  message: z.string().min(1).max(2000),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

export type EscalateInput = z.infer<typeof INPUT_SCHEMA>;

const TOOL_DESCRIPTION =
  'Escalate to a human operator. Emits an `escalation_needed` notification on behalf of the ' +
  'calling agent (no target_agent_id). Provide a short `message` describing what needs attention ' +
  'and an optional `priority` (low | medium | high — default medium). The notification is ' +
  'delivered through the calling agent\'s configured notification routes.';

export function createEscalateTool(deps: EscalateDeps): PluginMcpTool {
  const handler = async (
    raw: unknown,
    ctx: McpToolContext,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    try {
      if (!deps.enabled) {
        return errorResult('operator-console plugin is disabled for this agent');
      }

      const input = INPUT_SCHEMA.parse(raw);

      if (!deps.notificationsEmitter) {
        return errorResult(
          'notifications emitter unavailable — the gateway has not wired the operator-console plugin to a NotificationsEmitter',
        );
      }

      await deps.notificationsEmitter.emit('escalation_needed', {
        agentId: ctx.agentId,
        message: input.message,
        priority: input.priority,
        at: new Date().toISOString(),
      });

      deps.logger?.info(
        { agentId: ctx.agentId, priority: input.priority },
        'operator-console: escalation emitted',
      );

      return okResult({
        ok: true,
        agentId: ctx.agentId,
        priority: input.priority,
        message: input.message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.warn({ err: message }, 'operator-console: escalate failed');
      return errorResult(message);
    }
  };

  return {
    name: 'escalate',
    description: TOOL_DESCRIPTION,
    inputSchema: INPUT_SCHEMA,
    handler,
  };
}

function okResult(obj: Record<string, unknown>): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj) }] };
}

function errorResult(message: string): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
  };
}
