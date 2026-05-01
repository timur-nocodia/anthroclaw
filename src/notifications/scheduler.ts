import { CronJob as CronJobRunner } from 'cron';
import { logger } from '../logger.js';
import type { NotificationsEmitter } from './emitter.js';
import type { AgentNotificationsConfig, NotificationEventName } from './types.js';

/**
 * Lightweight cron registration for notification subscriptions that carry
 * a `schedule` field (currently `peer_pause_summary_daily`, but the
 * surface is event-agnostic).
 *
 * Kept separate from the gateway's `CronScheduler` because that one is
 * tightly coupled to ScheduledJob → synthetic agent inbound flow; here
 * the tick fires `emitter.fireScheduled(event, { agentId })` which
 * builds its payload from current state (e.g., aggregating active
 * pauses).
 */
export interface NotificationsScheduler {
  /** Register cron entries for an agent's `subscriptions[].schedule` fields. */
  registerAgent(agentId: string, cfg: AgentNotificationsConfig | undefined): void;
  /** Remove all jobs for an agent (e.g., on hot-reload removal). */
  unregisterAgent(agentId: string): void;
  /** Stop and clear all jobs (e.g., on gateway shutdown). */
  stopAll(): void;
  /** Diagnostic: list registered job keys. */
  listJobs(): string[];
}

export interface CreateNotificationsSchedulerOptions {
  emitter: Pick<NotificationsEmitter, 'subscribeAgent'> & {
    fireScheduled: (event: NotificationEventName, payload: { agentId: string }) => Promise<void>;
  };
  /**
   * Resolve the IANA timezone an agent's cron expressions should fire
   * in. `0 9 * * *` means 9am local for the agent, not 9am UTC. Returns
   * undefined to fall back to UTC.
   */
  getAgentTimezone?: (agentId: string) => string | undefined;
  /** Hook for tests to assert registration without spinning real cron. */
  testNoStart?: boolean;
}

export function createNotificationsScheduler(
  opts: CreateNotificationsSchedulerOptions,
): NotificationsScheduler {
  const jobs = new Map<string, CronJobRunner>();

  function jobKey(agentId: string, idx: number, event: string): string {
    return `${agentId}::${event}::${idx}`;
  }

  return {
    registerAgent: (agentId, cfg) => {
      // Drop existing jobs for this agent first — registration is idempotent.
      for (const key of [...jobs.keys()]) {
        if (key.startsWith(`${agentId}::`)) {
          jobs.get(key)?.stop();
          jobs.delete(key);
        }
      }
      if (!cfg || cfg.enabled === false) return;
      const subs = cfg.subscriptions ?? [];
      subs.forEach((sub, idx) => {
        if (!sub.schedule) return;
        const key = jobKey(agentId, idx, sub.event);
        try {
          const tz = opts.getAgentTimezone?.(agentId) ?? 'UTC';
          const runner = CronJobRunner.from({
            cronTime: sub.schedule,
            onTick: async () => {
              try {
                await opts.emitter.fireScheduled(sub.event, { agentId });
              } catch (err) {
                logger.warn(
                  { err, agentId, event: sub.event },
                  'notifications scheduler: fireScheduled failed',
                );
              }
            },
            start: !opts.testNoStart,
            timeZone: tz,
          });
          jobs.set(key, runner);
          logger.info(
            { key, schedule: sub.schedule, event: sub.event, agentId },
            'notifications scheduler: cron registered',
          );
        } catch (err) {
          logger.warn(
            { err, agentId, event: sub.event, schedule: sub.schedule },
            'notifications scheduler: failed to register cron',
          );
        }
      });
    },
    unregisterAgent: (agentId) => {
      for (const key of [...jobs.keys()]) {
        if (key.startsWith(`${agentId}::`)) {
          jobs.get(key)?.stop();
          jobs.delete(key);
        }
      }
    },
    stopAll: () => {
      for (const runner of jobs.values()) runner.stop();
      jobs.clear();
    },
    listJobs: () => [...jobs.keys()],
  };
}
