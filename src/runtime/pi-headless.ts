import {
  DEFAULT_HEADLESS_TIMEOUT_MS,
  type HeadlessCanUseTool,
  type HeadlessCustomTool,
  type HeadlessCustomToolContent,
  type HeadlessCustomToolResult,
  type HeadlessRunInput,
  type HeadlessRunResult,
  type HeadlessRuntime,
  type HeadlessToolCall,
  type HeadlessToolDecision,
  type HeadlessToolPolicy,
} from './headless.js';
import { normalizePiRuntimeEvents } from './pi-events.js';
import type { RuntimeEvent } from './events.js';
import type {
  RuntimeRewindFilesOptions,
  RuntimeRewindFilesResult,
  RuntimeRunHandle,
} from './types.js';
import {
  captureWorkspaceSnapshot,
  rewindWorkspaceSnapshot,
  type WorkspaceSnapshot,
  type WorkspaceSnapshotOptions,
} from './workspace-snapshot.js';

const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';
export const DEFAULT_PI_MODEL_ID = 'anthropic/claude-sonnet-4-6';

export interface PiAgentSessionLike {
  id?: string;
  sessionId?: string;
  prompt(text: string, options?: unknown): Promise<void>;
  subscribe(listener: (event: unknown) => void): () => void;
  abort?(): Promise<void>;
  dispose?(): void;
}

export interface PiCreateAgentSessionResult {
  session: PiAgentSessionLike;
  id?: string;
  sessionId?: string;
}

export type PiCreateAgentSession = (options?: Record<string, unknown>) => Promise<PiCreateAgentSessionResult>;

export interface PiCodingAgentSdkModule {
  createAgentSession?: PiCreateAgentSession;
  defineTool?: (definition: PiCustomToolDefinition) => unknown;
  AuthStorage?: {
    create: (authPath?: string) => unknown;
  };
  ModelRegistry?: {
    create: (authStorage: unknown, modelsPath?: string) => PiModelRegistryLike;
  };
  DefaultResourceLoader?: new (options: Record<string, unknown>) => PiResourceLoaderLike;
  getAgentDir?: () => string;
}

export interface PiCustomToolDefinition {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (toolCallId: unknown, params: unknown) => Promise<Record<string, unknown>>;
}

export type PiSdkLoader = () => Promise<PiCodingAgentSdkModule>;

export interface PiModelRegistryLike {
  find(provider: string, modelId: string): unknown | undefined;
}

export interface PiModelRef {
  provider: string;
  modelId: string;
}

export type PiModelRegistryProvider =
  | PiModelRegistryLike
  | ((input: HeadlessRunInput, sdk: PiCodingAgentSdkModule) => PiModelRegistryLike | Promise<PiModelRegistryLike>);

export type PiHeadlessToolCall = HeadlessToolCall;
export type PiHeadlessToolDecision = HeadlessToolDecision;
export type PiHeadlessCanUseTool = HeadlessCanUseTool;
export type PiHeadlessToolPolicy = HeadlessToolPolicy;

export interface PiToolCallEventLike {
  toolName?: unknown;
  toolCallId?: unknown;
  input?: unknown;
}

export type PiToolCallEventResultLike = { block?: boolean; reason?: string } | undefined;

export interface PiExtensionApiLike {
  on(
    event: 'tool_call',
    handler: (event: PiToolCallEventLike, context: unknown) => PiToolCallEventResultLike | Promise<PiToolCallEventResultLike>,
  ): void;
}

export type PiExtensionFactoryLike = (pi: PiExtensionApiLike) => void | Promise<void>;

export interface PiLoadExtensionsResultLike {
  extensions: unknown[];
  errors: unknown[];
  runtime?: unknown;
  [key: string]: unknown;
}

export interface PiResourceLoaderLike {
  getExtensions(): PiLoadExtensionsResultLike;
  reload?(): Promise<void>;
  getSystemPrompt?(): string | Promise<string>;
}

