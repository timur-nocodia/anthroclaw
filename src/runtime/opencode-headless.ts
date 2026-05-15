import {
  DEFAULT_HEADLESS_TIMEOUT_MS,
  type HeadlessRunInput,
  type HeadlessRunResult,
  type HeadlessRuntime,
} from './headless.js';
import type {
  RuntimeEvent,
} from './events.js';
import type {
  RuntimeRewindFilesOptions,
  RuntimeRewindFilesResult,
  RuntimeRunHandle,
} from './types.js';

const OPENCODE_PACKAGE_NAME = '@opencode-ai/sdk';

export interface OpenCodeSessionInfoLike {
  id?: string;
  sessionID?: string;
  title?: string;
}

export interface OpenCodeMessagePartLike {
  type?: string;
  text?: string;
  content?: string;
  [key: string]: unknown;
}

export interface OpenCodeMessageResultLike {
  info?: {
    id?: string;
    sessionID?: string;
    role?: string;
    error?: { name?: string; message?: string };
    [key: string]: unknown;
  };
  parts?: OpenCodeMessagePartLike[];
  [key: string]: unknown;
}

export interface OpenCodeClientLike {
  session: {
    create?: (input: { body?: Record<string, unknown> }) => Promise<unknown>;
    prompt: (input: { path: { id: string }; body: Record<string, unknown> }) => Promise<unknown>;
    abort?: (input: { path: { id: string } }) => Promise<unknown>;
    revert?: (input: { path: { id: string }; body: { messageID: string } }) => Promise<unknown>;
  };
}

export interface OpenCodeSdkInstanceLike {
  client: OpenCodeClientLike;
  server?: {
    url?: string;
    close?: () => void | Promise<void>;
  };
}

export interface OpenCodeSdkModuleLike {
  createOpencode?: (options?: Record<string, unknown>) => Promise<OpenCodeSdkInstanceLike>;
  createOpencodeClient?: (options: Record<string, unknown>) => OpenCodeClientLike;
}

export type OpenCodeSdkLoader = () => Promise<OpenCodeSdkModuleLike>;

export interface OpenCodeHeadlessRuntimeOptions {
  client?: OpenCodeClientLike;
  createClient?: (input: HeadlessRunInput, signal: AbortSignal) => OpenCodeClientLike | Promise<OpenCodeClientLike>;
  createOpencode?: (input: HeadlessRunInput, signal: AbortSignal) => Promise<OpenCodeSdkInstanceLike>;
  importOpenCodeSdk?: OpenCodeSdkLoader;
  baseUrl?: string;
  createOptions?: Record<string, unknown> | ((input: HeadlessRunInput) => Record<string, unknown> | Promise<Record<string, unknown>>);
  timeoutMs?: number;
}

interface OpenCodeClientLease {
  client: OpenCodeClientLike;
  close?: () => void | Promise<void>;
}

export class OpenCodeHeadlessRuntime implements HeadlessRuntime {
  readonly id = 'opencode';

  constructor(private readonly options: OpenCodeHeadlessRuntimeOptions = {}) {}

  async runText(input: HeadlessRunInput): Promise<string> {
    return (await this.run(input)).text;
  }

