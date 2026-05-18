import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { ChannelAdapter } from '../channels/types.js';
import { TelegramChannel } from '../channels/telegram.js';
import { loadAgentYml, loadGlobalConfig } from '../config/loader.js';
import type { AgentYml, GlobalConfig } from '../config/schema.js';
import { MetricsStore } from '../metrics/store.js';
import { createNotificationsEmitter } from '../notifications/emitter.js';
import type { NotificationRoute } from '../notifications/types.js';

const AGENT_ID = 'timur_agent';
const ACCOUNT_ID = 'default';
const DEFAULT_PEER_ID = '48705953';
const MARKER_PREFIX = 'TIMUR_AGENT_LIVE_NOTIFICATION_OK';
const EVENT_NAME = 'escalation_needed';

interface PiTimurAgentLiveNotificationArgs {
  configPath: string;
  agentsDir: string;
  dataDir: string;
  accountId: string;
  peerId: string;
  note?: string;
  confirmLiveNotification: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

interface PiTimurAgentLiveNotificationDeps {
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

interface PiTimurAgentLiveNotificationResult {
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
  note: string;
  notification: {
    event: typeof EVENT_NAME;
    operatorRoutePresent: boolean;
    subscriptionPresent: boolean;
    notificationsEnabled: boolean;
    formattedTextIncludesMarker: boolean;
  };
  delivery: {
    sent: boolean;
    via: 'notifications.emit';
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
    noCronMutation: boolean;
    noConfigMutation: boolean;
  };
  error?: string;
}

export async function runPiTimurAgentLiveNotificationCli(
  argv: string[],
  deps: PiTimurAgentLiveNotificationDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  let args: PiTimurAgentLiveNotificationArgs;
  try {
    args = parsePiTimurAgentLiveNotificationArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (!args.dryRun && !args.confirmLiveNotification) {
    stderr.write(`Refusing live notification: pass --confirm-live-notification after explicit operator approval.\n${usage()}\n`);
    return 2;
  }

  try {
    const result = await runPiTimurAgentLiveNotification(args, deps);
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const note = args.note ?? `${MARKER_PREFIX} ${new Date((deps.now ?? Date.now)()).toISOString()}`;
    const result = failedResult(args, note, errorMessage(err));
    writeResult(stderr, args.json, result);
    return 1;
  }
}

export async function runPiTimurAgentLiveNotification(
  input: PiTimurAgentLiveNotificationArgs,
  deps: PiTimurAgentLiveNotificationDeps = {},
): Promise<PiTimurAgentLiveNotificationResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const note = input.note ?? `${MARKER_PREFIX} ${new Date(startedAt).toISOString()}`;
  const metricsDb = join(input.dataDir, 'metrics.sqlite');
  const sessionKey = `${AGENT_ID}:telegram:dm:${input.peerId}:live-notification`;
  const runId = deps.makeRunId?.() ?? `pi-live-notification-${randomUUID()}`;

  const agentConfig = loadAgentYml(join(input.agentsDir, AGENT_ID));
  const notificationFacts = validateNotificationTarget(agentConfig, input.peerId, input.accountId);

  if (input.dryRun) {
    return {
      status: 'passed',
      runtime: 'pi',
      agentId: AGENT_ID,
      live: false,
      dryRun: true,
      target: { channel: 'telegram', accountId: input.accountId, peerId: input.peerId },
      markerPrefix: MARKER_PREFIX,
      note,
      notification: {
        event: EVENT_NAME,
        ...notificationFacts,
        formattedTextIncludesMarker: true,
      },
      delivery: {
        sent: false,
        via: 'notifications.emit',
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
    toolName: 'notifications.emit',
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
      toolName: 'notifications.emit',
      event: EVENT_NAME,
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

  const sends: Array<{ route: NotificationRoute; text: string; messageId: string }> = [];
  const emitter = createNotificationsEmitter({
    sendMessage: async (route, text) => {
      if (route.channel !== 'telegram') throw new Error(`unsupported notification channel: ${route.channel}`);
      const messageId = await channel.sendText(route.peer_id, text, { accountId: route.account_id });
      sends.push({ route, text, messageId });
      return messageId;
    },
  });
  emitter.subscribeAgent(AGENT_ID, agentConfig.notifications);

  try {
    const sentAt = now();
    await emitter.emit(EVENT_NAME, {
      agentId: AGENT_ID,
      peerKey: `telegram:${input.accountId}:${input.peerId}`,
      note,
    });
    const completedAt = now();
    if (sends.length !== 1) {
      throw new Error(`expected exactly one notification send, got ${sends.length}`);
    }
    const send = sends[0]!;
    if (send.route.account_id !== input.accountId || send.route.peer_id !== input.peerId) {
      throw new Error('notification delivery target drifted away from the operator route');
    }
    if (!send.text.includes(note)) {
      throw new Error('formatted notification text did not include the marker note');
    }

    metrics.recordToolEvent({
      timestamp: completedAt,
      agentId: AGENT_ID,
      sessionKey,
      toolName: 'notifications.emit',
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
        toolName: 'notifications.emit',
        event: EVENT_NAME,
        messageId: send.messageId,
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
      note,
      notification: {
        event: EVENT_NAME,
        ...notificationFacts,
        formattedTextIncludesMarker: true,
      },
      delivery: {
        sent: true,
        via: 'notifications.emit',
        realTelegramDelivery: true,
        messageId: send.messageId,
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
      toolName: 'notifications.emit',
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
        toolName: 'notifications.emit',
        event: EVENT_NAME,
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

export function parsePiTimurAgentLiveNotificationArgs(argv: string[]): PiTimurAgentLiveNotificationArgs {
  const args: PiTimurAgentLiveNotificationArgs = {
    configPath: process.env.OC_CONFIG ? resolve(process.env.OC_CONFIG) : resolve('config.yml'),
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    dataDir: process.env.OC_DATA_DIR ? resolve(process.env.OC_DATA_DIR) : resolve('data'),
    accountId: ACCOUNT_ID,
    peerId: DEFAULT_PEER_ID,
    confirmLiveNotification: false,
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
      case '--note':
        args.note = requireValue(argv, ++i, '--note');
        break;
      case '--confirm-live-notification':
        args.confirmLiveNotification = true;
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

function validateNotificationTarget(
  config: AgentYml,
  peerId: string,
  accountId: string,
): Pick<PiTimurAgentLiveNotificationResult['notification'], 'operatorRoutePresent' | 'subscriptionPresent' | 'notificationsEnabled'> {
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
  const notifications = config.notifications;
  const notificationsEnabled = notifications?.enabled === true;
  const operatorRoute = notifications?.routes?.operator;
  const operatorRoutePresent =
    operatorRoute?.channel === 'telegram' &&
    operatorRoute.account_id === accountId &&
    operatorRoute.peer_id === peerId;
  const subscriptionPresent = (notifications?.subscriptions ?? []).some((subscription) =>
    subscription.event === EVENT_NAME && subscription.route === 'operator'
  );

  if (!privateAllowlistSinglePeer) {
    throw new Error(`${AGENT_ID} must remain private and allowlisted to exactly one Telegram peer.`);
  }
  if (!routeBound) {
    throw new Error(`${AGENT_ID} must route only the target Telegram DM for this live gate.`);
  }
  if (!notificationsEnabled) throw new Error(`${AGENT_ID} notifications must be enabled.`);
  if (!operatorRoutePresent) {
    throw new Error(`${AGENT_ID} notifications.operator route must target telegram/${accountId}/${peerId}.`);
  }
  if (!subscriptionPresent) {
    throw new Error(`${AGENT_ID} must subscribe escalation_needed to the operator route.`);
  }

  return { operatorRoutePresent, subscriptionPresent, notificationsEnabled };
}

function safetyFacts(input: PiTimurAgentLiveNotificationArgs): PiTimurAgentLiveNotificationResult['safety'] {
  return {
    operatorApproved: input.confirmLiveNotification || input.dryRun,
    noBroadFanout: input.peerId === DEFAULT_PEER_ID,
    noCronMutation: true,
    noConfigMutation: true,
  };
}

function failedResult(
  args: PiTimurAgentLiveNotificationArgs,
  note: string,
  error: string,
): PiTimurAgentLiveNotificationResult {
  return {
    status: 'failed',
    runtime: 'pi',
    agentId: AGENT_ID,
    live: !args.dryRun,
    dryRun: args.dryRun,
    target: { channel: 'telegram', accountId: args.accountId, peerId: args.peerId },
    markerPrefix: MARKER_PREFIX,
    note,
    notification: {
      event: EVENT_NAME,
      operatorRoutePresent: false,
      subscriptionPresent: false,
      notificationsEnabled: false,
      formattedTextIncludesMarker: false,
    },
    delivery: {
      sent: false,
      via: 'notifications.emit',
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
  result: PiTimurAgentLiveNotificationResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      `Pi timur_agent live notification ${result.dryRun ? 'dry-run' : 'gate'} passed.`,
      `target: telegram/${result.target.accountId}/${result.target.peerId}`,
      `note: ${result.note}`,
      `delivery: ${JSON.stringify(result.delivery)}`,
      `metrics: ${JSON.stringify(result.metrics)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi timur_agent live notification gate failed: ${result.error ?? 'unknown error'}\n`);
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
    'Usage: pnpm runtime:pi-timur-agent-live-notification -- [options]',
    '',
    'Options:',
    '  --config <path>                 global config path (default: ./config.yml or OC_CONFIG)',
    '  --agents-dir <path>             agents directory containing timur_agent (default: ./agents or OC_AGENTS_DIR)',
    '  --data-dir <path>               data directory for metrics.sqlite (default: ./data or OC_DATA_DIR)',
    '  --account-id <id>               Telegram account id (default: default)',
    '  --peer-id <id>                  Telegram peer id (default: operator peer)',
    '  --note <text>                   escalation note (default: timestamped canary marker)',
    '  --confirm-live-notification     required for real Telegram notification delivery',
    '  --dry-run                       validate policy without sending or writing metrics',
    '  --json                          emit JSON',
    '  -h, --help                      show this help',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentLiveNotificationCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
