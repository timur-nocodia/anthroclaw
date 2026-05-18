import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { getOverlayPath, loadGlobalConfigWithOverlay } from '@backend/config/overlay.js';
import { PI_PACKAGE_NAME, DEFAULT_PI_MODEL_ID } from '@backend/runtime/pi-headless.js';
import {
  findSideEffectGate,
  SIDE_EFFECT_GATE_REGISTRY,
  type SideEffectGateRegistryEntry,
} from '@backend/runtime/side-effect-gates/registry.js';
import {
  modelOption,
  STATIC_RUNTIME_MODEL_OPTIONS,
  type RuntimeModelOption,
} from '@/lib/runtime-models';

export type RuntimeProvider = 'claude-agent-sdk' | 'pi' | 'opencode';

export interface RuntimeGatewayStatusInput {
  uptime?: number;
  activeSessions?: number;
  agents?: string[];
  runtimeDefaults?: {
    headlessProvider?: RuntimeProvider;
    gatewayHarness?: string;
  };
}

export interface RuntimeControlPlaneStatus {
  harness: {
    id: 'runtime-v1';
  };
  defaultProvider: RuntimeProvider;
  legacyProviders: RuntimeProvider[];
  pi: {
    packageName: string;
    packageAvailable: boolean;
    defaultModel: string;
    authPath: string | null;
    authConfigured: boolean;
    modelsPath: string | null;
    modelsConfigured: boolean;
    lastError: string | null;
  };
  agents: {
    total: number;
    byEffectiveProvider: Record<RuntimeProvider, number>;
  };
  gateway: {
    uptime: number | null;
    activeSessions: number | null;
    lastError: string | null;
  };
  legacy: {
    claudeAgentSdk: {
      present: boolean;
      primary: boolean;
    };
  };
}

export interface RuntimeGateRegistryResponse {
  status: 'ok';
  gates: RuntimeGateSummary[];
}

export interface RuntimeGateSummary {
  id: string;
  title: string;
  summary: string;
  capabilityGroup: string;
  focusedCommand: string;
  aggregateDispatcher: boolean;
  risk: string;
  action: string;
  execution: {
    requiredFlags: string[];
    optionalFlags: string[];
    supportsDryRun: boolean;
    safetyMode: string;
    approval: string;
    exampleArgs: string[];
  };
}

export type RuntimeGateArgs = Record<string, string | number | boolean | null | undefined>;

export interface RuntimeGateValidationResult {
  ok: boolean;
  gateId: string;
  missingRequiredFlags: string[];
  unknownFlags: string[];
  normalizedArgs: Record<string, string | number | boolean>;
  requiredFlags: string[];
  optionalFlags: string[];
}

export interface RuntimeGatePlanResult {
  ok: boolean;
  dryRunOnly: true;
  gate: RuntimeGateSummary;
  validation: RuntimeGateValidationResult;
  command: string;
  argv: string[];
}

export interface RuntimeModelGroup {
  id: 'pi' | 'opencode' | 'legacy-claude';
  title: string;
  enabled: boolean;
  compatibility?: boolean;
  source: {
    kind: 'configured' | 'static' | 'compatibility';
    modelsPath?: string | null;
    modelsConfigured?: boolean;
    error?: string | null;
  };
  models: RuntimeModelOption[];
}

export interface RuntimeModelRegistryResponse {
  status: 'ok';
  defaultProvider: RuntimeProvider;
  defaultModel: string;
  groups: RuntimeModelGroup[];
  options: RuntimeModelOption[];
}

const CONFIG_PATH = process.env.OC_CONFIG
  ? resolve(process.env.OC_CONFIG)
  : resolve(process.cwd(), '..', 'config.yml');
const AGENTS_DIR = process.env.OC_AGENTS_DIR
  ? resolve(process.env.OC_AGENTS_DIR)
  : resolve(process.cwd(), '..', 'agents');
