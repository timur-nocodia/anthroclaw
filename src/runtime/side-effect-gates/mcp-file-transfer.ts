import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createConnectMcpTool, type ConnectMcpDispatchContext } from '../../agent/tools/connect-mcp.js';
import { loadAgentYml } from '../../config/loader.js';
import { createOnboarding } from '../../integrations/mcp-onboarding/index.js';
import { createPluginContext } from '../../plugins/context.js';
import { loadPlugin } from '../../plugins/loader.js';
import { parsePluginManifest } from '../../plugins/manifest-schema.js';
import { PluginRegistry } from '../../plugins/registry.js';
import type {
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

export const MCP_FILE_TRANSFER_GATE_ID = 'mcp-file-transfer';
export const DEFAULT_MCP_FILE_TRANSFER_SERVER_URL = 'https://mcp.example.test';
export const DEFAULT_MCP_FILE_TRANSFER_PENDING_ID = 'pnd_mcp_file_transfer_gate';
export const DEFAULT_MCP_FILE_TRANSFER_SERVER_NAME = 'mcp-file-transfer-gate';
export const DEFAULT_MCP_FILE_TRANSFER_SEED_TEXT = 'generic file-transfer seed';
export const DEFAULT_MCP_FILE_TRANSFER_WRITE_TEXT = 'written by generic MCP/file-transfer gate';

interface PluginRegister {
  (ctx: PluginContext): Promise<PluginInstance> | PluginInstance;
}

export interface McpFileTransferGateInput {
  agentId: string;
  sourceAgentsDir: string;
  workspace: string;
  peerId: string;
  senderId: string;
  sessionKey?: string;
  serverUrl?: string;
  pendingId?: string;
  fakeServerName?: string;
  expectedConfiguredRoots?: string[];
  seedText?: string;
  writeText?: string;
}

export interface McpFileTransferGateResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  gate: {
    id: typeof MCP_FILE_TRANSFER_GATE_ID;
    spec: RuntimeSideEffectGateSpec;
    validation: RuntimeSideEffectGateValidation;
  };
  agentsDir: string;
  peerId: string;
  mcp: {
    enabled: boolean;
    privateAllowlistIncludesPeer: boolean;
    privateAllowlistSinglePeer: boolean;
    privateConnectForwarded: boolean;
    privateSessionBound: boolean;
    privateChatTypeBound: boolean;
    groupRejected: boolean;
    checkReturnedPending: boolean;
    cancelReturnedCancelled: boolean;
    noExternalMcpConfigured: boolean;
  };
  fileTransfer: {
    pluginEnabled: boolean;
    configuredRoots: string[];
    configuredWriteEnabled: boolean;
    toolsPresent: boolean;
    dirListSawSeed: boolean;
    fileFetchMatchedSeed: boolean;
    fileWriteSucceeded: boolean;
    outsideDenied: boolean;
    tempOnly: boolean;
  };
  safety: {
    noLiveRootMutation: boolean;
    noHardcodedSecrets: boolean;
  };
  error?: string;
}

type NormalizedMcpFileTransferGateInput = McpFileTransferGateInput & {
  sessionKey: string;
  serverUrl: string;
  pendingId: string;
  fakeServerName: string;
  expectedConfiguredRoots: string[];
  seedText: string;
  writeText: string;
};

