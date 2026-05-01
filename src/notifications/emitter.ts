import type {
  AgentNotificationsConfig,
  NotificationEventName,
  NotificationEventPayload,
  NotificationRoute,
  NotificationSubscription,
  SendNotificationFn,
} from './types.js';

/**
 * Public surface of the notifications emitter. Stage 2 (Tasks 11–16):
 * scaffold types and registration; later tasks fill in subscription
 * dispatch, throttle, and scheduled events.
 */
export interface NotificationsEmitter {
  /** Register or replace the per-agent notifications config. Idempotent. */
  subscribeAgent(agentId: string, cfg: AgentNotificationsConfig | undefined): void;
  /** Remove an agent's subscriptions (e.g., on hot-reload removal). */
  unsubscribeAgent(agentId: string): void;
  /** Dispatch an event payload to every matching subscription. */
  emit(event: NotificationEventName, payload: NotificationEventPayload): Promise<void>;
  /** Lower-level helper retained for symmetry with `emit` — same semantics. */
  subscribe(agentId: string, subscription: NotificationSubscription, route: NotificationRoute): void;
}

export interface CreateNotificationsEmitterOptions {
  sendMessage: SendNotificationFn;
}

/**
 * Factory. Returns an emitter whose `emit` is a no-op until Task 14 wires
 * subscription dispatch + throttle. The shape is the contract that
 * Stage 1 callsites (gateway, send-message tool) bind to.
 */
export function createNotificationsEmitter(
  opts: CreateNotificationsEmitterOptions,
): NotificationsEmitter {
  void opts.sendMessage;
  const agentConfigs = new Map<string, AgentNotificationsConfig>();

  return {
    subscribeAgent: (agentId, cfg) => {
      if (!cfg) {
        agentConfigs.delete(agentId);
        return;
      }
      agentConfigs.set(agentId, cfg);
    },
    unsubscribeAgent: (agentId) => {
      agentConfigs.delete(agentId);
    },
    emit: async (_event, _payload) => {
      void _event;
      void _payload;
    },
    subscribe: (_agentId, _subscription, _route) => {
      void _agentId;
      void _subscription;
      void _route;
    },
  };
}
