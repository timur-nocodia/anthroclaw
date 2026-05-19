import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { getOverlayPath, deepDiffOverlay, deepMergeOverlay, loadGlobalConfigWithOverlay, readBaseConfigRaw, readRuntimeOverlay, writeRuntimeOverlay } from '@backend/config/overlay.js';
import { GlobalConfigSchema } from '@backend/config/schema.js';
import { DEFAULT_PI_MODEL_ID, PI_PACKAGE_NAME, parsePiModelRef } from '@backend/runtime/pi-headless.js';
import { runHeadlessReviewResult } from '@backend/sdk/headless-review.js';
import { headlessRuntimeOptionsFromConfig } from '@backend/sdk/headless-runtime-config.js';
import { modelOption, STATIC_RUNTIME_MODEL_OPTIONS, type RuntimeModelOption } from '@/lib/runtime-models';

export type RuntimeProvider = 'claude-agent-sdk' | 'pi' | 'opencode';

export interface RuntimeProviderAccount {
  id: string;
  label: string;
  configured: boolean;
  authSource: string | null;
  authLabel: string | null;
  modelCount: number;
  availableModelCount: number;
  defaultForInstance: boolean;
  supportsApiKey: boolean;
}

export interface RuntimeProvidersResponse {
  status: 'ok';
  runtimeMode: RuntimeProvider;
  defaultModel: string;
  pi: {
    packageName: string;
    packageAvailable: boolean;
    packageVersion: string | null;
    authPath: string;
    modelsPath: string;
    authConfigured: boolean;
    availableModelCount: number;
    modelCount: number;
    providers: RuntimeProviderAccount[];
    models: RuntimeModelOption[];
    lastError: string | null;
  };
  legacy: {
    visible: boolean;
    primary: boolean;
  };
}

export interface RuntimeConfigPatch {
  runtimeMode?: RuntimeProvider;
  defaultModel?: string;
  piAuthPath?: string | null;
  piModelsPath?: string | null;
}

interface PiSdkModule {
  VERSION?: string;
  getAgentDir?: () => string;
  AuthStorage: {
    create: (authPath?: string) => PiAuthStorageLike;
  };
  ModelRegistry: {
    create: (authStorage: PiAuthStorageLike, modelsPath?: string) => PiModelRegistryLike;
  };
}

interface PiAuthStorageLike {
  set(provider: string, credential: { type: 'api_key'; key: string }): void;
  remove(provider: string): void;
  list(): string[];
  hasAuth(provider: string): boolean;
  getAuthStatus?(provider: string): PiAuthStatusLike;
}

interface PiAuthStatusLike {
  configured?: boolean;
  source?: string;
  label?: string;
}

interface PiModelRegistryLike {
  getAll(): PiModelLike[];
  getAvailable(): PiModelLike[] | Promise<PiModelLike[]>;
  find(provider: string, modelId: string): PiModelLike | undefined;
  hasConfiguredAuth(model: PiModelLike): boolean | Promise<boolean>;
  getProviderAuthStatus?(provider: string): PiAuthStatusLike;
  getProviderDisplayName?(provider: string): string;
}

interface PiModelLike {
  provider?: unknown;
  id?: unknown;
  name?: unknown;
}

const CONFIG_PATH = process.env.OC_CONFIG
  ? resolve(process.env.OC_CONFIG)
  : resolve(process.cwd(), '..', 'config.yml');
const DATA_DIR = process.env.OC_DATA_DIR
  ? resolve(process.env.OC_DATA_DIR)
  : resolve(process.cwd(), '..', 'data');
const OVERLAY_PATH = getOverlayPath(DATA_DIR);

const COMMON_PI_PROVIDERS = [
  'anthropic',
  'openai',
  'openrouter',
  'google',
  'gemini',
  'xai',
  'groq',
  'mistral',
];

