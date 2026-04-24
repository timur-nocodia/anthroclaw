export interface SdkTaskProgress {
  taskId: string;
  description: string;
  summary?: string;
  lastToolName?: string;
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
}

export interface SdkHookLifecycleEvent {
  subtype: 'hook_started' | 'hook_progress' | 'hook_response';
  hookId: string;
  hookName: string;
  hookEvent: string;
  output?: string;
  stdout?: string;
  stderr?: string;
  outcome?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function extractPartialText(event: Record<string, unknown>): string | null {
  if (event.type !== 'stream_event') return null;

  const raw = asRecord(event.event);
  if (raw.type !== 'content_block_delta') return null;

  const delta = asRecord(raw.delta);
  if (delta.type !== 'text_delta' || typeof delta.text !== 'string') return null;

  return delta.text;
}

export function extractPromptSuggestion(event: Record<string, unknown>): string | null {
  if (event.type !== 'prompt_suggestion') return null;
  return typeof event.suggestion === 'string' ? event.suggestion : null;
}

export function extractTaskProgress(event: Record<string, unknown>): SdkTaskProgress | null {
  if (event.type !== 'system' || event.subtype !== 'task_progress') return null;

  const usage = asRecord(event.usage);
  return {
    taskId: typeof event.task_id === 'string' ? event.task_id : '',
    description: typeof event.description === 'string' ? event.description : '',
    summary: typeof event.summary === 'string' ? event.summary : undefined,
    lastToolName: typeof event.last_tool_name === 'string' ? event.last_tool_name : undefined,
    totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
    toolUses: typeof usage.tool_uses === 'number' ? usage.tool_uses : undefined,
    durationMs: typeof usage.duration_ms === 'number' ? usage.duration_ms : undefined,
  };
}

export function extractHookLifecycleEvent(event: Record<string, unknown>): SdkHookLifecycleEvent | null {
  if (event.type !== 'system') return null;
  if (
    event.subtype !== 'hook_started'
    && event.subtype !== 'hook_progress'
    && event.subtype !== 'hook_response'
  ) {
    return null;
  }

  return {
    subtype: event.subtype,
    hookId: typeof event.hook_id === 'string' ? event.hook_id : '',
    hookName: typeof event.hook_name === 'string' ? event.hook_name : '',
    hookEvent: typeof event.hook_event === 'string' ? event.hook_event : '',
    output: typeof event.output === 'string' ? event.output : undefined,
    stdout: typeof event.stdout === 'string' ? event.stdout : undefined,
    stderr: typeof event.stderr === 'string' ? event.stderr : undefined,
    outcome: typeof event.outcome === 'string' ? event.outcome : undefined,
  };
}
