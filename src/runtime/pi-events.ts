import type {
  RuntimeEvent,
  RuntimeEventBase,
  RuntimeToolEvent,
  RuntimeUsageUpdatedEvent,
} from './events.js';

export interface PiRuntimeEventContext {
  runId: string;
  sessionId?: string;
  agentId?: string;
  timestamp?: number;
}

export function normalizePiRuntimeEvents(
  event: unknown,
  context: PiRuntimeEventContext,
): RuntimeEvent[] {
  if (!isRecord(event)) {
    return [{ ...commonEventFields(context, event), type: 'raw', event }];
  }

  const common = commonEventFields(context, event);
  const eventType = typeof event.type === 'string' ? event.type : undefined;

  if (eventType === 'agent_start') {
    return [{ ...common, type: 'run.started' }];
  }

  if (eventType === 'agent_end') {
    return [{
      ...common,
      type: piAgentEndHasError(event) ? 'run.failed' : 'run.completed',
    }];
  }

  if (eventType === 'message_update') {
    const text = extractPiAssistantTextDelta(event.assistantMessageEvent);
    return text
      ? [{ ...common, type: 'text.delta', text, source: 'partial' }]
      : [{ ...common, type: 'raw', event }];
  }

  if (eventType === 'message_end') {
    const message = isRecord(event.message) ? event.message : undefined;
    if (message?.role !== 'assistant') return [];

    const normalized: RuntimeEvent[] = [
      ...extractPiAssistantMessageText(message).map((text): RuntimeEvent => ({
        ...common,
        type: 'text.delta',
        text,
        source: 'message',
      })),
      { ...common, type: 'message.completed' },
    ];
    const usage = normalizePiUsage(message.usage);
    if (usage) {
      normalized.push({
        ...common,
        type: 'usage.updated',
        ...usage,
      });
    }
    return normalized;
  }

  if (eventType === 'tool_execution_start') {
    return [toolEvent('tool.call.started', common, event, {
      input: event.args,
    })];
  }

  if (eventType === 'tool_execution_update') {
    return [toolEvent('tool.call.delta', common, event, {
      input: event.args,
      output: event.partialResult,
    })];
  }

  if (eventType === 'tool_execution_end') {
    return [toolEvent(event.isError === true ? 'tool.call.failed' : 'tool.call.completed', common, event, {
      output: event.result,
      error: event.isError === true ? extractPiToolError(event.result) : undefined,
    })];
  }

  return [{ ...common, type: 'raw', event }];
}

function commonEventFields(
  context: PiRuntimeEventContext,
  raw: unknown,
): RuntimeEventBase {
  return {
    type: 'raw',
    runtime: 'pi',
    runId: context.runId,
    sessionId: context.sessionId,
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
    toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : '',
    toolName: typeof event.toolName === 'string' ? event.toolName : 'unknown',
    ...defined(fields),
  };
}

function extractPiAssistantTextDelta(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  if (event.type === 'text_delta' && typeof event.delta === 'string') {
    return event.delta;
  }
  if (event.type === 'text_end' && typeof event.content === 'string') {
    return event.content;
  }
  return undefined;
}

function extractPiAssistantMessageText(message: Record<string, unknown>): string[] {
  if (!Array.isArray(message.content)) return [];
  return message.content
    .filter((part): part is { type: string; text: string } =>
      isRecord(part) && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text);
}

function piAgentEndHasError(event: Record<string, unknown>): boolean {
  if (!Array.isArray(event.messages)) return false;
  const lastAssistant = [...event.messages]
    .reverse()
    .find((message) => isRecord(message) && message.role === 'assistant');
  if (!isRecord(lastAssistant)) return false;
  return lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted';
}

function normalizePiUsage(usage: unknown): Omit<RuntimeUsageUpdatedEvent, keyof RuntimeEventBase> | undefined {
  if (!isRecord(usage)) return undefined;
  const normalized = defined({
    inputTokens: typeof usage.input === 'number' ? usage.input : undefined,
    outputTokens: typeof usage.output === 'number' ? usage.output : undefined,
    cacheReadTokens: typeof usage.cacheRead === 'number' ? usage.cacheRead : undefined,
    cacheWriteTokens: typeof usage.cacheWrite === 'number' ? usage.cacheWrite : undefined,
    costUsd: readPiUsageCost(usage.cost),
  });
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function readPiUsageCost(cost: unknown): number | undefined {
  return isRecord(cost) && typeof cost.total === 'number' ? cost.total : undefined;
}

function extractPiToolError(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  if (typeof result.error === 'string') return result.error;
  if (Array.isArray(result.content)) {
    const text = result.content
      .filter((part): part is { type: string; text: string } =>
        isRecord(part) && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();
    return text || undefined;
  }
  return undefined;
}

function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
