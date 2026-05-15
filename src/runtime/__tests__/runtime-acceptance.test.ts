import { describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '../events.js';
import type { HeadlessRunInput, HeadlessRuntime } from '../headless.js';
import {
  OpenCodeHeadlessRuntime,
  type OpenCodeClientLike,
} from '../opencode-headless.js';
import {
  PiHeadlessRuntime,
  type PiAgentSessionLike,
  type PiCreateAgentSession,
} from '../pi-headless.js';
import type { RuntimeRunHandle } from '../types.js';

interface RuntimeWithHandle extends HeadlessRuntime {
  runHandle(
    input: HeadlessRunInput,
    context: { runId: string; sessionId?: string; agentId?: string },
  ): Promise<RuntimeRunHandle<RuntimeEvent>>;
}

interface RuntimeAcceptanceFixture {
  name: string;
  expectedRuntime: string;
  text: {
    create(): {
      runtime: HeadlessRuntime;
      verify(result: { text: string; sessionId?: string }): void;
    };
  };
  continuation: {
    create(): {
      runtime: HeadlessRuntime;
      sessionId: string;
      verify(): void;
    };
  };
  events: {
    create(): {
      runtime: RuntimeWithHandle;
      input: HeadlessRunInput;
      verify(events: RuntimeEvent[], handle: RuntimeRunHandle<RuntimeEvent>): Promise<void>;
    };
  };
  interrupt: {
    create(): {
      runtime: RuntimeWithHandle;
      input: HeadlessRunInput;
      verify(): void;
      close?(handle: RuntimeRunHandle<RuntimeEvent>): void;
    };
  };
  timeout: {
    create(): {
      runtime: HeadlessRuntime;
      input: HeadlessRunInput;
      advance(): Promise<void>;
      verify(): void;
      cleanup(): void;
    };
  };
}

describe('runtime acceptance harness', () => {
  for (const fixture of [piAcceptanceFixture(), openCodeAcceptanceFixture()]) {
    describe(fixture.name, () => {
      it('returns headless text and session metadata', async () => {
        const probe = fixture.text.create();

        const result = await probe.runtime.run!({
          prompt: 'return a short response',
          purpose: 'contract acceptance',
        });

        expect(result.text).toBeTruthy();
        probe.verify(result);
      });

      it('continues an existing session through HeadlessRunInput.sessionId', async () => {
        const probe = fixture.continuation.create();

        await probe.runtime.run!({
          prompt: 'continue',
          sessionId: probe.sessionId,
        });

        probe.verify();
      });

      it('normalizes runtime handle events with required AnthroClaw fields', async () => {
        const probe = fixture.events.create();
        const handle = await probe.runtime.runHandle(probe.input, {
          runId: 'accept-run-1',
          agentId: 'accept-agent-1',
        });

        const events = await drain(handle);

        expect(events.length).toBeGreaterThan(0);
        expect(events.every((event) => event.runtime === fixture.expectedRuntime)).toBe(true);
        expect(events.every((event) => event.runId === 'accept-run-1')).toBe(true);
        expect(events.every((event) => typeof event.timestamp === 'number')).toBe(true);
        expect(events.some((event) => event.type === 'text.delta')).toBe(true);
        await probe.verify(events, handle);
      });

      it('interrupts active runtime handles through the provider abort primitive', async () => {
        const probe = fixture.interrupt.create();
        const handle = await probe.runtime.runHandle(probe.input, {
          runId: 'interrupt-run-1',
        });

        await handle.interrupt();
        probe.verify();
        probe.close?.(handle);
      });

      it('aborts hung headless runs on timeout', async () => {
        const probe = fixture.timeout.create();
        try {
          const result = expect(probe.runtime.runText(probe.input))
            .rejects
            .toThrow(/timeout probe timeout after/);
          await probe.advance();
          await result;
          probe.verify();
        } finally {
          probe.cleanup();
        }
      });
    });
  }
});

function piAcceptanceFixture(): RuntimeAcceptanceFixture {
  return {
    name: 'Pi headless runtime',
    expectedRuntime: 'pi',
    text: {
      create: () => {
        const session = createPiSession([
          { type: 'assistant_text_delta', delta: 'Pi accepted' },
        ]);
        const runtime = new PiHeadlessRuntime({
          createAgentSession: vi.fn(async () => ({ session, sessionId: 'pi-accept-1' })),
        });
        return {
          runtime,
          verify: (result) => {
            expect(result).toEqual({ text: 'Pi accepted', sessionId: 'pi-accept-1' });
          },
        };
      },
    },
    continuation: {
      create: () => {
        const session = createPiSession([
          { type: 'assistant_text_delta', delta: 'continued' },
        ]);
        const createAgentSession = vi.fn(async (options?: Record<string, unknown>) => ({
          session,
          sessionId: typeof options?.sessionId === 'string' ? options.sessionId : 'pi-new-session',
        })) satisfies PiCreateAgentSession;
        return {
          runtime: new PiHeadlessRuntime({ createAgentSession }),
          sessionId: 'pi-existing-session',
          verify: () => {
            expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
              sessionId: 'pi-existing-session',
            }));
          },
        };
      },
    },
    events: {
      create: () => {
        const session = createPiSession([
          { type: 'agent_start' },
          { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'streamed pi' } },
          { type: 'agent_end', messages: [] },
        ]);
        return {
          runtime: new PiHeadlessRuntime({
            createAgentSession: vi.fn(async () => ({ session, sessionId: 'pi-event-session' })),
          }),
          input: { prompt: 'stream' },
          verify: async (events, handle) => {
            expect(events).toMatchObject([
              { type: 'run.started', sessionId: 'pi-event-session' },
              { type: 'text.delta', text: 'streamed pi', source: 'partial' },
              { type: 'run.completed' },
            ]);
            expect(handle.rewindFiles).toBeUndefined();
          },
        };
      },
    },
    interrupt: {
      create: () => {
        let resolvePrompt: (() => void) | undefined;
        const session: PiAgentSessionLike = {
          prompt: vi.fn(() => new Promise<void>((resolve) => {
            resolvePrompt = resolve;
          })),
          subscribe: vi.fn(() => vi.fn()),
          abort: vi.fn(async () => {
            resolvePrompt?.();
          }),
          dispose: vi.fn(),
        };
        return {
          runtime: new PiHeadlessRuntime({
            createAgentSession: vi.fn(async () => ({ session, sessionId: 'pi-interrupt-session' })),
          }),
          input: { prompt: 'long task' },
          verify: () => {
            expect(session.abort).toHaveBeenCalledTimes(1);
          },
        };
      },
    },
    timeout: {
      create: () => {
        vi.useFakeTimers();
        let resolvePrompt: (() => void) | undefined;
        const session: PiAgentSessionLike = {
          prompt: vi.fn(() => new Promise<void>((resolve) => {
            resolvePrompt = resolve;
          })),
          subscribe: vi.fn(() => vi.fn()),
          abort: vi.fn(async () => {
            resolvePrompt?.();
          }),
          dispose: vi.fn(),
        };
        return {
          runtime: new PiHeadlessRuntime({
            createAgentSession: vi.fn(async () => ({ session, sessionId: 'pi-timeout-session' })),
          }),
          input: { prompt: 'long task', purpose: 'timeout probe', timeoutMs: 25 },
          advance: async () => {
            await vi.advanceTimersByTimeAsync(25);
          },
          verify: () => {
            expect(session.abort).toHaveBeenCalledTimes(1);
            expect(session.dispose).toHaveBeenCalledTimes(1);
          },
          cleanup: () => {
            vi.useRealTimers();
          },
        };
      },
    },
  };
}

