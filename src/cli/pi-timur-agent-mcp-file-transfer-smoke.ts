import 'dotenv/config';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConnectMcpTool, type ConnectMcpDispatchContext } from '../agent/tools/connect-mcp.js';
import { loadAgentYml } from '../config/loader.js';
import { createOnboarding } from '../integrations/mcp-onboarding/index.js';
import { createPluginContext } from '../plugins/context.js';
import { loadPlugin } from '../plugins/loader.js';
import { parsePluginManifest } from '../plugins/manifest-schema.js';
import { PluginRegistry } from '../plugins/registry.js';
import type {
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
const DEFAULT_SENDER_ID = '48705953';
const SERVER_URL = 'https://mcp.example.test';
const SESSION_KEY = `${AGENT_ID}:telegram:dm:${DEFAULT_PEER_ID}:mcp-file-transfer-smoke`;

interface PiTimurAgentMcpFileTransferSmokeArgs {
  agentsDir: string;
  peerId: string;
  senderId: string;
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiTimurAgentMcpFileTransferSmokeDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiTimurAgentMcpFileTransferSmokeResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  agentsDir: string;
  peerId: string;
  mcp: {
    enabled: boolean;
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

type PluginRegister = (ctx: PluginContext) => Promise<PluginInstance> | PluginInstance;

export async function runPiTimurAgentMcpFileTransferSmokeCli(
  argv: string[],
  deps: PiTimurAgentMcpFileTransferSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTimurAgentMcpFileTransferSmokeArgs;

  try {
    args = parsePiTimurAgentMcpFileTransferSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-timur-agent-mcp-file-transfer-'));
  try {
    const result = await runPiTimurAgentMcpFileTransferSmoke({ ...args, workspace });
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result: PiTimurAgentMcpFileTransferSmokeResult = {
      status: 'failed',
      runtime: 'pi',
      agentId: AGENT_ID,
      agentsDir: join(workspace, 'agents'),
      peerId: args.peerId,
      mcp: {
        enabled: false,
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

export async function runPiTimurAgentMcpFileTransferSmoke(input: PiTimurAgentMcpFileTransferSmokeArgs & {
  workspace: string;
}): Promise<PiTimurAgentMcpFileTransferSmokeResult> {
  const agentsDir = join(input.workspace, 'agents');
  const agentDir = join(agentsDir, AGENT_ID);
  const labFilesRoot = join(agentDir, 'lab-files');
  const researchRoot = join(input.workspace, 'research');
  const outsideRoot = join(input.workspace, 'outside-root');
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(labFilesRoot, { recursive: true });
  mkdirSync(researchRoot, { recursive: true });
  mkdirSync(outsideRoot, { recursive: true });
  cpSync(join(resolve(input.agentsDir), AGENT_ID), agentDir, { recursive: true });
  writeFileSync(join(labFilesRoot, 'seed.txt'), 'timur agent file-transfer seed', 'utf8');
  writeFileSync(join(researchRoot, 'note.md'), 'timur agent research seed', 'utf8');
  writeFileSync(join(outsideRoot, 'secret.txt'), 'outside marker', 'utf8');

  const config = loadAgentYml(agentDir);
  const fileTransferConfig = getFileTransferConfig(config.plugins);
  const configuredRoots = getConfiguredRoots(fileTransferConfig);
  const privateAllowlistSinglePeer =
    config.safety_profile === 'private' &&
    config.allowlist?.telegram?.length === 1 &&
    config.allowlist.telegram[0] === input.peerId;
  if (!privateAllowlistSinglePeer) {
    throw new Error('timur_agent must remain private and allowlisted to the connected operator Telegram peer.');
  }
  if (!config.mcp_onboarding.enabled) {
    throw new Error('timur_agent must keep managed MCP onboarding enabled for this parity gate.');
  }
  if (config.external_mcp_servers && Object.keys(config.external_mcp_servers).length > 0) {
    throw new Error('timur_agent must not commit hardcoded external MCP servers for this smoke.');
  }
  assertConfiguredRoots(configuredRoots);
  if (fileTransferConfig.allowWrite !== true) {
    throw new Error('timur_agent file-transfer must keep allowWrite=true for the operator lab contract.');
  }

  const mcp = await runMcpOnboardingAssertions({ peerId: input.peerId, senderId: input.senderId });
  const fileTransfer = await runFileTransferAssertions({
    agentConfigForPlugin: {
      ...config,
      plugins: {
        ...(config.plugins ?? {}),
        'file-transfer': {
          ...fileTransferConfig,
          roots: [labFilesRoot, researchRoot],
        },
      },
    },
    labFilesRoot,
    outsideRoot,
  });

  return {
    status: 'passed',
    runtime: 'pi',
    agentId: AGENT_ID,
    agentsDir,
    peerId: input.peerId,
    mcp: {
      enabled: true,
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

async function runMcpOnboardingAssertions(input: {
  peerId: string;
  senderId: string;
}): Promise<Omit<PiTimurAgentMcpFileTransferSmokeResult['mcp'], 'enabled' | 'privateAllowlistSinglePeer' | 'noExternalMcpConfigured'>> {
  const dmContext: ConnectMcpDispatchContext = {
    agentSessionKey: SESSION_KEY,
    chatType: 'private',
  };
  const fakeFacade = makeFakeOnboardingFacade();
  const connectTool = createConnectMcpTool(AGENT_ID, () => fakeFacade, () => dmContext);
  const privateConnect = parseToolJson(await getToolHandler(connectTool)({
    op: 'connect',
    url: SERVER_URL,
  }));
  const call = fakeFacade.startConnectionCalls[0];
  if (!call) throw new Error('connect_mcp did not call the onboarding facade.');
  if (privateConnect.status !== 'authorize') {
    throw new Error('connect_mcp private connect did not return authorize status.');
  }
  if (privateConnect.pendingId !== 'pnd_timur_mcp_smoke') {
    throw new Error('connect_mcp private connect returned an unexpected pendingId.');
  }
  const privateConnectForwarded = call.url === SERVER_URL && call.requester.kind === 'agent' && call.requester.agentId === AGENT_ID;
  const privateSessionBound = call.requester.agentSessionKey === SESSION_KEY;
  const privateChatTypeBound = call.requester.chatType === 'private';
  if (!privateConnectForwarded || !privateSessionBound || !privateChatTypeBound) {
    throw new Error('connect_mcp did not preserve private dispatch attribution.');
  }

  const check = parseToolJson(await getToolHandler(connectTool)({
    op: 'check',
    pendingId: 'pnd_timur_mcp_smoke',
  }));
  const cancel = parseToolJson(await getToolHandler(connectTool)({
    op: 'cancel',
    pendingId: 'pnd_timur_mcp_smoke',
  }));

  const dmOnlyFacade = createOnboarding({
    pending: {} as never,
    credentials: {} as never,
    uiBaseUrl: 'https://ui.example.test',
    listTakenServerIds: async () => new Set<string>(),
  });
  const groupTool = createConnectMcpTool(AGENT_ID, () => dmOnlyFacade, () => ({
    agentSessionKey: `${AGENT_ID}:telegram:group:-100123:mcp-file-transfer-smoke`,
    chatType: 'group',
  }));
  const groupConnect = parseToolJson(await getToolHandler(groupTool)({
    op: 'connect',
    url: SERVER_URL,
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
  agentConfigForPlugin: unknown;
  labFilesRoot: string;
  outsideRoot: string;
}): Promise<Omit<
  PiTimurAgentMcpFileTransferSmokeResult['fileTransfer'],
  'pluginEnabled' | 'configuredRoots' | 'configuredWriteEnabled' | 'tempOnly'
>> {
  const registry = new PluginRegistry();
  await registerFileTransferPlugin(registry, {
    dataDir: join(input.labFilesRoot, '.plugin-data'),
    getAgentConfig: (agentId) => agentId === AGENT_ID ? input.agentConfigForPlugin : { plugins: {} },
  });
  registry.enableForAgent(AGENT_ID, 'file-transfer');

  try {
    const tools = registry.getMcpToolsForAgent(AGENT_ID);
    const toolNames = tools.map((tool) => tool.name).sort();
    const requiredTools = [
      'file-transfer_dir_fetch',
      'file-transfer_dir_list',
      'file-transfer_file_fetch',
      'file-transfer_file_write',
    ];
    const toolsPresent = requiredTools.every((name) => toolNames.includes(name));
    if (!toolsPresent) throw new Error(`file-transfer plugin is missing tools: ${requiredTools.filter((name) => !toolNames.includes(name)).join(', ')}`);

    const dirList = parseToolJson(await requirePluginTool(tools, 'file-transfer_dir_list').handler({
      path: input.labFilesRoot,
    }, {
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    }));
    const entries = dirList.entries as Array<{ name: string }>;
    const dirListSawSeed = entries.some((entry) => entry.name === 'seed.txt');
    if (!dirListSawSeed) throw new Error('file-transfer dir_list did not see the temp seed file.');

    const fetched = parseToolJson(await requirePluginTool(tools, 'file-transfer_file_fetch').handler({
      path: join(input.labFilesRoot, 'seed.txt'),
    }, {
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    }));
    const fileFetchMatchedSeed = fetched.text === 'timur agent file-transfer seed';
    if (!fileFetchMatchedSeed) throw new Error('file-transfer file_fetch returned the wrong seed content.');

    const writeResult = parseToolJson(await requirePluginTool(tools, 'file-transfer_file_write').handler({
      path: join(input.labFilesRoot, 'out.txt'),
      content: 'written by timur_agent MCP/file-transfer smoke',
    }, {
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    }));
    const fileWriteSucceeded = writeResult.sizeBytes === 'written by timur_agent MCP/file-transfer smoke'.length;
    if (!fileWriteSucceeded) throw new Error('file-transfer file_write returned the wrong size.');

    let outsideDenied = false;
    try {
      await requirePluginTool(tools, 'file-transfer_file_fetch').handler({
        path: join(input.outsideRoot, 'secret.txt'),
      }, {
        agentId: AGENT_ID,
        sessionKey: SESSION_KEY,
      });
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

function getFileTransferConfig(plugins: unknown): Record<string, unknown> {
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
    throw new Error('timur_agent must define plugins.file-transfer config.');
  }
  const fileTransfer = (plugins as Record<string, unknown>)['file-transfer'];
  if (!fileTransfer || typeof fileTransfer !== 'object' || Array.isArray(fileTransfer)) {
    throw new Error('timur_agent must define plugins.file-transfer config.');
  }
  return fileTransfer as Record<string, unknown>;
}

function getConfiguredRoots(config: Record<string, unknown>): string[] {
  const roots = config.roots;
  if (!Array.isArray(roots) || roots.some((root) => typeof root !== 'string')) {
    throw new Error('timur_agent file-transfer roots must be a string array.');
  }
  return roots as string[];
}

function assertConfiguredRoots(roots: string[]): void {
  const expected = ['agents/timur_agent/lab-files', 'research'];
  for (const root of expected) {
    if (!roots.includes(root)) {
      throw new Error(`timur_agent file-transfer roots must include ${root}.`);
    }
  }
}

function makeFakeOnboardingFacade() {
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
    async startConnection(input: {
      url: string;
      requester: {
        kind: string;
        agentId: string;
        agentSessionKey?: string;
        chatType?: string;
      };
    }) {
      calls.push(input);
      return {
        status: 'authorize' as const,
        pendingId: 'pnd_timur_mcp_smoke',
        authUrl: 'https://ui.example.test/api/mcp/oauth/start/pnd_timur_mcp_smoke',
        serverName: 'timur-mcp-smoke',
      };
    },
    async attachApiKey() {
      return {
        status: 'connected' as const,
        pendingId: 'pnd_timur_mcp_smoke',
        serverId: 'timur-mcp-smoke',
        tools: [{ name: 'noop' }],
      };
    },
    async finalize() {
      return {
        status: 'connected' as const,
        server: 'timur-mcp-smoke',
        tools: [{ name: 'noop' }],
      };
    },
    getPending(pendingId: string) {
      return pendingId === 'pnd_timur_mcp_smoke'
        ? { status: 'pending', age_seconds: 1, expires_in_seconds: 599 }
        : null;
    },
    cancel(pendingId: string) {
      return pendingId === 'pnd_timur_mcp_smoke'
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

export function parsePiTimurAgentMcpFileTransferSmokeArgs(argv: string[]): PiTimurAgentMcpFileTransferSmokeArgs {
  const args: PiTimurAgentMcpFileTransferSmokeArgs = {
    agentsDir: 'agents',
    peerId: DEFAULT_PEER_ID,
    senderId: DEFAULT_SENDER_ID,
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
      case '--sender-id':
        args.senderId = requireValue(argv, ++i, '--sender-id');
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
  result: PiTimurAgentMcpFileTransferSmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (result.status === 'passed') {
    stream.write('TIMUR_AGENT_MCP_FILE_TRANSFER_SMOKE_OK\n');
    return;
  }
  stream.write(`TIMUR_AGENT_MCP_FILE_TRANSFER_SMOKE_FAILED: ${result.error ?? 'unknown error'}\n`);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-timur-agent-mcp-file-transfer-smoke -- [--json]',
    '',
    'Options:',
    '  --agents-dir <path>  Agents directory to copy from (default: agents)',
    '  --peer-id <id>      Expected allowlisted Telegram peer (default: 48705953)',
    '  --sender-id <id>    Dispatch sender id (default: 48705953)',
    '  --keep-data         Keep temp workspace for inspection',
    '  --json              Emit machine-readable JSON',
  ].join('\n');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentMcpFileTransferSmokeCli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exit(1);
    });
}
