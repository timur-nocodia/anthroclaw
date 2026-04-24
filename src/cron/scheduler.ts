import { CronJob as CronJobRunner } from 'cron';
import { logger } from '../logger.js';

export const SILENT_MARKER = '[SILENT]';

export function isSilentResponse(response: string): boolean {
  return response.includes(SILENT_MARKER);
}

export interface ScheduledJob {
  id: string;
  agentId: string;
  schedule: string;
  prompt: string;
  deliverTo?: { channel: string; peer_id: string; account_id?: string };
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
