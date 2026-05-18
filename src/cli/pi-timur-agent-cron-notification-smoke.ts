import 'dotenv/config';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadAgentYml } from '../config/loader.js';
import { createAgentConfigWriter } from '../config/writer.js';
import { DynamicCronStore } from '../cron/dynamic-store.js';
import { createManageCronTool } from '../agent/tools/manage-cron.js';
import { createManageNotificationsTool } from '../agent/tools/manage-notifications.js';
import { createNotificationsEmitter } from '../notifications/emitter.js';
import type { NotificationRoute } from '../notifications/types.js';

const AGENT_ID = 'timur_agent';
const ACCOUNT_ID = 'default';
const DEFAULT_PEER_ID = '48705953';
const DEFAULT_SENDER_ID = '48705953';
const STATIC_CRON_ID = 'timur-agent-lab-silent-check';
const DYNAMIC_CRON_ID = 'timur-agent-cron-notification-smoke';
const NOTIFICATION_MARKER = 'TIMUR_AGENT_NOTIFICATION_CANARY';

interface PiTimurAgentCronNotificationSmokeArgs {
  agentsDir: string;
  peerId: string;
  senderId: string;
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiTimurAgentCronNotificationSmokeDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface FakeNotificationSend {
  route: NotificationRoute;
  text: string;
  meta: { event: string; agentId: string };
}

interface PiTimurAgentCronNotificationSmokeResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  agentsDir: string;
  dataDir: string;
  peerId: string;
  staticCron: {
    id: string;
    exists: boolean;
    enabled: boolean;
  };
  dynamicCron: {
    created: boolean;
    listed: boolean;
    toggledDisabled: boolean;
    deleted: boolean;
    remaining: number;
    updates: number;
    deliverToBound: boolean;
    ignoredModelSuppliedDeliverTo: boolean;
  };
  notifications: {
    operatorRoutePresent: boolean;
    subscriptions: number;
    manageToolTestDispatched: boolean;
    emitterSends: number;
    fakeOnly: boolean;
    markerSeen: boolean;
  };
  error?: string;
}

