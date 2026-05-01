/**
 * Notification subsystem — orthogonal layer that consumes events from the
 * gateway (pause start/end, intervention, errors, escalations, scheduled
 * summaries) and dispatches formatted messages to operator routes.
 *
 * Off-by-default: agents that omit the `notifications` block emit nothing.
 */

export type NotificationEventName =
  | 'peer_pause_started'
  | 'peer_pause_ended'
  | 'peer_pause_intervened_during_generation'
  | 'peer_pause_summary_daily'
  | 'agent_error'
  | 'iteration_budget_exhausted'
  | 'escalation_needed';

export interface NotificationEventPayload {
  agentId: string;
  /** IANA timezone for time formatting; falls back to 'UTC' if missing. */
  timezone?: string;
  [k: string]: unknown;
}

/**
 * A concrete delivery target — channel + account + peer. Resolved from a
 * named route (e.g., `'operator'`) declared per-agent.
 */
export interface NotificationRoute {
  channel: 'telegram' | 'whatsapp';
  accountId: string;
  peerId: string;
}

export interface NotificationSubscription {
  event: NotificationEventName;
  /** Route name; resolved against the agent's `routes` map. */
  route: string;
  /** Cron expression. Only valid for periodic events (e.g., daily summary). */
  schedule?: string;
  /** Throttle window — `'30s'`, `'5m'`, `'1h'`. Malformed values are treated as no-throttle. */
  throttle?: string;
  /** Optional payload-shape filter; not yet enforced (reserved). */
  filter?: Record<string, unknown>;
}

/**
 * Per-agent notifications config — the shape the schema produces and the
 * shape `subscribeAgent` accepts.
 */
export interface AgentNotificationsConfig {
  enabled?: boolean;
  routes?: Record<string, NotificationRoute>;
  subscriptions?: NotificationSubscription[];
}

/**
 * Function the emitter uses to actually deliver a formatted message.
 * Implementations typically wrap a `ChannelAdapter.sendText` call.
 */
export type SendNotificationFn = (
  route: NotificationRoute,
  text: string,
  meta: { event: NotificationEventName; agentId: string },
) => Promise<unknown> | unknown;
