import type {
  RuntimeEvent,
  RuntimeEventBase,
  RuntimeToolEvent,
  RuntimeUsageUpdatedEvent,
} from './events.js';

export interface ClaudeRuntimeEventContext {
  runId: string;
  sessionId?: string;
  agentId?: string;
  timestamp?: number;
  durationMs?: number;
}

export function normalizeClaudeRuntimeEvents(
  event: unknown,
  context: ClaudeRuntimeEventContext,
): RuntimeEvent[] {
  if (!isRecord(event)) {
    return [{ ...commonEventFields(context, event), type: 'raw', event }];
  }

  const common = commonEventFields(context, event);

  const partialText = extractClaudeStreamTextDelta(event);
  if (partialText) {
    return [{ ...common, type: 'text.delta', text: partialText, source: 'partial' }];
  }

  if (event.type === 'assistant') {
    const message = isRecord(event.message) ? event.message : undefined;
    const normalized: RuntimeEvent[] = [
      ...extractClaudeAssistantText(message).map((text): RuntimeEvent => ({
        ...common,
        type: 'text.delta',
        text,
        source: 'message',
      })),
      { ...common, type: 'message.completed' },
    ];
    const usage = normalizeClaudeUsage(message?.usage ?? event.usage, event, context);
    if (usage) {
      normalized.push({
        ...common,
        type: 'usage.updated',
        ...usage,
      });
    }
    return normalized;
  }

  if (event.type === 'result') {
    const normalized: RuntimeEvent[] = [];
    if (typeof event.result === 'string' && event.result.length > 0) {
      normalized.push({
        ...common,
        type: 'text.delta',
        text: event.result,
        source: 'result',
      });
    }
    const usage = normalizeClaudeUsage(event.usage, event, context);
    if (usage) {
      normalized.push({
        ...common,
        type: 'usage.updated',
        ...usage,
      });
    }
    normalized.push({
      ...common,
      type: isClaudeErrorResult(event) ? 'run.failed' : 'run.completed',
    });
    return normalized;
  }

  if (event.type === 'tool_use') {
    return [toolEvent('tool.call.started', common, event, {
      input: event.input,
    })];
  }

  if (event.type === 'tool_result') {
    const failed = event.is_error === true || event.status === 'error';
    return [toolEvent(failed ? 'tool.call.failed' : 'tool.call.completed', common, event, {
      output: event.output,
      error: failed ? extractClaudeToolError(event.output) : undefined,
    })];
  }

  return [{ ...common, type: 'raw', event }];
}

function commonEventFields(
  context: ClaudeRuntimeEventContext,
  raw: unknown,
): RuntimeEventBase {
  const rawSessionId = isRecord(raw) && typeof raw.session_id === 'string'
    ? raw.session_id
    : undefined;
  return {
    type: 'raw',
    runtime: 'claude-agent-sdk',
    runId: context.runId,
    sessionId: rawSessionId ?? context.sessionId,
    agentId: context.agentId,
    timestamp: context.timestamp ?? Date.now(),
    raw,
  };
}

function toolEvent(
  type: RuntimeToolEvent['type'],
  common: RuntimeEventBase,
  event: Record<string, unknown>,
  fields: Pick<RuntimeToolEvent, 'input' | 'output' | 'error'>,
): RuntimeToolEvent {
  return {
    ...common,
    type,
    toolCallId: readString(event.id) ?? readString(event.tool_use_id) ?? readString(event.tool_call_id) ?? '',
    toolName: readString(event.name) ?? 'unknown',
    ...defined(fields),
  };
}

function extractClaudeStreamTextDelta(event: Record<string, unknown>): string | undefined {
  if (event.type !== 'stream_event') return undefined;
  const raw = isRecord(event.event) ? event.event : undefined;
  if (raw?.type !== 'content_block_delta') return undefined;
  const delta = isRecord(raw.delta) ? raw.delta : undefined;
  if (delta?.type !== 'text_delta' || typeof delta.text !== 'string') return undefined;
  return delta.text;
}

function extractClaudeAssistantText(message: Record<string, unknown> | undefined): string[] {
  if (!Array.isArray(message?.content)) return [];
  return message.content
    .filter((block): block is { type: string; text: string } =>
      isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text);
}

function normalizeClaudeUsage(
  usage: unknown,
  result?: Record<string, unknown>,
  context?: ClaudeRuntimeEventContext,
): Omit<RuntimeUsageUpdatedEvent, keyof RuntimeEventBase> | undefined {
  const resultRecord = isRecord(result) ? result : {};
  const hasBillingFields = readNumber(resultRecord.total_cost_usd) !== undefined
    || readNumber(resultRecord.duration_api_ms) !== undefined
    || readNumber(resultRecord.num_turns) !== undefined;
  if (!isRecord(usage) && !hasBillingFields) return undefined;
  const usageRecord = isRecord(usage) ? usage : {};
  const normalized = defined({
    inputTokens: readNumber(usageRecord.input_tokens),
    outputTokens: readNumber(usageRecord.output_tokens),
    cacheReadTokens: readNumber(usageRecord.cache_read_input_tokens),
    cacheWriteTokens: readNumber(usageRecord.cache_creation_input_tokens),
    costUsd: readNumber(resultRecord.total_cost_usd),
    durationMs: context?.durationMs,
    durationApiMs: readNumber(resultRecord.duration_api_ms),
    numTurns: readNumber(resultRecord.num_turns),
  });
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isClaudeErrorResult(event: Record<string, unknown>): boolean {
  const subtype = readString(event.subtype) ?? 'unknown';
  return event.is_error === true && subtype !== 'success';
}

function extractClaudeToolError(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  if (!isRecord(output)) return undefined;
  if (typeof output.error === 'string') return output.error;
  if (typeof output.message === 'string') return output.message;
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