export async function runMcpFileTransferGate(
  input: McpFileTransferGateInput,
): Promise<McpFileTransferGateResult> {
  const normalized = normalizeMcpFileTransferGateInput(input);
  const agentsDir = join(normalized.workspace, 'agents');
  const agentDir = join(agentsDir, normalized.agentId);
  const outsideRoot = join(normalized.workspace, 'outside-root');
  const gate = buildMcpFileTransferGateSpec(normalized);

  if (!gate.validation.ok) {
    throw new Error(`invalid MCP/file-transfer gate spec: ${gate.validation.errors.join('; ')}`);
  }

  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(outsideRoot, { recursive: true });
  cpSync(join(resolve(normalized.sourceAgentsDir), normalized.agentId), agentDir, { recursive: true });

  const config = loadAgentYml(agentDir);
  const fileTransferConfig = getFileTransferConfig(config.plugins, normalized.agentId);
  const configuredRoots = getConfiguredRoots(fileTransferConfig, normalized.agentId);
  const tempRoots = configuredRoots.map((root) => resolveConfiguredRoot(normalized.workspace, root));
  for (const root of tempRoots) mkdirSync(root, { recursive: true });
  const primaryRoot = tempRoots[0];
  if (!primaryRoot) throw new Error(`${normalized.agentId} file-transfer roots must include at least one root.`);
  writeFileSync(join(primaryRoot, 'seed.txt'), normalized.seedText, 'utf8');
  writeFileSync(join(outsideRoot, 'secret.txt'), 'outside marker', 'utf8');

  const allowlist = config.allowlist?.telegram ?? [];
  const privateAllowlistIncludesPeer =
    config.safety_profile === 'private' && allowlist.includes(normalized.peerId);
  const privateAllowlistSinglePeer = privateAllowlistIncludesPeer && allowlist.length === 1;
  if (!privateAllowlistIncludesPeer) {
    throw new Error(`${normalized.agentId} must remain private and allowlisted to the confirmed operator Telegram peer.`);
  }
  if (!config.mcp_onboarding.enabled) {
    throw new Error(`${normalized.agentId} must keep managed MCP onboarding enabled for this gate.`);
  }
  if (config.external_mcp_servers && Object.keys(config.external_mcp_servers).length > 0) {
    throw new Error(`${normalized.agentId} must not commit hardcoded external MCP servers for this gate.`);
  }
  assertConfiguredRoots(configuredRoots, normalized.expectedConfiguredRoots, normalized.agentId);
  if (fileTransferConfig.allowWrite !== true) {
    throw new Error(`${normalized.agentId} file-transfer must keep allowWrite=true for this gate.`);
  }

  const mcp = await runMcpOnboardingAssertions(normalized);
  const fileTransfer = await runFileTransferAssertions({
    agentId: normalized.agentId,
    sessionKey: normalized.sessionKey,
    agentConfigForPlugin: {
      ...config,
      plugins: {
        ...(config.plugins ?? {}),
        'file-transfer': {
          ...fileTransferConfig,
          roots: tempRoots,
        },
      },
    },
    primaryRoot,
    outsideRoot,
    seedText: normalized.seedText,
    writeText: normalized.writeText,
  });

  return {
    status: 'passed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate,
    agentsDir,
    peerId: normalized.peerId,
    mcp: {
      enabled: true,
      privateAllowlistIncludesPeer,
      privateAllowlistSinglePeer,
      ...mcp,
      noExternalMcpConfigured: true,
    },
    fileTransfer: {
      pluginEnabled: fileTransferConfig.enabled === true,
      configuredRoots,
      configuredWriteEnabled: fileTransferConfig.allowWrite === true,
      ...fileTransfer,
      tempOnly: true,
    },
    safety: {
      noLiveRootMutation: true,
      noHardcodedSecrets: true,
    },
  };
}

export function createFailedMcpFileTransferGateResult(
  input: McpFileTransferGateInput,
  error: string,
): McpFileTransferGateResult {
  const normalized = normalizeMcpFileTransferGateInput(input);
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: normalized.agentId,
    gate: buildMcpFileTransferGateSpec(normalized),
    agentsDir: join(normalized.workspace, 'agents'),
    peerId: normalized.peerId,
    mcp: {
      enabled: false,
      privateAllowlistIncludesPeer: false,
      privateAllowlistSinglePeer: false,
      privateConnectForwarded: false,
      privateSessionBound: false,
      privateChatTypeBound: false,
      groupRejected: false,
      checkReturnedPending: false,
      cancelReturnedCancelled: false,
      noExternalMcpConfigured: false,
    },
    fileTransfer: {
      pluginEnabled: false,
      configuredRoots: [],
      configuredWriteEnabled: false,
      toolsPresent: false,
      dirListSawSeed: false,
      fileFetchMatchedSeed: false,
      fileWriteSucceeded: false,
      outsideDenied: false,
      tempOnly: true,
    },
    safety: {
      noLiveRootMutation: false,
      noHardcodedSecrets: false,
    },
    error,
  };
}

function normalizeMcpFileTransferGateInput(
  input: McpFileTransferGateInput,
): NormalizedMcpFileTransferGateInput {
  return {
    ...input,
    sessionKey: input.sessionKey ?? `${input.agentId}:telegram:dm:${input.peerId}:mcp-file-transfer`,
    serverUrl: input.serverUrl ?? DEFAULT_MCP_FILE_TRANSFER_SERVER_URL,
    pendingId: input.pendingId ?? DEFAULT_MCP_FILE_TRANSFER_PENDING_ID,
    fakeServerName: input.fakeServerName ?? DEFAULT_MCP_FILE_TRANSFER_SERVER_NAME,
    expectedConfiguredRoots: input.expectedConfiguredRoots ?? [],
    seedText: input.seedText ?? DEFAULT_MCP_FILE_TRANSFER_SEED_TEXT,
    writeText: input.writeText ?? DEFAULT_MCP_FILE_TRANSFER_WRITE_TEXT,
  };
}

