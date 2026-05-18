import 'dotenv/config';
import { existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { createSendMediaTool } from '../agent/tools/send-media.js';
import type { ApprovalRequest, ChannelAdapter } from '../channels/types.js';
import { TelegramChannel } from '../channels/telegram.js';
import { loadAgentYml, loadGlobalConfig } from '../config/loader.js';
import type { AgentYml, GlobalConfig } from '../config/schema.js';
import { MetricsStore } from '../metrics/store.js';
import { ApprovalBroker } from '../security/approval-broker.js';
import { getProfile } from '../security/profiles/index.js';
import { createCanUseTool } from '../sdk/permissions.js';

const AGENT_ID = 'timur_agent';
const SERVER_NAME = `${AGENT_ID}-tools`;
const ACCOUNT_ID = 'default';
const DEFAULT_PEER_ID = '48705953';
const DEFAULT_FILE_PATH = 'agents/timur_agent/lab-files/timur-agent-live-media-canary.txt';
const ALLOWED_FILE_ROOT = 'agents/timur_agent/lab-files';
const MARKER_PREFIX = 'TIMUR_AGENT_LIVE_SEND_MEDIA_OK';

interface PiTimurAgentLiveSendMediaArgs {
  configPath: string;
  agentsDir: string;
  dataDir: string;
  workspacePath: string;
  accountId: string;
  peerId: string;
  filePath: string;
  caption?: string;
  confirmLiveSendMedia: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

interface PiTimurAgentLiveSendMediaDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
  now?: () => number;
  makeRunId?: () => string;
  makeChannel?: (input: {
    globalConfig: GlobalConfig;
    accountId: string;
    dataDir: string;
  }) => ChannelAdapter;
}

interface PiTimurAgentLiveSendMediaResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  live: boolean;
  dryRun: boolean;
  target: {
    channel: 'telegram';
    accountId: string;
    peerId: string;
  };
  media: {
    type: 'document';
    filePath: string;
    caption: string;
    allowedRoot: string;
    fileExists: boolean;
    fileRootBound: boolean;
  };
  markerPrefix: string;
  permission: {
    mcpToolPresent: boolean;
    privateAllowlistSinglePeer: boolean;
    routeBound: boolean;
    sendMediaApprovalRequested: boolean;
    sendMediaAllowed: boolean;
  };
  delivery: {
    sent: boolean;
    via: 'send_media';
    realTelegramDelivery: boolean;
    messageId?: string;
  };
  metrics: {
    recorded: boolean;
    metricsDb: string;
    runId?: string;
    sessionKey?: string;
    toolStarted: boolean;
    toolCompleted: boolean;
  };
  safety: {
    operatorApproved: boolean;
    noBroadFanout: boolean;
    documentOnly: boolean;
    noConfigMutation: boolean;
  };
  error?: string;
}

