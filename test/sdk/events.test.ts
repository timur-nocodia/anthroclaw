import { describe, expect, it } from 'vitest';
import {
  extractHookLifecycleEvent,
  extractPartialText,
  extractPromptSuggestion,
  extractTaskLifecycleEvent,
  extractTaskNotification,
  extractTaskProgress,
} from '../../src/sdk/events.js';

describe('SDK event extractors', () => {
  it('extracts partial text deltas from SDK stream events', () => {
    const result = extractPartialText({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: {
          type: 'text_delta',
          text: 'hello',
        },
      },
    });

    expect(result).toBe('hello');
  });

  it('ignores non-text partial stream events', () => {
    expect(extractPartialText({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: { type: 'text', text: '' },
      },
    })).toBeNull();
  });

  it('extracts prompt suggestions', () => {
    expect(extractPromptSuggestion({
      type: 'prompt_suggestion',
      suggestion: 'What changed since yesterday?',
    })).toBe('What changed since yesterday?');
  });

  it('extracts task progress summaries', () => {
    const result = extractTaskProgress({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'task-1',
      description: 'Searching docs',
      summary: 'Found two candidates',
      last_tool_name: 'Grep',
      usage: {
        total_tokens: 1234,
        tool_uses: 3,
        duration_ms: 456,
      },
    });

    expect(result).toEqual({
      taskId: 'task-1',
      description: 'Searching docs',
      summary: 'Found two candidates',
      lastToolName: 'Grep',
      totalTokens: 1234,
      toolUses: 3,
      durationMs: 456,
    });
  });

  it('extracts terminal task notifications', () => {
    const result = extractTaskNotification({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task-1',
      status: 'completed',
      output_file: '/tmp/task.out',
      summary: 'Finished indexing docs',
      skip_transcript: true,
      usage: {
        total_tokens: 200,
        tool_uses: 4,
        duration_ms: 500,
      },
    });

    expect(result).toEqual({
      taskId: 'task-1',
      status: 'completed',
      summary: 'Finished indexing docs',
      outputFile: '/tmp/task.out',
      toolUseId: undefined,
      totalTokens: 200,
      toolUses: 4,
      durationMs: 500,
      skipTranscript: true,
    });
  });

  it('normalizes task lifecycle events', () => {
    expect(extractTaskLifecycleEvent({
      type: 'system',
      subtype: 'task_started',
      task_id: 'task-1',
      description: 'Indexing docs',
      task_type: 'background',
    })).toMatchObject({
      taskId: 'task-1',
      status: 'started',
      description: 'Indexing docs',
      taskType: 'background',
    });

    expect(extractTaskLifecycleEvent({
      type: 'system',
      subtype: 'task_updated',
      task_id: 'task-1',
      patch: {
        status: 'failed',
        error: 'boom',
      },
    })).toMatchObject({
      taskId: 'task-1',
      status: 'failed',
      error: 'boom',
    });
  });

  it('extracts hook lifecycle events', () => {
    const result = extractHookLifecycleEvent({
      type: 'system',
      subtype: 'hook_response',
      hook_id: 'hook-1',
      hook_name: 'audit',
      hook_event: 'PostToolUse',
      stdout: 'ok',
      stderr: '',
      outcome: 'success',
    });

    expect(result).toEqual({
      subtype: 'hook_response',
      hookId: 'hook-1',
      hookName: 'audit',
      hookEvent: 'PostToolUse',
      output: undefined,
      stdout: 'ok',
      stderr: '',
      outcome: 'success',
    });
  });
});