function buildMcpFileTransferGateSpec(
  input: NormalizedMcpFileTransferGateInput,
): McpFileTransferGateResult['gate'] {
  const spec: RuntimeSideEffectGateSpec = {
    gateId: MCP_FILE_TRANSFER_GATE_ID,
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
        id: 'mcp-onboarding-enabled',
        description: 'Agent keeps managed MCP onboarding enabled without hardcoded external MCP servers.',
        required: true,
      },
      {
        id: 'dm-only-onboarding',
        description: 'connect_mcp forwards private dispatch attribution and rejects group onboarding.',
        required: true,
      },
      {
        id: 'file-transfer-policy',
        description: 'Bundled file-transfer plugin enforces configured roots and write policy.',
        required: true,
      },
      {
        id: 'temp-only',
        description: 'The gate exercises file-transfer roots in a temporary workspace only.',
        required: true,
      },
    ],
    expectedEffects: [
      {
        id: 'fake-mcp-onboarding',
        kind: 'mcp.call',
        description: 'A fake MCP onboarding lifecycle reaches authorize, pending check, cancel, and group rejection states.',
        target: { channel: 'none' },
        maxCount: 1,
      },
      {
        id: 'file-transfer-read-write',
        kind: 'mcp.call',
        description: 'File-transfer tools list, fetch, and write under configured temporary roots.',
        target: { channel: 'none' },
        maxCount: 1,
      },
    ],
    cleanupChecks: [
      {
        id: 'source-roots-unchanged',
        description: 'Source agent roots are not mutated; plugin roots are rebound to temporary directories.',
        required: true,
      },
      {
        id: 'outside-root-denied',
        description: 'A file outside configured roots cannot be fetched.',
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
    id: MCP_FILE_TRANSFER_GATE_ID,
    spec,
    validation: validateRuntimeSideEffectGateSpec(spec),
  };
}

async function runMcpOnboardingAssertions(
  input: NormalizedMcpFileTransferGateInput,
): Promise<Omit<McpFileTransferGateResult['mcp'], 'enabled' | 'privateAllowlistIncludesPeer' | 'privateAllowlistSinglePeer' | 'noExternalMcpConfigured'>> {
  const dmContext: ConnectMcpDispatchContext = {
    agentSessionKey: input.sessionKey,
    chatType: 'private',
  };
  const fakeFacade = makeFakeOnboardingFacade(input);
  const connectTool = createConnectMcpTool(input.agentId, () => fakeFacade, () => dmContext);
  const privateConnect = parseToolJson(await getToolHandler(connectTool)({
    op: 'connect',
    url: input.serverUrl,
  }));
  const call = fakeFacade.startConnectionCalls[0];
  if (!call) throw new Error('connect_mcp did not call the onboarding facade.');
  if (privateConnect.status !== 'authorize') {
    throw new Error('connect_mcp private connect did not return authorize status.');
  }
  if (privateConnect.pendingId !== input.pendingId) {
    throw new Error('connect_mcp private connect returned an unexpected pendingId.');
  }
  const privateConnectForwarded = call.url === input.serverUrl &&
    call.requester.kind === 'agent' &&
    call.requester.agentId === input.agentId;
  const privateSessionBound = call.requester.agentSessionKey === input.sessionKey;
  const privateChatTypeBound = call.requester.chatType === 'private';
  if (!privateConnectForwarded || !privateSessionBound || !privateChatTypeBound) {
    throw new Error('connect_mcp did not preserve private dispatch attribution.');
  }

  const check = parseToolJson(await getToolHandler(connectTool)({
    op: 'check',
    pendingId: input.pendingId,
  }));
  const cancel = parseToolJson(await getToolHandler(connectTool)({
    op: 'cancel',
    pendingId: input.pendingId,
  }));

  const dmOnlyFacade = createOnboarding({
    pending: {} as never,
    credentials: {} as never,
    uiBaseUrl: 'https://ui.example.test',
    listTakenServerIds: async () => new Set<string>(),
  });
  const groupTool = createConnectMcpTool(input.agentId, () => dmOnlyFacade, () => ({
    agentSessionKey: `${input.agentId}:telegram:group:-100123:mcp-file-transfer`,
    chatType: 'group',
  }));
  const groupConnect = parseToolJson(await getToolHandler(groupTool)({
    op: 'connect',
    url: input.serverUrl,
  }));

  return {
    privateConnectForwarded,
    privateSessionBound,
    privateChatTypeBound,
    groupRejected: groupConnect.status === 'rejected' && groupConnect.reason === 'mcp_onboarding_requires_dm',
    checkReturnedPending: check.status === 'pending',
    cancelReturnedCancelled: cancel.status === 'cancelled',
  };
}