export async function runPiTimurAgentLiveSendMediaCli(
  argv: string[],
  deps: PiTimurAgentLiveSendMediaDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  let args: PiTimurAgentLiveSendMediaArgs;
  try {
    args = parsePiTimurAgentLiveSendMediaArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (!args.dryRun && !args.confirmLiveSendMedia) {
    stderr.write(`Refusing live media send: pass --confirm-live-send-media after explicit operator approval.\n${usage()}\n`);
    return 2;
  }

  try {
    const result = await runPiTimurAgentLiveSendMedia(args, deps);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result = failedResult(args, errorMessage(err));
    writeResult(stderr, args.json, result);
    return 1;
  }
}

export async function runPiTimurAgentLiveSendMedia(
  input: PiTimurAgentLiveSendMediaArgs,
  deps: PiTimurAgentLiveSendMediaDeps = {},
): Promise<PiTimurAgentLiveSendMediaResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const caption = input.caption ?? `${MARKER_PREFIX} ${new Date(startedAt).toISOString()}`;
  const metricsDb = join(input.dataDir, 'metrics.sqlite');
  const sessionKey = `${AGENT_ID}:telegram:dm:${input.peerId}:live-send-media`;
  const runId = deps.makeRunId?.() ?? `pi-live-media-${randomUUID()}`;

  const agentConfig = loadAgentYml(join(input.agentsDir, AGENT_ID));
  const permissionFacts = validateTarget(agentConfig, input.peerId, input.accountId);
  const mediaFacts = validateMediaFile(input.workspacePath, input.filePath);

  const approvalBroker = new ApprovalBroker();
  const approvalChannel = createAutoApprovalChannel(approvalBroker, input.peerId);
  const canUseTool = createCanUseTool({
    agent: {
      id: AGENT_ID,
      config: agentConfig,
      safetyProfile: getProfile(agentConfig.safety_profile),
      workspacePath: input.workspacePath,
    },
    approvalBroker,
    channel: approvalChannel,
    sessionContext: {
      channel: 'telegram',
      peerId: input.peerId,
      senderId: input.peerId,
      accountId: input.accountId,
    },
  });
  const permission = await canUseTool(
    `mcp__${SERVER_NAME}__send_media`,
    {
      channel: 'telegram',
      peer_id: input.peerId,
      account_id: input.accountId,
      file_path: input.filePath,
      type: 'document',
      caption,
    },
    { signal: new AbortController().signal, toolUseID: 'timur-agent-live-send-media' } as any,
  );
  const sendMediaAllowed = permission.behavior === 'allow';
  if (!sendMediaAllowed) {
    throw new Error(`send_media permission denied: ${permission.message ?? permission.behavior}`);
  }

  if (input.dryRun) {
    return {
      status: 'passed',
      runtime: 'pi',
      agentId: AGENT_ID,
      live: false,
      dryRun: true,
      target: { channel: 'telegram', accountId: input.accountId, peerId: input.peerId },
      media: { ...mediaFacts, caption },
      markerPrefix: MARKER_PREFIX,
      permission: {
        ...permissionFacts,
        sendMediaApprovalRequested: approvalChannel.approvalRequests.length === 1,
        sendMediaAllowed,
      },
      delivery: {
        sent: false,
        via: 'send_media',
        realTelegramDelivery: false,
      },
      metrics: {
        recorded: false,
        metricsDb,
        toolStarted: false,
        toolCompleted: false,
      },
      safety: safetyFacts(input),
    };
  }

  const globalConfig = loadGlobalConfig(input.configPath);
  const telegramAccount = globalConfig.telegram?.accounts[input.accountId];
  if (!telegramAccount) throw new Error(`telegram account not configured: ${input.accountId}`);
  if (telegramAccount.token.trim().length === 0) {
    throw new Error(`telegram account token is empty: ${input.accountId}`);
  }

  const metrics = new MetricsStore(metricsDb);
  metrics.recordAgentRunStart({
    runId,
    startedAt,
    agentId: AGENT_ID,
    sessionKey,
    source: 'channel',
    channel: 'telegram',
    accountId: input.accountId,
    peerId: input.peerId,
    model: agentConfig.model,
  });
  metrics.recordToolEvent({
    timestamp: startedAt,
    agentId: AGENT_ID,
    sessionKey,
    toolName: 'send_media',
    status: 'started',
  });
  metrics.recordDiagnosticEvent({
    timestamp: startedAt,
    traceId: runId,
    runId,
    agentId: AGENT_ID,
    sessionKey,
    eventType: 'run.tool_started',
    detail: {
      toolName: 'send_media',
      channel: 'telegram',
      accountId: input.accountId,
      peerId: input.peerId,
      filePath: input.filePath,
      markerPrefix: MARKER_PREFIX,
    },
  });

  const channel = deps.makeChannel?.({
    globalConfig,
    accountId: input.accountId,
    dataDir: input.dataDir,
  }) ?? new TelegramChannel({
    accounts: {
      [input.accountId]: {
        token: telegramAccount.token,
        webhook: telegramAccount.webhook,
      },
    },
    mediaDir: join(input.dataDir, 'telegram-media'),
  });
  const sendMediaTool = createSendMediaTool(
    input.workspacePath,
    (id) => id === 'telegram' ? channel : undefined,
    {
      dispatchContext: {
        channel: 'telegram',
        accountId: input.accountId,
      },
    },
  );

  try {
    const sentAt = now();
    const toolResult = await sendMediaTool.handler({
      channel: 'telegram',
      peer_id: input.peerId,
      account_id: input.accountId,
      file_path: input.filePath,
      type: 'document',
      caption,
    });
    if (toolResult.isError) {
      throw new Error(toolResult.content.map((item) => item.text).join('\n'));
    }
    const completedAt = now();
    const messageId = extractMessageId(toolResult);
    metrics.recordToolEvent({
      timestamp: completedAt,
      agentId: AGENT_ID,
      sessionKey,
      toolName: 'send_media',
      status: 'completed',
      durationMs: Math.max(0, completedAt - sentAt),
    });
    metrics.recordDiagnosticEvent({
      timestamp: completedAt,
      traceId: runId,
      runId,
      agentId: AGENT_ID,
      sessionKey,
      eventType: 'run.tool_completed',
      detail: {
        toolName: 'send_media',
        messageId,
      },
    });
    metrics.recordAgentRunFinish({
      runId,
      completedAt,
      status: 'succeeded',
      usage: {
        durationMs: Math.max(0, completedAt - startedAt),
        numTurns: 1,
      },
    });

    return {
      status: 'passed',
      runtime: 'pi',
      agentId: AGENT_ID,
      live: true,
      dryRun: false,
      target: { channel: 'telegram', accountId: input.accountId, peerId: input.peerId },
      media: { ...mediaFacts, caption },
      markerPrefix: MARKER_PREFIX,
      permission: {
        ...permissionFacts,
        sendMediaApprovalRequested: approvalChannel.approvalRequests.length === 1,
        sendMediaAllowed,
      },
      delivery: {
        sent: true,
        via: 'send_media',
        realTelegramDelivery: true,
        messageId,
      },
      metrics: {
        recorded: true,
        metricsDb,
        runId,
        sessionKey,
        toolStarted: true,
        toolCompleted: true,
      },
      safety: safetyFacts(input),
    };
  } catch (err) {
    const failedAt = now();
    const message = errorMessage(err);
    metrics.recordToolEvent({
      timestamp: failedAt,
      agentId: AGENT_ID,
      sessionKey,
      toolName: 'send_media',
      status: 'failed',
      durationMs: Math.max(0, failedAt - startedAt),
    });
    metrics.recordDiagnosticEvent({
      timestamp: failedAt,
      traceId: runId,
      runId,
      agentId: AGENT_ID,
      sessionKey,
      eventType: 'run.tool_failed',
      detail: {
        toolName: 'send_media',
        error: message,
      },
    });
    metrics.recordAgentRunFinish({
      runId,
      completedAt: failedAt,
      status: 'failed',
      usage: {
        durationMs: Math.max(0, failedAt - startedAt),
        numTurns: 1,
      },
      error: message,
    });
    throw err;
  }
}

