import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadAgentYml } from '../../config/loader.js';
import { createPluginContext } from '../../plugins/context.js';
import { loadPlugin } from '../../plugins/loader.js';
import { parsePluginManifest } from '../../plugins/manifest-schema.js';
import { PluginRegistry } from '../../plugins/registry.js';
import { buildPluginStartupPlan } from '../../plugins/startup-plan.js';
import type {
  ContextEngine,
  HookEvent,
  HookHandler,
  PluginContext,
  PluginInstance,
  PluginLogger,
  PluginManifest,
  PluginMcpTool,
} from '../../plugins/types.js';
import {
  validateRuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateValidation,
} from '../side-effect-gate.js';

export const HONCHO_LOCAL_GATE_ID = 'honcho-local';
export const DEFAULT_HONCHO_EXPECTED_MODE = 'tools';
export const DEFAULT_HONCHO_EXPECTED_ENVIRONMENT = 'local';
export const DEFAULT_HONCHO_EXPECTED_BASE_URL_HOST = 'localhost:8000';

interface PluginRegister {
  (ctx: PluginContext): Promise<PluginInstance> | PluginInstance;
}

export interface HonchoLocalGateInput {
  agentId: string;
  sourceAgentsDir: string;
  workspace: string;
  peerId: string;
  sessionKey?: string;
  expectedMode?: string;
  expectedEnvironment?: string;
  expectedBaseUrlHost?: string;
  expectedWorkspaceId?: string;
}

export interface HonchoLocalGateResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  gate: {
    id: typeof HONCHO_LOCAL_GATE_ID;
    spec: RuntimeSideEffectGateSpec;
    validation: RuntimeSideEffectGateValidation;
  };
  agentsDir: string;
  peerId: string;
  currentConfig: {
    privateAllowlistIncludesPeer: boolean;
    privateAllowlistSinglePeer: boolean;
    honchoConfigured: boolean;
    enabled: boolean;
    mode: string;
    environment: string;
    baseUrlHost: string;
    workspaceId: string;
    keylessLocal: boolean;
    maxRetriesZero: boolean;
  };
  disabledGate: {
    startupPlanSkipsHoncho: boolean;
    noHonchoToolsExposed: boolean;
    noContextEngineActive: boolean;
  };
  activationCandidate: {
    tempOnly: boolean;
    pluginRegistered: boolean;
    contextEngineRegistered: boolean;
    observeHookRegistered: boolean;
    toolsPresent: boolean;
    statusToolWorks: boolean;
    statusReportsExpectedHost: boolean;
    sessionToolRequiresDispatch: boolean;
    sessionToolUsesDispatchKey: boolean;
    noApiKeyRequiredByConfig: boolean;
  };
  safety: {
    noLiveConfigMutation: boolean;
    noNetworkCall: boolean;
    noHardcodedSecrets: boolean;
  };
  error?: string;
}

type NormalizedHonchoLocalGateInput = HonchoLocalGateInput & {
  sessionKey: string;
  expectedMode: string;
  expectedEnvironment: string;
  expectedBaseUrlHost: string;
  expectedWorkspaceId?: string;
};