export async function getRuntimeProviders(): Promise<RuntimeProvidersResponse> {
  const config = loadGlobalConfigWithOverlay(CONFIG_PATH, OVERLAY_PATH);
  const runtimeMode = normalizeProvider(config.runtime.headless.provider);
  const defaultModel = config.defaults.model || DEFAULT_PI_MODEL_ID;
  const piConfig = config.runtime.headless.pi;

  try {
    const sdk = await loadPiSdk();
    const authPath = piConfig?.auth_path ?? defaultPiAuthPath(sdk);
    const modelsPath = piConfig?.models_path ?? defaultPiModelsPath(sdk);
    const authStorage = sdk.AuthStorage.create(piConfig?.auth_path);
    const modelRegistry = sdk.ModelRegistry.create(authStorage, piConfig?.models_path);
    const allModels = normalizePiModels(modelRegistry.getAll());
    const availableModels = normalizePiModels(await modelRegistry.getAvailable());
    const providerIds = providerIdList(allModels, availableModels, authStorage.list());
    const defaultProvider = parseProviderFromModel(defaultModel);

    const providers = providerIds.map((provider) => {
      const status = modelRegistry.getProviderAuthStatus?.(provider) ?? authStorage.getAuthStatus?.(provider);
      const modelCount = allModels.filter((m) => m.provider === provider).length;
      const availableModelCount = availableModels.filter((m) => m.provider === provider).length;
      return {
        id: provider,
        label: labelProvider(provider),
        configured: Boolean(status?.configured ?? authStorage.hasAuth(provider)),
        authSource: status?.source ?? null,
        authLabel: status?.label ?? null,
        modelCount,
        availableModelCount,
        defaultForInstance: provider === defaultProvider,
        supportsApiKey: true,
      };
    });

    return {
      status: 'ok',
      runtimeMode,
      defaultModel,
      pi: {
        packageName: PI_PACKAGE_NAME,
        packageAvailable: true,
        packageVersion: sdk.VERSION ?? null,
        authPath,
        modelsPath,
        authConfigured: providers.some((p) => p.configured),
        availableModelCount: availableModels.length,
        modelCount: allModels.length,
        providers,
        models: availableModels.length > 0 ? availableModels.map(toRuntimeModelOption) : allModels.map(toRuntimeModelOption),
        lastError: null,
      },
      legacy: {
        visible: runtimeMode !== 'pi',
        primary: runtimeMode === 'claude-agent-sdk',
      },
    };
  } catch (err) {
    return {
      status: 'ok',
      runtimeMode,
      defaultModel,
      pi: {
        packageName: PI_PACKAGE_NAME,
        packageAvailable: false,
        packageVersion: null,
        authPath: piConfig?.auth_path ?? join(homedir(), '.pi', 'agent', 'auth.json'),
        modelsPath: piConfig?.models_path ?? join(homedir(), '.pi', 'agent', 'models.json'),
        authConfigured: false,
        availableModelCount: 0,
        modelCount: 0,
        providers: COMMON_PI_PROVIDERS.map((id) => ({
          id,
          label: labelProvider(id),
          configured: false,
          authSource: null,
          authLabel: null,
          modelCount: 0,
          availableModelCount: 0,
          defaultForInstance: id === parseProviderFromModel(defaultModel),
          supportsApiKey: true,
        })),
        models: STATIC_RUNTIME_MODEL_OPTIONS.filter((m) => m.runtime === 'pi'),
        lastError: err instanceof Error ? err.message : String(err),
      },
      legacy: {
        visible: runtimeMode !== 'pi',
        primary: runtimeMode === 'claude-agent-sdk',
      },
    };
  }
}

export async function savePiProviderApiKey(provider: string, apiKey: string): Promise<void> {
  const trimmedProvider = normalizeProviderId(provider);
  const trimmedKey = apiKey.trim();
  if (!trimmedProvider) throw new Error('provider is required');
  if (!trimmedKey) throw new Error('apiKey is required');

  const config = loadGlobalConfigWithOverlay(CONFIG_PATH, OVERLAY_PATH);
  const sdk = await loadPiSdk();
  const authStorage = sdk.AuthStorage.create(config.runtime.headless.pi?.auth_path);
  authStorage.set(trimmedProvider, { type: 'api_key', key: trimmedKey });
}

