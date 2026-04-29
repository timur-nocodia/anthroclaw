import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-dispatch session context. Made available to MCP tool handlers via
 * AsyncLocalStorage so they can default args (e.g. `manage_cron.deliver_to`)
 * to the originating chat without forcing the agent to ask the user for it.
 *
 * Set by the gateway around each query() call; tool handlers read it via
 * `sessionContextStore.getStore()`. Returns undefined for tool calls outside
 * a dispatch (e.g. background/cron-fired tool calls don't have a peer).
 */
export interface DispatchSessionContext {
  agentId: string;
  peerId: string;
  senderId?: string;
  channel: string;
  accountId?: string;
  threadId?: string;
}

export const sessionContextStore = new AsyncLocalStorage<DispatchSessionContext>();