export async function runPiTimurAgentCronNotificationSmokeCli(
  argv: string[],
  deps: PiTimurAgentCronNotificationSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTimurAgentCronNotificationSmokeArgs;

  try {
    args = parsePiTimurAgentCronNotificationSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-timur-agent-cron-notification-'));
  try {
    const result = await runPiTimurAgentCronNotificationSmoke({ ...args, workspace });
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result: PiTimurAgentCronNotificationSmokeResult = {
      status: 'failed',
      runtime: 'pi',
      agentId: AGENT_ID,
      agentsDir: join(workspace, 'agents'),
      dataDir: join(workspace, 'data'),
      peerId: args.peerId,
      staticCron: { id: STATIC_CRON_ID, exists: false, enabled: false },
      dynamicCron: {
        created: false,
        listed: false,
        toggledDisabled: false,
        deleted: false,
        remaining: -1,
        updates: 0,
        deliverToBound: false,
        ignoredModelSuppliedDeliverTo: false,
      },
      notifications: {
        operatorRoutePresent: false,
        subscriptions: 0,
        manageToolTestDispatched: false,
        emitterSends: 0,
        fakeOnly: true,
        markerSeen: false,
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

export async function runPiTimurAgentCronNotificationSmoke(input: PiTimurAgentCronNotificationSmokeArgs & {
  workspace: string;
}): Promise<PiTimurAgentCronNotificationSmokeResult> {
  const agentsDir = join(input.workspace, 'agents');
  const dataDir = join(input.workspace, 'data');
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  cpSync(join(resolve(input.agentsDir), AGENT_ID), join(agentsDir, AGENT_ID), { recursive: true });

  const config = loadAgentYml(join(agentsDir, AGENT_ID));
  const staticJob = (config.cron ?? []).find((job) => job.id === STATIC_CRON_ID);
  if (!staticJob) throw new Error(`Static cron job ${STATIC_CRON_ID} is missing.`);
  if (staticJob.enabled !== false) throw new Error(`Static cron job ${STATIC_CRON_ID} must remain disabled by default.`);

  const cronStore = new DynamicCronStore(join(dataDir, 'dynamic-cron.json'));
  let cronUpdates = 0;
  const cronTool = createManageCronTool(
    AGENT_ID,
    cronStore,
    () => {
      cronUpdates += 1;
    },
    {
      agentId: AGENT_ID,
      channel: 'telegram',
      accountId: ACCOUNT_ID,
      peerId: input.peerId,
      senderId: input.senderId,
    },
  );

  await assertToolOk(cronTool.handler({
    action: 'create',
    id: DYNAMIC_CRON_ID,
    schedule: '*/30 * * * *',
    prompt: 'Run a disabled timur_agent cron smoke. Reply [SILENT] if healthy.',
    deliver_to: { channel: 'telegram', peer_id: 'untrusted-model-target' },
  }), 'manage_cron create failed');
  await assertToolOk(cronTool.handler({ action: 'list' }), 'manage_cron list failed');
  await assertToolOk(cronTool.handler({
    action: 'toggle',
    id: DYNAMIC_CRON_ID,
    enabled: false,
  }), 'manage_cron toggle false failed');

  const [disabledJob] = cronStore.list(AGENT_ID);
  if (!disabledJob) throw new Error('manage_cron did not persist the temporary job.');
  if (disabledJob.enabled !== false) throw new Error('Temporary cron job was not toggled disabled.');
  if (disabledJob.deliverTo?.peer_id !== input.peerId || disabledJob.deliverTo.account_id !== ACCOUNT_ID) {
    throw new Error('Temporary cron job did not bind delivery to the operator dispatch context.');
  }

  await assertToolOk(cronTool.handler({
    action: 'delete',
    id: DYNAMIC_CRON_ID,
  }), 'manage_cron cleanup failed');

  const writer = createAgentConfigWriter({ agentsDir, backupKeep: 2 });
  const notifications = config.notifications;
  if (!notifications) throw new Error('timur_agent notifications block is missing.');
  const operatorRoute = notifications.routes?.operator;
  if (notifications.enabled !== true) throw new Error('timur_agent notifications must remain enabled for operator-route canaries.');
  if (!operatorRoute) throw new Error('timur_agent notifications.operator route is missing.');
  if (operatorRoute.account_id !== ACCOUNT_ID || operatorRoute.peer_id !== input.peerId) {
    throw new Error('timur_agent notifications.operator route does not target the connected default operator peer.');
  }

  const manageToolTestDispatches: Array<{ agentId: string; routeName: string; route: NotificationRoute }> = [];
  const notificationsTool = createManageNotificationsTool({
    agentId: AGENT_ID,
    writer,
    canManage: (callerId, targetId) => callerId === targetId,
    dispatchTest: (dispatch) => {
      manageToolTestDispatches.push(dispatch);
    },
    sessionKey: `${AGENT_ID}:telegram:dm:${input.peerId}`,
  });
  await assertToolOk(notificationsTool.handler({
    action: { kind: 'list_routes' },
  }), 'manage_notifications list_routes failed');
  await assertToolOk(notificationsTool.handler({
    action: { kind: 'list_subscriptions' },
  }), 'manage_notifications list_subscriptions failed');
  await assertToolOk(notificationsTool.handler({
    action: { kind: 'test', route_name: 'operator' },
  }), 'manage_notifications test dispatch failed');
  if (manageToolTestDispatches.length !== 1) {
    throw new Error(`manage_notifications test dispatched ${manageToolTestDispatches.length} times, expected 1.`);
  }

  const fakeSends: FakeNotificationSend[] = [];
  const emitter = createNotificationsEmitter({
    sendMessage: (route, text, meta) => {
      fakeSends.push({ route, text, meta });
    },
  });
  emitter.subscribeAgent(AGENT_ID, notifications);
  await emitter.emit('escalation_needed', {
    agentId: AGENT_ID,
    peerKey: `telegram:${ACCOUNT_ID}:${input.peerId}`,
    note: NOTIFICATION_MARKER,
  });
  if (fakeSends.length !== 1) throw new Error(`Expected one fake proactive notification send, got ${fakeSends.length}.`);
  const fakeSend = fakeSends[0]!;
  if (fakeSend.route.account_id !== ACCOUNT_ID || fakeSend.route.peer_id !== input.peerId) {
    throw new Error('Fake proactive notification did not target the operator route.');
  }
  if (!fakeSend.text.includes(NOTIFICATION_MARKER)) {
    throw new Error('Fake proactive notification did not include the canary marker.');
  }

  return {
    status: 'passed',
    runtime: 'pi',
    agentId: AGENT_ID,
    agentsDir,
    dataDir,
    peerId: input.peerId,
    staticCron: {
      id: STATIC_CRON_ID,
      exists: true,
      enabled: false,
    },
    dynamicCron: {
      created: true,
      listed: true,
      toggledDisabled: disabledJob.enabled === false,
      deleted: true,
      remaining: cronStore.list(AGENT_ID).length,
      updates: cronUpdates,
      deliverToBound: disabledJob.deliverTo?.peer_id === input.peerId && disabledJob.deliverTo.account_id === ACCOUNT_ID,
      ignoredModelSuppliedDeliverTo: disabledJob.deliverTo?.peer_id !== 'untrusted-model-target',
    },
    notifications: {
      operatorRoutePresent: true,
      subscriptions: notifications.subscriptions?.length ?? 0,
      manageToolTestDispatched: manageToolTestDispatches.length === 1,
      emitterSends: fakeSends.length,
      fakeOnly: true,
      markerSeen: fakeSend.text.includes(NOTIFICATION_MARKER),
    },
  };
}

export function parsePiTimurAgentCronNotificationSmokeArgs(argv: string[]): PiTimurAgentCronNotificationSmokeArgs {
  const args: PiTimurAgentCronNotificationSmokeArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
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
        args.agentsDir = resolve(requireValue(argv, ++i, '--agents-dir'));
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

async function assertToolOk(
  resultPromise: Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }>,
  message: string,
): Promise<void> {
  const result = await resultPromise;
  if (result.isError) {
    const text = result.content.map((item) => item.text).join('\n');
    throw new Error(`${message}: ${text}`);
  }
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTimurAgentCronNotificationSmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi timur_agent cron/notification smoke passed.',
      `staticCron: ${JSON.stringify(result.staticCron)}`,
      `dynamicCron: ${JSON.stringify(result.dynamicCron)}`,
      `notifications: ${JSON.stringify(result.notifications)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi timur_agent cron/notification smoke failed: ${result.error ?? 'unknown error'}\n`);
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
    'Usage: pnpm runtime:pi-timur-agent-cron-notification-smoke -- [--json]',
    '',
    'Options:',
    '  --agents-dir <path>  source agents directory containing timur_agent (default: agents)',
    '  --peer-id <id>       fake Telegram peer id (default: operator peer)',
    '  --sender-id <id>     fake Telegram sender id (default: operator peer)',
    '  --keep-data          keep temp workspace for inspection',
    '  --json               emit JSON',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentCronNotificationSmokeCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