const DATA_DIR = process.env.OC_DATA_DIR
  ? resolve(process.env.OC_DATA_DIR)
  : resolve(process.cwd(), '..', 'data');
const OVERLAY_PATH = getOverlayPath(DATA_DIR);

const RUNTIME_PROVIDERS: RuntimeProvider[] = ['claude-agent-sdk', 'pi', 'opencode'];
const LEGACY_PROVIDER: RuntimeProvider = 'claude-agent-sdk';

export function getRuntimeStatus(
  gatewayStatus?: RuntimeGatewayStatusInput,
  gatewayError?: unknown,
): RuntimeControlPlaneStatus {
  const config = loadGlobalConfigWithOverlay(CONFIG_PATH, OVERLAY_PATH);
  const defaultProvider = normalizeRuntimeProvider(
    gatewayStatus?.runtimeDefaults?.headlessProvider,
    config.runtime.headless.provider,
  );
  const providerCounts = countAgentProviders(AGENTS_DIR, defaultProvider);
  const authPath = config.runtime.headless.pi?.auth_path ?? null;
  const modelsPath = config.runtime.headless.pi?.models_path ?? null;
  const claudeAgentSdkPresent = defaultProvider === LEGACY_PROVIDER
    || providerCounts.byEffectiveProvider[LEGACY_PROVIDER] > 0;

  return {
    harness: {
      id: 'runtime-v1',
    },
    defaultProvider,
    legacyProviders: [LEGACY_PROVIDER],
    pi: {
      packageName: PI_PACKAGE_NAME,
      packageAvailable: isPackageAvailable(PI_PACKAGE_NAME),
      defaultModel: DEFAULT_PI_MODEL_ID,
      authPath,
      authConfigured: configuredPathExists(authPath),
      modelsPath,
      modelsConfigured: configuredPathExists(modelsPath),
      lastError: null,
    },
    agents: providerCounts,
    gateway: {
      uptime: typeof gatewayStatus?.uptime === 'number' ? gatewayStatus.uptime : null,
      activeSessions: typeof gatewayStatus?.activeSessions === 'number' ? gatewayStatus.activeSessions : null,
      lastError: gatewayError instanceof Error ? gatewayError.message : null,
    },
    legacy: {
      claudeAgentSdk: {
        present: claudeAgentSdkPresent,
        primary: defaultProvider === LEGACY_PROVIDER,
      },
    },
  };
}

export function getRuntimeGateRegistry(): RuntimeGateRegistryResponse {
  return {
    status: 'ok',
    gates: SIDE_EFFECT_GATE_REGISTRY.map(summarizeGate),
  };
}

export function validateRuntimeGateArgs(
  gateId: string,
  args: RuntimeGateArgs = {},
): RuntimeGateValidationResult | null {
  const gate = findSideEffectGate(gateId);
  if (!gate) return null;

  const knownFlags = new Set([
    ...gate.execution.requiredFlags,
    ...gate.execution.optionalFlags,
  ]);
  const normalizedArgs = normalizeGateArgs(args);
  const missingRequiredFlags = gate.execution.requiredFlags.filter((flag) =>
    !hasMeaningfulArg(normalizedArgs, flag),
  );
  const unknownFlags = Object.keys(normalizedArgs).filter((flag) => !knownFlags.has(flag));

  return {
    ok: missingRequiredFlags.length === 0 && unknownFlags.length === 0,
    gateId: gate.id,
    missingRequiredFlags,
    unknownFlags,
    normalizedArgs,
    requiredFlags: [...gate.execution.requiredFlags],
    optionalFlags: [...gate.execution.optionalFlags],
  };
}

export function planRuntimeGate(
  gateId: string,
  args: RuntimeGateArgs = {},
): RuntimeGatePlanResult | null {
  const gate = findSideEffectGate(gateId);
  if (!gate) return null;

  const validation = validateRuntimeGateArgs(gateId, args);
  if (!validation) return null;

  return {
    ok: validation.ok,
    dryRunOnly: true,
    gate: summarizeGate(gate),
    validation,
    command: gate.focusedCommand,
    argv: argsToCliArgv(validation.normalizedArgs),
  };
}

