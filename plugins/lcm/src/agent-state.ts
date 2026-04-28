/**
 * Per-agent LCM runtime state — bundle of all stateful objects a tool needs.
 *
 * Tool factories take a `resolveAgent: (agentId: string) => AgentState`
 * callback and call it inside the handler with `ctx.agentId` from the
 * `McpToolContext`. This replaces the v0.1.0 'default' bootstrap that bound
 * tools to a single agent's state at register time (T19 → T24 amendment).
 *
 * Note: each `AgentState` represents the agent's full per-DB state (one
 * SQLite file per agent). Session filtering is the responsibility of each
 * tool — either via tool input args, or via `ctx.sessionKey` from
 * `McpToolContext` when the gateway plumbs it through. There is intentionally
 * NO `sessionKey` field on `AgentState`: the previous synthesised
 * `${agentId}:default` value did not match the real gateway sessionKeys
 * under which mirror-hook / engine-facade ingest data, so any tool that
 * scoped reads by it returned nothing in production. (T24 review fix.)
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
}
