import type { EventEmitter } from 'node:events';
import type { PendingStore } from './pending-store.js';
import type { OnboardingEvent } from './index.js';

/**
 * Sweep expired pending rows: flip status `pending`/`exchanging` → `expired`
 * for any row past `expiresAt`, and emit a `timeout` event for each chat-
 * initiated sweep so the Gateway can dispatch a `[system] mcp_connect_
 * timeout: <serverId>` follow-up into the originating session.
 *
 * - Admin-initiated rows (`requestedBy` starts with `admin:`) are still
 *   swept (the row transition happens regardless) but produce no event —
 *   the wizard UI surfaces a stale-state error on its own.
 * - The `serverId` field on the event is the original `mcpUrl`; the row
 *   was expired before `deriveServerId` ever ran for it.
 *
 * Returns the number of rows swept so the caller (the 5-min Gateway cron
 * in Task 25) can log the sweep size.
 */
export function runCleanup(deps: {
  pending: PendingStore;
  events: EventEmitter;
  now?: () => number;
}): number {
  const n = (deps.now ?? Date.now)();
  const swept = deps.pending.sweepExpired(n);
  for (const row of swept) {
    if (row.requestedBy.startsWith('agent:')) {
      deps.events.emit('timeout', {
        pendingId: row.id,
        agentId: row.agentId,
        agentSessionKey: row.agentSessionKey,
        serverId: row.mcpUrl,
      } satisfies OnboardingEvent);
    }
  }
  return swept.length;
}
