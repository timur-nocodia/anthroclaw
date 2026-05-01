/**
 * operator_console.peer_pause — pause / unpause / list / status of pause
 * entries for a managed agent's peer.
 *
 * The plugin name (`operator-console`) and the gateway's namespacing rule
 * (`<plugin>_<tool>`) produce the runtime tool name `operator-console_peer_pause`.
 */

import { z } from 'zod';
import type { McpToolContext, PluginMcpTool } from '../types-shim.js';
import { canManage } from '../permissions.js';
import type { OperatorConsoleConfig } from '../config.js';

// ── PauseStore surface (only the bits we use) ────────────────────────

export interface PauseEntryShape {
  agentId: string;
  peerKey: string;
  pausedAt: string;
  expiresAt: string | null;
  reason: string;
  source: string;
  extendedCount: number;
  lastOperatorMessageAt: string | null;
}

export interface PauseStoreLike {
  pause(
    agentId: string,
    peerKey: string,
    opts: {
      ttlMinutes?: number;
      reason: 'operator_takeover' | 'manual' | 'manual_indefinite';
      source: string;
    },
  ): PauseEntryShape;
  unpause(agentId: string, peerKey: string, reason: string): PauseEntryShape | null;
  isPaused(
    agentId: string,
    peerKey: string,
  ): { paused: boolean; entry?: PauseEntryShape; expired?: boolean };
  list(agentId?: string): PauseEntryShape[];
}

export interface PeerPauseToolDeps {
  pauseStore: PauseStoreLike | null;
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
  action: z.enum(['pause', 'unpause', 'list', 'status']),
  /**
   * TTL in minutes for `action: 'pause'`. `null` means indefinite
   * (manual_indefinite reason). Omitted (`undefined`) inherits the agent
   * pause-store default TTL.
   */
  ttl_minutes: z.number().int().positive().nullable().optional(),
});

export type PeerPauseInput = z.infer<typeof INPUT_SCHEMA>;

// ── peerKey helper ────────────────────────────────────────────────────

/**
 * Build the canonical peerKey the gateway uses. When account_id is missing
 * we fall back to the literal `_` placeholder (matches send_message's
 * fail-open warning pattern). The fallback is documented because it will
 * never match a real gateway-issued pauseKey on a multi-account WA setup,
 * but it keeps single-account / test deployments working.
 */
export function buildPeerKey(peer: z.infer<typeof PEER_INPUT_SCHEMA>): string {
  return `${peer.channel}:${peer.account_id ?? '_'}:${peer.peer_id}`;
}

// ── Tool factory ──────────────────────────────────────────────────────

const TOOL_DESCRIPTION =
  'Pause, unpause, list, or check status of pause entries on a managed agent. ' +
  'action="pause" with ttl_minutes (positive int) sets a TTL pause; ttl_minutes=null sets an indefinite pause. ' +
  'action="unpause" removes the pause. action="list" returns all active pauses for the target agent. ' +
  'action="status" returns the pause status for a specific peer. ' +
  'Refuses with `not authorized` when the operator agent has no permission to manage the target.';

export function createPeerPauseTool(deps: PeerPauseToolDeps): PluginMcpTool {
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

      if (!deps.pauseStore) {
        return errorResult(
          'pause store unavailable — operator-console is not bound to a peerPauseStore at register time',
        );
      }

      const peerKey = buildPeerKey(input.peer);

      switch (input.action) {
        case 'pause': {
          // ttl_minutes === null → indefinite (manual_indefinite reason)
          // ttl_minutes === undefined → also indefinite (no TTL passed)
          // ttl_minutes is a positive int → TTL pause (manual reason)
          const ttlMinutes = input.ttl_minutes ?? undefined;
          const reason: 'manual' | 'manual_indefinite' =
            input.ttl_minutes === null || input.ttl_minutes === undefined
              ? 'manual_indefinite'
              : 'manual';
          const entry = deps.pauseStore.pause(input.target_agent_id, peerKey, {
            ttlMinutes,
            reason,
            source: 'mcp:operator-console',
          });
          deps.logger?.info(
            { target: input.target_agent_id, peerKey, ttlMinutes },
            'operator-console: peer_pause',
          );
          return okResult({
            ok: true,
            action: 'pause',
            peer_key: peerKey,
            expires_at: entry.expiresAt,
            paused_at: entry.pausedAt,
            reason: entry.reason,
          });
        }
        case 'unpause': {
          const removed = deps.pauseStore.unpause(
            input.target_agent_id,
            peerKey,
            'mcp:operator-console',
          );
          deps.logger?.info(
            { target: input.target_agent_id, peerKey, was_paused: !!removed },
            'operator-console: peer_unpause',
          );
          return okResult({
            ok: true,
            action: 'unpause',
            peer_key: peerKey,
            was_paused: !!removed,
          });
        }
        case 'list': {
          const pauses = deps.pauseStore.list(input.target_agent_id);
          return okResult({ ok: true, action: 'list', pauses });
        }
        case 'status': {
          const status = deps.pauseStore.isPaused(input.target_agent_id, peerKey);
          return okResult({ ok: true, action: 'status', peer_key: peerKey, ...status });
        }
        default:
          return errorResult(`unknown action: ${String(input.action)}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.warn({ err: message }, 'operator-console: peer_pause failed');
      return errorResult(message);
    }
  };

  return {
    name: 'peer_pause',
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
