import 'dotenv/config';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSendMediaTool } from '../agent/tools/send-media.js';
import { createSendMessageTool } from '../agent/tools/send-message.js';
import type { ChannelAdapter, OutboundMedia, SendOptions, ApprovalRequest } from '../channels/types.js';
import { loadAgentYml } from '../config/loader.js';
import { createPeerPauseStore } from '../routing/peer-pause.js';
import { ApprovalBroker } from '../security/approval-broker.js';
import { getProfile } from '../security/profiles/index.js';
import { createCanUseTool } from '../sdk/permissions.js';
import { logger } from '../logger.js';

const AGENT_ID = 'timur_agent';
const SERVER_NAME = `${AGENT_ID}-tools`;
const ACCOUNT_ID = 'default';
const DEFAULT_PEER_ID = '48705953';
const DEFAULT_SENDER_ID = '48705953';
const DEFAULT_THREAD_ID = 'timur-agent-fake-topic';
const TEXT_MARKER = 'TIMUR_AGENT_SEND_MESSAGE_CANARY';
const MEDIA_MARKER = 'TIMUR_AGENT_SEND_MEDIA_CANARY';

interface PiTimurAgentMessagingMediaSmokeArgs {
  agentsDir: string;
  peerId: string;
  senderId: string;
  threadId: string;
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiTimurAgentMessagingMediaSmokeDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiTimurAgentMessagingMediaSmokeResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  agentsDir: string;
  workspacePath: string;
  peerId: string;
  permissions: {
    mcpToolsPresent: boolean;
    privateAllowlistSinglePeer: boolean;
    sendMessageAllowed: boolean;
    sendMediaApprovalRequested: boolean;
    sendMediaApprovalAllowed: boolean;
  };
  delivery: {
    fakeChannelOnly: boolean;
    noRealTelegramDelivery: boolean;
    textSends: number;
    mediaSends: number;
    textPeerBound: boolean;
    mediaPeerBound: boolean;
    textAccountBound: boolean;
    mediaAccountBound: boolean;
    textThreadBound: boolean;
    mediaThreadBound: boolean;
    textMarkerSeen: boolean;
    mediaMarkerSeen: boolean;
  };
  safety: {
    pathTraversalBlocked: boolean;
    pausedPeerSuppressed: boolean;
    pausedPeerExtraSends: number;
    pauseNotificationEmitted: boolean;
  };
  error?: string;
}

