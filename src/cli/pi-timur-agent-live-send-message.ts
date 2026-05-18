import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createSendMessageTool } from '../agent/tools/send-message.js';
import type { ChannelAdapter } from '../channels/types.js';
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
const MARKER_PREFIX = 'TIMUR_AGENT_LIVE_SEND_MESSAGE_OK';

interface PiTimurAgentLiveSendMessageArgs {
  configPath: string;
  agentsDir: string;
  dataDir: string;
  accountId: string;
  peerId: string;
  marker?: string;
  confirmLiveSend: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

interface PiTimurAgentLiveSendMessageDeps {
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

interface PiTimurAgentLiveSendMessageResult {
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
  markerPrefix: string;
  markerText: string;
  permission: {
    mcpToolPresent: boolean;
    privateAllowlistSinglePeer: boolean;
    routeBound: boolean;
    sendMessageAllowed: boolean;
  };
  delivery: {
    sent: boolean;
    via: 'send_message';
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
    noMedia: boolean;
    noConfigMutation: boolean;
  };
  error?: string;
}

export async function runPiTimurAgentLiveSendMessageCli(
  argv: string[],
  deps: PiTimurAgentLiveSendMessageDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  let args: PiTimurAgentLiveSendMessageArgs;
  try {
    args = parsePiTimurAgentLiveSendMessageArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (!args.dryRun && !args.confirmLiveSend) {
    stderr.write(`Refusing live send: pass --confirm-live-send after explicit operator approval.\n${usage()}\n`);
    return 2;
  }

  try {
    const result = await runPiTimurAgentLiveSendMessage(args, deps);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const markerText = args.marker ?? `${MARKER_PREFIX} ${new Date((deps.now ?? Date.now)()).toISOString()}`;
    const result = failedResult(args, markerText, errorMessage(err));
    writeResult(stderr, args.json, result);
    return 1;
  }
}

export async function runPiTimurAgentLiveSendMessage(
  input: PiTimurAgentLiveSendMessageArgs,
  deps: PiTimurAgentLiveSendMessageDeps = {},
): Promise<PiTimurAgentLiveSendMessageResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const markerText = input.marker ?? `${MARKER_PREFIX} ${new Date(startedAt).toISOString()}`;
  const metricsDb = join(input.dataDir, 'metrics.sqlite');
  const sessionKey = `${AGENT_ID}:telegram:dm:${input.peerId}:live-send-message`;
  const runId = deps.makeRunId?.() ?? `pi-live-send-${randomUUID()}`;

  const agentConfig = loadAgentYml(join(input.agentsDir, AGENT_ID));
  const permissionFacts = validateTarget(agentConfig, input.peerId, input.accountId);

  const canUseTool = createCanUseTool({
    agent: {
      id: AGENT_ID,
      config: agentConfig,
      safetyProfile: getProfile(agentConfig.safety_profile),
      workspacePath: resolve('.'),
    },
    approvalBroker: new ApprovalBroker(),
    sessionContext: {
      channel: 'telegram',
      peerId: input.peerId,
      senderId: input.peerId,
      accountId: input.accountId,
    },
  });
  const permission = await canUseTool(
    `mcp__${SERVER_NAME}__send_message`,
    {
      channel: 'telegram',
      peer_id: input.peerId,
      account_id: input.accountId,
      text: markerText,
    },
    { signal: new AbortController().signal, toolUseID: 'timur-agent-live-send-message' } as any,
  );
  const sendMessageAllowed = permission.behavior === 'allow';
  if (!sendMessageAllowed) {
    throw new Error(`send_message permission denied: ${permission.message ?? permission.behavior}`);
  }

  if (input.dryRun) {
    return {
      status: 'passed',
      runtime: 'pi',
      agentId: AGENT_ID,
      live: false,
      dryRun: true,
      target: { channel: 'telegram', accountId: input.accountId, peerId: input.peerId },
      markerPrefix: MARKER_PREFIX,
      markerText,
      permission: { ...permissionFacts, sendMessageAllowed },
      delivery: {
        sent: false,
        via: 'send_message',
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
    toolName: 'send_message',
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
      toolName: 'send_message',
      channel: 'telegram',
      accountId: input.accountId,
      peerId: input.peerId,
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
  const sendMessageTool = createSendMessageTool(
    (id) => id === 'telegram' ? channel : undefined,
    {
      agentId: AGENT_ID,
      dispatchContext: {
        channel: 'telegram',
        accountId: input.accountId,
      },
    },
  );

  try {
    const sentAt = now();
    const toolResult = await sendMessageTool.handler({
      channel: 'telegram',
      peer_id: input.peerId,
      account_id: input.accountId,
      text: markerText,
    });
    if (toolResult.isError) {
      throw new Error(toolResult.content.map((item) => item.text).join('\n'));
    }
    const completedAt = now();
    metrics.recordToolEvent({
      timestamp: completedAt,
      agentId: AGENT_ID,
      sessionKey,
      toolName: 'send_message',
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
        toolName: 'send_message',
        messageId: extractMessageId(toolResult),
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
      markerPrefix: MARKER_PREFIX,
      markerText,
      permission: { ...permissionFacts, sendMessageAllowed },
      delivery: {
        sent: true,
        via: 'send_message',
        realTelegramDelivery: true,
        messageId: extractMessageId(toolResult),
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
      toolName: 'send_message',
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
        toolName: 'send_message',
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

export function parsePiTimurAgentLiveSendMessageArgs(argv: string[]): PiTimurAgentLiveSendMessageArgs {
  const args: PiTimurAgentLiveSendMessageArgs = {
    configPath: process.env.OC_CONFIG ? resolve(process.env.OC_CONFIG) : resolve('config.yml'),
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    dataDir: process.env.OC_DATA_DIR ? resolve(process.env.OC_DATA_DIR) : resolve('data'),
    accountId: ACCOUNT_ID,
    peerId: DEFAULT_PEER_ID,
    confirmLiveSend: false,
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
      case '--account-id':
        args.accountId = requireValue(argv, ++i, '--account-id');
        break;
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
        break;
      case '--marker':
        args.marker = requireValue(argv, ++i, '--marker');
        break;
      case '--confirm-live-send':
        args.confirmLiveSend = true;
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
): PiTimurAgentLiveSendMessageResult['permission'] {
  const mcpToolPresent = (config.mcp_tools ?? []).includes('send_message');
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

  if (!mcpToolPresent) throw new Error(`${AGENT_ID} must expose send_message.`);
  if (!privateAllowlistSinglePeer) {
    throw new Error(`${AGENT_ID} must remain private and allowlisted to exactly one Telegram peer.`);
  }
  if (!routeBound) {
    throw new Error(`${AGENT_ID} must route only the target Telegram DM for this live gate.`);
  }

  return {
    mcpToolPresent,
    privateAllowlistSinglePeer,
    routeBound,
    sendMessageAllowed: false,
  };
}

function safetyFacts(input: PiTimurAgentLiveSendMessageArgs): PiTimurAgentLiveSendMessageResult['safety'] {
  return {
    operatorApproved: input.confirmLiveSend || input.dryRun,
    noBroadFanout: input.peerId === DEFAULT_PEER_ID,
    noMedia: true,
    noConfigMutation: true,
  };
}

function extractMessageId(result: { content: Array<{ type: string; text: string }> }): string | undefined {
  const text = result.content.map((item) => item.text).join('\n');
  const match = text.match(/ID:\s*(.+)\s*$/);
  return match?.[1]?.trim();
}

function failedResult(
  args: PiTimurAgentLiveSendMessageArgs,
  markerText: string,
  error: string,
): PiTimurAgentLiveSendMessageResult {
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: AGENT_ID,
    live: !args.dryRun,
    dryRun: args.dryRun,
    target: { channel: 'telegram', accountId: args.accountId, peerId: args.peerId },
    markerPrefix: MARKER_PREFIX,
    markerText,
    permission: {
      mcpToolPresent: false,
      privateAllowlistSinglePeer: false,
      routeBound: false,
      sendMessageAllowed: false,
    },
    delivery: {
      sent: false,
      via: 'send_message',
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
  result: PiTimurAgentLiveSendMessageResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      `Pi timur_agent live send_message ${result.dryRun ? 'dry-run' : 'gate'} passed.`,
      `target: telegram/${result.target.accountId}/${result.target.peerId}`,
      `marker: ${result.markerText}`,
      `delivery: ${JSON.stringify(result.delivery)}`,
      `metrics: ${JSON.stringify(result.metrics)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi timur_agent live send_message gate failed: ${result.error ?? 'unknown error'}\n`);
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
    'Usage: pnpm runtime:pi-timur-agent-live-send-message -- [options]',
    '',
    'Options:',
    '  --config <path>          global config path (default: ./config.yml or OC_CONFIG)',
    '  --agents-dir <path>      agents directory containing timur_agent (default: ./agents or OC_AGENTS_DIR)',
    '  --data-dir <path>        data directory for metrics.sqlite (default: ./data or OC_DATA_DIR)',
    '  --account-id <id>        Telegram account id (default: default)',
    '  --peer-id <id>           Telegram peer id (default: operator peer)',
    '  --marker <text>          exact text to send (default: timestamped canary marker)',
    '  --confirm-live-send      required for real Telegram delivery',
    '  --dry-run                validate policy without sending or writing metrics',
    '  --json                   emit JSON',
    '  -h, --help               show this help',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentLiveSendMessageCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
