import { CronJob as CronJobRunner } from 'cron';
import { logger } from '../logger.js';

export const SILENT_MARKER = '[SILENT]';

export function isSilentResponse(response: string): boolean {
  return response.includes(SILENT_MARKER);
}

/**
 * Sentinel for "the agent has decided not to reply this turn".
 *
 * Conventional pattern in conversational agents: the system prompt instructs
 * the model to emit a marker token (e.g. `NO_REPLY`) when it judges the
 * message doesn't warrant a response — blocked sender, off-topic spam, ack-only
 * follow-up, etc. The gateway recognizes the marker and suppresses delivery.
 *
 * Two real shapes the model emits in practice:
 *   1. Whole response is just the marker → suppress delivery entirely.
 *   2. Marker tacked on as a trailing line after a real reply (the model
 *      treats it as "end of turn"). Strip it; deliver the rest.
 *
 * `processNoReplySentinel` returns the message that should be delivered, or
 * `null` if delivery should be suppressed.
 */
const NO_REPLY_TRAILING = /(?:^|\n)\s*no_reply[^\n]*\s*$/i;
const NO_REPLY_LEADING = /^no_reply\b/i;

export function processNoReplySentinel(response: string): string | null {
  const trimmed = response.trim();
  if (NO_REPLY_LEADING.test(trimmed)) return null;

  const stripped = response.replace(NO_REPLY_TRAILING, '').trimEnd();
  if (stripped.length === 0) return null;
  return stripped;
}

export interface ScheduledJob {
  id: string;
  agentId: string;
  schedule: string;
  prompt: string;
  deliverTo?: { channel: string; peer_id: string; account_id?: string; thread_id?: string };
  runOnce?: boolean;
  expiresAt?: number;
  enabled: boolean;
}

export class CronScheduler {
  private jobs: Map<string, CronJobRunner> = new Map();
  private handler: (job: ScheduledJob) => Promise<void>;

  constructor(handler: (job: ScheduledJob) => Promise<void>) {
    this.handler = handler;
  }

  addJob(job: ScheduledJob): void {
    if (!job.enabled) return;
    if (typeof job.expiresAt === 'number' && job.expiresAt <= Date.now()) return;

    const key = `${job.agentId}:${job.id}`;

    const runner = CronJobRunner.from({
      cronTime: job.schedule,
      onTick: async () => {
        logger.info({ agentId: job.agentId, jobId: job.id }, 'Cron job fired');
        try {
          await this.handler(job);
        } catch (err) {
          logger.error({ err, agentId: job.agentId, jobId: job.id }, 'Cron job handler failed');
        }
      },
      start: true,
      timeZone: 'UTC',
    });

    this.jobs.set(key, runner);
    logger.info({ key, schedule: job.schedule }, 'Cron job registered');
  }

  stop(): void {
    for (const [key, runner] of this.jobs) {
      runner.stop();
      logger.info({ key }, 'Cron job stopped');
    }
    this.jobs.clear();
  }

  listJobs(): string[] {
    return [...this.jobs.keys()];
  }
}