export function getRuntimeModelRegistry(): RuntimeModelRegistryResponse {
  const config = loadGlobalConfigWithOverlay(CONFIG_PATH, OVERLAY_PATH);
  const defaultProvider = config.runtime.headless.provider;
  const modelsPath = config.runtime.headless.pi?.models_path ?? null;
  const configuredPiModels = readConfiguredPiModels(modelsPath);
  const staticPiModels = STATIC_RUNTIME_MODEL_OPTIONS.filter((option) => option.runtime === 'pi');
  const piModels = mergeModelOptions([
    ...configuredPiModels.models,
    ...staticPiModels,
  ]);
  const opencodeEnabled = defaultProvider === 'opencode';
  const opencodeModels = opencodeEnabled
    ? [modelOption(config.defaults.model, undefined, 'opencode')]
    : [];
  const legacyModels = STATIC_RUNTIME_MODEL_OPTIONS.filter((option) => option.runtime === 'legacy-claude');
  const groups: RuntimeModelGroup[] = [
    {
      id: 'pi',
      title: 'Pi configured models',
      enabled: defaultProvider === 'pi',
      source: {
        kind: configuredPiModels.models.length > 0 ? 'configured' : 'static',
        modelsPath,
        modelsConfigured: configuredPathExists(modelsPath),
        error: configuredPiModels.error,
      },
      models: piModels,
    },
    {
      id: 'opencode',
      title: 'OpenCode models',
      enabled: opencodeEnabled,
      source: {
        kind: 'static',
      },
      models: opencodeModels,
    },
    {
      id: 'legacy-claude',
      title: 'Legacy Claude Agent SDK compatibility',
      enabled: true,
      compatibility: true,
      source: {
        kind: 'compatibility',
      },
      models: legacyModels,
    },
  ];

  return {
    status: 'ok',
    defaultProvider,
    defaultModel: config.defaults.model,
    groups,
    options: mergeModelOptions(groups.flatMap((group) => group.models)),
  };
}

function countAgentProviders(
  agentsDir: string,
  defaultProvider: RuntimeProvider,
): RuntimeControlPlaneStatus['agents'] {
  const byEffectiveProvider = emptyProviderCounts();
  if (!existsSync(agentsDir)) {
    return {
      total: 0,
      byEffectiveProvider,
    };
  }

  let total = 0;
  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const agentConfigPath = join(agentsDir, entry.name, 'agent.yml');
    if (!existsSync(agentConfigPath)) continue;
    total += 1;
    const provider = readAgentProvider(agentConfigPath, defaultProvider);
    byEffectiveProvider[provider] += 1;
  }

  return {
    total,
    byEffectiveProvider,
  };
}

function readAgentProvider(agentConfigPath: string, defaultProvider: RuntimeProvider): RuntimeProvider {
  try {
    const parsed = parseYaml(readFileSync(agentConfigPath, 'utf-8'));
    const provider = getNestedProvider(parsed);
    return normalizeRuntimeProvider(provider, defaultProvider);
  } catch {
    return defaultProvider;
  }
}

function getNestedProvider(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  const runtime = value.runtime;
  if (!isRecord(runtime)) return undefined;
  const headless = runtime.headless;
  if (!isRecord(headless)) return undefined;
  return headless.provider;
}

function normalizeRuntimeProvider(value: unknown, fallback: RuntimeProvider): RuntimeProvider {
  return typeof value === 'string' && isRuntimeProvider(value) ? value : fallback;
}

function isRuntimeProvider(value: string): value is RuntimeProvider {
  return RUNTIME_PROVIDERS.includes(value as RuntimeProvider);
}

function emptyProviderCounts(): Record<RuntimeProvider, number> {
  return {
    'claude-agent-sdk': 0,
    pi: 0,
    opencode: 0,
  };
}

