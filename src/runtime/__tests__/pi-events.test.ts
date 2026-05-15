import { describe, expect, it } from 'vitest';
import { normalizePiRuntimeEvents } from '../pi-events.js';

const context = {
  runId: 'run-1',
  sessionId: 'session-1',
  agentId: 'agent-1',
  timestamp: 123,
};

describe('normalizePiRuntimeEvents', () => {
  it('maps Pi agent lifecycle events into runtime run events', () => {
    expect(normalizePiRuntimeEvents({ type: 'agent_start' }, context)).toEqual([{
      type: 'run.started',
      runtime: 'pi',
      runId: 'run-1',
      sessionId: 'session-1',
      agentId: 'agent-1',
      timestamp: 123,
      raw: { type: 'agent_start' },
    }]);

    expect(normalizePiRuntimeEvents({ type: 'agent_end', messages: [] }, context)[0])
      .toMatchObject({
        type: 'run.completed',
        runtime: 'pi',
        runId: 'run-1',
      });

    expect(normalizePiRuntimeEvents({
      type: 'agent_end',
      messages: [{ role: 'assistant', stopReason: 'error' }],
    }, context)[0]).toMatchObject({
      type: 'run.failed',
      runtime: 'pi',
      runId: 'run-1',
    });
  });

  it('maps Pi assistant text deltas into text.delta events', () => {
    expect(normalizePiRuntimeEvents({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'hello ',
      },
      message: { role: 'assistant' },
    }, context)).toEqual([{
      type: 'text.delta',
      runtime: 'pi',
      runId: 'run-1',
      sessionId: 'session-1',
      agentId: 'agent-1',
      timestamp: 123,
      raw: expect.objectContaining({ type: 'message_update' }),
      text: 'hello ',
      source: 'partial',
    }]);
  });

  it('maps assistant message completion and Pi usage into runtime events', () => {
    expect(normalizePiRuntimeEvents({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        stopReason: 'stop',
        usage: {
          input: 10,
          output: 3,
          cacheRead: 2,
          cacheWrite: 1,
          totalTokens: 16,
          cost: { total: 0.001 },
        },
      },
    }, context)).toEqual([
      {
        type: 'message.completed',
        runtime: 'pi',
        runId: 'run-1',
        sessionId: 'session-1',
        agentId: 'agent-1',
        timestamp: 123,
        raw: expect.objectContaining({ type: 'message_end' }),
      },
      {
        type: 'usage.updated',
        runtime: 'pi',
        runId: 'run-1',
        sessionId: 'session-1',
        agentId: 'agent-1',
        timestamp: 123,
        raw: expect.objectContaining({ type: 'message_end' }),
        inputTokens: 10,
        outputTokens: 3,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        costUsd: 0.001,
      },
    ]);
  });

  it('keeps assistant error message completion separate from final run status', () => {
    expect(normalizePiRuntimeEvents({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'model unavailable',
      },
    }, context).map((event) => event.type)).toEqual([
      'message.completed',
    ]);
  });

  it('maps Pi tool lifecycle events into runtime tool events', () => {
    expect(normalizePiRuntimeEvents({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'bash',
      args: { command: 'pwd' },
    }, context)[0]).toMatchObject({
      type: 'tool.call.started',
      toolCallId: 'tool-1',
      toolName: 'bash',
      input: { command: 'pwd' },
    });

    expect(normalizePiRuntimeEvents({
      type: 'tool_execution_update',
      toolCallId: 'tool-1',
      toolName: 'bash',
      partialResult: { content: [{ type: 'text', text: 'running' }] },
    }, context)[0]).toMatchObject({
      type: 'tool.call.delta',
      output: { content: [{ type: 'text', text: 'running' }] },
    });

    expect(normalizePiRuntimeEvents({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'bash',
      result: { content: [{ type: 'text', text: 'ok' }] },
      isError: false,
    }, context)[0]).toMatchObject({
      type: 'tool.call.completed',
      output: { content: [{ type: 'text', text: 'ok' }] },
    });
  });

  it('maps Pi failed tool execution into tool.call.failed with model-visible text', () => {
    expect(normalizePiRuntimeEvents({
      type: 'tool_execution_end',
      toolCallId: 'tool-2',
      toolName: 'read',
      result: {
        content: [{ type: 'text', text: 'Read denied by policy.' }],
      },
      isError: true,
    }, context)[0]).toMatchObject({
      type: 'tool.call.failed',
      toolCallId: 'tool-2',
      toolName: 'read',
      error: 'Read denied by policy.',
    });
  });

  it('keeps unsupported Pi events observable as raw runtime events', () => {
    expect(normalizePiRuntimeEvents({
      type: 'queue_update',
      steering: [],
      followUp: [],
    }, context)).toEqual([{
      type: 'raw',
      runtime: 'pi',
      runId: 'run-1',
      sessionId: 'session-1',
      agentId: 'agent-1',
      timestamp: 123,
      raw: expect.objectContaining({ type: 'queue_update' }),
      event: expect.objectContaining({ type: 'queue_update' }),
    }]);
  });
});
