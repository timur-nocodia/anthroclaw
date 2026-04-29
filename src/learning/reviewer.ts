import { z } from 'zod';
import { logger } from '../logger.js';
import { metrics } from '../metrics/collector.js';
import { redactSecrets } from '../security/redact.js';
import { scanForInjection } from '../security/injection-scanner.js';
import type {
  LearningActionRecord,
  LearningActionType,
} from './types.js';
import { LearningStore } from './store.js';

const DEFAULT_MAX_ACTIONS = 8;
const DEFAULT_MAX_PAYLOAD_CHARS = 16_000;
const DEFAULT_MAX_RAW_JSON_CHARS = 128_000;

const LearningActionTypeSchema = z.enum([
  'memory_candidate',
  'skill_patch',
  'skill_create',
  'skill_update_full',
  'none',
]);

const ReviewerActionSchema = z.object({
  type: LearningActionTypeSchema,
  confidence: z.number().min(0).max(1).optional(),
  title: z.string().max(240).optional(),
  rationale: z.string().max(4_000).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
}).strict();

const ReviewerOutputSchema = z.object({
  actions: z.array(ReviewerActionSchema),
}).strict();

export interface LearningReviewerProtocolOptions {
  maxActions?: number;
  maxPayloadChars?: number;
  maxRawJsonChars?: number;
}

export interface NormalizedLearningAction {
  actionType: LearningActionType;
  confidence?: number;
  title: string;
  rationale: string;
  payload: Record<string, unknown>;
}

export interface ParsedLearningReviewOutput {
  rawJson: string;
  actions: NormalizedLearningAction[];
}

export class LearningReviewerProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LearningReviewerProtocolError';
  }
}

export function parseLearningReviewOutput(
  rawOutput: string,
  opts: LearningReviewerProtocolOptions = {},
): ParsedLearningReviewOutput {
  const maxRawJsonChars = opts.maxRawJsonChars ?? DEFAULT_MAX_RAW_JSON_CHARS;
  const rawJson = extractJson(rawOutput).trim();
  if (rawJson.length > maxRawJsonChars) {
    throw new LearningReviewerProtocolError(`reviewer output exceeds ${maxRawJsonChars} characters`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new LearningReviewerProtocolError(`reviewer output is not valid JSON: ${String(err)}`);
  }

  const result = ReviewerOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new LearningReviewerProtocolError(`reviewer output schema violation: ${result.error.issues.map((issue) => issue.message).join('; ')}`);
  }

  const maxActions = opts.maxActions ?? DEFAULT_MAX_ACTIONS;
  if (result.data.actions.length > maxActions) {
    throw new LearningReviewerProtocolError(`reviewer output has too many actions: ${result.data.actions.length} > ${maxActions}`);
  }

  const actions = result.data.actions.map((action): NormalizedLearningAction => {
    const payload = action.payload ?? {};
    validateSafeActionContent(action, payload, opts);
    return {
      actionType: action.type,
      confidence: action.confidence,
      title: action.title ?? defaultTitle(action.type),
      rationale: action.rationale ?? '',
      payload,
    };
  });

  return { rawJson, actions };
}

export function persistLearningReviewResult(params: {
  store: LearningStore;
  reviewId: string;
  agentId: string;
  result: ParsedLearningReviewOutput;
  completedAt?: number;
}): LearningActionRecord[] {
  metrics.increment('learning_actions_proposed', params.result.actions.length);
  params.store.completeReview(params.reviewId, {
    completedAt: params.completedAt,
    output: {
      rawJson: params.result.rawJson,
      actionCount: params.result.actions.length,
    },
  });

  const actions = params.result.actions.map((action) => params.store.addAction({
    reviewId: params.reviewId,
    agentId: params.agentId,
    actionType: action.actionType,
    confidence: action.confidence,
    title: action.title,
    rationale: action.rationale,
    payload: action.payload,
    createdAt: params.completedAt,
  }));
  logger.info({
    reviewId: params.reviewId,
    agentId: params.agentId,
    actionIds: actions.map((action) => action.id),
    actionTypes: actions.map((action) => action.actionType),
  }, 'Learning actions proposed');
  return actions;
}

function validateSafeActionContent(
  action: z.infer<typeof ReviewerActionSchema>,
  payload: Record<string, unknown>,
  opts: LearningReviewerProtocolOptions,
): void {
  const maxPayloadChars = opts.maxPayloadChars ?? DEFAULT_MAX_PAYLOAD_CHARS;
  const payloadJson = JSON.stringify(payload);
  if (payloadJson.length > maxPayloadChars) {
    throw new LearningReviewerProtocolError(`reviewer action payload exceeds ${maxPayloadChars} characters`);
  }

  const combined = [
    action.title ?? '',
    action.rationale ?? '',
    payloadJson,
  ].join('\n');
  if (redactSecrets(combined) !== combined) {
    throw new LearningReviewerProtocolError('reviewer action contains a secret-like value');
  }

  const scan = scanForInjection(combined, 'learning_reviewer_output');
  if (!scan.safe) {
    throw new LearningReviewerProtocolError(`reviewer action contains prompt-injection markers: ${scan.threats.join('; ')}`);
  }
}

function extractJson(rawOutput: string): string {
  const trimmed = rawOutput.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

function defaultTitle(type: LearningActionType): string {
  switch (type) {
    case 'memory_candidate':
      return 'Memory candidate';
    case 'skill_patch':
      return 'Skill patch';
    case 'skill_create':
      return 'Skill create';
    case 'skill_update_full':
      return 'Skill update';
    case 'none':
      return 'No learning action';
  }
}