export interface PiHeadlessRuntimeOptions {
  createAgentSession?: PiCreateAgentSession;
  importPiCodingAgent?: PiSdkLoader;
  createOptions?: Record<string, unknown> | ((input: HeadlessRunInput) => Record<string, unknown> | Promise<Record<string, unknown>>);
  authStoragePath?: string;
  modelsPath?: string;
  modelRegistry?: PiModelRegistryProvider;
  resolveModel?: (modelId: string, sdk: PiCodingAgentSdkModule) => unknown | Promise<unknown>;
  toolPolicy?: PiHeadlessToolPolicy | ((input: HeadlessRunInput) => PiHeadlessToolPolicy | Promise<PiHeadlessToolPolicy>);
  timeoutMs?: number;
  workspaceRewind?: false | WorkspaceSnapshotOptions;
}

export interface PiRuntimeRunHandleContext {
  runId: string;
  sessionId?: string;
  agentId?: string;
}

export class PiHeadlessRuntime implements HeadlessRuntime {
  readonly id = 'pi';

  constructor(private readonly options: PiHeadlessRuntimeOptions = {}) {}

  async runText(input: HeadlessRunInput): Promise<string> {
    return (await this.run(input)).text;
  }

  async run(input: HeadlessRunInput): Promise<HeadlessRunResult> {
    const timeoutMs = input.timeoutMs
      ?? input.runtimeDefaults?.timeoutMs
      ?? this.options.timeoutMs
      ?? DEFAULT_HEADLESS_TIMEOUT_MS;
    const sdk = await this.loadSdk();
    const createAgentSession = this.options.createAgentSession ?? sdk.createAgentSession;
    if (!createAgentSession) {
      throw new Error('Pi headless runtime could not find createAgentSession().');
    }

    const sessionOptions = await this.buildCreateOptions(input, sdk);
    const sessionResult = await createAgentSession(sessionOptions);
    const { session } = sessionResult;
    const chunks: string[] = [];
    let eventError: Error | undefined;

    const unsubscribe = session.subscribe((event) => {
      try {
        const extracted = extractPiTextDelta(event);
        if (extracted) chunks.push(extracted);
        const error = extractPiError(event);
        if (error) eventError = error;
      } catch (err) {
        eventError = err instanceof Error ? err : new Error(String(err));
      }
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void session.abort?.().catch(() => undefined);
        reject(new Error(`${input.purpose ?? 'pi headless'} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      await Promise.race([
        session.prompt(input.prompt).then(() => {
          if (eventError) throw eventError;
        }),
        timeoutPromise,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      unsubscribe();
      session.dispose?.();
    }

    const result = chunks.join('').trim();
    if (!result) {
      throw new Error(`${input.purpose ?? 'pi headless'} returned empty result`);
    }
    return {
      text: result,
      sessionId: extractPiSessionId(sessionResult),
    };
  }

  async runHandle(
    input: HeadlessRunInput,
    context: PiRuntimeRunHandleContext,
  ): Promise<PiRuntimeRunHandle> {
    const timeoutMs = input.timeoutMs
      ?? input.runtimeDefaults?.timeoutMs
      ?? this.options.timeoutMs
      ?? DEFAULT_HEADLESS_TIMEOUT_MS;
    const sdk = await this.loadSdk();
    const createAgentSession = this.options.createAgentSession ?? sdk.createAgentSession;
    if (!createAgentSession) {
      throw new Error('Pi runtime handle could not find createAgentSession().');
    }

    const sessionOptions = await this.buildCreateOptions(input, sdk);
    const sessionResult = await createAgentSession(sessionOptions);
    const rewindSnapshot = await this.captureRewindSnapshot(input);
    return new PiRuntimeRunHandle({
      input,
      session: sessionResult.session,
      sessionId: extractPiSessionId(sessionResult) ?? context.sessionId,
      runId: context.runId,
      agentId: context.agentId,
      timeoutMs,
      rewindSnapshot,
    });
  }

  private async captureRewindSnapshot(input: HeadlessRunInput): Promise<WorkspaceSnapshot | undefined> {
    if (this.options.workspaceRewind === false) return undefined;
    const cwd = input.cwd ?? input.runtimeDefaults?.cwd;
    if (!cwd) return undefined;
    return captureWorkspaceSnapshot(cwd, this.options.workspaceRewind);
  }

  private async loadSdk(): Promise<PiCodingAgentSdkModule> {
    if (this.options.importPiCodingAgent) {
      try {
        return await this.options.importPiCodingAgent();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Pi headless runtime requires optional package ${PI_PACKAGE_NAME}. Install it for the experimental Pi spike. Original error: ${message}`);
      }
    }
    if (this.options.createAgentSession) return {};
    return importPiCodingAgent();
  }

  private async buildCreateOptions(input: HeadlessRunInput, sdk: PiCodingAgentSdkModule): Promise<Record<string, unknown>> {
    const configured = typeof this.options.createOptions === 'function'
      ? await this.options.createOptions(input)
      : (this.options.createOptions ?? {});
    const cwd = input.cwd ?? input.runtimeDefaults?.cwd ?? configured.cwd ?? process.cwd();
    const options: Record<string, unknown> = {
      ...configured,
      cwd,
      ...(await this.buildToolOptions(input, sdk, configured, String(cwd))),
    };
    const sessionId = input.sessionId ?? configured.sessionId;
    if (typeof sessionId === 'string' && sessionId) {
      options.sessionId = sessionId;
    }

    const modelId = input.model ?? input.runtimeDefaults?.model;
    if (modelId && this.options.resolveModel) {
      options.model = await this.options.resolveModel(modelId, sdk);
    } else if (modelId) {
      const registry = await this.resolveModelRegistry(input, sdk, configured);
      if (registry) {
        options.modelRegistry = registry;
        options.model = resolvePiModelFromRegistry(modelId, registry);
      }
    }

    return options;
  }

  private async resolveModelRegistry(
    input: HeadlessRunInput,
    sdk: PiCodingAgentSdkModule,
    configured: Record<string, unknown>,
  ): Promise<PiModelRegistryLike | undefined> {
    if (isPiModelRegistry(configured.modelRegistry)) return configured.modelRegistry;
    if (this.options.modelRegistry) {
      return typeof this.options.modelRegistry === 'function'
        ? await this.options.modelRegistry(input, sdk)
        : this.options.modelRegistry;
    }
    if (sdk.AuthStorage?.create && sdk.ModelRegistry?.create) {
      return sdk.ModelRegistry.create(
        sdk.AuthStorage.create(this.options.authStoragePath),
        this.options.modelsPath,
      );
    }
    return undefined;
  }

  private async buildToolOptions(
    input: HeadlessRunInput,
    sdk: PiCodingAgentSdkModule,
    configured: Record<string, unknown>,
    cwd: string,
  ): Promise<Record<string, unknown>> {
    const policy = input.toolPolicy ?? (typeof this.options.toolPolicy === 'function'
      ? await this.options.toolPolicy(input)
      : (this.options.toolPolicy ?? { mode: 'deny' }));

    if (policy.mode === 'deny') {
      const toolOptions: Record<string, unknown> = {
        noTools: 'all',
        tools: [],
      };
      if (input.systemPrompt) {
        toolOptions.resourceLoader = await buildPiRuntimeResourceLoader({
          input,
          sdk,
          configured,
          cwd,
        });
      }
      return toolOptions;
    }

    const customTools = buildPiCustomTools(input, policy, sdk);
    const toolOptions: Record<string, unknown> = {
      tools: normalizePiToolNames([
        ...policy.tools,
        ...customToolNames(input.customTools),
      ]),
    };
    if (customTools.length > 0) {
      toolOptions.customTools = customTools;
    }

    if (policy.canUseTool || input.systemPrompt) {
      toolOptions.resourceLoader = await buildPiRuntimeResourceLoader({
        input,
        policy,
        sdk,
        configured,
        cwd,
      });
    }

    return toolOptions;
  }
}

export function createPiHeadlessRuntime(options: PiHeadlessRuntimeOptions = {}): HeadlessRuntime {
  return new PiHeadlessRuntime(options);
}

interface PiRuntimeRunHandleParams {
  input: HeadlessRunInput;
  session: PiAgentSessionLike;
  sessionId?: string;
  runId: string;
  agentId?: string;
  timeoutMs: number;
  rewindSnapshot?: WorkspaceSnapshot;
}

export class PiRuntimeRunHandle implements RuntimeRunHandle<RuntimeEvent> {
  private readonly queue = new RuntimeEventQueue();
  private readonly unsubscribe: () => void;
  private readonly promptPromise: Promise<void>;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  readonly sessionId?: string;