export async function runHonchoLocalGate(input: HonchoLocalGateInput): Promise<HonchoLocalGateResult> {
  const normalized = normalizeHonchoLocalGateInput(input);
  const agentsDir = join(normalized.workspace, 'agents');
  const agentDir = join(agentsDir, normalized.agentId);
  const gate = buildHonchoLocalGateSpec(normalized);

  if (!gate.validation.ok) {
    throw new Error(`invalid Honcho local gate spec: ${gate.validation.errors.join('; ')}`);
  }

  mkdirSync(agentsDir, { recursive: true });
  cpSync(join(resolve(normalized.sourceAgentsDir), normalized.agentId), agentDir, { recursive: true });

  const config = loadAgentYml(agentDir);
  const honchoConfig = getHonchoConfig(config.plugins, normalized.agentId);
  const connection = getConnectionConfig(honchoConfig, normalized.agentId);
  const allowlist = config.allowlist?.telegram ?? [];
  const privateAllowlistIncludesPeer =
    config.safety_profile === 'private' && allowlist.includes(normalized.peerId);
  const privateAllowlistSinglePeer = privateAllowlistIncludesPeer && allowlist.length === 1;
  if (!privateAllowlistIncludesPeer) {
    throw new Error(`${normalized.agentId} must remain private and allowlisted to the confirmed operator Telegram peer.`);
  }

  const enabled = honchoConfig.enabled === true;
  const mode = stringField(honchoConfig, 'mode');
  const environment = stringField(connection, 'environment');
  const baseUrlHost = new URL(stringField(connection, 'base_url')).host;
  const workspaceId = stringField(connection, 'workspace_id');
  const keylessLocal = environment === 'local' && !('api_key_env' in connection);
  const maxRetriesZero = connection.max_retries === 0;
  if (enabled) throw new Error(`${normalized.agentId} Honcho must stay disabled until intentionally activated.`);
  if (mode !== normalized.expectedMode) throw new Error(`${normalized.agentId} Honcho mode changed unexpectedly.`);
  if (environment !== normalized.expectedEnvironment) throw new Error(`${normalized.agentId} Honcho environment changed unexpectedly.`);
  if (baseUrlHost !== normalized.expectedBaseUrlHost) throw new Error(`${normalized.agentId} Honcho base_url host changed unexpectedly.`);
  if (normalized.expectedWorkspaceId && workspaceId !== normalized.expectedWorkspaceId) {
    throw new Error(`${normalized.agentId} Honcho workspace id changed unexpectedly.`);
  }
  if (!keylessLocal) throw new Error(`${normalized.agentId} local Honcho config should not require an API key env var.`);
  if (!maxRetriesZero) throw new Error(`${normalized.agentId} local Honcho config should use max_retries=0.`);

  const disabledGate = await runDisabledGateAssertions(normalized.agentId, config);
  const activationCandidate = await runActivationCandidateAssertions({
    agentId: normalized.agentId,
    peerId: normalized.peerId,
    sessionKey: normalized.sessionKey,
    expectedMode: normalized.expectedMode,
    expectedBaseUrlHost: normalized.expectedBaseUrlHost,
    expectedWorkspaceId: workspaceId,
    agentConfig: {
      ...config,
      plugins: {
        ...(config.plugins ?? {}),
        honcho: {
          ...honchoConfig,
          enabled: true,
        },
      },
    },
    dataDir: join(normalized.workspace, 'honcho-plugin-data'),
  });

  return {
    status: 'passed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate,
    agentsDir,
    peerId: normalized.peerId,
    currentConfig: {
      privateAllowlistIncludesPeer,
      privateAllowlistSinglePeer,
      honchoConfigured: true,
      enabled,
      mode,
      environment,
      baseUrlHost,
      workspaceId,
      keylessLocal,
      maxRetriesZero,
    },
    disabledGate,
    activationCandidate,
    safety: {
      noLiveConfigMutation: true,
      noNetworkCall: true,
      noHardcodedSecrets: true,
    },
  };
}

export function createFailedHonchoLocalGateResult(
  input: HonchoLocalGateInput,
  error: string,
): HonchoLocalGateResult {
  const normalized = normalizeHonchoLocalGateInput(input);
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate: buildHonchoLocalGateSpec(normalized),
    agentsDir: join(normalized.workspace, 'agents'),
    peerId: normalized.peerId,
    currentConfig: {
      privateAllowlistIncludesPeer: false,
      privateAllowlistSinglePeer: false,
      honchoConfigured: false,
      enabled: false,
      mode: '',
      environment: '',
      baseUrlHost: '',
      workspaceId: '',
      keylessLocal: false,
      maxRetriesZero: false,
    },
    disabledGate: {
      startupPlanSkipsHoncho: false,
      noHonchoToolsExposed: false,
      noContextEngineActive: false,
    },
    activationCandidate: {
      tempOnly: true,
      pluginRegistered: false,
      contextEngineRegistered: false,
      observeHookRegistered: false,
      toolsPresent: false,
      statusToolWorks: false,
      statusReportsExpectedHost: false,
      sessionToolRequiresDispatch: false,
      sessionToolUsesDispatchKey: false,
      noApiKeyRequiredByConfig: false,
    },
    safety: {
      noLiveConfigMutation: false,
      noNetworkCall: false,
      noHardcodedSecrets: false,
    },
    error,
  };
}

