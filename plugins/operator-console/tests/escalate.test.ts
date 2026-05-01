import { describe, it, expect, vi } from 'vitest';
import { createEscalateTool, type NotificationsEmitterLike } from '../src/tools/escalate.js';

const ctx = (agentId = 'klavdia') => ({ agentId });

function parsed(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function makeEmitter(): { emitter: NotificationsEmitterLike; calls: Array<{ event: string; payload: Record<string, unknown> }> } {
  const calls: Array<{ event: string; payload: Record<string, unknown> }> = [];
  return {
    calls,
    emitter: {
      emit: vi.fn(async (event, payload) => {
        calls.push({ event, payload: payload as Record<string, unknown> });
      }) as NotificationsEmitterLike['emit'],
    },
  };
}

describe('operator_console.escalate', () => {
  it('emits escalation_needed for the calling agent with default priority=medium', async () => {
    const { emitter, calls } = makeEmitter();
    const tool = createEscalateTool({ notificationsEmitter: emitter, enabled: true });
    const r = await tool.handler({ message: 'I need help' }, ctx('klavdia'));
    const body = parsed(r);
    expect(body.ok).toBe(true);
    expect(body.priority).toBe('medium');
    expect(body.agentId).toBe('klavdia');
    expect(calls).toHaveLength(1);
    expect(calls[0].event).toBe('escalation_needed');
    expect(calls[0].payload.agentId).toBe('klavdia');
    expect(calls[0].payload.message).toBe('I need help');
    expect(calls[0].payload.priority).toBe('medium');
  });

  it('respects an explicit priority', async () => {
    const { emitter, calls } = makeEmitter();
    const tool = createEscalateTool({ notificationsEmitter: emitter, enabled: true });
    await tool.handler({ message: 'urgent', priority: 'high' }, ctx());
    expect(calls[0].payload.priority).toBe('high');
  });

  it('returns an error when emitter is not bound', async () => {
    const tool = createEscalateTool({ notificationsEmitter: null, enabled: true });
    const r = await tool.handler({ message: 'x' }, ctx());
    expect(parsed(r).error).toMatch(/notifications emitter unavailable/i);
  });

  it('refuses when plugin is disabled', async () => {
    const { emitter } = makeEmitter();
    const tool = createEscalateTool({ notificationsEmitter: emitter, enabled: false });
    const r = await tool.handler({ message: 'x' }, ctx());
    expect(parsed(r).error).toMatch(/disabled/i);
  });

  it('rejects invalid input (empty message)', async () => {
    const { emitter } = makeEmitter();
    const tool = createEscalateTool({ notificationsEmitter: emitter, enabled: true });
    const r = await tool.handler({ message: '' }, ctx());
    expect(parsed(r).error).toBeTruthy();
  });
});
