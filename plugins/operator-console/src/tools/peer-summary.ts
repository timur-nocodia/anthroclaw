/**
 * operator_console.peer_summary — pull memory excerpts about a specific
 * peer from the managed agent's memory store. v1 keeps it simple: pass
 * peer-related query terms to the agent's memory_search via a callback
 * the gateway provides. The plugin does not access the memory store
 * directly — it would require duplicating per-agent memory wiring.
 */

import { z } from 'zod';
import type { McpToolContext, PluginMcpTool, SearchAgentMemoryInput, SearchAgentMemoryResult } from '../types-shim.js';
import { canManage } from '../permissions.js';
import type { OperatorConsoleConfig } from '../config.js';

export type SearchAgentMemoryFn = (
  input: SearchAgentMemoryInput,
) => Promise<SearchAgentMemoryResult>;

export interface PeerSummaryDeps {
  searchAgentMemory: SearchAgentMemoryFn | null;
  config: OperatorConsoleConfig;
  logger?: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void };
}

export const PEER_INPUT_SCHEMA = z.object({
  channel: z.enum(['whatsapp', 'telegram']),
  account_id: z.string().min(1).optional(),
  peer_id: z.string().min(1),
});

export const INPUT_SCHEMA = z.object({
  target_agent_id: z.string().min(1),
  peer: PEER_INPUT_SCHEMA,
  /** Optional extra context to refine the memory query. */
  query: z.string().min(1).max(500).optional(),
  max_results: z.number().int().min(1).max(50).default(10),
});

export type PeerSummaryInput = z.infer<typeof INPUT_SCHEMA>;

const TOOL_DESCRIPTION =
  'Summarize what the managed agent already remembers about a specific peer. ' +
  'Internally runs memory_search against the target agent\'s memory store using ' +
  'peer identifiers (channel/account/peer_id) plus an optional `query` for refinement. ' +
  'Returns up to `max_results` excerpts (default 10, max 50). ' +
  'Refuses with `not authorized` when the operator agent has no permission.';

export function createPeerSummaryTool(deps: PeerSummaryDeps): PluginMcpTool {
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

      if (!deps.searchAgentMemory) {
        return okResult({
          ok: true,
          target_agent_id: input.target_agent_id,
          peer_key: peerKey(input.peer),
          // No memory adapter — best-effort empty response so the tool is
          // never the cause of the calling agent stalling.
          results: [],
          notes:
            'memory adapter not available — peer_summary returned no results (gateway may not have wired searchAgentMemory).',
        });
      }

      const queryText = buildQuery(input);
      const result = await deps.searchAgentMemory({
        targetAgentId: input.target_agent_id,
        query: queryText,
        maxResults: input.max_results,
      });

      return okResult({
        ok: true,
        target_agent_id: input.target_agent_id,
        peer_key: peerKey(input.peer),
        query: queryText,
        results: result.results,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.warn({ err: message }, 'operator-console: peer_summary failed');
      return errorResult(message);
    }
  };

  return {
    name: 'peer_summary',
    description: TOOL_DESCRIPTION,
    inputSchema: INPUT_SCHEMA,
    handler,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function peerKey(peer: { channel: string; account_id?: string; peer_id: string }): string {
  return `${peer.channel}:${peer.account_id ?? '_'}:${peer.peer_id}`;
}

function buildQuery(input: PeerSummaryInput): string {
  const parts: string[] = [];
  if (input.query) parts.push(input.query);
  parts.push(input.peer.peer_id);
  if (input.peer.account_id) parts.push(input.peer.account_id);
  parts.push(input.peer.channel);
  return parts.join(' ');
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