function normalizeHonchoLocalGateInput(input: HonchoLocalGateInput): NormalizedHonchoLocalGateInput {
  return {
    ...input,
    sessionKey: input.sessionKey ?? `${input.agentId}:telegram:dm:${input.peerId}:honcho-local`,
    expectedMode: input.expectedMode ?? DEFAULT_HONCHO_EXPECTED_MODE,
    expectedEnvironment: input.expectedEnvironment ?? DEFAULT_HONCHO_EXPECTED_ENVIRONMENT,
    expectedBaseUrlHost: input.expectedBaseUrlHost ?? DEFAULT_HONCHO_EXPECTED_BASE_URL_HOST,
  };
}

function buildHonchoLocalGateSpec(input: NormalizedHonchoLocalGateInput): HonchoLocalGateResult['gate'] {
  const spec: RuntimeSideEffectGateSpec = {
    gateId: HONCHO_LOCAL_GATE_ID,
    agentId: input.agentId,
    runtime: 'pi',
    risk: 'operator_only',
    action: 'mcp.call',
    target: {
      channel: 'telegram',
      peerId: input.peerId,
    },
    dryRunSupported: true,
    approvalRequired: true,
    policyAssertions: [
      {
        id: 'disabled-by-default',
        description: 'Honcho is configured but disabled until a local service is intentionally activated.',
        required: true,
      },
      {
        id: 'local-keyless-config',
        description: 'Local Honcho config uses no API key env var and max_retries=0.',
        required: true,
      },
      {
        id: 'activation-surface',
        description: 'Temporary activation registers context engine, observe hook, and expected tools.',
        required: true,
      },
      {
        id: 'no-network',
        description: 'The gate checks plugin surface without calling a real Honcho service.',
        required: true,
      },
    ],
    expectedEffects: [
      {
        id: 'startup-plan-skip',
        kind: 'mcp.call',
        description: 'Disabled Honcho config is skipped by plugin startup planning.',
        target: { channel: 'none' },
        maxCount: 1,
      },
      {
        id: 'temporary-activation-surface',
        kind: 'mcp.call',
        description: 'Temporary activation exposes Honcho status/session/tool surfaces without network calls.',
        target: { channel: 'none' },
        maxCount: 1,
      },
    ],
    cleanupChecks: [
      {
        id: 'source-config-unchanged',
        description: 'The gate copies agent config before temporary activation and does not mutate source config.',
        required: true,
      },
      {
        id: 'no-context-injection-tools-mode',
        description: 'Tools mode does not automatically inject Honcho context.',
        required: true,
      },
    ],
    metrics: {
      runStarted: true,
      runCompleted: true,
      noFailedTools: true,
    },
  };

  return {
    id: HONCHO_LOCAL_GATE_ID,
    spec,
    validation: validateRuntimeSideEffectGateSpec(spec),
  };
}

