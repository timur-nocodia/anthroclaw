import 'dotenv/config';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { HeadlessRunInput, HeadlessRuntime } from '../runtime/headless.js';
import { GlobalConfigSchema } from '../config/schema.js';
import { Gateway } from '../gateway.js';
import { createPluginContext } from '../plugins/context.js';
import { loadPlugin } from '../plugins/loader.js';
import { parsePluginManifest } from '../plugins/manifest-schema.js';
import { PluginRegistry } from '../plugins/registry.js';
import { runSubagent } from '../plugins/subagent-runner.js';
import type {
  HookEvent,
  HookHandler,
  PluginContext,
  PluginInstance,
  PluginMcpTool,
  PluginLogger,
  SearchAgentMemoryInput,
  SyntheticInboundInput,
} from '../plugins/types.js';
import { DEFAULT_PI_MODEL_ID } from '../runtime/pi-headless.js';

interface PiPluginsContextCanaryArgs {
  json: boolean;
  keepWorkspace: boolean;
  gateway: boolean;
  allowSkip: boolean;
  model?: string;
  authPath?: string;
  modelsPath?: string;
  timeoutMs: number;
  help: boolean;
}

interface PiPluginsContextCanaryDeps {
  GatewayCtor?: new () => Gateway;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiPluginsContextCanaryResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  scenario: 'pi.plugins-context-tools';
  durationMs: number;
  workspacePath?: string;
  assertions: Record<string, unknown>;
  error?: string;
}

const SCENARIO_ID = 'pi.plugins-context-tools' as const;
const AGENT_ID = 'pi-plugin-canary-agent';
const DISABLED_AGENT_ID = 'pi-plugin-disabled-agent';
const PLUGIN_NAME = 'pi-canary-plugin';
const SESSION_KEY = `${AGENT_ID}:telegram:dm:pi-plugin-peer`;
const BUNDLED_LCM_AGENT_ID = 'pi-bundled-lcm-agent';
const BUNDLED_OPERATOR_AGENT_ID = 'pi-bundled-operator-agent';
const BUNDLED_FILE_AGENT_ID = 'pi-bundled-file-agent';
const BUNDLED_MANAGED_AGENT_ID = 'pi-bundled-managed-agent';
type PluginRegister = (ctx: PluginContext) => Promise<PluginInstance> | PluginInstance;
interface LoadedBundledPlugin {
  register: PluginRegister;
  manifest: {
    name: 'lcm' | 'operator-console' | 'file-transfer';
    version: string;
    description?: string;
    entry: string;
  };
}