  async run(input: HeadlessRunInput): Promise<HeadlessRunResult> {
    const controller = new AbortController();
    const timeoutMs = input.timeoutMs
      ?? input.runtimeDefaults?.timeoutMs
      ?? this.options.timeoutMs
      ?? DEFAULT_HEADLESS_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const lease = await this.createClientLease(input, controller.signal);
    let sessionId = input.sessionId;

    try {
      if (!sessionId) {
        sessionId = await this.createSession(lease.client, input);
      }
      if (!sessionId) {
        throw new Error('OpenCode runtime could not create or resolve a session id.');
      }

      if (input.systemPrompt) {
        await lease.client.session.prompt({
          path: { id: sessionId },
          body: {
            noReply: true,
            parts: [{ type: 'text', text: input.systemPrompt }],
          },
        });
      }

      const result = await abortable(
        lease.client.session.prompt({
          path: { id: sessionId },
          body: buildOpenCodePromptBody(input),
        }),
        controller.signal,
        `${input.purpose ?? 'opencode headless'} timeout after ${timeoutMs}ms`,
      );
      const text = extractOpenCodeText(result).trim();
      if (!text) {
        throw new Error(`${input.purpose ?? 'opencode headless'} returned empty result`);
      }
      return { text, sessionId };
    } catch (err) {
      if (controller.signal.aborted && sessionId) {
        await lease.client.session.abort?.({ path: { id: sessionId } }).catch(() => undefined);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      await lease.close?.();
    }
  }

  async runHandle(
    input: HeadlessRunInput,
    context: { runId: string; sessionId?: string; agentId?: string },
  ): Promise<OpenCodeRuntimeRunHandle> {
    const controller = new AbortController();
    const lease = await this.createClientLease(input, controller.signal);
    const sessionId = input.sessionId ?? context.sessionId ?? await this.createSession(lease.client, input);
    if (!sessionId) {
      await lease.close?.();
      throw new Error('OpenCode runtime handle could not create or resolve a session id.');
    }
    return new OpenCodeRuntimeRunHandle({
      input,
      client: lease.client,
      sessionId,
      runId: context.runId,
      agentId: context.agentId,
      abortController: controller,
      closeLease: lease.close,
    });
  }

  private async createSession(client: OpenCodeClientLike, input: HeadlessRunInput): Promise<string | undefined> {
    if (!client.session.create) return undefined;
    const title = input.purpose ? `AnthroClaw ${input.purpose}` : 'AnthroClaw headless';
    return extractOpenCodeSessionId(await client.session.create({
      body: {
        title,
      },
    }));
  }

  private async createClientLease(input: HeadlessRunInput, signal: AbortSignal): Promise<OpenCodeClientLease> {
    if (this.options.client) {
      return { client: this.options.client };
    }
    if (this.options.createClient) {
      return { client: await this.options.createClient(input, signal) };
    }
    if (this.options.createOpencode) {
      const instance = await this.options.createOpencode(input, signal);
      return {
        client: instance.client,
        close: instance.server?.close ? () => instance.server!.close!() : undefined,
      };
    }

    const sdk = await this.loadSdk();
    if (this.options.baseUrl && sdk.createOpencodeClient) {
      return {
        client: sdk.createOpencodeClient({
          baseUrl: this.options.baseUrl,
        }),
      };
    }
    if (!sdk.createOpencode) {
      throw new Error('OpenCode runtime could not find createOpencode().');
    }
    const configured = typeof this.options.createOptions === 'function'
      ? await this.options.createOptions(input)
      : (this.options.createOptions ?? {});
    const cwd = input.cwd ?? input.runtimeDefaults?.cwd ?? configured.cwd ?? process.cwd();
    const instance = await sdk.createOpencode({
      ...configured,
      cwd,
      signal,
      config: {
        ...(isRecord(configured.config) ? configured.config : {}),
        ...(input.model ?? input.runtimeDefaults?.model ? { model: input.model ?? input.runtimeDefaults?.model } : {}),
      },
    });
    return {
      client: instance.client,
      close: instance.server?.close ? () => instance.server!.close!() : undefined,
    };
  }

  private async loadSdk(): Promise<OpenCodeSdkModuleLike> {
    if (this.options.importOpenCodeSdk) {
      try {
        return await this.options.importOpenCodeSdk();
      } catch (err) {
        throw optionalPackageError(err);
      }
    }
    return importOpenCodeSdk();
  }
}

interface OpenCodeRuntimeRunHandleParams {
  input: HeadlessRunInput;
  client: OpenCodeClientLike;
  sessionId: string;
  runId: string;
  agentId?: string;
  abortController: AbortController;
  closeLease?: () => void | Promise<void>;
}

export class OpenCodeRuntimeRunHandle implements RuntimeRunHandle<RuntimeEvent> {
  private readonly queue = new OpenCodeEventQueue();
  private closed = false;
  readonly sessionId: string;

  constructor(private readonly params: OpenCodeRuntimeRunHandleParams) {
    this.sessionId = params.sessionId;
    this.start();
  }

  [Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    return this.queue[Symbol.asyncIterator]();
  }

  async interrupt(): Promise<void> {
    this.params.abortController.abort();
    await this.params.client.session.abort?.({ path: { id: this.params.sessionId } });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.params.abortController.abort();
    void this.params.closeLease?.();
  }

  async rewindFiles(
    userMessageId: string,
    options?: RuntimeRewindFilesOptions,
  ): Promise<RuntimeRewindFilesResult> {
    if (!this.params.client.session.revert) {
      return {
        canRewind: false,
        error: 'The active OpenCode client does not support session.revert().',
      };
    }
    if (options?.dryRun) {
      return {
        canRewind: true,
      };
    }
    await this.params.client.session.revert({
      path: { id: this.params.sessionId },
      body: { messageID: userMessageId },
    });
    return {
      canRewind: true,
    };
  }