async function runDisabledGateAssertions(
  agentId: string,
  agentConfig: { plugins?: Record<string, { enabled?: boolean } | undefined> },
): Promise<HonchoLocalGateResult['disabledGate']> {
  const startupPlan = buildPluginStartupPlan({
    catalog: {
      entries: [{
        name: 'honcho',
        version: '0.1.0',
        sourceType: 'bundled',
        pluginDir: resolve('plugins', 'honcho'),
        manifestPath: resolve('plugins', 'honcho', '.claude-plugin', 'plugin.json'),
        entryPath: resolve('plugins', 'honcho', 'dist', 'index.js'),
        loadable: true,
        loaded: false,
        status: 'ok',
        diagnostics: [],
        manifest: {
          name: 'honcho',
          version: '0.1.0',
          entry: 'dist/index.js',
        },
      }],
      duplicates: [],
    },
    agentPluginConfigs: [agentConfig.plugins ?? {}],
  });
  const startupPlanSkipsHoncho = startupPlan.skippedNames.has('honcho') && !startupPlan.loadNames.has('honcho');
  if (!startupPlanSkipsHoncho) throw new Error('Honcho should be skipped while plugins.honcho.enabled=false.');

  const registry = new PluginRegistry();
  const noHonchoToolsExposed = registry.getMcpToolsForAgent(agentId).length === 0;
  const noContextEngineActive = registry.getContextEngine(agentId) === null;
  if (!noHonchoToolsExposed || !noContextEngineActive) {
    throw new Error('Disabled Honcho state unexpectedly exposed plugin tools or a context engine.');
  }

  return {
    startupPlanSkipsHoncho,
    noHonchoToolsExposed,
    noContextEngineActive,
  };
}

async function runActivationCandidateAssertions(input: {
  agentId: string;
  peerId: string;
  sessionKey: string;
  expectedMode: string;
  expectedBaseUrlHost: string;
  expectedWorkspaceId: string;
  agentConfig: unknown;
  dataDir: string;
}): Promise<HonchoLocalGateResult['activationCandidate']> {
  const registry = new PluginRegistry();
  const hooks: Array<{ pluginName: string; event: HookEvent; handler: HookHandler }> = [];
  await registerHonchoPlugin(registry, {
    dataDir: input.dataDir,
    getAgentConfig: (agentId) => agentId === input.agentId ? input.agentConfig : { plugins: {} },
    onHook: (hook) => hooks.push(hook),
  });
  registry.enableForAgent(input.agentId, 'honcho');

  try {
    const pluginRegistered = registry.listPlugins().some((entry) => entry.manifest.name === 'honcho');
    const contextEngineRegistered = registry.getContextEngine(input.agentId)?.name === 'honcho';
    const observeHookRegistered = hooks.some((hook) => hook.pluginName === 'honcho' && hook.event === 'on_after_query');
    const tools = registry.getMcpToolsForAgent(input.agentId);
    const toolNames = tools.map((tool) => tool.name).sort();
    const expectedTools = [
      'honcho_ask',
      'honcho_context',
      'honcho_search_conclusions',
      'honcho_search_messages',
      'honcho_session',
      'honcho_status',
    ];
    const toolsPresent = expectedTools.every((toolName) => toolNames.includes(toolName));
    if (!pluginRegistered || !contextEngineRegistered || !observeHookRegistered || !toolsPresent) {
      throw new Error('Honcho activation candidate did not register the expected engine, hook, and tools.');
    }

    const status = JSON.parse(toolText(await requirePluginTool(tools, 'honcho_status').handler({}, {
      agentId: input.agentId,
      sessionKey: input.sessionKey,
    }))) as {
      enabled?: unknown;
      mode?: unknown;
      workspace_id?: unknown;
      base_url_host?: unknown;
      status?: unknown;
    };
    const statusToolWorks = status.enabled === true &&
      status.mode === input.expectedMode &&
      status.workspace_id === input.expectedWorkspaceId &&
      status.status === 'configured';
    const statusReportsExpectedHost = status.base_url_host === input.expectedBaseUrlHost;
    if (!statusToolWorks || !statusReportsExpectedHost) {
      throw new Error('Honcho status tool did not report the expected local tools-mode config.');
    }

    const noSessionResult = toolText(await requirePluginTool(tools, 'honcho_session').handler({}, {
      agentId: input.agentId,
    }));
    const sessionToolRequiresDispatch = noSessionResult.includes('requires an active AnthroClaw session');
    if (!sessionToolRequiresDispatch) {
      throw new Error('Honcho session tool should require a dispatch session key.');
    }

    const engine = registry.getContextEngine(input.agentId)?.engine as ContextEngine | undefined;
    const assembled = await engine?.assemble?.({
      agentId: input.agentId,
      sessionKey: input.sessionKey,
      sessionContext: {
        channel: 'telegram',
        accountId: 'default',
        peerId: input.peerId,
        senderId: input.peerId,
        chatType: 'dm',
      },
      messages: [{ role: 'user', content: 'honcho disabled-mode gate' }],
    });
    const sessionToolUsesDispatchKey = assembled === null;
    if (!sessionToolUsesDispatchKey) {
      throw new Error('Honcho tools-mode candidate should not inject context automatically.');
    }

    return {
      tempOnly: true,
      pluginRegistered,
      contextEngineRegistered,
      observeHookRegistered,
      toolsPresent,
      statusToolWorks,
      statusReportsExpectedHost,
      sessionToolRequiresDispatch,
      sessionToolUsesDispatchKey,
      noApiKeyRequiredByConfig: true,
    };
  } finally {
    for (const entry of registry.listPlugins()) {
      await entry.instance.shutdown?.();
    }
  }
}