export async function runPiPluginsContextCanaryCli(
  argv: string[],
  deps: PiPluginsContextCanaryDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiPluginsContextCanaryArgs;

  try {
    args = parsePiPluginsContextCanaryArgs(argv);
  } catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    stderr.write(`${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const startedAt = Date.now();
  let workspacePath: string | undefined;

  try {
    workspacePath = await mkdtemp(join(tmpdir(), 'pi-plugins-context-canary-'));
    const gatewayAssertions = await runGatewayPluginCanary({
      GatewayCtor: deps.GatewayCtor ?? Gateway,
      workspacePath,
      authPath: args.authPath,
      modelsPath: args.modelsPath,
    });
    const subagentAssertions = await runPluginSubagentCanary({
      model: args.model ?? DEFAULT_PI_MODEL_ID,
      timeoutMs: args.timeoutMs,
    });
    const bundledAssertions = await runBundledPluginsCanary({ workspacePath });
    const result: PiPluginsContextCanaryResult = {
      status: 'passed',
      runtime: 'pi',
      scenario: SCENARIO_ID,
      durationMs: Date.now() - startedAt,
      ...(args.keepWorkspace ? { workspacePath } : {}),
      assertions: {
        ...gatewayAssertions,
        subagent: subagentAssertions,
        bundled: bundledAssertions,
      },
    };
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const status = args.allowSkip && isSkippableCanaryError(error) ? 'skipped' : 'failed';
    const result: PiPluginsContextCanaryResult = {
      status,
      runtime: 'pi',
      scenario: SCENARIO_ID,
      durationMs: Date.now() - startedAt,
      ...(workspacePath ? { workspacePath } : {}),
      assertions: {},
      error,
    };
    writeResult(status === 'failed' ? stderr : stdout, args.json, result);
    return status === 'skipped' ? 0 : 1;
  } finally {
    if (workspacePath && !args.keepWorkspace) {
      await rm(workspacePath, { recursive: true, force: true });
    }
  }
}

async function runBundledPluginsCanary(input: { workspacePath: string }): Promise<Record<string, unknown>> {
  const workspacePath = resolve(input.workspacePath);
  const dataDir = join(workspacePath, 'bundled-data');
  const safeRoot = join(workspacePath, 'file-transfer-root');
  const outsideRoot = join(workspacePath, 'outside-root');
  await mkdir(safeRoot, { recursive: true });
  await mkdir(outsideRoot, { recursive: true });
  await writeFile(join(safeRoot, 'note.txt'), 'bundled file transfer marker', 'utf8');
  await writeFile(join(outsideRoot, 'secret.txt'), 'outside marker', 'utf8');

  const registry = new PluginRegistry();
  const dispatched: SyntheticInboundInput[] = [];
  const memorySearches: SearchAgentMemoryInput[] = [];
  const escalations: unknown[] = [];

  const getAgentConfig = (agentId: string): unknown => {
    if (agentId === BUNDLED_LCM_AGENT_ID) {
      return {
        plugins: {
          lcm: {
            enabled: true,
            triggers: {
              compress_threshold_tokens: 16,
              fresh_tail_count: 1,
            },
          },
        },
      };
    }
    if (agentId === BUNDLED_OPERATOR_AGENT_ID) {
      return {
        plugins: {
          'operator-console': {
            enabled: true,
            manages: [BUNDLED_MANAGED_AGENT_ID],
            capabilities: ['delegate', 'peer_summary', 'escalate'],
          },
        },
      };
    }
    if (agentId === BUNDLED_FILE_AGENT_ID) {
      return {
        plugins: {
          'file-transfer': {
            enabled: true,
            roots: [safeRoot],
            allowWrite: true,
            maxFileBytes: 4096,
            maxEntries: 20,
          },
        },
      };
    }
    return { plugins: {} };
  };
  const getGlobalConfig = (): unknown => ({
    plugins: {
      lcm: { defaults: {} },
      'operator-console': {
        enabled: true,
        manages: '*',
        capabilities: ['peer_pause', 'delegate', 'list_peers', 'peer_summary', 'escalate'],
      },
      'file-transfer': {},
    },
  });

  await registerBundledPlugin(registry, {
    pluginName: 'lcm',
    dataDir: join(dataDir, 'lcm'),
    getAgentConfig,
    getGlobalConfig,
    runSubagent: async () => 'bundled lcm canary subagent result',
  });
  await registerBundledPlugin(registry, {
    pluginName: 'operator-console',
    dataDir: join(dataDir, 'operator-console'),
    getAgentConfig,
    getGlobalConfig,
    dispatchSyntheticInbound: async (dispatchInput) => {
      dispatched.push(dispatchInput);
      return {
        messageId: 'bundled-delegation-message',
        sessionKey: `${dispatchInput.targetAgentId}:${dispatchInput.channel}:dm:${dispatchInput.peerId}`,
      };
    },
    searchAgentMemory: async (searchInput) => {
      memorySearches.push(searchInput);
      return {
        results: [{
          path: `${searchInput.targetAgentId}/memory.md`,
          snippet: `bundled operator-console memory hit for ${searchInput.query}`,
          score: 0.9,
        }],
      };
    },
    getNotificationsEmitter: () => ({
      async emit(event: string, payload: unknown) {
        escalations.push({ event, payload });
      },
    }),
  });
  await registerBundledPlugin(registry, {
    pluginName: 'file-transfer',
    dataDir: join(dataDir, 'file-transfer'),
    getAgentConfig,
    getGlobalConfig,
  });

  registry.enableForAgent(BUNDLED_LCM_AGENT_ID, 'lcm');
  registry.enableForAgent(BUNDLED_OPERATOR_AGENT_ID, 'operator-console');
  registry.enableForAgent(BUNDLED_FILE_AGENT_ID, 'file-transfer');

  try {
    const entries = registry.listPlugins();
    const loaded = entries.map((entry) => entry.manifest.name).sort();
    const manifestEntries = Object.fromEntries(entries
      .map((entry) => [entry.manifest.name, entry.manifest.entry])
      .sort(([left], [right]) => left.localeCompare(right)));
    assert(loaded.includes('lcm'), 'bundled lcm plugin was not loaded');
    assert(loaded.includes('operator-console'), 'bundled operator-console plugin was not loaded');
    assert(loaded.includes('file-transfer'), 'bundled file-transfer plugin was not loaded');
    assert(manifestEntries.lcm === 'dist/index.js', 'bundled lcm canary did not use compiled manifest entry');
    assert(manifestEntries['operator-console'] === 'dist/index.js', 'bundled operator-console canary did not use compiled manifest entry');
    assert(manifestEntries['file-transfer'] === 'dist/index.js', 'bundled file-transfer canary did not use compiled manifest entry');

    const lcm = await runBundledLcmAssertions(registry);
    const operatorConsole = await runBundledOperatorConsoleAssertions(registry, {
      dispatched,
      memorySearches,
      escalations,
    });
    const fileTransfer = await runBundledFileTransferAssertions(registry, {
      safeRoot,
      outsideRoot,
    });

    return {
      loadedPlugins: loaded,
      manifestEntries,
      lcm,
      operatorConsole,
      fileTransfer,
    };
  } finally {
    for (const entry of registry.listPlugins()) {
      await entry.instance.shutdown?.();
    }
  }
}

async function registerBundledPlugin(
  registry: PluginRegistry,
  input: {
    pluginName: 'lcm' | 'operator-console' | 'file-transfer';
    dataDir: string;
    getAgentConfig(agentId: string): unknown;
    getGlobalConfig(): unknown;
    runSubagent?: PluginContext['runSubagent'];
    getNotificationsEmitter?: () => unknown;
    dispatchSyntheticInbound?: PluginContext['dispatchSyntheticInbound'];
    searchAgentMemory?: PluginContext['searchAgentMemory'];
  },
): Promise<void> {
  await mkdir(input.dataDir, { recursive: true });
  const loaded = await loadBundledPlugin(input.pluginName);
  const context = createPluginContext({
    pluginName: input.pluginName,
    pluginVersion: loaded.manifest.version,
    dataDir: input.dataDir,
    rootLogger: silentLogger,
    registerHook(pluginName: string, event: HookEvent, handler: HookHandler): void {
      registry.addHookFromPlugin(pluginName, event, handler);
    },
    registerTool(tool: PluginMcpTool): void {
      registry.addToolFromPlugin(input.pluginName, tool);
    },
    registerEngine(pluginName: string, engine): void {
      registry.addEngineFromPlugin(pluginName, engine);
    },
    registerCommand(cmd): void {
      registry.addCommandFromPlugin(input.pluginName, cmd);
    },
    getAgentConfig: input.getAgentConfig,
    getGlobalConfig: input.getGlobalConfig,
    ...(input.runSubagent ? { runSubagent: input.runSubagent } : {}),
    ...(input.getNotificationsEmitter ? { getNotificationsEmitter: input.getNotificationsEmitter } : {}),
    ...(input.dispatchSyntheticInbound ? { dispatchSyntheticInbound: input.dispatchSyntheticInbound } : {}),
    ...(input.searchAgentMemory ? { searchAgentMemory: input.searchAgentMemory } : {}),
  });
  const instance = await loaded.register(context);
  registry.addPlugin(input.pluginName, {
    manifest: loaded.manifest,
    instance,
  });
}

async function loadBundledPlugin(pluginName: 'lcm' | 'operator-console' | 'file-transfer'): Promise<LoadedBundledPlugin> {
  const pluginDir = resolve('plugins', pluginName);
  const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');
  const manifest = await parsePluginManifest(manifestPath);
  assert(manifest.name === pluginName, `bundled plugin manifest name mismatch for ${pluginName}`);
  assert(
    existsSync(join(pluginDir, manifest.entry)),
    `bundled plugin ${pluginName} compiled entry is missing at ${manifest.entry}; run pnpm build before this canary`,
  );
  const module = await loadPlugin({
    manifest: manifest as never,
    manifestPath,
    pluginDir,
  });
  return {
    register: module.register as PluginRegister,
    manifest: manifest as LoadedBundledPlugin['manifest'],
  };
}

const silentLogger: PluginLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

async function runBundledLcmAssertions(registry: PluginRegistry): Promise<Record<string, unknown>> {
  const sessionKey = `${BUNDLED_LCM_AGENT_ID}:telegram:dm:bundled-lcm-peer`;
  const tools = registry.getMcpToolsForAgent(BUNDLED_LCM_AGENT_ID);
  const toolNames = tools.map((tool) => tool.name).sort();
  for (const name of ['lcm_describe', 'lcm_doctor', 'lcm_expand', 'lcm_expand_query', 'lcm_grep', 'lcm_status']) {
    assert(toolNames.includes(name), `bundled lcm missing tool ${name}`);
  }
  const hook = registry
    .listAllHooks()
    .find((candidate) => candidate.pluginName === 'lcm' && candidate.event === 'on_after_query');
  assert(hook, 'bundled lcm mirror hook was not registered');
  await Promise.resolve(hook.handler({
    agentId: BUNDLED_LCM_AGENT_ID,
    sessionKey,
    source: 'telegram',
    newMessages: [
      { role: 'user', content: 'BUNDLED-LCM-MARKER: remember the runtime plugin canary', ts: 1000 },
      { role: 'assistant', content: 'The bundled LCM canary marker was mirrored.', ts: 1001 },
    ],
  }));

  const grepTool = requireTool(tools, 'lcm_grep');
  const grep = parseToolJson(await grepTool.handler({
    query: 'BUNDLED-LCM-MARKER',
    limit: 3,
  }, {
    agentId: BUNDLED_LCM_AGENT_ID,
    sessionKey,
  }));
  assert(Array.isArray(grep.results) && grep.results.length >= 1, 'bundled lcm grep did not find mirrored message');

  const statusTool = requireTool(tools, 'lcm_status');
  const status = parseToolJson(await statusTool.handler({}, {
    agentId: BUNDLED_LCM_AGENT_ID,
    sessionKey,
  }));
  assert((status.store as { messages?: number } | undefined)?.messages === 2, 'bundled lcm status did not count mirrored messages');

  const engineEntry = registry.getContextEngine(BUNDLED_LCM_AGENT_ID);
  assert(engineEntry?.name === 'lcm', 'bundled lcm context engine was not active');
  const assembleResult = await engineEntry.engine.assemble?.({
    agentId: BUNDLED_LCM_AGENT_ID,
    sessionKey,
    messages: [{ role: 'user', content: 'assemble bundled lcm context' }],
  });
  assert(Array.isArray(assembleResult?.messages), 'bundled lcm assemble did not return messages');
  const compressResult = await engineEntry.engine.compress?.({
    agentId: BUNDLED_LCM_AGENT_ID,
    sessionKey,
    messages: [
      { role: 'system', content: 'bundled lcm canary system prompt', ts: 1002 },
      { role: 'user', content: 'compress bundled lcm context backlog alpha beta gamma delta', ts: 1003 },
      { role: 'assistant', content: 'compress bundled lcm context backlog epsilon zeta eta theta', ts: 1004 },
      { role: 'user', content: 'fresh bundled lcm tail message', ts: 1005 },
    ],
    currentTokens: 100_000,
  });
  assert(Array.isArray(compressResult?.messages), 'bundled lcm compress did not return compressed messages');

  return {
    tools: toolNames.length,
    mirrorHook: true,
    grepHits: (grep.results as unknown[]).length,
    statusMessages: (status.store as { messages: number }).messages,
    assembleMessages: assembleResult.messages.length,
    compressTriggered: true,
  };
}

async function runBundledOperatorConsoleAssertions(
  registry: PluginRegistry,
  spies: {
    dispatched: SyntheticInboundInput[];
    memorySearches: SearchAgentMemoryInput[];
    escalations: unknown[];
  },
): Promise<Record<string, unknown>> {
  const tools = registry.getMcpToolsForAgent(BUNDLED_OPERATOR_AGENT_ID);
  const toolNames = tools.map((tool) => tool.name).sort();
  for (const name of [
    'operator-console_delegate_to_peer',
    'operator-console_escalate',
    'operator-console_peer_summary',
  ]) {
    assert(toolNames.includes(name), `bundled operator-console missing tool ${name}`);
  }

  const peerSummary = parseToolJson(await requireTool(tools, 'operator-console_peer_summary').handler({
    target_agent_id: BUNDLED_MANAGED_AGENT_ID,
    peer: {
      channel: 'whatsapp',
      peer_id: 'bundled-managed-peer',
    },
    query: 'runtime plugin canary',
    max_results: 2,
  }, {
    agentId: BUNDLED_OPERATOR_AGENT_ID,
  }));
  assert(peerSummary.ok === true, 'bundled operator-console peer_summary did not authorize managed target');
  assert(peerSummary.target_agent_id === BUNDLED_MANAGED_AGENT_ID, 'bundled operator-console peer_summary used wrong target');
  assert(spies.memorySearches.length === 1, 'bundled operator-console peer_summary did not call memory search');

  const delegated = parseToolJson(await requireTool(tools, 'operator-console_delegate_to_peer').handler({
    target_agent_id: BUNDLED_MANAGED_AGENT_ID,
    peer: {
      channel: 'whatsapp',
      peer_id: 'bundled-managed-peer',
    },
    instruction: 'exercise bundled operator-console dispatch',
  }, {
    agentId: BUNDLED_OPERATOR_AGENT_ID,
  }));
  assert(delegated.ok === true, 'bundled operator-console delegate did not dispatch authorized target');
  assert(spies.dispatched.length === 1, 'bundled operator-console delegate did not call dispatch');
  const dispatchPayload = spies.dispatched[0];
  assert(dispatchPayload.targetAgentId === BUNDLED_MANAGED_AGENT_ID, 'bundled operator-console delegate used wrong target');
  assert(dispatchPayload.channel === 'whatsapp', 'bundled operator-console delegate used wrong channel');
  assert(dispatchPayload.peerId === 'bundled-managed-peer', 'bundled operator-console delegate used wrong peer');
  assert(dispatchPayload.text.includes('exercise bundled operator-console dispatch'), 'bundled operator-console delegate lost instruction text');
  assert(dispatchPayload.meta?.source === 'mcp:operator-console', 'bundled operator-console delegate lost source metadata');

  const deniedDelegate = parseToolJson(await requireTool(tools, 'operator-console_delegate_to_peer').handler({
    target_agent_id: 'unmanaged-agent',
    peer: {
      channel: 'telegram',
      peer_id: 'unmanaged-peer',
    },
    instruction: 'this must not dispatch',
  }, {
    agentId: BUNDLED_OPERATOR_AGENT_ID,
  }));
  assert(String(deniedDelegate.error ?? '').includes('not authorized'), 'bundled operator-console delegate did not enforce manages policy');
  assert(spies.dispatched.length === 1, 'bundled operator-console denied delegate still dispatched');

  const escalation = parseToolJson(await requireTool(tools, 'operator-console_escalate').handler({
    message: 'operator-console bundled canary escalation',
    priority: 'high',
  }, {
    agentId: BUNDLED_OPERATOR_AGENT_ID,
  }));
  assert(escalation.ok === true, 'bundled operator-console escalate did not emit successfully');
  assert(escalation.agentId === BUNDLED_OPERATOR_AGENT_ID, 'bundled operator-console escalate lost caller attribution');
  assert(spies.escalations.length === 1, 'bundled operator-console escalate did not reach notifications emitter');
  const emitted = spies.escalations[0] as { event?: unknown; payload?: Record<string, unknown> } | undefined;
  assert(emitted?.event === 'escalation_needed', 'bundled operator-console emitted wrong escalation event');
  assert(emitted.payload?.agentId === BUNDLED_OPERATOR_AGENT_ID, 'bundled operator-console escalation payload lost agent id');
  assert(emitted.payload?.priority === 'high', 'bundled operator-console escalation payload lost priority');
  assert(emitted.payload?.message === 'operator-console bundled canary escalation', 'bundled operator-console escalation payload lost message');

  return {
    tools: toolNames.length,
    peerSummaryAuthorized: true,
    delegateDispatched: true,
    delegateDenied: true,
    escalation: true,
  };
}

async function runBundledFileTransferAssertions(
  registry: PluginRegistry,
  paths: { safeRoot: string; outsideRoot: string },
): Promise<Record<string, unknown>> {
  const tools = registry.getMcpToolsForAgent(BUNDLED_FILE_AGENT_ID);
  const toolNames = tools.map((tool) => tool.name).sort();
  for (const name of [
    'file-transfer_dir_fetch',
    'file-transfer_dir_list',
    'file-transfer_file_fetch',
    'file-transfer_file_write',
  ]) {
    assert(toolNames.includes(name), `bundled file-transfer missing tool ${name}`);
  }

  const dirList = parseToolJson(await requireTool(tools, 'file-transfer_dir_list').handler({
    path: paths.safeRoot,
  }, {
    agentId: BUNDLED_FILE_AGENT_ID,
  }));
  const entries = dirList.entries as Array<{ name: string }>;
  assert(entries.some((entry) => entry.name === 'note.txt'), 'bundled file-transfer dir_list missed safe file');

  const fetched = parseToolJson(await requireTool(tools, 'file-transfer_file_fetch').handler({
    path: join(paths.safeRoot, 'note.txt'),
  }, {
    agentId: BUNDLED_FILE_AGENT_ID,
  }));
  assert(fetched.text === 'bundled file transfer marker', 'bundled file-transfer file_fetch returned wrong text');

  const writeResult = parseToolJson(await requireTool(tools, 'file-transfer_file_write').handler({
    path: join(paths.safeRoot, 'out.txt'),
    content: 'written by bundled file-transfer canary',
  }, {
    agentId: BUNDLED_FILE_AGENT_ID,
  }));
  assert(writeResult.sizeBytes === 'written by bundled file-transfer canary'.length, 'bundled file-transfer file_write returned wrong size');

  let outsideDenied = false;
  try {
    await requireTool(tools, 'file-transfer_file_fetch').handler({
      path: join(paths.outsideRoot, 'secret.txt'),
    }, {
      agentId: BUNDLED_FILE_AGENT_ID,
    });
  } catch (err) {
    outsideDenied = /outside allowed roots/i.test(err instanceof Error ? err.message : String(err));
  }
  assert(outsideDenied, 'bundled file-transfer did not enforce path boundary');

  return {
    tools: toolNames.length,
    dirListEntries: entries.length,
    fileFetch: true,
    fileWrite: true,
    outsideDenied,
  };
}

export function parsePiPluginsContextCanaryArgs(argv: string[]): PiPluginsContextCanaryArgs {
  const args: PiPluginsContextCanaryArgs = {
    json: false,
    keepWorkspace: false,
    gateway: false,
    allowSkip: false,
    model: DEFAULT_PI_MODEL_ID,
    timeoutMs: 60_000,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--':
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--keep-workspace':
        args.keepWorkspace = true;
        break;
      case '--gateway':
        args.gateway = true;
        break;
      case '--allow-skip':
        args.allowSkip = true;
        break;
      case '--model':
        args.model = requireValue(argv, ++i, '--model');
        break;
      case '--auth-path':
        args.authPath = requireValue(argv, ++i, '--auth-path');
        break;
      case '--models-path':
        args.modelsPath = requireValue(argv, ++i, '--models-path');
        break;
      case '--timeout-ms':
        args.timeoutMs = parsePositiveInt(requireValue(argv, ++i, '--timeout-ms'), '--timeout-ms');
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function runGatewayPluginCanary(input: {
  GatewayCtor: new () => Gateway;
  workspacePath: string;
  authPath?: string;
  modelsPath?: string;
}): Promise<Record<string, unknown>> {
  const workspacePath = resolve(input.workspacePath);
  const agentsDir = join(workspacePath, 'agents');
  const dataDir = join(workspacePath, 'data');
  const pluginsDir = join(workspacePath, 'plugins');
  await writeCanaryAgent(agentsDir, AGENT_ID, true);
  await writeCanaryAgent(agentsDir, DISABLED_AGENT_ID, false);
  await writeCanaryPlugin(pluginsDir, dataDir);

  const gateway = new input.GatewayCtor();
  const pluginDataDir = join(dataDir, PLUGIN_NAME);
  let pluginLoaded = false;
  try {
    await gateway.start(GlobalConfigSchema.parse({
      defaults: {
        model: DEFAULT_PI_MODEL_ID,
        embedding_provider: 'off',
        embedding_model: 'text-embedding-3-small',
        debounce_ms: 0,
      },
      runtime: {
        headless: {
          provider: 'pi',
          ...(input.authPath || input.modelsPath
            ? { pi: { ...(input.authPath ? { auth_path: input.authPath } : {}), ...(input.modelsPath ? { models_path: input.modelsPath } : {}) } }
            : {}),
        },
      },
    }), agentsDir, dataDir, pluginsDir);

    const loadedPlugins = gateway.pluginRegistry.listPlugins().map((entry) => entry.manifest.name);
    assert(loadedPlugins.includes(PLUGIN_NAME), 'canary plugin was not loaded');
    pluginLoaded = true;
    assert(gateway.pluginRegistry.isEnabledFor(AGENT_ID, PLUGIN_NAME), 'canary plugin was not enabled for the canary agent');
    assert(!gateway.pluginRegistry.isEnabledFor(DISABLED_AGENT_ID, PLUGIN_NAME), 'canary plugin leaked into disabled agent');

    const enabledTools = gateway.pluginRegistry.getMcpToolsForAgent(AGENT_ID);
    const disabledTools = gateway.pluginRegistry.getMcpToolsForAgent(DISABLED_AGENT_ID);
    const toolNames = enabledTools.map((tool) => tool.name).sort();
    assert(toolNames.includes(`${PLUGIN_NAME}_inspect`), 'read-only plugin tool was not exposed');
    assert(toolNames.includes(`${PLUGIN_NAME}_policy_gate`), 'policy-sensitive plugin tool was not exposed');
    assert(disabledTools.length === 0, 'plugin tools were exposed to disabled agent');

    const inspectTool = enabledTools.find((tool) => tool.name === `${PLUGIN_NAME}_inspect`);
    const policyTool = enabledTools.find((tool) => tool.name === `${PLUGIN_NAME}_policy_gate`);
    assert(inspectTool, 'missing inspect tool');
    assert(policyTool, 'missing policy gate tool');

    const inspectText = firstText(await inspectTool.handler({ marker: 'inspect-marker' }, {
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    }));
    assert(inspectText.includes(AGENT_ID), 'read-only plugin tool lost agent context');
    assert(inspectText.includes(SESSION_KEY), 'read-only plugin tool lost session context');
    assert(inspectText.includes('inspect-marker'), 'read-only plugin tool lost input payload');

    const deniedText = firstText(await policyTool.handler({ action: 'write' }, {
      agentId: AGENT_ID,
      sessionKey: 'wrong-session',
    }));
    assert(deniedText.includes('denied'), 'policy-sensitive plugin tool did not reject wrong session');
    const allowedText = firstText(await policyTool.handler({ action: 'write' }, {
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    }));
    assert(allowedText.includes('allowed'), 'policy-sensitive plugin tool did not accept allowed session');

    const hooks = gateway.pluginRegistry.listAllHooks();
    const afterQueryHook = hooks.find((hook) => hook.pluginName === PLUGIN_NAME && hook.event === 'on_after_query');
    assert(afterQueryHook, 'canary plugin hook was not registered');
    const emitter = gateway._hookEmitters.get(AGENT_ID);
    assert(emitter, 'canary agent hook emitter was not created');
    await emitter.emit('on_after_query', {
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
      newMessages: [{ role: 'user', content: 'plugin hook marker' }],
    });
    const hookLog = await readFile(join(pluginDataDir, 'hook.jsonl'), 'utf8');
    assert(hookLog.includes(AGENT_ID) && hookLog.includes(SESSION_KEY), 'plugin hook payload lost agent/session attribution');

    const engineEntry = gateway.pluginRegistry.getContextEngine(AGENT_ID);
    assert(engineEntry?.name === PLUGIN_NAME, 'canary context engine was not selected for agent');
    const assembleResult = await engineEntry.engine.assemble?.({
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
      messages: [{ role: 'user', content: 'assemble input' }],
    });
    assert(Array.isArray(assembleResult?.messages), 'context engine assemble did not return messages');
    assert(JSON.stringify(assembleResult).includes('canary-assembled'), 'context engine assemble did not transform context');
    const compressResult = await engineEntry.engine.compress?.({
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
      messages: [{ role: 'user', content: 'compress input' }],
      currentTokens: 50_000,
    });
    assert(Array.isArray(compressResult?.messages), 'context engine compress did not return messages');
    assert(JSON.stringify(compressResult).includes('canary-compressed'), 'context engine compress did not transform context');

    return {
      gateway: true,
      loadedPlugins: loadedPlugins.length,
      enabledForAgent: true,
      disabledAgentTools: disabledTools.length,
      toolNames,
      readOnlyTool: true,
      policyTool: true,
      hooks: hooks.length,
      contextEngine: engineEntry.name,
      assembleMessages: assembleResult.messages.length,
      compressMessages: compressResult.messages.length,
      sessionAttribution: true,
    };
  } finally {
    await gateway.stop();
    if (pluginLoaded) {
      assert(existsSync(join(pluginDataDir, 'shutdown.log')), 'plugin shutdown did not run');
    }
  }
}

async function runPluginSubagentCanary(input: {
  model: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  let seenInput: HeadlessRunInput | undefined;
  const runtime: HeadlessRuntime = {
    id: 'pi-canary-headless',
    async runText(runInput) {
      seenInput = runInput;
      return 'plugin subagent canary result';
    },
  };

  const result = await runSubagent({
    prompt: 'Summarize plugin canary state.',
    systemPrompt: 'Return a compact canary summary.',
    model: input.model,
    timeoutMs: input.timeoutMs,
    runtime,
  });

  assert(result === 'plugin subagent canary result', 'plugin subagent runner returned unexpected text');
  assert(seenInput?.purpose === 'runSubagent', 'plugin subagent runner did not tag purpose');
  assert(seenInput?.toolDenyMessage === 'Tools disabled in plugin subagent.', 'plugin subagent runner did not request tool denial');
  assert(!seenInput?.customTools?.length, 'plugin subagent runner received custom tools');
  assert(seenInput?.model === input.model, 'plugin subagent runner lost model selection');
  return {
    runtime: runtime.id,
    purpose: seenInput.purpose,
    toolsDisabled: true,
    model: seenInput.model,
  };
}

async function writeCanaryAgent(agentsDir: string, agentId: string, pluginEnabled: boolean): Promise<void> {
  const agentDir = join(agentsDir, agentId);
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'CLAUDE.md'), `# ${agentId}\n`, 'utf8');
  const channel = pluginEnabled ? 'telegram' : 'whatsapp';
  await writeFile(join(agentDir, 'agent.yml'), [
    'safety_profile: trusted',
    'routes:',
    `  - channel: ${channel}`,
    '    scope: dm',
    'runtime:',
    '  headless:',
    '    provider: pi',
    'plugins:',
    `  ${PLUGIN_NAME}:`,
    `    enabled: ${pluginEnabled ? 'true' : 'false'}`,
  ].join('\n') + '\n', 'utf8');
}

async function writeCanaryPlugin(pluginsDir: string, dataDir: string): Promise<void> {
  const pluginDir = join(pluginsDir, PLUGIN_NAME);
  const manifestDir = join(pluginDir, '.claude-plugin');
  await mkdir(manifestDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(manifestDir, 'plugin.json'), JSON.stringify({
    name: PLUGIN_NAME,
    version: '0.0.1',
    description: 'Runtime migration canary plugin.',
    entry: 'index.mjs',
  }, null, 2), 'utf8');
  await writeFile(join(pluginDir, 'index.mjs'), pluginSource(), 'utf8');
}

function pluginSource(): string {
  return `
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(${JSON.stringify(join(process.cwd(), 'package.json'))});
const { z } = require('zod');
const agentId = ${JSON.stringify(AGENT_ID)};
const sessionKey = ${JSON.stringify(SESSION_KEY)};

export async function register(ctx) {
  ctx.registerMcpTool({
    name: 'inspect',
    description: 'Read-only plugin context inspection canary.',
    inputSchema: z.object({ marker: z.string().optional() }),
    handler: async (input, toolCtx) => ({
      content: [{ type: 'text', text: JSON.stringify({
        marker: input.marker,
        agentId: toolCtx.agentId,
        sessionKey: toolCtx.sessionKey ?? null,
      }) }],
    }),
  });

  ctx.registerMcpTool({
    name: 'policy_gate',
    description: 'Policy-sensitive plugin tool context canary.',
    inputSchema: z.object({ action: z.string() }),
    handler: async (_input, toolCtx) => {
      const allowed = toolCtx.agentId === agentId && toolCtx.sessionKey === sessionKey;
      return { content: [{ type: 'text', text: allowed ? 'allowed' : 'denied' }] };
    },
  });

  ctx.registerHook('on_after_query', async (payload) => {
    appendFileSync(join(ctx.dataDir, 'hook.jsonl'), JSON.stringify({
      agentId: payload.agentId,
      sessionKey: payload.sessionKey,
      messages: Array.isArray(payload.newMessages) ? payload.newMessages.length : 0,
    }) + '\\n');
  });

  ctx.registerContextEngine({
    assemble: async (input) => ({
      messages: [
        ...input.messages,
        { role: 'system', content: 'canary-assembled:' + input.agentId + ':' + input.sessionKey },
      ],
    }),
    compress: async (input) => ({
      messages: [
        { role: 'system', content: 'canary-compressed:' + input.agentId + ':' + input.sessionKey + ':' + input.messages.length },
      ],
    }),
  });

  return {
    shutdown() {
      appendFileSync(join(ctx.dataDir, 'shutdown.log'), 'shutdown\\n');
    },
  };
}
`.trimStart();
}

function firstText(result: { content: Array<{ type: 'text'; text: string }> }): string {
  return result.content[0]?.text ?? '';
}

function requireTool(tools: PluginMcpTool[], name: string): PluginMcpTool {
  const tool = tools.find((candidate) => candidate.name === name);
  assert(tool, `missing plugin tool ${name}`);
  return tool;
}

function parseToolJson(result: { content: Array<{ type: 'text'; text: string }> }): Record<string, unknown> {
  const text = firstText(result);
  const parsed = JSON.parse(text) as unknown;
  assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'plugin tool did not return a JSON object');
  return parsed as Record<string, unknown>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isSkippableCanaryError(message: string): boolean {
  return /optional package|api key|auth|oauth|credential|model registry/i.test(message);
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiPluginsContextCanaryResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }
  stream.write([
    `Pi plugins/context canary ${result.status}.`,
    `durationMs: ${result.durationMs}`,
    `scenario: ${result.scenario}`,
  ].join('\n'));
  stream.write('\n');
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function usage(): string {
  return [
    'Usage: pnpm smoke:pi-plugins-context -- [--json] [--keep-workspace]',
    '',
    'Runs the scripted Pi runtime v1 plugin/context canary.',
    '',
    'Options:',
    '  --json                print structured result',
    '  --keep-workspace      keep temporary canary workspace for inspection',
    '  --gateway             accepted for pi-v1-canary compatibility',
    '  --allow-skip          exit 0 for skippable optional runtime/auth errors',
    `  --model <model>       model recorded for plugin subagent runner (default: ${DEFAULT_PI_MODEL_ID})`,
    '  --auth-path <path>    optional Pi auth.json path recorded in Gateway config',
    '  --models-path <path>  optional Pi models.json path recorded in Gateway config',
    '  --timeout-ms <ms>     positive integer timeout for plugin subagent runner',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiPluginsContextCanaryCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
