import { describe, expect, it, vi } from 'vitest';
import {
  createPiHeadlessRuntime,
  normalizePiToolNames,
  parsePiModelRef,
  PiHeadlessRuntime,
  resolvePiModelFromRegistry,
  type PiAgentSessionLike,
  type PiCreateAgentSession,
} from '../pi-headless.js';

function createSession(events: unknown[], promptImpl?: () => Promise<void>): PiAgentSessionLike {
  let listener: ((event: unknown) => void) | undefined;
  return {
    prompt: vi.fn(async () => {
      for (const event of events) listener?.(event);
      await promptImpl?.();
    }),
    subscribe: vi.fn((next) => {
      listener = next;
      return vi.fn(() => {
        listener = undefined;
      });
    }),
    abort: vi.fn(async () => undefined),
    dispose: vi.fn(),
  };
}

describe('PiHeadlessRuntime', () => {
  it('collects Pi text deltas from an injected session factory', async () => {
    const session = createSession([
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hello ' } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'pi' } },
    ]);
    const createAgentSession = vi.fn(async () => ({ session })) satisfies PiCreateAgentSession;
    const runtime = new PiHeadlessRuntime({
      createAgentSession,
      createOptions: { agentDir: '/tmp/pi-agent' },
    });

    await expect(runtime.runText({
      prompt: 'say hello',
      cwd: '/workspace',
      model: 'openai/gpt-5-mini',
    })).resolves.toBe('hello pi');

    expect(createAgentSession).toHaveBeenCalledWith({
      agentDir: '/tmp/pi-agent',
      cwd: '/workspace',
      noTools: 'all',
      tools: [],
    });
    expect(session.prompt).toHaveBeenCalledWith('say hello');
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it('can resolve a Pi model object only when a resolver is configured', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'done' },
    ]);
    const createAgentSession = vi.fn(async () => ({ session })) satisfies PiCreateAgentSession;
    const model = { provider: 'openai', id: 'gpt-5-mini' };
    const runtime = new PiHeadlessRuntime({
      createAgentSession,
      resolveModel: vi.fn(async () => model),
    });

    await expect(runtime.runText({
      prompt: 'p',
      model: 'openai/gpt-5-mini',
    })).resolves.toBe('done');

    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ model }));
  });

  it('can resolve model ids through a Pi ModelRegistry-like object', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'done' },
    ]);
    const createAgentSession = vi.fn(async () => ({ session })) satisfies PiCreateAgentSession;
    const model = { provider: 'anthropic', id: 'claude-sonnet-4-5' };
    const modelRegistry = {
      find: vi.fn((provider: string, modelId: string) =>
        provider === 'anthropic' && modelId === 'claude-sonnet-4-5'
          ? model
          : undefined
      ),
    };
    const runtime = new PiHeadlessRuntime({
      createAgentSession,
      modelRegistry,
    });

    await expect(runtime.runText({
      prompt: 'p',
      model: 'anthropic/claude-sonnet-4-5',
    })).resolves.toBe('done');

    expect(modelRegistry.find).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-5');
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      model,
      modelRegistry,
    }));
  });

  it('keeps Pi headless tools denied by default even if runtime defaults mention tools', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'done' },
    ]);
    const createAgentSession = vi.fn(async () => ({ session })) satisfies PiCreateAgentSession;
    const runtime = new PiHeadlessRuntime({ createAgentSession });

    await runtime.runText({
      prompt: 'p',
      runtimeDefaults: {
        allowedTools: ['Read', 'Bash'],
      },
    });

    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      noTools: 'all',
      tools: [],
    }));
  });

  it('maps explicit AnthroClaw tool policy into Pi tool names', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'done' },
    ]);
    const createAgentSession = vi.fn(async () => ({ session })) satisfies PiCreateAgentSession;
    const runtime = new PiHeadlessRuntime({
      createAgentSession,
      toolPolicy: { mode: 'allow-list', tools: ['Read', 'Bash', 'Edit', 'Read'] },
    });

    await runtime.runText({ prompt: 'p' });

    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      tools: ['read', 'bash', 'edit'],
    }));
    const firstOptions = (createAgentSession as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstOptions).not.toHaveProperty('noTools');
  });

  it('returns a session id from Pi run metadata', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'started' },
    ]);
    const runtime = new PiHeadlessRuntime({
      createAgentSession: vi.fn(async () => ({
        session,
        sessionId: 'pi-session-1',
      })),
    });

    await expect(runtime.run({
      prompt: 'start',
    })).resolves.toEqual({
      text: 'started',
      sessionId: 'pi-session-1',
    });
  });

  it('passes sessionId into the next Pi session for continuation probes', async () => {
    const sessions = [
      createSession([{ type: 'assistant_text_delta', delta: 'first' }]),
      createSession([{ type: 'assistant_text_delta', delta: 'second' }]),
    ];
    let callIndex = 0;
    const createAgentSession = vi.fn(async (options?: Record<string, unknown>) => ({
      session: sessions[callIndex++],
      sessionId: typeof options?.sessionId === 'string' ? options.sessionId : 'pi-session-1',
    })) satisfies PiCreateAgentSession;
    const runtime = new PiHeadlessRuntime({ createAgentSession });

    const first = await runtime.run({ prompt: 'first prompt' });
    const second = await runtime.run({
      prompt: 'second prompt',
      sessionId: first.sessionId,
    });

    expect(first).toEqual({ text: 'first', sessionId: 'pi-session-1' });
    expect(second).toEqual({ text: 'second', sessionId: 'pi-session-1' });
    expect(createAgentSession).toHaveBeenNthCalledWith(1, expect.not.objectContaining({
      sessionId: expect.anything(),
    }));
    expect(createAgentSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sessionId: 'pi-session-1',
    }));
  });

  it('surfaces Pi error events after prompt completion', async () => {
    const session = createSession([
      { type: 'message_update', assistantMessageEvent: { type: 'error', message: 'model unavailable' } },
    ]);
    const runtime = createPiHeadlessRuntime({
      createAgentSession: vi.fn(async () => ({ session })),
    });

    await expect(runtime.runText({ prompt: 'p', purpose: 'pi spike' }))
      .rejects.toThrow(/model unavailable/);
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it('aborts, unsubscribes, and disposes on timeout', async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    let resolvePrompt: (() => void) | undefined;
    const session: PiAgentSessionLike = {
      prompt: vi.fn(() => {
        return new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        });
      }),
      subscribe: vi.fn(() => unsubscribe),
      abort: vi.fn(async () => {
        resolvePrompt?.();
      }),
      dispose: vi.fn(),
    };
    const runtime = createPiHeadlessRuntime({
      createAgentSession: vi.fn(async () => ({ session })),
    });

    try {
      const result = expect(runtime.runText({
        prompt: 'p',
        purpose: 'pi spike',
        timeoutMs: 50,
      })).rejects.toThrow(/pi spike timeout after 50ms/);
      await vi.advanceTimersByTimeAsync(50);
      await result;
      expect(session.abort).toHaveBeenCalledTimes(1);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(session.dispose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces optional Pi loader failures', async () => {
    const runtime = createPiHeadlessRuntime({
      importPiCodingAgent: async () => {
        throw new Error('module not found');
      },
    });

    await expect(runtime.runText({ prompt: 'p' }))
      .rejects.toThrow(/@earendil-works\/pi-coding-agent.*module not found/);
  });

  it('parses Pi model ids and normalizes tool aliases', () => {
    expect(parsePiModelRef('openai/gpt-5-mini')).toEqual({
      provider: 'openai',
      modelId: 'gpt-5-mini',
    });
    expect(parsePiModelRef('anthropic:claude-sonnet-4-5')).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    });
    expect(() => parsePiModelRef('gpt-5-mini')).toThrow(/provider\/model/);

    expect(normalizePiToolNames(['Read', 'Bash', 'Glob', 'read', 'custom_tool']))
      .toEqual(['read', 'bash', 'find', 'custom_tool']);
  });

  it('throws clear errors for missing registry models', () => {
    expect(() => resolvePiModelFromRegistry('openai/gpt-5-mini', {
      find: () => undefined,
    })).toThrow(/could not find model openai\/gpt-5-mini/);
  });
});