  private start(): void {
    void (async () => {
      try {
        if (this.params.input.systemPrompt) {
          await this.params.client.session.prompt({
            path: { id: this.params.sessionId },
            body: {
              noReply: true,
              parts: [{ type: 'text', text: this.params.input.systemPrompt }],
            },
          });
        }
        const result = await this.params.client.session.prompt({
          path: { id: this.params.sessionId },
          body: buildOpenCodePromptBody(this.params.input),
        });
        const text = extractOpenCodeText(result).trim();
        if (text) {
          this.queue.push({
            type: 'text.delta',
            runtime: 'opencode',
            runId: this.params.runId,
            sessionId: this.params.sessionId,
            agentId: this.params.agentId,
            timestamp: Date.now(),
            text,
            source: 'message',
          });
        }
        this.queue.push({
          type: 'run.completed',
          runtime: 'opencode',
          runId: this.params.runId,
          sessionId: this.params.sessionId,
          agentId: this.params.agentId,
          timestamp: Date.now(),
        });
        this.queue.close();
      } catch (err) {
        this.queue.push({
          type: 'run.failed',
          runtime: 'opencode',
          runId: this.params.runId,
          sessionId: this.params.sessionId,
          agentId: this.params.agentId,
          timestamp: Date.now(),
          raw: {
            error: err instanceof Error ? err.message : String(err),
          },
        });
        this.queue.fail(err instanceof Error ? err : new Error(String(err)));
      } finally {
        this.close();
      }
    })();
  }
}

export function createOpenCodeHeadlessRuntime(options: OpenCodeHeadlessRuntimeOptions = {}): HeadlessRuntime {
  return new OpenCodeHeadlessRuntime(options);
}

function buildOpenCodePromptBody(input: HeadlessRunInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    parts: [{ type: 'text', text: input.prompt }],
  };
  const model = parseOpenCodeModel(input.model ?? input.runtimeDefaults?.model);
  if (model) body.model = model;
  return body;
}

function parseOpenCodeModel(modelId: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!modelId) return undefined;
  const slashIndex = modelId.indexOf('/');
  const colonIndex = modelId.indexOf(':');
  const separatorIndex = slashIndex >= 0 ? slashIndex : colonIndex;
  if (separatorIndex <= 0 || separatorIndex >= modelId.length - 1) return undefined;
  return {
    providerID: modelId.slice(0, separatorIndex),
    modelID: modelId.slice(separatorIndex + 1),
  };
}

function extractOpenCodeSessionId(value: unknown): string | undefined {
  const data = unwrapData(value);
  if (!isRecord(data)) return undefined;
  if (typeof data.id === 'string') return data.id;
  if (typeof data.sessionID === 'string') return data.sessionID;
  if (isRecord(data.info)) {
    if (typeof data.info.sessionID === 'string') return data.info.sessionID;
    if (typeof data.info.id === 'string') return data.info.id;
  }
  return undefined;
}

function extractOpenCodeText(value: unknown): string {
  const data = unwrapData(value);
  if (!isRecord(data)) return '';
  const result = data as OpenCodeMessageResultLike;
  if (result.info?.error?.message) {
    throw new Error(`OpenCode message error: ${result.info.error.message}`);
  }
  if (!Array.isArray(result.parts)) return '';
  return result.parts
    .map((part) => {
      if (part.type === 'text' && typeof part.text === 'string') return part.text;
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      return '';
    })
    .filter(Boolean)
    .join('');
}

function unwrapData(value: unknown): unknown {
  if (isRecord(value) && 'data' in value) return value.data;
  return value;
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal, message: string): Promise<T> {
  if (signal.aborted) throw new Error(message);
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error(message)), { once: true });
    }),
  ]);
}

async function importOpenCodeSdk(): Promise<OpenCodeSdkModuleLike> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
  try {
    return await dynamicImport(OPENCODE_PACKAGE_NAME) as OpenCodeSdkModuleLike;
  } catch (err) {
    throw optionalPackageError(err);
  }
}

function optionalPackageError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`OpenCode runtime requires optional package ${OPENCODE_PACKAGE_NAME}. Install it for the experimental OpenCode benchmark. Original error: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

class OpenCodeEventQueue implements AsyncIterable<RuntimeEvent> {
  private readonly values: RuntimeEvent[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<RuntimeEvent>) => void;
    reject: (err: Error) => void;
  }> = [];
  private done = false;
  private error: Error | undefined;

  push(event: RuntimeEvent): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: event });
      return;
    }
    this.values.push(event);
  }

  fail(error: Error): void {
    if (this.done) return;
    this.error = error;
    this.done = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error);
    }
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    return {
      next: () => this.next(),
    };
  }

  private next(): Promise<IteratorResult<RuntimeEvent>> {
    if (this.values.length > 0) {
      return Promise.resolve({ done: false, value: this.values.shift()! });
    }
    if (this.error) {
      return Promise.reject(this.error);
    }
    if (this.done) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}
