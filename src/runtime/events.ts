import type { RuntimeId } from './types.js';

export type RuntimeEventType =
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'text.delta'
  | 'message.completed'
  | 'tool.call.started'
  | 'tool.call.delta'
  | 'tool.call.completed'
  | 'tool.call.failed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'elicitation.requested'
  | 'subagent.started'
  | 'subagent.completed'
  | 'subagent.failed'
  | 'checkpoint.created'
  | 'usage.updated'
  | 'notification'
  | 'raw';

export interface RuntimeEventBase<TType extends RuntimeEventType = RuntimeEventType> {
  type: TType;
  runtime: RuntimeId;
  runId: string;
  sessionId?: string;
  agentId?: string;
  timestamp: number;
  raw?: unknown;
}

export interface RuntimeTextDeltaEvent extends RuntimeEventBase<'text.delta'> {
  text: string;
  source?: 'partial' | 'message' | 'result';
}

export interface RuntimeToolEvent extends RuntimeEventBase<
  | 'tool.call.started'
  | 'tool.call.delta'
  | 'tool.call.completed'
  | 'tool.call.failed'
> {
  toolCallId: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface RuntimeApprovalRequestedEvent extends RuntimeEventBase<'approval.requested'> {
  requestId: string;
  toolName?: string;
  input?: unknown;
  reason?: string;
}

export interface RuntimeUsageUpdatedEvent extends RuntimeEventBase<'usage.updated'> {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  durationMs?: number;
  durationApiMs?: number;
  numTurns?: number;
}

export interface RuntimeRawEvent extends RuntimeEventBase<'raw'> {
  event: unknown;
}

export type RuntimeEvent =
  | RuntimeEventBase<Exclude<
      RuntimeEventType,
      | 'text.delta'
      | 'tool.call.started'
      | 'tool.call.delta'
      | 'tool.call.completed'
      | 'tool.call.failed'
      | 'approval.requested'
      | 'usage.updated'
      | 'raw'
    >>
  | RuntimeTextDeltaEvent
  | RuntimeToolEvent
  | RuntimeApprovalRequestedEvent
  | RuntimeUsageUpdatedEvent
  | RuntimeRawEvent;
