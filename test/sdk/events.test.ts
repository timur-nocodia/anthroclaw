import { describe, expect, it } from 'vitest';
import {
  extractHookLifecycleEvent,
  extractPartialText,
  extractPromptSuggestion,
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
