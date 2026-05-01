import { createHash } from 'node:crypto';
import { logger } from '../logger.js';
import { formatForChannel } from './formatters.js';
import type { PeerPauseStore } from '../routing/peer-pause.js';
import type {
  AgentNotificationsConfig,
  NotificationEventName,
  NotificationEventPayload,
  NotificationRoute,
  NotificationSubscription,
  SendNotificationFn,
} from './types.js';

/**
 * Public surface of the notifications emitter. Owns:
 *  • per-agent route + subscription registry (via subscribeAgent)
 *  • dispatch fan-out on `emit` to all matching subscriptions
 *  • per-(event, route, payload-hash) throttle window
 *
 * The emitter is the only call surface the gateway and the send_message
 * tool depend on. Stage 3 (operator-console plugin) reuses the same
 * surface for `escalation_needed` and similar.
 */
export interface NotificationsEmitter {
  /** Register or replace the per-agent notifications config. Idempotent. */
  subscribeAgent(agentId: string, cfg: AgentNotificationsConfig | undefined): void;
  /** Remove an agent's subscriptions (e.g., on hot-reload removal). */
  unsubscribeAgent(agentId: string): void;
  /** Dispatch an event payload to every matching subscription. */
  emit(event: NotificationEventName, payload: NotificationEventPayload): Promise<void>;
  /** Lower-level helper: register a single subscription with a literal route. */
  subscribe(agentId: string, subscription: NotificationSubscription, route: NotificationRoute): void;
  /**
   * Fire a scheduled event for a specific agent. The emitter constructs
   * the payload from current state (e.g., aggregating active pauses for
   * `peer_pause_summary_daily`). Called by the notifications scheduler
   * on cron tick.
   */
  fireScheduled(event: NotificationEventName, args: { agentId: string }): Promise<void>;
}

export interface CreateNotificationsEmitterOptions {
  sendMessage: SendNotificationFn;
  /** Injectable clock for tests. Defaults to Date.now. */
  clock?: () => number;
  /**
   * Max throttle entries to retain in memory. Old entries are dropped
   * LRU-style when the cap is exceeded. Default 1000.
   */
  throttleMaxEntries?: number;
  /**
   * Optional pause store. When provided, scheduled events that summarize
   * pauses (e.g. `peer_pause_summary_daily`) build their payload from
   * `peerPauseStore.list(agentId)`. When absent the summary fires with
   * an empty `items` array.
   */
  peerPauseStore?: Pick<PeerPauseStore, 'list'> | null;
  /**
   * Optional resolver for per-agent timezone (used by formatters in
   * scheduled events). Defaults to UTC.
   */
  getAgentTimezone?: (agentId: string) => string | undefined;
}

interface ResolvedSubscription {
  subscription: NotificationSubscription;
  route: NotificationRoute;
  routeName: string;
}

const DEFAULT_THROTTLE_CAP = 1000;

/**
 * Events whose cadence is governed by a cron schedule rather than the
 * per-(event, route, payload-hash) throttle window. Skipping the throttle
 * here ensures a scheduled fire after a process restart (which clears
 * the throttle map but preserves the cron) is not silently dropped — the
 * cron schedule itself is the rate limit.
 */
const SCHEDULED_EVENTS = new Set<NotificationEventName>([
  'peer_pause_summary_daily',
]);

/**
 * Parse a throttle string like "5m", "30s", "1h" into milliseconds.
 * Returns null for unrecognized input — the emitter then treats it as
 * no-throttle and logs a one-time warning per malformed value.
 */
export function parseThrottle(input: string | undefined | null): number | null {
  if (!input) return null;
  const m = input.trim().match(/^(\d+)\s*(s|m|h)$/i);
  if (!m) return null;
  const n = Number.parseInt(m[1] ?? '', 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] ?? '').toLowerCase();
  switch (unit) {
    case 's': return n * 1000;
    case 'm': return n * 60_000;
    case 'h': return n * 3_600_000;
    default: return null;
  }
}

/**
 * Build a stable hash of payload fields that distinguish "the same event
 * about the same thing" — e.g. peerKey for pause events. Used to
 * collapse repeat events within a throttle window.
 */
