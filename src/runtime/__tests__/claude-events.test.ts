import { describe, expect, it } from 'vitest';
import { normalizeClaudeRuntimeEvents } from '../claude-events.js';

const context = {
  runId: 'run-1',
  sessionId: 'session-1',
  agentId: 'agent-1',
  timestamp: 123,
};

describe('normalizeClaudeRuntimeEvents', () => {
  it('maps Claude stream text deltas into runtime text deltas', () => {
    expect(normalizeClaudeRuntimeEvents({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'hello' },
      },
    }, context)).toEqual([{
      type: 'text.delta',
      runtime: 'claude-agent-sdk',
      runId: 'run-1',
      sessionId: 'session-1',
      agentId: 'agent-1',
      timestamp: 123,
      raw: expect.objectContaining({ type: 'stream_event' }),
      text: 'hello',
      source: 'partial',
    }]);
  });

  it('maps assistant messages to message text, completion, and usage events', () => {
    expect(normalizeClaudeRuntimeEvents({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'done' }],
        usage: {
          input_tokens: 10,
          output_tokens: 3,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 1,
        },
      },
    }, context)).toEqual([
      {
        type: 'text.delta',
        runtime: 'claude-agent-sdk',
        runId: 'run-1',
        sessionId: 'session-1',
        agentId: 'agent-1',
        timestamp: 123,
        raw: expect.objectContaining({ type: 'assistant' }),
        text: 'done',
        source: 'message',
      },
      {
        type: 'message.completed',
        runtime: 'claude-agent-sdk',
        runId: 'run-1',
        sessionId: 'session-1',
        agentId: 'agent-1',
        timestamp: 123,
        raw: expect.objectContaining({ type: 'assistant' }),
      },
      {
        type: 'usage.updated',
        runtime: 'claude-agent-sdk',
        runId: 'run-1',
        sessionId: 'session-1',
        agentId: 'agent-1',
        timestamp: 123,
        raw: expect.objectContaining({ type: 'assistant' }),
        inputTokens: 10,
        outputTokens: 3,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
      },
    ]);
  });

  it('maps result events into result text, usage, and run completion', () => {
    expect(normalizeClaudeRuntimeEvents({
      type: 'result',
      result: 'final',
      session_id: 'sdk-session-1',
      usage: {
        input_tokens: 10,
        output_tokens: 3,
        cache_read_input_tokens: 2,
      },
      total_cost_usd: 0.001,
    }, context)).toEqual([
      expect.objectContaining({
        type: 'text.delta',
        sessionId: 'sdk-session-1',
        text: 'final',
        source: 'result',
      }),
      expect.objectContaining({
        type: 'usage.updated',
        inputTokens: 10,
        outputTokens: 3,
        cacheReadTokens: 2,
        costUsd: 0.001,
      }),
      expect.objectContaining({
        type: 'run.completed',
        sessionId: 'sdk-session-1',
      }),
    ]);
  });

  it('maps Claude tool lifecycle events into runtime tool events', () => {
    expect(normalizeClaudeRuntimeEvents({
      type: 'tool_use',
      id: 'tool-1',
      name: 'Bash',
      input: { command: 'pwd' },
    }, context)[0]).toMatchObject({
      type: 'tool.call.started',
      toolCallId: 'tool-1',
      toolName: 'Bash',
      input: { command: 'pwd' },
    });

    expect(normalizeClaudeRuntimeEvents({
      type: 'tool_result',
      tool_use_id: 'tool-1',
      name: 'Bash',
      output: 'ok',
    }, context)[0]).toMatchObject({
      type: 'tool.call.completed',
      toolCallId: 'tool-1',
      toolName: 'Bash',
      output: 'ok',
    });
  });

  it('maps Claude error result and failed tool result', () => {
    expect(normalizeClaudeRuntimeEvents({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
    }, context)[0]).toMatchObject({
      type: 'run.failed',
    });

    expect(normalizeClaudeRuntimeEvents({
      type: 'tool_result',
      name: 'Read',
      output: 'denied',
      is_error: true,
    }, context)[0]).toMatchObject({
      type: 'tool.call.failed',
      toolName: 'Read',
      error: 'denied',
    });
  });
});