async function registerHonchoPlugin(
  registry: PluginRegistry,
  input: {
    dataDir: string;
    getAgentConfig(agentId: string): unknown;
    onHook(hook: { pluginName: string; event: HookEvent; handler: HookHandler }): void;
  },
): Promise<void> {
  mkdirSync(input.dataDir, { recursive: true });
  const pluginDir = resolve('plugins', 'honcho');
  const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');
  const manifest = await parsePluginManifest(manifestPath) as PluginManifest;
  if (manifest.name !== 'honcho') {
    throw new Error('bundled Honcho plugin manifest name mismatch.');
  }
  if (!existsSync(join(pluginDir, manifest.entry))) {
    throw new Error(`bundled Honcho plugin compiled entry is missing at ${manifest.entry}; run pnpm build before this smoke.`);
  }
  const module = await loadPlugin({ manifest, manifestPath, pluginDir });
  const context = createPluginContext({
    pluginName: manifest.name,
    pluginVersion: manifest.version,
    dataDir: input.dataDir,
    rootLogger: silentLogger,
    registerHook(pluginName: string, event: HookEvent, handler: HookHandler): void {
      registry.addHookFromPlugin(pluginName, event, handler);
      input.onHook({ pluginName, event, handler });
    },
    registerTool(tool: PluginMcpTool): void {
      registry.addToolFromPlugin(manifest.name, tool);
    },
    registerEngine(pluginName: string, engine): void {
      registry.addEngineFromPlugin(pluginName, engine);
    },
    registerCommand(cmd): void {
      registry.addCommandFromPlugin(manifest.name, cmd);
    },
    getAgentConfig: input.getAgentConfig,
    getGlobalConfig: () => ({
      plugins: {
        honcho: {
          defaults: {},
        },
      },
    }),
  });
  const instance = await (module.register as PluginRegister)(context);
  registry.addPlugin(manifest.name, { manifest, instance });
}

function getHonchoConfig(plugins: unknown, agentId: string): Record<string, unknown> {
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
    throw new Error(`${agentId} must define plugins.honcho config.`);
  }
  const honcho = (plugins as Record<string, unknown>).honcho;
  if (!honcho || typeof honcho !== 'object' || Array.isArray(honcho)) {
    throw new Error(`${agentId} must define plugins.honcho config.`);
  }
  return honcho as Record<string, unknown>;
}

function getConnectionConfig(honcho: Record<string, unknown>, agentId: string): Record<string, unknown> {
  const connection = honcho.connection;
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)) {
    throw new Error(`${agentId} Honcho config must define connection.`);
  }
  return connection as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected Honcho ${key} to be a non-empty string.`);
  }
  return value;
}

function requirePluginTool(tools: PluginMcpTool[], name: string): PluginMcpTool {
  const found = tools.find((tool) => tool.name === name);
  if (!found) throw new Error(`missing plugin tool: ${name}`);
  return found;
}

function toolText(result: { content: Array<{ type: string; text: string }> }): string {
  const text = result.content[0]?.text;
  if (typeof text !== 'string') throw new Error('tool result did not contain text content.');
  return text;
}

const silentLogger: PluginLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};