function dedupeKeyFor(event: NotificationEventName, payload: NotificationEventPayload): string {
  const parts: string[] = [event, String(payload.agentId ?? '')];
  // Stable, well-known fields used across the pause/error events.
  for (const key of ['peerKey', 'channel', 'accountId']) {
    const v = payload[key];
    if (typeof v === 'string') parts.push(`${key}=${v}`);
  }
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

export function createNotificationsEmitter(
  opts: CreateNotificationsEmitterOptions,
): NotificationsEmitter {
  const sendMessage = opts.sendMessage;
  const clock = opts.clock ?? Date.now;
  const throttleCap = opts.throttleMaxEntries ?? DEFAULT_THROTTLE_CAP;
  const peerPauseStore = opts.peerPauseStore ?? null;
  const getAgentTimezone = opts.getAgentTimezone;

  const agentConfigs = new Map<string, AgentNotificationsConfig>();
  // (event, routeKey, dedupeKey) → last-emit ms
  const throttleHits = new Map<string, number>();
  const warnedMalformed = new Set<string>();

  function noteThrottle(key: string, now: number): void {
    // delete-then-set moves the entry to the tail of insertion order,
    // turning Map's insertion-order iteration into LRU semantics.
    throttleHits.delete(key);
    throttleHits.set(key, now);
    if (throttleHits.size > throttleCap) {
      const oldest = throttleHits.keys().next().value as string | undefined;
      if (oldest !== undefined) throttleHits.delete(oldest);
    }
  }

  function resolveSubscriptions(
    agentId: string,
    event: NotificationEventName,
  ): ResolvedSubscription[] {
    const cfg = agentConfigs.get(agentId);
    if (!cfg) return [];
    if (cfg.enabled === false) return [];
    const subs = cfg.subscriptions ?? [];
    const routes = cfg.routes ?? {};
    const matches: ResolvedSubscription[] = [];
    for (const sub of subs) {
      if (sub.event !== event) continue;
      const route = routes[sub.route];
      if (!route) {
        logger.warn(
          { agentId, event, routeName: sub.route },
          'notifications: subscription references unknown route name; skipping',
        );
        continue;
      }
      matches.push({ subscription: sub, route, routeName: sub.route });
    }
    return matches;
  }

  async function dispatchOne(
    event: NotificationEventName,
    payload: NotificationEventPayload,
    resolved: ResolvedSubscription,
  ): Promise<void> {
    const { subscription, route, routeName } = resolved;
    const text = formatForChannel(route.channel, event, payload);
    const now = clock();
    const throttleMs = parseThrottle(subscription.throttle);
    if (subscription.throttle && throttleMs === null && !warnedMalformed.has(subscription.throttle)) {
      warnedMalformed.add(subscription.throttle);
      logger.warn(
        { throttle: subscription.throttle, agentId: payload.agentId, event },
        'notifications: malformed throttle string; treating as no-throttle',
      );
    }
    // Scheduled events (cron-driven) skip the throttle map entirely —
    // their cadence is already bounded by the cron schedule, and the
    // dedupe key for scheduled payloads collapses to event+agentId
    // (no peerKey/channel/accountId), so a process restart within the
    // throttle window would otherwise drop the next fire silently.
    if (throttleMs !== null && !SCHEDULED_EVENTS.has(event)) {
      const key = `${event}::${payload.agentId}::${routeName}::${dedupeKeyFor(event, payload)}`;
      const last = throttleHits.get(key);
      if (last !== undefined && now - last < throttleMs) {
        logger.debug(
          { event, agentId: payload.agentId, routeName, throttleMs, sinceLastMs: now - last },
          'notifications: throttled; skipping send',
        );
        return;
      }
      noteThrottle(key, now);
    }
    try {
      await sendMessage(route, text, { event, agentId: String(payload.agentId) });
    } catch (err) {
      logger.warn(
        { err, event, agentId: payload.agentId, routeName },
        'notifications: send failed',
      );
    }
  }

  function buildScheduledPayload(
    event: NotificationEventName,
    agentId: string,
  ): NotificationEventPayload {
    const tz = getAgentTimezone?.(agentId);
    const base: NotificationEventPayload = { agentId };
    if (tz) base.timezone = tz;

    if (event === 'peer_pause_summary_daily') {
      const entries = peerPauseStore ? peerPauseStore.list(agentId) : [];
      const items = entries.map((e) => ({
        peerKey: e.peerKey,
        pausedAt: e.pausedAt,
        expiresAt: e.expiresAt,
        extendedCount: e.extendedCount,
        reason: e.reason,
      }));
      base.activePauses = items.length;
      base.items = items;
    }
    return base;
  }

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
    emit: async (event, payload) => {
      const agentId = String(payload.agentId ?? '');
      if (!agentId) return;
      const resolved = resolveSubscriptions(agentId, event);
      if (resolved.length === 0) return;
      await Promise.all(resolved.map((r) => dispatchOne(event, payload, r)));
    },
    subscribe: (agentId, subscription, route) => {
      const existing = agentConfigs.get(agentId) ?? {
        enabled: true,
        routes: {},
        subscriptions: [],
      };
      const routes = { ...(existing.routes ?? {}), [subscription.route]: route };
      const subscriptions = [...(existing.subscriptions ?? []), subscription];
      agentConfigs.set(agentId, { ...existing, routes, subscriptions });
    },
    fireScheduled: async (event, args) => {
      const payload = buildScheduledPayload(event, args.agentId);
      const resolved = resolveSubscriptions(args.agentId, event);
      if (resolved.length === 0) return;
      await Promise.all(resolved.map((r) => dispatchOne(event, payload, r)));
    },
  };
}