export async function deletePiProviderCredential(provider: string): Promise<void> {
  const trimmedProvider = normalizeProviderId(provider);
  if (!trimmedProvider) throw new Error('provider is required');

  const config = loadGlobalConfigWithOverlay(CONFIG_PATH, OVERLAY_PATH);
  const sdk = await loadPiSdk();
  const authStorage = sdk.AuthStorage.create(config.runtime.headless.pi?.auth_path);
  authStorage.remove(trimmedProvider);
}

export async function testPiProvider(provider: string, model?: string): Promise<{
  ok: boolean;
  provider: string;
  model: string | null;
  configured: boolean;
  available: boolean;
  message: string;
}> {
  const trimmedProvider = normalizeProviderId(provider);
  if (!trimmedProvider) throw new Error('provider is required');

  const config = loadGlobalConfigWithOverlay(CONFIG_PATH, OVERLAY_PATH);
  const sdk = await loadPiSdk();
  const authStorage = sdk.AuthStorage.create(config.runtime.headless.pi?.auth_path);
  const registry = sdk.ModelRegistry.create(authStorage, config.runtime.headless.pi?.models_path);
  const available = normalizePiModels(await registry.getAvailable());
  const requestedRef = model ? parsePiModelRef(model) : null;
  const selected = requestedRef
    ? registry.find(requestedRef.provider, requestedRef.modelId)
    : available.find((m) => m.provider === trimmedProvider);
  const selectedModel = selected ? toRuntimeModelOption(normalizePiModels([selected])[0]).id : null;
  const status = registry.getProviderAuthStatus?.(trimmedProvider) ?? authStorage.getAuthStatus?.(trimmedProvider);
  const configured = Boolean(status?.configured ?? authStorage.hasAuth(trimmedProvider));
  const providerAvailable = available.some((m) => m.provider === trimmedProvider);
  const ok = configured && Boolean(selectedModel) && providerAvailable;

  return {
    ok,
    provider: trimmedProvider,
    model: selectedModel,
    configured,
    available: providerAvailable,
    message: ok
      ? `${labelProvider(trimmedProvider)} is configured and has available models.`
      : configured
        ? `${labelProvider(trimmedProvider)} credentials are present, but no available model was found.`
        : `${labelProvider(trimmedProvider)} credentials are missing.`,
  };
}

export async function updateRuntimeConfig(patch: RuntimeConfigPatch): Promise<void> {
  const base = readBaseConfigRaw(CONFIG_PATH);
  const currentOverlay = readRuntimeOverlay(OVERLAY_PATH);
  const current = deepMergeOverlay(base, currentOverlay);
  const target = applyRuntimeConfigPatch(current, patch);
  const validated = GlobalConfigSchema.safeParse(target);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(issues);
  }
  writeRuntimeOverlay(OVERLAY_PATH, deepDiffOverlay(base, target));
}

