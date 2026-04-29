import { randomUUID } from 'node:crypto';
import { logger } from '../logger.js';
import { metrics } from '../metrics/collector.js';
import { redactSecrets } from '../security/redact.js';

export type LearningTriggerType =
  | 'turn_interval'
  | 'user_correction'
  | 'tool_error_recovered'
  | 'tool_call_threshold'
  | 'skill_or_memory_activity'
  | 'compression_or_lcm';

export interface LearningTriggerInput {
  reviewIntervalTurns?: number;
  turnCount?: number;
  userText?: string;
  recoveredToolErrors?: number;
  toolCalls?: number;
  toolCallThreshold?: number;
  skillOrMemoryActivity?: boolean;
  compressionOrLcmActivity?: boolean;
}

export interface LearningReviewJobInput {
  agentId: string;
  sessionKey: string;
  runId?: string;
  traceId?: string;
  sdkSessionId?: string;
  trigger: LearningTriggerType;
  triggers?: LearningTriggerType[];
  createdAt?: number;
  metadata?: Record<string, unknown>;
}

export interface LearningReviewJob {
  id: string;
  agentId: string;
  sessionKey: string;
  runId?: string;
  traceId?: string;
  sdkSessionId?: string;
  triggers: LearningTriggerType[];
  createdAt: number;
  updatedAt: number;
  coalescedCount: number;
  metadata: Record<string, unknown>;
}

export interface LearningQueueOptions {
  runner: (job: LearningReviewJob) => Promise<void>;
  onError?: (err: unknown, job: LearningReviewJob) => void;
  now?: () => number;
}

export type LearningQueueEnqueueResult =
  | { status: 'started'; job: LearningReviewJob }
  | { status: 'coalesced'; job: LearningReviewJob };

export class LearningQueue {
  private readonly runner: (job: LearningReviewJob) => Promise<void>;
  private readonly onError?: (err: unknown, job: LearningReviewJob) => void;
  private readonly now: () => number;
  private readonly active = new Map<string, LearningReviewJob>();
  private readonly pending = new Map<string, LearningReviewJob>();

  constructor(options: LearningQueueOptions) {
    this.runner = options.runner;
    this.onError = options.onError;
    this.now = options.now ?? Date.now;
  }

  enqueueAfterResponse(input: LearningReviewJobInput): LearningQueueEnqueueResult {
    const key = jobKey(input.agentId, input.sessionKey);
    const existing = this.active.get(key) ?? this.pending.get(key);
    if (existing) {
      mergeJob(existing, input, this.now());
      this.pending.set(key, existing);
      return { status: 'coalesced', job: cloneJob(existing) };
    }

    const job = createJob(input, this.now());
    this.start(key, job);
    return { status: 'started', job: cloneJob(job) };
  }

  listActive(): LearningReviewJob[] {
    return [...this.active.values()].map(cloneJob);
  }

  listPending(): LearningReviewJob[] {
    return [...this.pending.values()].map(cloneJob);
  }

  stop(): void {
    this.pending.clear();
    this.active.clear();
  }

  private start(key: string, job: LearningReviewJob): void {
    this.pending.delete(key);
    this.active.set(key, job);
    metrics.increment('learning_reviews_started');
    void Promise.resolve()
      .then(() => this.runner(cloneJob(job)))
      .catch((err) => {
        metrics.increment('learning_reviews_failed');
        this.onError?.(err, cloneJob(job));
        logger.warn({
          err: redactSecrets(String(err)),
          agentId: job.agentId,
          sessionKey: job.sessionKey,
          runId: job.runId,
          triggers: job.triggers,
        }, 'Learning review failed');
      })
      .finally(() => {
        this.active.delete(key);
        const next = this.pending.get(key);
        if (next) {
          this.start(key, next);
        }
      });
  }
}

export function detectLearningTriggers(input: LearningTriggerInput): LearningTriggerType[] {
  const triggers = new Set<LearningTriggerType>();
  if (
    input.reviewIntervalTurns
    && input.reviewIntervalTurns > 0
    && input.turnCount
    && input.turnCount > 0
    && input.turnCount % input.reviewIntervalTurns === 0
  ) {
    triggers.add('turn_interval');
  }
  if (input.userText && looksLikeCorrection(input.userText)) {
    triggers.add('user_correction');
  }
  if ((input.recoveredToolErrors ?? 0) > 0) {
    triggers.add('tool_error_recovered');
  }
  if (
    input.toolCallThreshold
    && input.toolCallThreshold > 0
    && (input.toolCalls ?? 0) >= input.toolCallThreshold
  ) {
    triggers.add('tool_call_threshold');
  }
  if (input.skillOrMemoryActivity) {
    triggers.add('skill_or_memory_activity');
  }
  if (input.compressionOrLcmActivity) {
    triggers.add('compression_or_lcm');
  }
  return [...triggers];
}

function looksLikeCorrection(text: string): boolean {
  return [
    /\bremember\b/i,
    /\bnext time\b/i,
    /\bi told you\b/i,
    /\byou should\b/i,
    /\bdo not\b/i,
    /\bdon't\b/i,
    /запомни/i,
    /в следующий раз/i,
    /я говорил/i,
    /я сказала/i,
    /не делай/i,
    /делай так/i,
    /исправь/i,
    /ты должен/i,
    /ты должна/i,
  ].some((pattern) => pattern.test(text));
}

function createJob(input: LearningReviewJobInput, now: number): LearningReviewJob {
  return {
    id: randomUUID(),
    agentId: input.agentId,
    sessionKey: input.sessionKey,
    runId: input.runId,
    traceId: input.traceId,
    sdkSessionId: input.sdkSessionId,
    triggers: uniqueTriggers([input.trigger, ...(input.triggers ?? [])]),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    coalescedCount: 0,
    metadata: { ...(input.metadata ?? {}) },
  };
}

function mergeJob(job: LearningReviewJob, input: LearningReviewJobInput, now: number): void {
  job.triggers = uniqueTriggers([...job.triggers, input.trigger, ...(input.triggers ?? [])]);
  job.runId = input.runId ?? job.runId;
  job.traceId = input.traceId ?? job.traceId;
  job.sdkSessionId = input.sdkSessionId ?? job.sdkSessionId;
  job.updatedAt = now;
  job.coalescedCount += 1;
  job.metadata = {
    ...job.metadata,
    ...(input.metadata ?? {}),
  };
}

function uniqueTriggers(triggers: LearningTriggerType[]): LearningTriggerType[] {
  return [...new Set(triggers)];
}

function cloneJob(job: LearningReviewJob): LearningReviewJob {
  return {
    ...job,
    triggers: [...job.triggers],
    metadata: { ...job.metadata },
  };
}

function jobKey(agentId: string, sessionKey: string): string {
  return `${agentId}\0${sessionKey}`;
}
