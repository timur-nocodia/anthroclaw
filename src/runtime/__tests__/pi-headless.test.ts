import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  applyPiModelOutputTokenCap,
  createPiToolPolicyExtension,
  createPiHeadlessRuntime,
  DEFAULT_PI_OPENROUTER_MAX_OUTPUT_TOKENS,
  evaluatePiToolCallPolicy,
  normalizePiCustomToolParameters,
  normalizePiToolNames,
  parsePiModelRef,
  PiHeadlessRuntime,
  resolvePiModelFromRegistry,
  type PiAgentSessionLike,
  type PiCreateAgentSession,
  type PiLoadExtensionsResultLike,
  type PiResourceLoaderLike,
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

  it('can resolve model ids through the SDK default ModelRegistry when available', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'done' },
    ]);
    const createAgentSession = vi.fn(async () => ({ session })) satisfies PiCreateAgentSession;
    const authStorage = {};
    const model = { provider: 'anthropic', id: 'claude-sonnet-4-6' };
    const modelRegistry = {
      find: vi.fn((provider: string, modelId: string) =>
        provider === 'anthropic' && modelId === 'claude-sonnet-4-6'
          ? model
          : undefined
      ),
    };
    const authCreate = vi.fn(() => authStorage);
    const registryCreate = vi.fn(() => modelRegistry);
    const runtime = new PiHeadlessRuntime({
      importPiCodingAgent: async () => ({
        createAgentSession,
        AuthStorage: { create: authCreate },
        ModelRegistry: { create: registryCreate },
      }),
    });

    await expect(runtime.runText({
      prompt: 'p',
      model: 'claude-sonnet-4-6',
    })).resolves.toBe('done');

    expect(authCreate).toHaveBeenCalledTimes(1);
    expect(registryCreate).toHaveBeenCalledWith(authStorage, undefined);
    expect(modelRegistry.find).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-6');
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      model,
      modelRegistry,
    }));
  });

  it('passes configured Pi auth and model storage paths into the default registry', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'done' },
    ]);
    const createAgentSession = vi.fn(async () => ({ session })) satisfies PiCreateAgentSession;
    const authStorage = {};
    const model = { provider: 'anthropic', id: 'claude-sonnet-4-6' };
    const modelRegistry = {
      find: vi.fn(() => model),
    };
    const authCreate = vi.fn(() => authStorage);
    const registryCreate = vi.fn(() => modelRegistry);
    const runtime = new PiHeadlessRuntime({
      authStoragePath: '/secure/pi-auth.json',
      modelsPath: '/secure/pi-models.json',
      importPiCodingAgent: async () => ({
        createAgentSession,
        AuthStorage: { create: authCreate },
        ModelRegistry: { create: registryCreate },
      }),
    });

    await expect(runtime.runText({
      prompt: 'p',
      model: 'claude-sonnet-4-6',
    })).resolves.toBe('done');

    expect(authCreate).toHaveBeenCalledWith('/secure/pi-auth.json');
    expect(registryCreate).toHaveBeenCalledWith(authStorage, '/secure/pi-models.json');
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

  it('passes headless custom tools through Pi defineTool and tool allow-list', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'done' },
    ]);
    const createAgentSession = vi.fn(async () => ({ session })) satisfies PiCreateAgentSession;
    const defineTool = vi.fn((definition) => ({ ...definition, defined: true }));
    const handler = vi.fn(async () => ({
      content: [{ type: 'text', text: 'memory result' }],
    }));
    const runtime = new PiHeadlessRuntime({
      createAgentSession,
      importPiCodingAgent: async () => ({ defineTool }),
      toolPolicy: { mode: 'allow-list', tools: ['Read'] },
    });

    await runtime.runText({
      prompt: 'p',
      customTools: [{
        name: 'memory_search',
        description: 'Search memory',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        handler,
      }],
    });

    const options = (createAgentSession as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options.tools).toEqual(['read', 'memory_search']);
    expect(options.customTools).toHaveLength(1);
    expect(defineTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'memory_search',
      label: 'memory_search',
      description: 'Search memory',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      execute: expect.any(Function),
    }));

    const defined = (options.customTools as Array<{ execute: (id: string, params: unknown) => Promise<unknown> }>)[0];
    await expect(defined.execute('tool-1', { query: 'plans' })).resolves.toEqual({
      content: [{ type: 'text', text: 'memory result' }],
      details: {},
    });
    expect(handler).toHaveBeenCalledWith({ query: 'plans' });
  });

  it('normalizes Agent SDK zod raw-shape tools into Pi JSON object schemas', () => {
    expect(normalizePiCustomToolParameters({
      query: z.string().describe('Search query text'),
      max_results: z.number().optional(),
    })).toMatchObject({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query text' },
        max_results: { type: 'number' },
      },
      required: ['query'],
    });

    expect(normalizePiCustomToolParameters({})).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('rechecks custom tool policy inside Pi execute when no tool_call event was observed', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'done' },
    ]);
    const createAgentSession = vi.fn(async () => ({ session })) satisfies PiCreateAgentSession;
    const canUseTool = vi.fn(async () => ({ behavior: 'deny' as const, message: 'needs approval' }));
    const handler = vi.fn(async () => ({
      content: [{ type: 'text', text: 'should not run' }],
    }));
    const runtime = new PiHeadlessRuntime({
      createAgentSession,
      createOptions: {
        resourceLoader: {
          getExtensions: vi.fn(() => ({ extensions: [], errors: [], runtime: {} })),
        },
      },
      toolPolicy: {
        mode: 'allow-list',
        tools: ['memory_search'],
        canUseTool,
      },
    });

    await runtime.runText({
      prompt: 'p',
      customTools: [{
        name: 'memory_search',
        description: 'Search memory',
        inputSchema: {},
        handler,
      }],
    });

    const options = (createAgentSession as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as Record<string, unknown>;
    const customTool = (options.customTools as Array<{ execute: (id: string, params: unknown) => Promise<unknown> }>)[0];
    await expect(customTool.execute('tool-1', { query: 'plans' })).resolves.toEqual({
      content: [{ type: 'text', text: 'needs approval' }],
      details: {
        isError: true,
        denied: true,
      },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(canUseTool).toHaveBeenCalledWith({
      toolName: 'memory_search',
      originalToolName: 'memory_search',
      toolCallId: 'tool-1',
      input: { query: 'plans' },
    }, expect.objectContaining({ prompt: 'p' }));
  });

  it('wires systemPrompt through Pi DefaultResourceLoader override', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'done' },
    ]);
    const createAgentSession = vi.fn(async () => ({ session })) satisfies PiCreateAgentSession;
    const reload = vi.fn(async () => undefined);
    const DefaultResourceLoader = vi.fn(function DefaultResourceLoader(this: PiResourceLoaderLike, options: Record<string, unknown>) {
      this.getExtensions = vi.fn(() => ({ extensions: [], errors: [], runtime: {} }));
      this.reload = reload;
      Object.assign(this, { options });
    });
    const runtime = new PiHeadlessRuntime({
      createAgentSession,
      importPiCodingAgent: async () => ({
        DefaultResourceLoader: DefaultResourceLoader as unknown as new (options: Record<string, unknown>) => PiResourceLoaderLike,
        getAgentDir: () => '/tmp/pi-agent',
      }),
    });

    await runtime.runText({
      prompt: 'p',
      cwd: '/workspace',
      systemPrompt: 'You are AnthroClaw.',
    });

    expect(DefaultResourceLoader).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/workspace',
      agentDir: '/tmp/pi-agent',
      systemPromptOverride: expect.any(Function),
    }));
    const options = DefaultResourceLoader.mock.calls[0]?.[0] as { systemPromptOverride: () => string };
    expect(options.systemPromptOverride()).toBe('You are AnthroClaw.');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      resourceLoader: expect.any(Object),
      noTools: 'all',
      tools: [],
    }));
  });

  it('lets per-run tool policy override constructor-level Pi tool policy', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'done' },
    ]);
    const createAgentSession = vi.fn(async () => ({ session })) satisfies PiCreateAgentSession;
    const runtime = new PiHeadlessRuntime({
      createAgentSession,
      toolPolicy: { mode: 'deny' },
    });

    await runtime.runText({
      prompt: 'p',
      toolPolicy: { mode: 'allow-list', tools: ['Read'] },
    });

    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      tools: ['read'],
    }));
    const firstOptions = (createAgentSession as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstOptions).not.toHaveProperty('noTools');
  });

  it('installs model-visible Pi tool denial feedback on a configured resource loader', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'done' },
    ]);
    const createAgentSession = vi.fn(async () => ({ session })) satisfies PiCreateAgentSession;
    const canUseTool = vi.fn(async () => ({
      behavior: 'deny' as const,
      message: 'bash requires review',
    }));
    const baseExtensions: PiLoadExtensionsResultLike = {
      extensions: [{ path: '<base>' }],
      errors: [],
      runtime: {},
    };
    const resourceLoader: PiResourceLoaderLike = {
      getExtensions: vi.fn(() => baseExtensions),
      reload: vi.fn(async () => undefined),
    };
    const runtime = new PiHeadlessRuntime({
      createAgentSession,
      createOptions: { resourceLoader },
      toolPolicy: {
        mode: 'allow-list',
        tools: ['Bash'],
        canUseTool,
      },
    });

    await runtime.runText({
      prompt: 'p',
      purpose: 'tool proof',
    });

    const firstOptions = (createAgentSession as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstOptions.tools).toEqual(['bash']);
    expect(firstOptions.resourceLoader).not.toBe(resourceLoader);

    const wrappedLoader = firstOptions.resourceLoader as PiResourceLoaderLike;
    const extensions = wrappedLoader.getExtensions().extensions as Array<Record<string, unknown>>;
    expect(extensions.map((extension) => extension.path)).toEqual(['<base>', '<anthroclaw:pi-tool-policy>']);
    const policyExtension = extensions[1];
    const handlers = policyExtension.handlers as Map<string, Array<(event: unknown) => Promise<unknown>>>;

    await expect(handlers.get('tool_call')?.[0]({
      toolName: 'bash',
      toolCallId: 'call-1',
      input: { command: 'rm -rf /tmp/x' },
    })).resolves.toEqual({
      block: true,
      reason: 'bash requires review',
    });
    expect(canUseTool).toHaveBeenCalledWith({
      toolName: 'bash',
      originalToolName: 'bash',
      toolCallId: 'call-1',
      input: { command: 'rm -rf /tmp/x' },
    }, expect.objectContaining({ purpose: 'tool proof' }));
  });

  it('uses Pi DefaultResourceLoader to install tool denial feedback when no resource loader is configured', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'done' },
    ]);
    const createAgentSession = vi.fn(async () => ({ session })) satisfies PiCreateAgentSession;
    const reload = vi.fn(async () => undefined);
    const DefaultResourceLoader = vi.fn(function DefaultResourceLoader(this: PiResourceLoaderLike, options: Record<string, unknown>) {
      this.getExtensions = vi.fn(() => ({ extensions: [], errors: [], runtime: {} }));
      this.reload = reload;
      Object.assign(this, { options });
    });
    const runtime = new PiHeadlessRuntime({
      createAgentSession,
      importPiCodingAgent: async () => ({
        DefaultResourceLoader: DefaultResourceLoader as unknown as new (options: Record<string, unknown>) => PiResourceLoaderLike,
        getAgentDir: () => '/tmp/pi-agent',
      }),
      toolPolicy: {
        mode: 'allow-list',
        tools: ['Read'],
        canUseTool: async () => true,
      },
    });

    await runtime.runText({
      prompt: 'p',
      cwd: '/workspace',
    });

    expect(DefaultResourceLoader).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/workspace',
      agentDir: '/tmp/pi-agent',
      extensionFactories: [expect.any(Function)],
    }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      tools: ['read'],
      resourceLoader: expect.any(Object),
    }));
  });

  it('fails closed when dynamic Pi tool policy cannot be installed', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'done' },
    ]);
    const runtime = new PiHeadlessRuntime({
      createAgentSession: vi.fn(async () => ({ session })),
      toolPolicy: {
        mode: 'allow-list',
        tools: ['Bash'],
        canUseTool: async () => false,
      },
    });

    await expect(runtime.runText({ prompt: 'p' }))
      .rejects.toThrow(/DefaultResourceLoader.*resourceLoader/);
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

  it('prefers Pi sessionFile as the resumable session reference', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'started' },
    ]);
    session.sessionId = 'pi-session-id-1';
    session.sessionFile = '/tmp/pi-session-file.jsonl';
    const runtime = new PiHeadlessRuntime({
      createAgentSession: vi.fn(async () => ({ session })),
    });

    await expect(runtime.run({
      prompt: 'start',
    })).resolves.toEqual({
      text: 'started',
      sessionId: '/tmp/pi-session-file.jsonl',
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

  it('opens an absolute Pi session file through SessionManager for continuation', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'continued' },
    ]);
    const sessionManager = { kind: 'opened-session-manager' };
    const open = vi.fn(() => sessionManager);
    const createAgentSession = vi.fn(async () => ({ session }));
    const runtime = new PiHeadlessRuntime({
      importPiCodingAgent: vi.fn(async () => ({
        createAgentSession,
        SessionManager: { open },
      })),
    });

    await expect(runtime.run({
      prompt: 'continue',
      cwd: '/workspace',
      sessionId: '/tmp/pi-session-file.jsonl',
    })).resolves.toEqual({
      text: 'continued',
      sessionId: undefined,
    });

    expect(open).toHaveBeenCalledWith('/tmp/pi-session-file.jsonl', undefined, '/workspace');
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/workspace',
      sessionManager,
      noTools: 'all',
      tools: [],
    }));
    expect(createAgentSession).toHaveBeenCalledWith(expect.not.objectContaining({
      sessionId: expect.anything(),
    }));
  });

  it('creates a RuntimeRunHandle over Pi session events', async () => {
    const session = createSession([
      { type: 'agent_start' },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hello ' } },
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          usage: { input: 4, output: 2 },
        },
      },
      { type: 'agent_end', messages: [] },
    ]);
    const createAgentSession = vi.fn(async () => ({ session, sessionId: 'pi-session-1' })) satisfies PiCreateAgentSession;
    const runtime = new PiHeadlessRuntime({ createAgentSession });

    const handle = await runtime.runHandle({
      prompt: 'hello',
      cwd: '/workspace',
    }, {
      runId: 'run-1',
      agentId: 'agent-1',
    });

    const events: unknown[] = [];
    for await (const event of handle) {
      events.push(event);
    }

    expect(events).toMatchObject([
      { type: 'run.started', runtime: 'pi', runId: 'run-1', sessionId: 'pi-session-1', agentId: 'agent-1' },
      { type: 'text.delta', text: 'hello ', source: 'partial' },
      { type: 'message.completed' },
      { type: 'usage.updated', inputTokens: 4, outputTokens: 2 },
      { type: 'run.completed' },
    ]);
    expect(session.prompt).toHaveBeenCalledWith('hello');
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it('passes sessionId and runtime defaults into Pi runtime handles', async () => {
    const session = createSession([
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'continued' } },
    ]);
    const createAgentSession = vi.fn(async () => ({ session, sessionId: 'pi-session-1' })) satisfies PiCreateAgentSession;
    const runtime = new PiHeadlessRuntime({ createAgentSession });

    const handle = await runtime.runHandle({
      prompt: 'continue',
      sessionId: 'pi-session-1',
      runtimeDefaults: {
        model: 'anthropic/claude-sonnet-4-5',
        cwd: '/workspace',
      },
    }, {
      runId: 'run-1',
      sessionId: 'pi-session-1',
    });

    for await (const _event of handle) {
      // drain
    }

    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'pi-session-1',
      cwd: '/workspace',
      noTools: 'all',
      tools: [],
    }));
  });

  it('rewinds Pi runtime handle workspace changes through AnthroClaw snapshots', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-rewind-'));
    try {
      mkdirSync(join(cwd, 'src'));
      writeFileSync(join(cwd, 'src', 'file.txt'), 'before');
      writeFileSync(join(cwd, 'deleted.txt'), 'before');
      const session = createSession([
        { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'changed' } },
      ], async () => {
        writeFileSync(join(cwd, 'src', 'file.txt'), 'after');
        writeFileSync(join(cwd, 'created.txt'), 'created');
        rmSync(join(cwd, 'deleted.txt'));
      });
      const runtime = new PiHeadlessRuntime({
        createAgentSession: vi.fn(async () => ({ session, sessionId: 'pi-session-1' })),
      });

      const handle = await runtime.runHandle({
        prompt: 'change files',
        cwd,
      }, {
        runId: 'run-1',
      });

      for await (const _event of handle) {
        // drain
      }

      await expect(handle.rewindFiles('user-message-1', { dryRun: true })).resolves.toMatchObject({
        canRewind: true,
        filesChanged: ['created.txt', 'deleted.txt', 'src/file.txt'],
        insertions: 2,
        deletions: 1,
      });
      expect(readFileSync(join(cwd, 'src', 'file.txt'), 'utf8')).toBe('after');

      await expect(handle.rewindFiles('user-message-1', { dryRun: false })).resolves.toMatchObject({
        canRewind: true,
        filesChanged: ['created.txt', 'deleted.txt', 'src/file.txt'],
        insertions: 2,
        deletions: 1,
      });
      expect(readFileSync(join(cwd, 'src', 'file.txt'), 'utf8')).toBe('before');
      expect(readFileSync(join(cwd, 'deleted.txt'), 'utf8')).toBe('before');
      expect(() => readFileSync(join(cwd, 'created.txt'), 'utf8')).toThrow();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('interrupts and closes Pi runtime handles', async () => {
    let listener: ((event: unknown) => void) | undefined;
    let resolvePrompt: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const session: PiAgentSessionLike = {
      prompt: vi.fn(() => new Promise<void>((resolve) => {
        resolvePrompt = resolve;
      })),
      subscribe: vi.fn((next) => {
        listener = next;
        return unsubscribe;
      }),
      abort: vi.fn(async () => {
        listener?.({ type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'aborted' }] });
        resolvePrompt?.();
      }),
      dispose: vi.fn(),
    };
    const runtime = new PiHeadlessRuntime({
      createAgentSession: vi.fn(async () => ({ session })),
    });

    const handle = await runtime.runHandle({ prompt: 'p' }, { runId: 'run-1' });
    await handle.interrupt();

    const seen: unknown[] = [];
    for await (const event of handle) {
      seen.push(event);
    }

    expect(seen).toMatchObject([{ type: 'run.failed' }]);
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalledTimes(1);
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
    expect(parsePiModelRef('claude-sonnet-4-6')).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
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

  it('caps OpenRouter model output tokens by default so Pi does not request oversized completions', async () => {
    const session = createSession([
      { type: 'assistant_text_delta', delta: 'done' },
    ]);
    const createAgentSession = vi.fn(async () => ({ session })) satisfies PiCreateAgentSession;
    const model = { provider: 'openrouter', id: 'qwen/qwen3.6-max-preview', maxTokens: 32_000 };
    const runtime = new PiHeadlessRuntime({
      createAgentSession,
      modelRegistry: {
        find: vi.fn(() => model),
      },
    });

    await expect(runtime.runText({
      prompt: 'p',
      model: 'openrouter/qwen/qwen3.6-max-preview',
    })).resolves.toBe('done');

    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.objectContaining({
        provider: 'openrouter',
        id: 'qwen/qwen3.6-max-preview',
        maxTokens: DEFAULT_PI_OPENROUTER_MAX_OUTPUT_TOKENS,
      }),
    }));
  });

  it('honors configured Pi provider output token caps', () => {
    const model = { provider: 'openrouter', id: 'qwen/qwen3.6-max-preview', maxTokens: 32_000 };

    expect(applyPiModelOutputTokenCap(model, {
      provider: 'openrouter',
      modelId: 'qwen/qwen3.6-max-preview',
    }, {
      providerMaxOutputTokens: { openrouter: 256 },
    })).toMatchObject({
      maxTokens: 256,
    });
  });

  it('honors configured Pi model output token caps before provider caps', () => {
    const model = { provider: 'openrouter', id: 'qwen/qwen3.6-max-preview', maxTokens: 32_000 };

    expect(applyPiModelOutputTokenCap(model, {
      provider: 'openrouter',
      modelId: 'qwen/qwen3.6-max-preview',
    }, {
      providerMaxOutputTokens: { openrouter: 512 },
      modelMaxOutputTokens: { 'openrouter/qwen/qwen3.6-max-preview': 192 },
    })).toMatchObject({
      maxTokens: 192,
    });
  });

  it('exposes a Pi policy extension helper for direct SDK resource loader wiring', async () => {
    const registered: Array<(event: unknown) => Promise<unknown>> = [];
    const extension = createPiToolPolicyExtension({
      prompt: 'p',
      toolDenyMessage: 'denied by smoke',
    }, {
      mode: 'allow-list',
      tools: ['Read'],
      canUseTool: async () => false,
    });

    extension({
      on: (_event, handler) => {
        registered.push(handler as (event: unknown) => Promise<unknown>);
      },
    });

    await expect(registered[0]?.({
      toolName: 'read',
      input: { filePath: 'a.txt' },
    })).resolves.toEqual({
      block: true,
      reason: 'denied by smoke',
    });
  });

  it('evaluates Pi tool policy allow, deny, and outside-allowlist calls', async () => {
    await expect(evaluatePiToolCallPolicy({ prompt: 'p' }, {
      mode: 'allow-list',
      tools: ['Read'],
      canUseTool: async () => ({ allow: true }),
    }, {
      toolName: 'read',
      input: { filePath: 'README.md' },
    })).resolves.toBeUndefined();

    await expect(evaluatePiToolCallPolicy({ prompt: 'p' }, {
      mode: 'allow-list',
      tools: ['Read'],
      canUseTool: async () => false,
      denyMessage: 'no reads',
    }, {
      toolName: 'read',
      input: { filePath: 'README.md' },
    })).resolves.toEqual({
      block: true,
      reason: 'no reads',
    });

    await expect(evaluatePiToolCallPolicy({ prompt: 'p', purpose: 'policy test' }, {
      mode: 'allow-list',
      tools: ['Read'],
    }, {
      toolName: 'bash',
      input: { command: 'pwd' },
    })).resolves.toEqual({
      block: true,
      reason: 'Tool bash is not enabled for policy test.',
    });
  });
});