export async function runPiTimurAgentMessagingMediaSmokeCli(
  argv: string[],
  deps: PiTimurAgentMessagingMediaSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTimurAgentMessagingMediaSmokeArgs;

  try {
    args = parsePiTimurAgentMessagingMediaSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-timur-agent-messaging-media-'));
  try {
    const result = await runPiTimurAgentMessagingMediaSmoke({ ...args, workspace });
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result: PiTimurAgentMessagingMediaSmokeResult = {
      status: 'failed',
      runtime: 'pi',
      agentId: AGENT_ID,
      agentsDir: join(workspace, 'agents'),
      workspacePath: workspace,
      peerId: args.peerId,
      permissions: {
        mcpToolsPresent: false,
        privateAllowlistSinglePeer: false,
        sendMessageAllowed: false,
        sendMediaApprovalRequested: false,
        sendMediaApprovalAllowed: false,
      },
      delivery: {
        fakeChannelOnly: true,
        noRealTelegramDelivery: true,
        textSends: 0,
        mediaSends: 0,
        textPeerBound: false,
        mediaPeerBound: false,
        textAccountBound: false,
        mediaAccountBound: false,
        textThreadBound: false,
        mediaThreadBound: false,
        textMarkerSeen: false,
        mediaMarkerSeen: false,
      },
      safety: {
        pathTraversalBlocked: false,
        pausedPeerSuppressed: false,
        pausedPeerExtraSends: -1,
        pauseNotificationEmitted: false,
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

export async function runPiTimurAgentMessagingMediaSmoke(input: PiTimurAgentMessagingMediaSmokeArgs & {
  workspace: string;
}): Promise<PiTimurAgentMessagingMediaSmokeResult> {
  const agentsDir = join(input.workspace, 'agents');
  const workspacePath = join(input.workspace, 'workspace');
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(workspacePath, { recursive: true });
  cpSync(join(resolve(input.agentsDir), AGENT_ID), join(agentsDir, AGENT_ID), { recursive: true });
  writeFileSync(join(workspacePath, 'timur-agent-canary.txt'), 'timur_agent fake media canary\n', 'utf8');

  const config = loadAgentYml(join(agentsDir, AGENT_ID));
  const mcpToolsPresent = ['send_message', 'send_media'].every((toolName) => (config.mcp_tools ?? []).includes(toolName));
  if (!mcpToolsPresent) throw new Error('timur_agent must expose send_message and send_media tools.');
  const privateAllowlistSinglePeer =
    config.safety_profile === 'private' &&
    config.allowlist?.telegram?.length === 1 &&
    config.allowlist.telegram[0] === input.peerId;
  if (!privateAllowlistSinglePeer) {
    throw new Error('timur_agent must remain private and allowlisted to the connected operator Telegram peer.');
  }

  const approvalBroker = new ApprovalBroker();
  const adapter = createFakeTelegramAdapter(approvalBroker, input.senderId);
  const getChannel = (id: string): ChannelAdapter | undefined => id === 'telegram' ? adapter : undefined;
  const dispatchContext = {
    channel: 'telegram' as const,
    accountId: ACCOUNT_ID,
    threadId: input.threadId,
  };
  const canUseTool = createCanUseTool({
    agent: {
      id: AGENT_ID,
      config,
      safetyProfile: getProfile(config.safety_profile),
      workspacePath,
    },
    approvalBroker,
    channel: adapter,
    sessionContext: {
      channel: 'telegram',
      peerId: input.peerId,
      senderId: input.senderId,
      accountId: ACCOUNT_ID,
      threadId: input.threadId,
    },
  });

  const sendMessagePermission = await canUseTool(
    `mcp__${SERVER_NAME}__send_message`,
    { channel: 'telegram', peer_id: input.peerId, text: TEXT_MARKER },
    { signal: new AbortController().signal, toolUseID: 'timur-agent-send-message' } as any,
  );
  const sendMediaPermission = await canUseTool(
    `mcp__${SERVER_NAME}__send_media`,
    { channel: 'telegram', peer_id: input.peerId, file_path: 'timur-agent-canary.txt', type: 'document' },
    { signal: new AbortController().signal, toolUseID: 'timur-agent-send-media' } as any,
  );
  if (sendMessagePermission.behavior !== 'allow') throw new Error('send_message permission was not allowed.');
  if (sendMediaPermission.behavior !== 'allow') throw new Error('send_media approval flow was not allowed.');

  const sendMessageTool = createSendMessageTool(getChannel, { dispatchContext });
  const sendMessageResult = await sendMessageTool.handler({
    channel: 'telegram',
    peer_id: input.peerId,
    text: TEXT_MARKER,
  });
  assertToolOk(sendMessageResult, 'send_message fake delivery failed');

  const sendMediaTool = createSendMediaTool(workspacePath, getChannel, { dispatchContext });
  const sendMediaResult = await sendMediaTool.handler({
    channel: 'telegram',
    peer_id: input.peerId,
    file_path: 'timur-agent-canary.txt',
    type: 'document',
    caption: MEDIA_MARKER,
  });
  assertToolOk(sendMediaResult, 'send_media fake delivery failed');

  const traversalResult = await sendMediaTool.handler({
    channel: 'telegram',
    peer_id: input.peerId,
    file_path: '../outside.txt',
    type: 'document',
  });
  const pathTraversalBlocked = traversalResult.isError === true &&
    traversalResult.content.some((item) => item.text.includes('Path traversal blocked'));

  const pauseNotifications: string[] = [];
  const pauseStore = createPeerPauseStore({ filePath: ':memory:' });
  pauseStore.pause(AGENT_ID, `telegram:${ACCOUNT_ID}:${input.peerId}`, {
    ttlMinutes: 30,
    reason: 'operator_takeover',
    source: 'timur-agent-smoke',
  });
  const textSendsBeforePause = adapter.sentTexts.length;
  const pausedSendTool = createSendMessageTool(getChannel, {
    agentId: AGENT_ID,
    peerPauseStore: pauseStore,
    dispatchContext,
    notificationsEmitter: {
      emit: async (event, payload) => {
        pauseNotifications.push(`${event}:${payload.agentId ?? ''}:${payload.peerKey ?? ''}`);
      },
    },
  });
  const previousLogLevel = logger.level;
  let pausedResult: { isError?: boolean; content: Array<{ type: string; text: string }> };
  try {
    logger.level = 'silent';
    pausedResult = await pausedSendTool.handler({
      channel: 'telegram',
      peer_id: input.peerId,
      text: 'should be suppressed while operator owns the peer',
    });
  } finally {
    logger.level = previousLogLevel;
  }
  const pausedPayload = parseFirstJson(pausedResult);
  const pausedPeerSuppressed = pausedPayload?.suppressed === true && pausedPayload.reason === 'paused';
  const pausedPeerExtraSends = adapter.sentTexts.length - textSendsBeforePause;

  const textSend = adapter.sentTexts[0];
  const mediaSend = adapter.sentMedia[0];
  const result: PiTimurAgentMessagingMediaSmokeResult = {
    status: 'passed',
    runtime: 'pi',
    agentId: AGENT_ID,
    agentsDir,
    workspacePath,
    peerId: input.peerId,
    permissions: {
      mcpToolsPresent,
      privateAllowlistSinglePeer,
      sendMessageAllowed: sendMessagePermission.behavior === 'allow',
      sendMediaApprovalRequested: adapter.approvalRequests.length === 1,
      sendMediaApprovalAllowed: sendMediaPermission.behavior === 'allow',
    },
    delivery: {
      fakeChannelOnly: true,
      noRealTelegramDelivery: true,
      textSends: adapter.sentTexts.length,
      mediaSends: adapter.sentMedia.length,
      textPeerBound: textSend?.peerId === input.peerId,
      mediaPeerBound: mediaSend?.peerId === input.peerId,
      textAccountBound: textSend?.options.accountId === ACCOUNT_ID,
      mediaAccountBound: mediaSend?.options.accountId === ACCOUNT_ID,
      textThreadBound: textSend?.options.threadId === input.threadId,
      mediaThreadBound: mediaSend?.options.threadId === input.threadId,
      textMarkerSeen: textSend?.text === TEXT_MARKER,
      mediaMarkerSeen: mediaSend?.media.caption === MEDIA_MARKER,
    },
    safety: {
      pathTraversalBlocked,
      pausedPeerSuppressed,
      pausedPeerExtraSends,
      pauseNotificationEmitted: pauseNotifications.some((entry) => entry.includes('peer_pause_intervened_during_generation')),
    },
  };
  assertSmokeResult(result);
  return result;
}

export function parsePiTimurAgentMessagingMediaSmokeArgs(argv: string[]): PiTimurAgentMessagingMediaSmokeArgs {
  const args: PiTimurAgentMessagingMediaSmokeArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    peerId: DEFAULT_PEER_ID,
    senderId: DEFAULT_SENDER_ID,
    threadId: DEFAULT_THREAD_ID,
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
        args.agentsDir = resolve(requireValue(argv, ++i, '--agents-dir'));
        break;
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
        break;
      case '--sender-id':
        args.senderId = requireValue(argv, ++i, '--sender-id');
        break;
      case '--thread-id':
        args.threadId = requireValue(argv, ++i, '--thread-id');
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

function createFakeTelegramAdapter(
  approvalBroker: ApprovalBroker,
  senderId: string,
): ChannelAdapter & {
  approvalRequests: ApprovalRequest[];
  sentTexts: Array<{ peerId: string; text: string; options: SendOptions }>;
  sentMedia: Array<{ peerId: string; media: OutboundMedia; options: SendOptions }>;
} {
  const approvalRequests: ApprovalRequest[] = [];
  const sentTexts: Array<{ peerId: string; text: string; options: SendOptions }> = [];
  const sentMedia: Array<{ peerId: string; media: OutboundMedia; options: SendOptions }> = [];
  const adapter = {
    id: 'telegram',
    start: async () => {},
    stop: async () => {},
    onMessage: () => {},
    sendTyping: async () => {},
    editText: async () => {},
    deleteText: async () => {},
    supportsApproval: true,
    promptForApproval: async (req: ApprovalRequest) => {
      approvalRequests.push(req);
      setTimeout(() => {
        approvalBroker.resolveBySender(req.id, senderId, 'allow');
      }, 0);
    },
    sendText: async (peerId: string, text: string, options: SendOptions = {}) => {
      sentTexts.push({ peerId, text, options });
      return 'timur-agent-fake-text-id';
    },
    sendMedia: async (peerId: string, media: OutboundMedia, options: SendOptions = {}) => {
      sentMedia.push({ peerId, media, options });
      return 'timur-agent-fake-media-id';
    },
    approvalRequests,
    sentTexts,
    sentMedia,
  };
  return adapter as unknown as ChannelAdapter & {
    approvalRequests: ApprovalRequest[];
    sentTexts: Array<{ peerId: string; text: string; options: SendOptions }>;
    sentMedia: Array<{ peerId: string; media: OutboundMedia; options: SendOptions }>;
  };
}

function assertToolOk(
  result: { isError?: boolean; content: Array<{ type: string; text: string }> },
  message: string,
): void {
  if (result.isError) {
    const text = result.content.map((item) => item.text).join('\n');
    throw new Error(`${message}: ${text}`);
  }
}

function assertSmokeResult(result: PiTimurAgentMessagingMediaSmokeResult): void {
  for (const [section, values] of Object.entries({
    permissions: result.permissions,
    delivery: result.delivery,
    safety: result.safety,
  })) {
    for (const [key, value] of Object.entries(values)) {
      if (key === 'textSends' || key === 'mediaSends') continue;
      if (key === 'pausedPeerExtraSends') continue;
      if (value !== true) {
        throw new Error(`timur_agent messaging/media smoke assertion failed: ${section}.${key}`);
      }
    }
  }
  if (result.delivery.textSends !== 1) throw new Error('send_message fake send count mismatch.');
  if (result.delivery.mediaSends !== 1) throw new Error('send_media fake send count mismatch.');
  if (result.safety.pausedPeerExtraSends !== 0) throw new Error('paused peer send was not suppressed.');
}

function parseFirstJson(result: { content: Array<{ type: string; text: string }> }): Record<string, unknown> | null {
  try {
    return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTimurAgentMessagingMediaSmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi timur_agent messaging/media smoke passed.',
      `permissions: ${JSON.stringify(result.permissions)}`,
      `delivery: ${JSON.stringify(result.delivery)}`,
      `safety: ${JSON.stringify(result.safety)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi timur_agent messaging/media smoke failed: ${result.error ?? 'unknown error'}\n`);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-timur-agent-messaging-media-smoke -- [--json]',
    '',
    'Options:',
    '  --agents-dir <path>  source agents directory containing timur_agent (default: agents)',
    '  --peer-id <id>       fake Telegram peer id (default: operator peer)',
    '  --sender-id <id>     fake Telegram sender id (default: operator peer)',
    '  --thread-id <id>     fake Telegram thread id for context propagation',
    '  --keep-data          keep temp workspace for inspection',
    '  --json               emit JSON',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentMessagingMediaSmokeCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