export function parsePiTimurAgentLiveSendMediaArgs(argv: string[]): PiTimurAgentLiveSendMediaArgs {
  const args: PiTimurAgentLiveSendMediaArgs = {
    configPath: process.env.OC_CONFIG ? resolve(process.env.OC_CONFIG) : resolve('config.yml'),
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    dataDir: process.env.OC_DATA_DIR ? resolve(process.env.OC_DATA_DIR) : resolve('data'),
    workspacePath: process.env.OC_WORKSPACE_DIR ? resolve(process.env.OC_WORKSPACE_DIR) : resolve('.'),
    accountId: ACCOUNT_ID,
    peerId: DEFAULT_PEER_ID,
    filePath: DEFAULT_FILE_PATH,
    confirmLiveSendMedia: false,
    dryRun: false,
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
      case '--config':
        args.configPath = resolve(requireValue(argv, ++i, '--config'));
        break;
      case '--agents-dir':
        args.agentsDir = resolve(requireValue(argv, ++i, '--agents-dir'));
        break;
      case '--data-dir':
        args.dataDir = resolve(requireValue(argv, ++i, '--data-dir'));
        break;
      case '--workspace':
        args.workspacePath = resolve(requireValue(argv, ++i, '--workspace'));
        break;
      case '--account-id':
        args.accountId = requireValue(argv, ++i, '--account-id');
        break;
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
        break;
      case '--file-path':
        args.filePath = requireValue(argv, ++i, '--file-path');
        break;
      case '--caption':
        args.caption = requireValue(argv, ++i, '--caption');
        break;
      case '--confirm-live-send-media':
        args.confirmLiveSendMedia = true;
        break;
      case '--dry-run':
        args.dryRun = true;
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

function validateTarget(
  config: AgentYml,
  peerId: string,
  accountId: string,
): Pick<PiTimurAgentLiveSendMediaResult['permission'], 'mcpToolPresent' | 'privateAllowlistSinglePeer' | 'routeBound'> {
  const mcpToolPresent = (config.mcp_tools ?? []).includes('send_media');
  const privateAllowlistSinglePeer =
    config.safety_profile === 'private' &&
    config.allowlist?.telegram?.length === 1 &&
    config.allowlist.telegram[0] === peerId;
  const routeBound = (config.routes ?? []).some((route) =>
    route.channel === 'telegram' &&
    route.scope === 'dm' &&
    (route.account === undefined || route.account === accountId) &&
    (route.peers ?? []).length === 1 &&
    (route.peers ?? [])[0] === peerId
  );

  if (!mcpToolPresent) throw new Error(`${AGENT_ID} must expose send_media.`);
  if (!privateAllowlistSinglePeer) {
    throw new Error(`${AGENT_ID} must remain private and allowlisted to exactly one Telegram peer.`);
  }
  if (!routeBound) {
    throw new Error(`${AGENT_ID} must route only the target Telegram DM for this live gate.`);
  }

  return { mcpToolPresent, privateAllowlistSinglePeer, routeBound };
}

function validateMediaFile(
  workspacePath: string,
  filePath: string,
): PiTimurAgentLiveSendMediaResult['media'] {
  const resolvedWorkspace = resolve(workspacePath);
  const resolvedFile = resolve(resolvedWorkspace, filePath);
  const resolvedAllowedRoot = resolve(resolvedWorkspace, ALLOWED_FILE_ROOT);
  const relToRoot = relative(resolvedAllowedRoot, resolvedFile);
  const fileRootBound = relToRoot !== '' && !relToRoot.startsWith('..') && !relToRoot.startsWith('/');
  const fileExists = existsSync(resolvedFile) && statSync(resolvedFile).isFile();

  if (!fileRootBound) {
    throw new Error(`media file must stay under ${ALLOWED_FILE_ROOT}`);
  }
  if (!fileExists) {
    throw new Error(`media file not found: ${filePath}`);
  }

  return {
    type: 'document',
    filePath,
    caption: '',
    allowedRoot: ALLOWED_FILE_ROOT,
    fileExists,
    fileRootBound,
  };
}

function createAutoApprovalChannel(
  approvalBroker: ApprovalBroker,
  senderId: string,
): ChannelAdapter & { approvalRequests: ApprovalRequest[] } {
  const approvalRequests: ApprovalRequest[] = [];
  return {
    id: 'telegram',
    supportsApproval: true,
    start: async () => {},
    stop: async () => {},
    onMessage: () => {},
    sendTyping: async () => {},
    editText: async () => {},
    deleteText: async () => {},
    promptForApproval: async (req: ApprovalRequest) => {
      approvalRequests.push(req);
      setTimeout(() => {
        approvalBroker.resolveBySender(req.id, senderId, 'allow');
      }, 0);
    },
    sendText: async () => 'approval-only-text-id',
    sendMedia: async () => 'approval-only-media-id',
    approvalRequests,
  };
}

function safetyFacts(input: PiTimurAgentLiveSendMediaArgs): PiTimurAgentLiveSendMediaResult['safety'] {
  return {
    operatorApproved: input.confirmLiveSendMedia || input.dryRun,
    noBroadFanout: input.peerId === DEFAULT_PEER_ID,
    documentOnly: true,
    noConfigMutation: true,
  };
}

function extractMessageId(result: { content: Array<{ type: string; text: string }> }): string | undefined {
  const text = result.content.map((item) => item.text).join('\n');
  const match = text.match(/ID:\s*(.+)\s*$/);
  return match?.[1]?.trim();
}

function failedResult(
  args: PiTimurAgentLiveSendMediaArgs,
  error: string,
): PiTimurAgentLiveSendMediaResult {
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: AGENT_ID,
    live: !args.dryRun,
    dryRun: args.dryRun,
    target: { channel: 'telegram', accountId: args.accountId, peerId: args.peerId },
    media: {
      type: 'document',
      filePath: args.filePath,
      caption: args.caption ?? '',
      allowedRoot: ALLOWED_FILE_ROOT,
      fileExists: false,
      fileRootBound: false,
    },
    markerPrefix: MARKER_PREFIX,
    permission: {
      mcpToolPresent: false,
      privateAllowlistSinglePeer: false,
      routeBound: false,
      sendMediaApprovalRequested: false,
      sendMediaAllowed: false,
    },
    delivery: {
      sent: false,
      via: 'send_media',
      realTelegramDelivery: false,
    },
    metrics: {
      recorded: false,
      metricsDb: join(args.dataDir, 'metrics.sqlite'),
      toolStarted: false,
      toolCompleted: false,
    },
    safety: safetyFacts(args),
    error,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTimurAgentLiveSendMediaResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      `Pi timur_agent live send_media ${result.dryRun ? 'dry-run' : 'gate'} passed.`,
      `target: telegram/${result.target.accountId}/${result.target.peerId}`,
      `file: ${result.media.filePath}`,
      `caption: ${result.media.caption}`,
      `delivery: ${JSON.stringify(result.delivery)}`,
      `metrics: ${JSON.stringify(result.metrics)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi timur_agent live send_media gate failed: ${result.error ?? 'unknown error'}\n`);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-timur-agent-live-send-media -- [options]',
    '',
    'Options:',
    '  --config <path>              global config path (default: ./config.yml or OC_CONFIG)',
    '  --agents-dir <path>          agents directory containing timur_agent (default: ./agents or OC_AGENTS_DIR)',
    '  --data-dir <path>            data directory for metrics.sqlite (default: ./data or OC_DATA_DIR)',
    '  --workspace <path>           workspace root for media path resolution (default: . or OC_WORKSPACE_DIR)',
    '  --account-id <id>            Telegram account id (default: default)',
    '  --peer-id <id>               Telegram peer id (default: operator peer)',
    `  --file-path <path>           document path under ${ALLOWED_FILE_ROOT} (default: ${DEFAULT_FILE_PATH})`,
    '  --caption <text>             document caption (default: timestamped canary marker)',
    '  --confirm-live-send-media    required for real Telegram document delivery',
    '  --dry-run                    validate policy without sending or writing metrics',
    '  --json                       emit JSON',
    '  -h, --help                   show this help',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentLiveSendMediaCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