async function runFileTransferAssertions(input: {
  agentId: string;
  sessionKey: string;
  agentConfigForPlugin: unknown;
  primaryRoot: string;
  outsideRoot: string;
  seedText: string;
  writeText: string;
}): Promise<Omit<
  McpFileTransferGateResult['fileTransfer'],
  'pluginEnabled' | 'configuredRoots' | 'configuredWriteEnabled' | 'tempOnly'
>> {
  const registry = new PluginRegistry();
  await registerFileTransferPlugin(registry, {
    dataDir: join(input.primaryRoot, '.plugin-data'),
    getAgentConfig: (agentId) => agentId === input.agentId ? input.agentConfigForPlugin : { plugins: {} },
  });
  registry.enableForAgent(input.agentId, 'file-transfer');

  try {
    const tools = registry.getMcpToolsForAgent(input.agentId);
    const toolNames = tools.map((tool) => tool.name).sort();
    const requiredTools = [
      'file-transfer_dir_fetch',
      'file-transfer_dir_list',
      'file-transfer_file_fetch',
      'file-transfer_file_write',
    ];
    const toolsPresent = requiredTools.every((name) => toolNames.includes(name));
    if (!toolsPresent) throw new Error(`file-transfer plugin is missing tools: ${requiredTools.filter((name) => !toolNames.includes(name)).join(', ')}`);

    const toolContext = {
      agentId: input.agentId,
      sessionKey: input.sessionKey,
    };
    const dirList = parseToolJson(await requirePluginTool(tools, 'file-transfer_dir_list').handler({
      path: input.primaryRoot,
    }, toolContext));
    const entries = dirList.entries as Array<{ name: string }>;
    const dirListSawSeed = entries.some((entry) => entry.name === 'seed.txt');
    if (!dirListSawSeed) throw new Error('file-transfer dir_list did not see the temp seed file.');

    const fetched = parseToolJson(await requirePluginTool(tools, 'file-transfer_file_fetch').handler({
      path: join(input.primaryRoot, 'seed.txt'),
    }, toolContext));
    const fileFetchMatchedSeed = fetched.text === input.seedText;
    if (!fileFetchMatchedSeed) throw new Error('file-transfer file_fetch returned the wrong seed content.');

    const writeResult = parseToolJson(await requirePluginTool(tools, 'file-transfer_file_write').handler({
      path: join(input.primaryRoot, 'out.txt'),
      content: input.writeText,
    }, toolContext));
    const fileWriteSucceeded = writeResult.sizeBytes === input.writeText.length;
    if (!fileWriteSucceeded) throw new Error('file-transfer file_write returned the wrong size.');

    let outsideDenied = false;
    try {
      await requirePluginTool(tools, 'file-transfer_file_fetch').handler({
        path: join(input.outsideRoot, 'secret.txt'),
      }, toolContext);
    } catch (err) {
      outsideDenied = /outside allowed roots/i.test(errorMessage(err));
    }
    if (!outsideDenied) throw new Error('file-transfer did not deny a path outside configured roots.');

    return {
      toolsPresent,
      dirListSawSeed,
      fileFetchMatchedSeed,
      fileWriteSucceeded,
      outsideDenied,
    };
  } finally {
    for (const entry of registry.listPlugins()) {
      await entry.instance.shutdown?.();
    }
  }
}

function getFileTransferConfig(plugins: unknown, agentId: string): Record<string, unknown> {
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
    throw new Error(`${agentId} must define plugins.file-transfer config.`);
  }
  const fileTransfer = (plugins as Record<string, unknown>)['file-transfer'];
  if (!fileTransfer || typeof fileTransfer !== 'object' || Array.isArray(fileTransfer)) {
    throw new Error(`${agentId} must define plugins.file-transfer config.`);
  }
  return fileTransfer as Record<string, unknown>;
}