export async function runRuntimeTestTurn(input: {
  model?: string;
  prompt?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; text: string; sessionId: string | null; model: string }> {
  const config = loadGlobalConfigWithOverlay(CONFIG_PATH, OVERLAY_PATH);
  const model = input.model || config.defaults.model || DEFAULT_PI_MODEL_ID;
  const result = await runHeadlessReviewResult({
    prompt: input.prompt || 'Reply exactly: ANTHROCLAW_PI_RUNTIME_TEST_OK',
    model,
    cwd: resolve(process.cwd(), '..'),
    timeoutMs: input.timeoutMs ?? 120_000,
    purpose: 'runtime setup test turn',
    toolDenyMessage: 'Tools disabled for runtime setup test turn.',
    ...headlessRuntimeOptionsFromConfig(config),
  });
  return {
    ok: true,
    text: result.text,
    sessionId: result.sessionId ?? null,
    model,
  };
}

export function isPiPackageInstalledSync(): boolean {
  return findPackageDir(PI_PACKAGE_NAME) !== null;
}

function applyRuntimeConfigPatch(
  current: Record<string, unknown>,
  patch: RuntimeConfigPatch,
): Record<string, unknown> {
  const target = cloneRecord(current);

  if (patch.defaultModel) {
    const defaults = ensureChildRecord(target, 'defaults');
    defaults.model = patch.defaultModel;
  }

  if (patch.runtimeMode || 'piAuthPath' in patch || 'piModelsPath' in patch) {
    const runtime = ensureChildRecord(target, 'runtime');
    const headless = ensureChildRecord(runtime, 'headless');
    if (patch.runtimeMode) headless.provider = patch.runtimeMode;

    if ('piAuthPath' in patch || 'piModelsPath' in patch) {
      const pi = ensureChildRecord(headless, 'pi');
      if ('piAuthPath' in patch) {
        if (patch.piAuthPath) pi.auth_path = patch.piAuthPath;
        else delete pi.auth_path;
      }
      if ('piModelsPath' in patch) {
        if (patch.piModelsPath) pi.models_path = patch.piModelsPath;
        else delete pi.models_path;
      }
      if (Object.keys(pi).length === 0) delete headless.pi;
    }
  }

  return target;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function ensureChildRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (isRecord(existing)) return existing;
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadPiSdk(): Promise<PiSdkModule> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
  return await dynamicImport(PI_PACKAGE_NAME) as PiSdkModule;
}

function defaultPiAuthPath(sdk: PiSdkModule): string {
  return join(sdk.getAgentDir?.() ?? join(homedir(), '.pi', 'agent'), 'auth.json');
}

function defaultPiModelsPath(sdk: PiSdkModule): string {
  return join(sdk.getAgentDir?.() ?? join(homedir(), '.pi', 'agent'), 'models.json');
}

function normalizeProvider(value: string): RuntimeProvider {
  if (value === 'pi' || value === 'opencode' || value === 'claude-agent-sdk') return value;
  return 'pi';
}

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase();
}

function providerIdList(
  allModels: Array<{ provider: string }>,
  availableModels: Array<{ provider: string }>,
  configuredProviders: string[],
): string[] {
  return Array.from(new Set([
    ...COMMON_PI_PROVIDERS,
    ...allModels.map((m) => m.provider),
    ...availableModels.map((m) => m.provider),
    ...configuredProviders,
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function normalizePiModels(models: PiModelLike[] | undefined): Array<{ provider: string; id: string; name?: string }> {
  return (models ?? [])
    .map((model) => ({
      provider: typeof model.provider === 'string' ? model.provider : '',
      id: typeof model.id === 'string' ? model.id : '',
      name: typeof model.name === 'string' ? model.name : undefined,
    }))
    .filter((model) => model.provider && model.id);
}

function toRuntimeModelOption(model: { provider: string; id: string; name?: string }): RuntimeModelOption {
  return modelOption(
    `${model.provider}/${model.id}`,
    model.provider,
    'pi',
    false,
    'configured',
    model.name ?? `${labelProvider(model.provider)} ${model.id}`,
  );
}

function parseProviderFromModel(model: string): string {
  const slash = model.indexOf('/');
  if (slash > 0) return model.slice(0, slash);
  if (model.startsWith('claude-')) return 'anthropic';
  return '';
}

function labelProvider(provider: string): string {
  return provider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function findPackageDir(packageName: string): string | null {
  const parts = packageName.split('/');
  const starts = [
    resolve(process.cwd(), 'node_modules'),
    resolve(process.cwd(), '..', 'node_modules'),
  ];
  for (const root of starts) {
    const direct = resolve(root, ...parts);
    if (existsSync(direct)) return direct;
  }
  return null;
}

export async function hasPiPackageInstalledDeep(): Promise<boolean> {
  if (isPiPackageInstalledSync()) return true;
  const pnpmRoot = resolve(process.cwd(), '..', 'node_modules', '.pnpm');
  try {
    const entries = await readdir(pnpmRoot);
    return entries.some((entry) => entry.startsWith('@earendil-works+pi-coding-agent@'));
  } catch {
    return false;
  }
}
