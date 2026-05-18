import 'dotenv/config';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadAgentYml } from '../config/loader.js';
import { parsePluginManifest } from '../plugins/manifest-schema.js';
import { createPluginContext } from '../plugins/context.js';
import { loadPlugin } from '../plugins/loader.js';
import { PluginRegistry } from '../plugins/registry.js';
import { buildPluginStartupPlan } from '../plugins/startup-plan.js';
import type {
  ContextEngine,
  HookEvent,
  HookHandler,
  PluginContext,
  PluginInstance,
  PluginLogger,
  PluginManifest,
  PluginMcpTool,
} from '../plugins/types.js';

const AGENT_ID = 'timur_agent';
const DEFAULT_PEER_ID = '48705953';
const SESSION_KEY = `${AGENT_ID}:telegram:dm:${DEFAULT_PEER_ID}:honcho-local-smoke`;

interface PiTimurAgentHonchoLocalSmokeArgs {
  agentsDir: string;
  peerId: string;
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiTimurAgentHonchoLocalSmokeDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiTimurAgentHonchoLocalSmokeResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  agentsDir: string;
  peerId: string;
  currentConfig: {
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
    statusReportsLocalHost: boolean;
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

type PluginRegister = (ctx: PluginContext) => Promise<PluginInstance> | PluginInstance;

export async function runPiTimurAgentHonchoLocalSmokeCli(
  argv: string[],
  deps: PiTimurAgentHonchoLocalSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTimurAgentHonchoLocalSmokeArgs;

  try {
    args = parsePiTimurAgentHonchoLocalSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-timur-agent-honcho-local-'));
  try {
    const result = await runPiTimurAgentHonchoLocalSmoke({ ...args, workspace });
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result: PiTimurAgentHonchoLocalSmokeResult = {
      status: 'failed',
      runtime: 'pi',
      agentId: AGENT_ID,
      agentsDir: join(workspace, 'agents'),
      peerId: args.peerId,
      currentConfig: {
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
        statusReportsLocalHost: false,
        sessionToolRequiresDispatch: false,
        sessionToolUsesDispatchKey: false,
        noApiKeyRequiredByConfig: false,
      },
      safety: {
        noLiveConfigMutation: false,
        noNetworkCall: false,
        noHardcodedSecrets: false,
      },
      error: errorMessage(err),
    };
    writeResult(stderr, args.json, result);
    return 1;
  } finally {
    if (!args.keepData) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export async function runPiTimurAgentHonchoLocalSmoke(input: PiTimurAgentHonchoLocalSmokeArgs & {
  workspace: string;
}): Promise<PiTimurAgentHonchoLocalSmokeResult> {
  const agentsDir = join(input.workspace, 'agents');
  const agentDir = join(agentsDir, AGENT_ID);
  mkdirSync(agentsDir, { recursive: true });
  cpSync(join(resolve(input.agentsDir), AGENT_ID), agentDir, { recursive: true });

  const config = loadAgentYml(agentDir);
  const honchoConfig = getHonchoConfig(config.plugins);
  const connection = getConnectionConfig(honchoConfig);
  const privateAllowlistSinglePeer =
    config.safety_profile === 'private' &&
    config.allowlist?.telegram?.length === 1 &&
    config.allowlist.telegram[0] === input.peerId;
  if (!privateAllowlistSinglePeer) {
    throw new Error('timur_agent must remain private and allowlisted to the connected operator Telegram peer.');
  }

  const enabled = honchoConfig.enabled === true;
  const mode = stringField(honchoConfig, 'mode');
  const environment = stringField(connection, 'environment');
  const baseUrlHost = new URL(stringField(connection, 'base_url')).host;
  const workspaceId = stringField(connection, 'workspace_id');
  const keylessLocal = environment === 'local' && !('api_key_env' in connection);
  const maxRetriesZero = connection.max_retries === 0;
  if (enabled) throw new Error('timur_agent Honcho must stay disabled until a local service is intentionally started.');
  if (mode !== 'tools') throw new Error('timur_agent Honcho should stay in tools mode for controlled operator testing.');
  if (environment !== 'local') throw new Error('timur_agent Honcho should target a local environment.');
  if (baseUrlHost !== 'localhost:8000') throw new Error('timur_agent Honcho should target localhost:8000 by default.');
  if (workspaceId !== 'anthroclaw-timur-agent-lab') throw new Error('timur_agent Honcho workspace id changed unexpectedly.');
  if (!keylessLocal) throw new Error('timur_agent local Honcho config should not require an API key env var.');
  if (!maxRetriesZero) throw new Error('timur_agent local Honcho config should use max_retries=0.');

  const disabledGate = await runDisabledGateAssertions(config);
  const activationCandidate = await runActivationCandidateAssertions({
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
    dataDir: join(input.workspace, 'honcho-plugin-data'),
  });

  return {
    status: 'passed',
    runtime: 'pi',
    agentId: AGENT_ID,
    agentsDir,
    peerId: input.peerId,
    currentConfig: {
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

async function runDisabledGateAssertions(agentConfig: { plugins?: Record<string, { enabled?: boolean } | undefined> }): Promise<PiTimurAgentHonchoLocalSmokeResult['disabledGate']> {
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
  if (!startupPlanSkipsHoncho) throw new Error('Honcho should be skipped while timur_agent plugins.honcho.enabled=false.');

  const registry = new PluginRegistry();
  const noHonchoToolsExposed = registry.getMcpToolsForAgent(AGENT_ID).length === 0;
  const noContextEngineActive = registry.getContextEngine(AGENT_ID) === null;
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
  agentConfig: unknown;
  dataDir: string;
}): Promise<PiTimurAgentHonchoLocalSmokeResult['activationCandidate']> {
  const registry = new PluginRegistry();
  const hooks: Array<{ pluginName: string; event: HookEvent; handler: HookHandler }> = [];
  await registerHonchoPlugin(registry, {
    dataDir: input.dataDir,
    getAgentConfig: (agentId) => agentId === AGENT_ID ? input.agentConfig : { plugins: {} },
    onHook: (hook) => hooks.push(hook),
  });
  registry.enableForAgent(AGENT_ID, 'honcho');

  try {
    const pluginRegistered = registry.listPlugins().some((entry) => entry.manifest.name === 'honcho');
    const contextEngineRegistered = registry.getContextEngine(AGENT_ID)?.name === 'honcho';
    const observeHookRegistered = hooks.some((hook) => hook.pluginName === 'honcho' && hook.event === 'on_after_query');
    const tools = registry.getMcpToolsForAgent(AGENT_ID);
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
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    }))) as {
      enabled?: unknown;
      mode?: unknown;
      workspace_id?: unknown;
      base_url_host?: unknown;
      status?: unknown;
    };
    const statusToolWorks = status.enabled === true &&
      status.mode === 'tools' &&
      status.workspace_id === 'anthroclaw-timur-agent-lab' &&
      status.status === 'configured';
    const statusReportsLocalHost = status.base_url_host === 'localhost:8000';
    if (!statusToolWorks || !statusReportsLocalHost) {
      throw new Error('Honcho status tool did not report the expected local tools-mode config.');
    }

    const noSessionResult = toolText(await requirePluginTool(tools, 'honcho_session').handler({}, {
      agentId: AGENT_ID,
    }));
    const sessionToolRequiresDispatch = noSessionResult.includes('requires an active AnthroClaw session');
    if (!sessionToolRequiresDispatch) {
      throw new Error('Honcho session tool should require a dispatch session key.');
    }

    const engine = registry.getContextEngine(AGENT_ID)?.engine as ContextEngine | undefined;
    const assembled = await engine?.assemble?.({
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
      sessionContext: {
        channel: 'telegram',
        accountId: 'default',
        peerId: DEFAULT_PEER_ID,
        senderId: DEFAULT_PEER_ID,
        chatType: 'dm',
      },
      messages: [{ role: 'user', content: 'honcho disabled-mode smoke' }],
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
      statusReportsLocalHost,
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

function getHonchoConfig(plugins: unknown): Record<string, unknown> {
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
    throw new Error('timur_agent must define plugins.honcho config.');
  }
  const honcho = (plugins as Record<string, unknown>).honcho;
  if (!honcho || typeof honcho !== 'object' || Array.isArray(honcho)) {
    throw new Error('timur_agent must define plugins.honcho config.');
  }
  return honcho as Record<string, unknown>;
}

function getConnectionConfig(honcho: Record<string, unknown>): Record<string, unknown> {
  const connection = honcho.connection;
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)) {
    throw new Error('timur_agent Honcho config must define connection.');
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

export function parsePiTimurAgentHonchoLocalSmokeArgs(argv: string[]): PiTimurAgentHonchoLocalSmokeArgs {
  const args: PiTimurAgentHonchoLocalSmokeArgs = {
    agentsDir: 'agents',
    peerId: DEFAULT_PEER_ID,
    keepData: false,
    json: false,
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
      case '--agents-dir':
        args.agentsDir = requireValue(argv, ++i, '--agents-dir');
        break;
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
        break;
      case '--keep-data':
        args.keepData = true;
        break;
      case '--json':
        args.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTimurAgentHonchoLocalSmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (result.status === 'passed') {
    stream.write('TIMUR_AGENT_HONCHO_LOCAL_SMOKE_OK\n');
    return;
  }
  stream.write(`TIMUR_AGENT_HONCHO_LOCAL_SMOKE_FAILED: ${result.error ?? 'unknown error'}\n`);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-timur-agent-honcho-local-smoke -- [--json]',
    '',
    'Options:',
    '  --agents-dir <path>  Agents directory to copy from (default: agents)',
    '  --peer-id <id>      Expected allowlisted Telegram peer (default: 48705953)',
    '  --keep-data         Keep temp workspace for inspection',
    '  --json              Emit machine-readable JSON',
  ].join('\n');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentHonchoLocalSmokeCli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exit(1);
    });
}
