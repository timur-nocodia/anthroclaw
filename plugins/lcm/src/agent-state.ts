/**
 * Per-agent LCM runtime state — bundle of all stateful objects a tool needs.
 *
 * Tool factories take a `resolveAgent: (agentId: string) => AgentState`
 * callback and call it inside the handler with `ctx.agentId` from the
 * `McpToolContext`. This replaces the v0.1.0 'default' bootstrap that bound
 * tools to a single agent's state at register time (T19 → T24 amendment).
 */

import type Database from 'better-sqlite3';
import type { MessageStore } from './store.js';
import type { SummaryDAG } from './dag.js';
import type { LifecycleManager } from './lifecycle.js';
import type { LCMConfig } from './config.js';

export interface AgentState {
  db: Database.Database;
  store: MessageStore;
  dag: SummaryDAG;
  lifecycle: LifecycleManager;
  config: LCMConfig;
  /**
   * Stable session key built from agentId. Tools that need a session ID
   * use this; future iterations may inject a richer sessionKey via
   * `ctx.sessionKey` from `McpToolContext`.
   */
  sessionKey: string;
}
