/**
 * operator_console.list_active_peers — return the recent peer activity for
 * a managed agent. v1 derives the list from the pause store entries
 * (canonical source of "currently active" peers); future versions may
 * also tap into the agent's recent message log.
 */

import { z } from 'zod';
import type { McpToolContext, PluginMcpTool } from '../types-shim.js';
import { canManage } from '../permissions.js';
import type { OperatorConsoleConfig } from '../config.js';
import type { PauseStoreLike, PauseEntryShape } from './peer-pause.js';

export interface ListActivePeersDeps {
  pauseStore: PauseStoreLike | null;
  config: OperatorConsoleConfig;
  logger?: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void };
}

export const INPUT_SCHEMA = z.object({
  target_agent_id: z.string().min(1),
  /** ISO 8601 timestamp; entries with `pausedAt < since` are dropped. */
  since: z.string().min(1).optional(),
  /** Cap returned peers. Defaults to 50. */
  limit: z.number().int().min(1).max(500).default(50),
});

export type ListActivePeersInput = z.infer<typeof INPUT_SCHEMA>;

const TOOL_DESCRIPTION =
  'List active peers for a managed agent (currently derived from pause-store entries). ' +
  'Optional `since` ISO timestamp filters by pausedAt; `limit` (1..500, default 50) caps results. ' +
  'Refuses with `not authorized` when the operator agent has no permission to manage the target.';

export function createListActivePeersTool(
  deps: ListActivePeersDeps,
): PluginMcpTool {
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
        return errorResult('pause store unavailable');
      }

      let entries: PauseEntryShape[] = deps.pauseStore.list(input.target_agent_id);

      if (input.since) {
        const sinceMs = Date.parse(input.since);
        if (!Number.isNaN(sinceMs)) {
          entries = entries.filter((e) => Date.parse(e.pausedAt) >= sinceMs);
        }
      }

      const truncated = entries.length > input.limit;
      if (truncated) entries = entries.slice(0, input.limit);

      return okResult({
        ok: true,
        target_agent_id: input.target_agent_id,
        count: entries.length,
        truncated,
        peers: entries,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.warn({ err: message }, 'operator-console: list_active_peers failed');
      return errorResult(message);
    }
  };

  return {
    name: 'list_active_peers',
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
