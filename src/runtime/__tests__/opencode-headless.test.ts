import { describe, expect, it, vi } from 'vitest';
import {
  OpenCodeHeadlessRuntime,
  type OpenCodeClientLike,
} from '../opencode-headless.js';

function createClient(overrides: Partial<OpenCodeClientLike['session']> = {}): OpenCodeClientLike {
  return {
    session: {
      create: vi.fn(async () => ({ data: { id: 'oc-session-1' } })),
      prompt: vi.fn(async () => ({
        data: {
          info: { id: 'assistant-message-1', sessionID: 'oc-session-1' },
          parts: [{ type: 'text', text: 'OpenCode says hi' }],
        },
      })),
      abort: vi.fn(async () => true),
      revert: vi.fn(async () => ({ data: { id: 'oc-session-1' } })),
      ...overrides,
    },
  };
}

describe('OpenCode headless runtime', () => {
  it('creates a session and sends prompts through the OpenCode SDK shape', async () => {
    const client = createClient();
    const runtime = new OpenCodeHeadlessRuntime({ client });

    await expect(runtime.run({
      prompt: 'hello',
      systemPrompt: 'system context',
      model: 'anthropic/claude-3-5-sonnet-20241022',
      purpose: 'benchmark',
    })).resolves.toEqual({
      text: 'OpenCode says hi',
      sessionId: 'oc-session-1',
    });

    expect(client.session.create).toHaveBeenCalledWith({
      body: { title: 'AnthroClaw benchmark' },
    });
    expect(client.session.prompt).toHaveBeenNthCalledWith(1, {
      path: { id: 'oc-session-1' },
      body: {
        noReply: true,
        parts: [{ type: 'text', text: 'system context' }],
      },
    });
    expect(client.session.prompt).toHaveBeenNthCalledWith(2, {
      path: { id: 'oc-session-1' },
      body: {
        model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet-20241022' },
        parts: [{ type: 'text', text: 'hello' }],
      },
    });
  });

  it('resumes an existing session without creating a new one', async () => {
    const client = createClient();
    const runtime = new OpenCodeHeadlessRuntime({ client });

    await runtime.run({
      prompt: 'continue',
      sessionId: 'existing-session',
    });

    expect(client.session.create).not.toHaveBeenCalled();
    expect(client.session.prompt).toHaveBeenCalledWith({
      path: { id: 'existing-session' },
      body: {
        parts: [{ type: 'text', text: 'continue' }],
      },
    });
  });

  it('can stream a benchmark RuntimeRunHandle and revert by message id', async () => {
    const client = createClient();
    const runtime = new OpenCodeHeadlessRuntime({ client });
    const handle = await runtime.runHandle({
      prompt: 'handle prompt',
      sessionId: 'oc-session-1',
    }, {
      runId: 'run-1',
      agentId: 'agent-1',
    });

    const events = [];
    for await (const event of handle) {
      events.push(event);
    }

    expect(events).toMatchObject([
      {
        type: 'text.delta',
        runtime: 'opencode',
        runId: 'run-1',
        sessionId: 'oc-session-1',
        text: 'OpenCode says hi',
      },
      {
        type: 'run.completed',
        runtime: 'opencode',
        runId: 'run-1',
        sessionId: 'oc-session-1',
      },
    ]);
    await expect(handle.rewindFiles('user-message-1', { dryRun: true })).resolves.toEqual({
      canRewind: true,
    });
    await expect(handle.rewindFiles('user-message-1', { dryRun: false })).resolves.toEqual({
      canRewind: true,
    });
    expect(client.session.revert).toHaveBeenCalledWith({
      path: { id: 'oc-session-1' },
      body: { messageID: 'user-message-1' },
    });
  });

  it('interrupts a running handle through session.abort', async () => {
    const client = createClient({
      prompt: vi.fn(() => new Promise(() => undefined)),
    });
    const runtime = new OpenCodeHeadlessRuntime({ client });
    const handle = await runtime.runHandle({
      prompt: 'long task',
      sessionId: 'oc-session-1',
    }, {
      runId: 'run-1',
    });

    await handle.interrupt();

    expect(client.session.abort).toHaveBeenCalledWith({
      path: { id: 'oc-session-1' },
    });
    handle.close();
  });

  it('aborts the OpenCode session when a headless run times out', async () => {
    const client = createClient({
      prompt: vi.fn(() => new Promise(() => undefined)),
    });
    const runtime = new OpenCodeHeadlessRuntime({ client, timeoutMs: 1 });

    await expect(runtime.run({
      prompt: 'long task',
      sessionId: 'oc-session-1',
      purpose: 'timeout probe',
    })).rejects.toThrow('timeout probe timeout after 1ms');

    expect(client.session.abort).toHaveBeenCalledWith({
      path: { id: 'oc-session-1' },
    });
  });

  it('surfaces optional package loader failures clearly', async () => {
    const runtime = new OpenCodeHeadlessRuntime({
      importOpenCodeSdk: vi.fn(async () => {
        throw new Error('missing package');
      }),
    });

    await expect(runtime.run({ prompt: 'hello' })).rejects.toThrow(
      /OpenCode runtime requires optional package @opencode-ai\/sdk/,
    );
  });
});