function configuredPathExists(path: string | null): boolean {
  if (!path) return false;
  return existsSync(isAbsolute(path) ? path : resolve(process.cwd(), '..', path));
}

function isPackageAvailable(packageName: string): boolean {
  try {
    createRequire(import.meta.url).resolve(`${packageName}/package.json`);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function summarizeGate(gate: SideEffectGateRegistryEntry): RuntimeGateSummary {
  return {
    id: gate.id,
    title: gate.title,
    summary: gate.summary,
    capabilityGroup: gate.capabilityGroup,
    focusedCommand: gate.focusedCommand,
    aggregateDispatcher: gate.aggregateDispatcher,
    risk: gate.risk,
    action: gate.action,
    execution: {
      requiredFlags: [...gate.execution.requiredFlags],
      optionalFlags: [...gate.execution.optionalFlags],
      supportsDryRun: gate.execution.supportsDryRun,
      safetyMode: gate.execution.safetyMode,
      approval: gate.execution.approval,
      exampleArgs: [...gate.execution.exampleArgs],
    },
  };
}

function normalizeGateArgs(args: RuntimeGateArgs): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = value;
    }
  }
  return normalized;
}

function hasMeaningfulArg(args: Record<string, string | number | boolean>, flag: string): boolean {
  const value = args[flag];
  if (value === undefined) return false;
  return !(typeof value === 'string' && value.trim() === '');
}

function argsToCliArgv(args: Record<string, string | number | boolean>): string[] {
  const argv: string[] = [];
  for (const [key, value] of Object.entries(args).sort(([a], [b]) => a.localeCompare(b))) {
    if (typeof value === 'boolean') {
      if (value) argv.push(`--${key}`);
      continue;
    }
    argv.push(`--${key}`, String(value));
  }
  return argv;
}

function readConfiguredPiModels(modelsPath: string | null): { models: RuntimeModelOption[]; error: string | null } {
  if (!modelsPath || !configuredPathExists(modelsPath)) {
    return { models: [], error: null };
  }

  try {
    const path = isAbsolute(modelsPath) ? modelsPath : resolve(process.cwd(), '..', modelsPath);
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return { models: extractModelOptions(parsed), error: null };
  } catch (err) {
    return {
      models: [],
      error: err instanceof Error ? err.message : 'Failed to read Pi models file',
    };
  }
}

function extractModelOptions(value: unknown): RuntimeModelOption[] {
  if (Array.isArray(value)) return value.flatMap(extractModelEntry);
  if (isRecord(value)) {
    if (Array.isArray(value.models)) return value.models.flatMap(extractModelEntry);
    if (Array.isArray(value.available)) return value.available.flatMap(extractModelEntry);
  }
  return [];
}

function extractModelEntry(value: unknown): RuntimeModelOption[] {
  if (typeof value === 'string' && value.trim()) {
    return [modelOption(value.trim(), undefined, 'pi', false, 'configured')];
  }
  if (!isRecord(value)) return [];

  const provider = typeof value.provider === 'string' ? value.provider : undefined;
  const rawId = typeof value.id === 'string'
    ? value.id
    : typeof value.modelId === 'string'
      ? value.modelId
      : typeof value.model === 'string'
        ? value.model
        : undefined;
  if (!rawId) return [];

  const id = provider && !rawId.includes('/') && !rawId.includes(':')
    ? `${provider}/${rawId}`
    : rawId;
  const label = typeof value.name === 'string' && value.name.trim()
    ? `${id} - ${value.name.trim()}`
    : id;
  return [modelOption(id, provider, 'pi', false, 'configured', label)];
}

function mergeModelOptions(options: RuntimeModelOption[]): RuntimeModelOption[] {
  const seen = new Set<string>();
  const merged: RuntimeModelOption[] = [];
  for (const option of options) {
    if (seen.has(option.id)) continue;
    seen.add(option.id);
    merged.push(option);
  }
  return merged;
}