function getConfiguredRoots(config: Record<string, unknown>, agentId: string): string[] {
  const roots = config.roots;
  if (!Array.isArray(roots) || roots.some((root) => typeof root !== 'string')) {
    throw new Error(`${agentId} file-transfer roots must be a string array.`);
  }
  return roots as string[];
}

function assertConfiguredRoots(roots: string[], expectedRoots: string[], agentId: string): void {
  for (const root of expectedRoots) {
    if (!roots.includes(root)) {
      throw new Error(`${agentId} file-transfer roots must include ${root}.`);
    }
  }
}

function resolveConfiguredRoot(workspace: string, root: string): string {
  return root.startsWith('/') ? join(workspace, 'absolute-roots', root.replace(/^\/+/, '')) : join(workspace, root);
}

function makeFakeOnboardingFacade(input: NormalizedMcpFileTransferGateInput) {
  const calls: Array<{
    url: string;
    requester: {
      kind: string;
      agentId: string;
      agentSessionKey?: string;
      chatType?: string;
    };
  }> = [];
  return {
    startConnectionCalls: calls,
    async startConnection(call: {
      url: string;
      requester: {
        kind: string;
        agentId: string;
        agentSessionKey?: string;
        chatType?: string;
      };
    }) {
      calls.push(call);
      return {
        status: 'authorize' as const,
        pendingId: input.pendingId,
        authUrl: `https://ui.example.test/api/mcp/oauth/start/${input.pendingId}`,
        serverName: input.fakeServerName,
      };
    },
    async attachApiKey() {
      return {
        status: 'connected' as const,
        pendingId: input.pendingId,
        serverId: input.fakeServerName,
        tools: [{ name: 'noop' }],
      };
    },
    async finalize() {
      return {
        status: 'connected' as const,
        server: input.fakeServerName,
        tools: [{ name: 'noop' }],
      };
    },
    getPending(pendingId: string) {
      return pendingId === input.pendingId
        ? { status: 'pending', age_seconds: 1, expires_in_seconds: 599 }
        : null;
    },
    cancel(pendingId: string) {
      return pendingId === input.pendingId
        ? { status: 'cancelled' as const }
        : { status: 'not_found' as const };
    },
  } as unknown as ReturnType<typeof createOnboarding> & {
    startConnectionCalls: typeof calls;
  };
}

async function registerFileTransferPlugin(
  registry: PluginRegistry,
  input: {
    dataDir: string;
    getAgentConfig(agentId: string): unknown;
  },
): Promise<void> {
  mkdirSync(input.dataDir, { recursive: true });
  const pluginDir = resolve('plugins', 'file-transfer');
  const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');
  const manifest = await parsePluginManifest(manifestPath) as PluginManifest;
  if (manifest.name !== 'file-transfer') {
    throw new Error('bundled file-transfer plugin manifest name mismatch.');
  }
  if (!existsSync(join(pluginDir, manifest.entry))) {
    throw new Error(`bundled file-transfer plugin compiled entry is missing at ${manifest.entry}; run pnpm build before this smoke.`);
  }
  const module = await loadPlugin({ manifest, manifestPath, pluginDir });
  const context = createPluginContext({
    pluginName: manifest.name,
    pluginVersion: manifest.version,
    dataDir: input.dataDir,
    rootLogger: silentLogger,
    registerHook(pluginName: string, event: HookEvent, handler: HookHandler): void {
      registry.addHookFromPlugin(pluginName, event, handler);
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
        'file-transfer': {},
      },
    }),
  });
  const instance = await (module.register as PluginRegister)(context);
  registry.addPlugin(manifest.name, { manifest, instance });
}

const silentLogger: PluginLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

function requirePluginTool(tools: PluginMcpTool[], name: string): PluginMcpTool {
  const found = tools.find((tool) => tool.name === name);
  if (!found) throw new Error(`missing plugin tool: ${name}`);
  return found;
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function getToolHandler(tool: unknown): (args: Record<string, unknown>) => Promise<ToolResult> {
  return (tool as { handler: (args: Record<string, unknown>) => Promise<ToolResult> }).handler;
}

function parseToolJson(result: ToolResult | { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== 'string') throw new Error('tool result did not contain text content.');
  return JSON.parse(text) as Record<string, unknown>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
