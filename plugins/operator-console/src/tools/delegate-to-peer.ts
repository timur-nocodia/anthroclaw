/**
 * operator_console.delegate_to_peer — synthesise an inbound message for the
 * managed agent's session targeting the specified peer. Useful for
 * operator-driven follow-ups (e.g. "find out a convenient time").
 *
 * The synthetic dispatch is provided by the gateway via a callback at
 * register time. We don't extract the helper from src/cron/scheduler.ts
 * (it's inline in Gateway.handleCronJob) to keep this PR small; instead
 * the gateway wires a thin `dispatchSyntheticInbound` callback that builds
 * an `InboundMessage` and runs `queryAgent`. See Task 24's wiring.
 */

import { z } from 'zod';
import type { McpToolContext, PluginMcpTool, SyntheticInboundInput, SyntheticInboundResult } from '../types-shim.js';
import { canManage } from '../permissions.js';
import type { OperatorConsoleConfig } from '../config.js';

export type DispatchSyntheticInboundFn = (
  input: SyntheticInboundInput,
) => Promise<SyntheticInboundResult>;

export interface DelegateToolDeps {
  dispatchSynthetic: DispatchSyntheticInboundFn | null;
  config: OperatorConsoleConfig;
  logger?: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void };
}

// ── Input schema ─────────────────────────────────────────────────────

export const PEER_INPUT_SCHEMA = z.object({
  channel: z.enum(['whatsapp', 'telegram']),
  account_id: z.string().min(1).optional(),
  peer_id: z.string().min(1),
});

export const INPUT_SCHEMA = z.object({
  target_agent_id: z.string().min(1),
  peer: PEER_INPUT_SCHEMA,
  instruction: z.string().min(1).max(4000),
});

export type DelegateInput = z.infer<typeof INPUT_SCHEMA>;

// ── Tool factory ──────────────────────────────────────────────────────

const TOOL_DESCRIPTION =
  'Delegate work to a managed agent by synthesising an inbound message into its peer session. ' +
  'The instruction is wrapped as "[Operator delegation] Find out from this peer: <instruction>" ' +
  'and dispatched as if it had arrived through the peer\'s channel. The managed agent processes ' +
  'it through its normal session and may reply on the same channel. Returns dispatched_message_id ' +
  'and target_session_id. Refuses with `not authorized` when the operator agent has no permission.';

export function createDelegateTool(deps: DelegateToolDeps): PluginMcpTool {
  const handler = async (
    raw: unknown,
    _ctx: McpToolContext,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    try {
      const input = INPUT_SCHEMA.parse(raw);

      if (!canManage(deps.config, input.target_agent_id)) {
        return errorResult(
          `not authorized: this operator agent cannot manage "${input.target_agent_id}"`,
        );
      }

      if (!deps.dispatchSynthetic) {
        return errorResult(
          'synthetic dispatch unavailable — operator-console is not bound to dispatchSyntheticInbound',
        );
      }

      const wrapped = `[Operator delegation] Find out from this peer: ${input.instruction}`;
      const result = await deps.dispatchSynthetic({
        targetAgentId: input.target_agent_id,
        channel: input.peer.channel,
        accountId: input.peer.account_id,
        peerId: input.peer.peer_id,
        text: wrapped,
        meta: {
          source: 'mcp:operator-console',
          delegation: true,
        },
      });

      deps.logger?.info(
        {
          target: input.target_agent_id,
          channel: input.peer.channel,
          peer: input.peer.peer_id,
          messageId: result.messageId,
        },
        'operator-console: delegated work to managed agent',
      );

      return okResult({
        ok: true,
        dispatched_message_id: result.messageId,
        target_session_id: result.sessionKey,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.warn({ err: message }, 'operator-console: delegate_to_peer failed');
      return errorResult(message);
    }
  };

  return {
    name: 'delegate_to_peer',
    description: TOOL_DESCRIPTION,
    inputSchema: INPUT_SCHEMA,
    handler,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

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