  constructor(private readonly params: PiRuntimeRunHandleParams) {
    this.sessionId = params.sessionId;
    this.unsubscribe = params.session.subscribe((event) => {
      try {
        this.queue.pushMany(normalizePiRuntimeEvents(event, {
          runId: params.runId,
          sessionId: params.sessionId,
          agentId: params.agentId,
        }));
      } catch (err) {
        this.queue.fail(err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.timer = setTimeout(() => {
      void this.interrupt().catch(() => undefined);
      this.queue.fail(new Error(`${params.input.purpose ?? 'pi runtime'} timeout after ${params.timeoutMs}ms`));
      this.close();
    }, params.timeoutMs);

    this.promptPromise = params.session.prompt(params.input.prompt)
      .then(() => this.queue.close())
      .catch((err) => this.queue.fail(err instanceof Error ? err : new Error(String(err))))
      .finally(() => this.close());
  }

  [Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    return this.queue[Symbol.asyncIterator]();
  }

  async interrupt(): Promise<void> {
    await this.params.session.abort?.();
  }

  async rewindFiles(
    _userMessageId: string,
    options?: RuntimeRewindFilesOptions,
  ): Promise<RuntimeRewindFilesResult> {
    return rewindWorkspaceSnapshot(this.params.rewindSnapshot, options);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.unsubscribe();
    this.params.session.dispose?.();
  }

  completion(): Promise<void> {
    return this.promptPromise;
  }
}

class RuntimeEventQueue implements AsyncIterable<RuntimeEvent> {
  private readonly values: RuntimeEvent[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<RuntimeEvent>) => void;
    reject: (err: Error) => void;
  }> = [];
  private done = false;
  private error: Error | undefined;

  pushMany(events: RuntimeEvent[]): void {
    for (const event of events) {
      this.push(event);
    }
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

  private push(event: RuntimeEvent): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: event });
      return;
    }
    this.values.push(event);
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

export function parsePiModelRef(modelId: string): PiModelRef {
  const trimmed = normalizePiModelId(modelId);
  const slashIndex = trimmed.indexOf('/');
  const colonIndex = trimmed.indexOf(':');
  const separatorIndex = slashIndex >= 0
    ? slashIndex
    : colonIndex;

  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    throw new Error(`Pi model id must be formatted as provider/model or provider:model: ${modelId}`);
  }

  return {
    provider: trimmed.slice(0, separatorIndex),
    modelId: trimmed.slice(separatorIndex + 1),
  };
}

export function normalizePiModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (trimmed.includes('/') || trimmed.includes(':')) return trimmed;
  if (trimmed.startsWith('claude-')) return `anthropic/${trimmed}`;
  return trimmed;
}

export function resolvePiModelFromRegistry(modelId: string, registry: PiModelRegistryLike): unknown {
  const ref = parsePiModelRef(modelId);
  const model = registry.find(ref.provider, ref.modelId);
  if (!model) {
    throw new Error(`Pi model registry could not find model ${ref.provider}/${ref.modelId}`);
  }
  return model;
}

export function normalizePiToolNames(tools: string[]): string[] {
  const normalized = tools.map((tool) => {
    return normalizePiToolName(tool);
  }).filter((tool) => tool.length > 0);

  return Array.from(new Set(normalized));
}

export function createPiToolPolicyExtension(
  input: HeadlessRunInput,
  policy: PiHeadlessToolPolicy,
): PiExtensionFactoryLike {
  return (pi) => {
    pi.on('tool_call', async (event) => evaluatePiToolCallPolicy(input, policy, event));
  };
}

export async function evaluatePiToolCallPolicy(
  input: HeadlessRunInput,
  policy: PiHeadlessToolPolicy,
  event: PiToolCallEventLike,
): Promise<PiToolCallEventResultLike> {
  if (policy.mode === 'deny') {
    return {
      block: true,
      reason: input.toolDenyMessage ?? `Tools disabled for ${input.purpose ?? 'pi headless'}.`,
    };
  }

  const originalToolName = typeof event.toolName === 'string' ? event.toolName : '';
  const toolName = normalizePiToolName(originalToolName);
  const allowedTools = new Set(normalizePiToolNames([
    ...policy.tools,
    ...customToolNames(input.customTools),
  ]));
  if (!toolName || !allowedTools.has(toolName)) {
    return {
      block: true,
      reason: policy.denyMessage
        ?? input.toolDenyMessage
        ?? `Tool ${originalToolName || '<unknown>'} is not enabled for ${input.purpose ?? 'pi headless'}.`,
    };
  }

  const cacheKey = piToolPolicyCacheKey(event);
  if (cacheKey) {
    const cached = getPiToolPolicyCache(input);
    if (cached.has(cacheKey)) {
      return cached.get(cacheKey);
    }
  }

  if (!policy.canUseTool) return undefined;

  const decision = await policy.canUseTool({
    toolName,
    originalToolName,
    toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : undefined,
    input: isRecord(event.input) ? event.input : {},
  }, input);
  const normalizedDecision = normalizePiToolDecision(decision);

  if (normalizedDecision.allowed) {
    if (cacheKey) getPiToolPolicyCache(input).set(cacheKey, undefined);
    return undefined;
  }

  const result = {
    block: true,
    reason: normalizedDecision.reason
      ?? policy.denyMessage
      ?? input.toolDenyMessage
      ?? `Tool ${toolName} was denied by AnthroClaw policy.`,
  };
  if (cacheKey) getPiToolPolicyCache(input).set(cacheKey, result);
  return result;
}

function extractPiTextDelta(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;

  if (event.type === 'message_update' && isRecord(event.assistantMessageEvent)) {
    const assistantEvent = event.assistantMessageEvent;
    if (assistantEvent.type === 'text_delta' && typeof assistantEvent.delta === 'string') {
      return assistantEvent.delta;
    }
    if (assistantEvent.type === 'text' && typeof assistantEvent.text === 'string') {
      return assistantEvent.text;
    }
  }

  if (event.type === 'assistant_text_delta' && typeof event.delta === 'string') {
    return event.delta;
  }

  return undefined;
}

function extractPiError(event: unknown): Error | undefined {
  if (!isRecord(event)) return undefined;
  if (event.type === 'error') {
    return new Error(typeof event.message === 'string' ? event.message : 'Pi headless runtime error');
  }
  if (event.type === 'message_update' && isRecord(event.assistantMessageEvent)) {
    const assistantEvent = event.assistantMessageEvent;
    if (assistantEvent.type === 'error') {
      return new Error(typeof assistantEvent.message === 'string' ? assistantEvent.message : 'Pi assistant runtime error');
    }
  }
  return undefined;
}

function extractPiSessionId(result: PiCreateAgentSessionResult): string | undefined {
  if (typeof result.sessionId === 'string' && result.sessionId) return result.sessionId;
  if (typeof result.id === 'string' && result.id) return result.id;
  if (typeof result.session.sessionId === 'string' && result.session.sessionId) {
    return result.session.sessionId;
  }
  if (typeof result.session.id === 'string' && result.session.id) return result.session.id;
  return undefined;
}

async function importPiCodingAgent(): Promise<PiCodingAgentSdkModule> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
  try {
    return await dynamicImport(PI_PACKAGE_NAME) as PiCodingAgentSdkModule;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Pi headless runtime requires optional package ${PI_PACKAGE_NAME}. Install it for the experimental Pi spike. Original error: ${message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPiModelRegistry(value: unknown): value is PiModelRegistryLike {
  return isRecord(value) && typeof value.find === 'function';
}

const PI_TOOL_NAME_ALIASES: Record<string, string> = {
  Bash: 'bash',
  bash: 'bash',
  Read: 'read',
  read: 'read',
  Edit: 'edit',
  edit: 'edit',
  Write: 'write',
  write: 'write',
  Grep: 'grep',
  grep: 'grep',
  Glob: 'find',
  glob: 'find',
  Find: 'find',
  find: 'find',
  LS: 'ls',
  Ls: 'ls',
  ls: 'ls',
};

const PI_TOOL_POLICY_EXTENSION_PATH = '<anthroclaw:pi-tool-policy>';

interface BuildPiToolPolicyResourceLoaderParams {
  input: HeadlessRunInput;
  policy?: Extract<PiHeadlessToolPolicy, { mode: 'allow-list' }>;
  sdk: PiCodingAgentSdkModule;
  configured: Record<string, unknown>;
  cwd: string;
}

async function buildPiRuntimeResourceLoader(params: BuildPiToolPolicyResourceLoaderParams): Promise<PiResourceLoaderLike> {
  const configuredResourceLoader = params.configured.resourceLoader;
  if (isPiResourceLoader(configuredResourceLoader)) {
    if (params.input.systemPrompt) {
      throw new Error('Pi headless runtime cannot apply systemPrompt override to a preconfigured resourceLoader.');
    }
    if (!params.policy?.canUseTool) return configuredResourceLoader;
    return wrapPiResourceLoaderWithPolicyExtension(configuredResourceLoader, params.input, params.policy);
  }

  const ResourceLoader = params.sdk.DefaultResourceLoader;
  if (typeof ResourceLoader !== 'function') {
    throw new Error('Pi headless runtime needs Pi DefaultResourceLoader or createOptions.resourceLoader to install tool denial feedback.');
  }

  const agentDir = typeof params.configured.agentDir === 'string'
    ? params.configured.agentDir
    : params.sdk.getAgentDir?.();
  if (!agentDir) {
    throw new Error('Pi headless runtime needs agentDir or Pi getAgentDir() to install tool denial feedback.');
  }

  const resourceLoader = new ResourceLoader({
    cwd: params.cwd,
    agentDir,
    settingsManager: params.configured.settingsManager,
    ...(params.input.systemPrompt
      ? { systemPromptOverride: () => params.input.systemPrompt }
      : {}),
    ...(params.policy?.canUseTool
      ? { extensionFactories: [createPiToolPolicyExtension(params.input, params.policy)] }
      : {}),
  });
  await resourceLoader.reload?.();
  return resourceLoader;
}

function wrapPiResourceLoaderWithPolicyExtension(
  resourceLoader: PiResourceLoaderLike,
  input: HeadlessRunInput,
  policy: Extract<PiHeadlessToolPolicy, { mode: 'allow-list' }>,
): PiResourceLoaderLike {
  return new Proxy(resourceLoader, {
    get(target, prop, receiver) {
      if (prop === 'getExtensions') {
        return () => appendPiLoadedPolicyExtension(target.getExtensions(), input, policy);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function appendPiLoadedPolicyExtension(
  base: PiLoadExtensionsResultLike,
  input: HeadlessRunInput,
  policy: Extract<PiHeadlessToolPolicy, { mode: 'allow-list' }>,
): PiLoadExtensionsResultLike {
  return {
    ...base,
    extensions: [
      ...base.extensions,
      createPiLoadedToolPolicyExtension(input, policy),
    ],
  };
}

function createPiLoadedToolPolicyExtension(input: HeadlessRunInput, policy: Extract<PiHeadlessToolPolicy, { mode: 'allow-list' }>): Record<string, unknown> {
  return {
    path: PI_TOOL_POLICY_EXTENSION_PATH,
    resolvedPath: PI_TOOL_POLICY_EXTENSION_PATH,
    sourceInfo: {
      path: PI_TOOL_POLICY_EXTENSION_PATH,
      source: 'AnthroClaw',
      scope: 'temporary',
      origin: 'top-level',
    },
    handlers: new Map<string, unknown[]>([
      ['tool_call', [
        async (event: PiToolCallEventLike) => evaluatePiToolCallPolicy(input, policy, event),
      ]],
    ]),
    tools: new Map(),
    messageRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  };
}

function isPiResourceLoader(value: unknown): value is PiResourceLoaderLike {
  return isRecord(value) && typeof value.getExtensions === 'function';
}

function normalizePiToolDecision(decision: PiHeadlessToolDecision): { allowed: boolean; reason?: string } {
  if (decision === undefined) return { allowed: true };
  if (typeof decision === 'boolean') return { allowed: decision };
  if ('behavior' in decision) {
    return {
      allowed: decision.behavior === 'allow',
      reason: decision.reason ?? decision.message,
    };
  }
  return {
    allowed: decision.allow,
    reason: decision.reason ?? decision.message,
  };
}

function normalizePiToolName(tool: string): string {
  const compact = tool.trim();
  const builtin = PI_TOOL_NAME_ALIASES[compact] ?? PI_TOOL_NAME_ALIASES[compact.toLowerCase()];
  return builtin ?? compact;
}

function buildPiCustomTools(
  input: HeadlessRunInput,
  policy: Extract<PiHeadlessToolPolicy, { mode: 'allow-list' }>,
  sdk: PiCodingAgentSdkModule,
): unknown[] {
  return (input.customTools ?? []).map((tool) => {
    const definition: PiCustomToolDefinition = {
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      execute: async (toolCallId: unknown, params: unknown) => {
        const args = isRecord(params) ? params : {};
        const denial = await evaluatePiToolCallPolicy(input, policy, {
          toolName: tool.name,
          toolCallId: typeof toolCallId === 'string' ? toolCallId : undefined,
          input: args,
        });
        if (denial?.block) {
          return piToolDeniedResult(denial.reason ?? `Tool ${tool.name} was denied.`);
        }
        return headlessCustomToolResultToPiResult(await tool.handler(args));
      },
    };

    return typeof sdk.defineTool === 'function'
      ? sdk.defineTool(definition)
      : definition;
  });
}

function headlessCustomToolResultToPiResult(result: HeadlessCustomToolResult): Record<string, unknown> {
  return {
    content: normalizePiToolResultContent(result.content),
    details: {
      ...(result.details ?? {}),
      ...(result.isError ? { isError: true } : {}),
    },
  };
}

function piToolDeniedResult(reason: string): Record<string, unknown> {
  return {
    content: [{ type: 'text', text: reason }],
    details: {
      isError: true,
      denied: true,
    },
  };
}

function normalizePiToolResultContent(content: HeadlessCustomToolContent[]): HeadlessCustomToolContent[] {
  if (content.length === 0) {
    return [{ type: 'text', text: '' }];
  }
  return content.map((entry) => ({
    ...entry,
    type: typeof entry.type === 'string' && entry.type ? entry.type : 'text',
    ...(typeof entry.text === 'string' ? { text: entry.text } : {}),
  }));
}

function customToolNames(tools: HeadlessCustomTool[] | undefined): string[] {
  return (tools ?? []).map((tool) => tool.name);
}

const piToolPolicyDecisionCache = new WeakMap<HeadlessRunInput, Map<string, PiToolCallEventResultLike>>();

function getPiToolPolicyCache(input: HeadlessRunInput): Map<string, PiToolCallEventResultLike> {
  let cache = piToolPolicyDecisionCache.get(input);
  if (!cache) {
    cache = new Map();
    piToolPolicyDecisionCache.set(input, cache);
  }
  return cache;
}

function piToolPolicyCacheKey(event: PiToolCallEventLike): string | undefined {
  if (typeof event.toolCallId === 'string' && event.toolCallId) {
    return `id:${event.toolCallId}`;
  }
  if (typeof event.toolName !== 'string' || !event.toolName) return undefined;
  try {
    return `shape:${event.toolName}:${JSON.stringify(event.input ?? {})}`;
  } catch {
    return undefined;
  }
}
