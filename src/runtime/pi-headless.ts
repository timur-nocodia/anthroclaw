import {
  DEFAULT_HEADLESS_TIMEOUT_MS,
  type HeadlessRunInput,
  type HeadlessRunResult,
  type HeadlessRuntime,
} from './headless.js';

const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';

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

export type PiHeadlessToolPolicy =
  | { mode: 'deny' }
  | { mode: 'allow-list'; tools: string[] };

export interface PiHeadlessRuntimeOptions {
  createAgentSession?: PiCreateAgentSession;
  importPiCodingAgent?: PiSdkLoader;
  createOptions?: Record<string, unknown> | ((input: HeadlessRunInput) => Record<string, unknown> | Promise<Record<string, unknown>>);
  modelRegistry?: PiModelRegistryProvider;
  resolveModel?: (modelId: string, sdk: PiCodingAgentSdkModule) => unknown | Promise<unknown>;
  toolPolicy?: PiHeadlessToolPolicy | ((input: HeadlessRunInput) => PiHeadlessToolPolicy | Promise<PiHeadlessToolPolicy>);
  timeoutMs?: number;
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

  private async loadSdk(): Promise<PiCodingAgentSdkModule> {
    if (this.options.createAgentSession) return {};
    if (this.options.importPiCodingAgent) {
      try {
        return await this.options.importPiCodingAgent();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Pi headless runtime requires optional package ${PI_PACKAGE_NAME}. Install it for the experimental Pi spike. Original error: ${message}`);
      }
    }
    return importPiCodingAgent();
  }

  private async buildCreateOptions(input: HeadlessRunInput, sdk: PiCodingAgentSdkModule): Promise<Record<string, unknown>> {
    const configured = typeof this.options.createOptions === 'function'
      ? await this.options.createOptions(input)
      : (this.options.createOptions ?? {});
    const options: Record<string, unknown> = {
      ...configured,
      cwd: input.cwd ?? input.runtimeDefaults?.cwd ?? configured.cwd ?? process.cwd(),
      ...(await this.buildToolOptions(input)),
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
    if (!this.options.modelRegistry) return undefined;
    return typeof this.options.modelRegistry === 'function'
      ? await this.options.modelRegistry(input, sdk)
      : this.options.modelRegistry;
  }

  private async buildToolOptions(input: HeadlessRunInput): Promise<Record<string, unknown>> {
    const policy = typeof this.options.toolPolicy === 'function'
      ? await this.options.toolPolicy(input)
      : (this.options.toolPolicy ?? { mode: 'deny' });

    if (policy.mode === 'deny') {
      return {
        noTools: 'all',
        tools: [],
      };
    }

    return {
      tools: normalizePiToolNames(policy.tools),
    };
  }
}

export function createPiHeadlessRuntime(options: PiHeadlessRuntimeOptions = {}): HeadlessRuntime {
  return new PiHeadlessRuntime(options);
}

export function parsePiModelRef(modelId: string): PiModelRef {
  const trimmed = modelId.trim();
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
    const compact = tool.trim();
    const builtin = PI_TOOL_NAME_ALIASES[compact] ?? PI_TOOL_NAME_ALIASES[compact.toLowerCase()];
    return builtin ?? compact;
  }).filter((tool) => tool.length > 0);

  return Array.from(new Set(normalized));
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