function openCodeAcceptanceFixture(): RuntimeAcceptanceFixture {
  return {
    name: 'OpenCode headless runtime',
    expectedRuntime: 'opencode',
    text: {
      create: () => {
        const client = createOpenCodeClient();
        return {
          runtime: new OpenCodeHeadlessRuntime({ client }),
          verify: (result) => {
            expect(result).toEqual({ text: 'OpenCode accepted', sessionId: 'oc-accept-1' });
          },
        };
      },
    },
    continuation: {
      create: () => {
        const client = createOpenCodeClient();
        return {
          runtime: new OpenCodeHeadlessRuntime({ client }),
          sessionId: 'oc-existing-session',
          verify: () => {
            expect(client.session.create).not.toHaveBeenCalled();
            expect(client.session.prompt).toHaveBeenCalledWith({
              path: { id: 'oc-existing-session' },
              body: {
                parts: [{ type: 'text', text: 'continue' }],
              },
            });
          },
        };
      },
    },
    events: {
      create: () => {
        const client = createOpenCodeClient();
        return {
          runtime: new OpenCodeHeadlessRuntime({ client }),
          input: { prompt: 'stream', sessionId: 'oc-event-session' },
          verify: async (events, handle) => {
            expect(events).toMatchObject([
              { type: 'text.delta', text: 'OpenCode accepted', source: 'message', sessionId: 'oc-event-session' },
              { type: 'run.completed', sessionId: 'oc-event-session' },
            ]);
            await expect(handle.rewindFiles?.('user-message-1', { dryRun: true }))
              .resolves
              .toEqual({ canRewind: true });
          },
        };
      },
    },
    interrupt: {
      create: () => {
        const client = createOpenCodeClient({
          prompt: vi.fn(() => new Promise(() => undefined)),
        });
        return {
          runtime: new OpenCodeHeadlessRuntime({ client }),
          input: { prompt: 'long task', sessionId: 'oc-interrupt-session' },
          verify: () => {
            expect(client.session.abort).toHaveBeenCalledWith({
              path: { id: 'oc-interrupt-session' },
            });
          },
          close: (handle) => {
            handle.close();
          },
        };
      },
    },
    timeout: {
      create: () => {
        const client = createOpenCodeClient({
          prompt: vi.fn(() => new Promise(() => undefined)),
        });
        return {
          runtime: new OpenCodeHeadlessRuntime({ client, timeoutMs: 1 }),
          input: { prompt: 'long task', sessionId: 'oc-timeout-session', purpose: 'timeout probe' },
          advance: async () => new Promise((resolve) => setTimeout(resolve, 5)),
          verify: () => {
            expect(client.session.abort).toHaveBeenCalledWith({
              path: { id: 'oc-timeout-session' },
            });
          },
          cleanup: () => undefined,
        };
      },
    },
  };
}

function createPiSession(events: unknown[]): PiAgentSessionLike {
  let listener: ((event: unknown) => void) | undefined;
  return {
    prompt: vi.fn(async () => {
      for (const event of events) {
        listener?.(event);
      }
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

function createOpenCodeClient(overrides: Partial<OpenCodeClientLike['session']> = {}): OpenCodeClientLike {
  return {
    session: {
      create: vi.fn(async () => ({ data: { id: 'oc-accept-1' } })),
      prompt: vi.fn(async () => ({
        data: {
          info: { id: 'assistant-message-1', sessionID: 'oc-accept-1' },
          parts: [{ type: 'text', text: 'OpenCode accepted' }],
        },
      })),
      abort: vi.fn(async () => true),
      revert: vi.fn(async () => ({ data: { id: 'oc-accept-1' } })),
      ...overrides,
    },
  };
}

async function drain(handle: RuntimeRunHandle<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of handle) {
    events.push(event);
  }
  return events;
}
