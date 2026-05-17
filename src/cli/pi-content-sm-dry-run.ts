import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManageCronTool } from '../agent/tools/manage-cron.js';
import { createSendMediaTool } from '../agent/tools/send-media.js';
import { createSendMessageTool } from '../agent/tools/send-message.js';
import type { ChannelAdapter, OutboundMedia, SendOptions } from '../channels/types.js';
import { DynamicCronStore } from '../cron/dynamic-store.js';
import { ApprovalBroker } from '../security/approval-broker.js';
import { chatLikeOpenclawProfile } from '../security/profiles/index.js';
import { redactSecrets } from '../security/redact.js';
import { createCanUseTool } from '../sdk/permissions.js';

interface PiContentSmDryRunArgs {
  json: boolean;
  keepWorkspace: boolean;
  help: boolean;
}

interface PiContentSmDryRunDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiContentSmDryRunResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  scenario: 'pi.content-sm-safe-dry-run';
  agentId: 'content_sm_building';
  durationMs: number;
  workspacePath?: string;
  assertions: Record<string, unknown>;
  error?: string;
}

const AGENT_ID = 'content_sm_building';
const SERVER_NAME = `${AGENT_ID}-tools`;
const DISPATCH_CONTEXT = {
  agentId: AGENT_ID,
  channel: 'telegram',
  peerId: '-100content-sm-canary',
  senderId: 'operator',
  accountId: 'content_sm',
  threadId: '42',
} as const;

export async function runPiContentSmDryRunCli(
  argv: string[],
  deps: PiContentSmDryRunDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiContentSmDryRunArgs;

  try {
    args = parsePiContentSmDryRunArgs(argv);
  } catch (err) {
    stderr.write(`${message(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const startedAt = Date.now();
  let workspacePath: string | undefined;
  try {
    workspacePath = await mkdtemp(join(tmpdir(), 'pi-content-sm-dry-run-'));
    const assertions = await runContentSmDryRun(workspacePath);
    assertDryRunSafety(assertions);
    const result: PiContentSmDryRunResult = {
      status: 'passed',
      runtime: 'pi',
      scenario: 'pi.content-sm-safe-dry-run',
      agentId: AGENT_ID,
      durationMs: Date.now() - startedAt,
      ...(args.keepWorkspace ? { workspacePath } : {}),
      assertions,
    };
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result: PiContentSmDryRunResult = {
      status: 'failed',
      runtime: 'pi',
      scenario: 'pi.content-sm-safe-dry-run',
      agentId: AGENT_ID,
      durationMs: Date.now() - startedAt,
      ...(args.keepWorkspace && workspacePath ? { workspacePath } : {}),
      assertions: {},
      error: redactSecrets(message(err)),
    };
    writeResult(stderr, args.json, result);
    return 1;
  } finally {
    if (workspacePath && !args.keepWorkspace) {
      await rm(workspacePath, { recursive: true, force: true });
    }
  }
}

export function parsePiContentSmDryRunArgs(argv: string[]): PiContentSmDryRunArgs {
  const args: PiContentSmDryRunArgs = {
    json: false,
    keepWorkspace: false,
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
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

export async function runContentSmDryRun(workspacePath: string): Promise<Record<string, unknown>> {
  await mkdir(workspacePath, { recursive: true });
  await writeFile(join(workspacePath, 'preview.html'), '<html><body>safe preview</body></html>', 'utf8');

  const adapter = createFakeTelegramAdapter();
  const getChannel = (id: string): ChannelAdapter | undefined => id === 'telegram' ? adapter : undefined;
  const canUseTool = createCanUseTool({
    agent: {
      id: AGENT_ID,
      config: {
        safety_profile: 'chat_like_openclaw',
        safety_overrides: {},
        sdk: {
          permissions: {
            allowed_mcp_tools: ['send_message', 'send_media', 'manage_cron'],
          },
        },
      },
      safetyProfile: chatLikeOpenclawProfile,
      workspacePath,
    } as any,
    approvalBroker: new ApprovalBroker(),
    channel: adapter,
    sessionContext: {
      channel: DISPATCH_CONTEXT.channel,
      peerId: DISPATCH_CONTEXT.peerId,
      senderId: DISPATCH_CONTEXT.senderId,
      accountId: DISPATCH_CONTEXT.accountId,
      threadId: DISPATCH_CONTEXT.threadId,
    },
  });

  const permissionResults = {
    sendMessage: await canUseTool(
      `mcp__${SERVER_NAME}__send_message`,
      { channel: 'telegram', peer_id: DISPATCH_CONTEXT.peerId, text: 'dry-run text' },
      { signal: new AbortController().signal, toolUseID: 'content-sm-send-message' } as any,
    ),
    sendMedia: await canUseTool(
      `mcp__${SERVER_NAME}__send_media`,
      { channel: 'telegram', peer_id: DISPATCH_CONTEXT.peerId, file_path: 'preview.html', type: 'document' },
      { signal: new AbortController().signal, toolUseID: 'content-sm-send-media' } as any,
    ),
    manageCron: await canUseTool(
      `mcp__${SERVER_NAME}__manage_cron`,
      { action: 'create', id: 'content-sm-dry-run', schedule: '0 9 * * *', prompt: 'dry-run' },
      { signal: new AbortController().signal, toolUseID: 'content-sm-manage-cron' } as any,
    ),
  };

  const sendMessageTool = createSendMessageTool(getChannel, { dispatchContext: DISPATCH_CONTEXT });
  const sendMessageResult = await sendMessageTool.handler({
    channel: 'telegram',
    peer_id: DISPATCH_CONTEXT.peerId,
    text: 'CONTENT_SM_DRY_RUN_TEXT',
  });
  assert.equal(sendMessageResult.isError, undefined, 'send_message dry-run returned an error');

  const sendMediaTool = createSendMediaTool(workspacePath, getChannel, { dispatchContext: DISPATCH_CONTEXT });
  const sendMediaResult = await sendMediaTool.handler({
    channel: 'telegram',
    peer_id: DISPATCH_CONTEXT.peerId,
    file_path: 'preview.html',
    type: 'document',
    caption: 'CONTENT_SM_DRY_RUN_MEDIA',
  });
  assert.equal(sendMediaResult.isError, undefined, 'send_media dry-run returned an error');

  const store = new DynamicCronStore(join(workspacePath, 'dynamic-cron.json'));
  let cronUpdates = 0;
  const manageCronTool = createManageCronTool(
    AGENT_ID,
    store,
    () => {
      cronUpdates += 1;
    },
    DISPATCH_CONTEXT,
  );
  const createCronResult = await manageCronTool.handler({
    action: 'create',
    id: 'content-sm-dry-run',
    schedule: '0 9 * * *',
    prompt: 'Prepare a dry-run content summary.',
    deliver_to: { channel: 'telegram', peer_id: 'untrusted-model-target' },
  });
  assert.equal(createCronResult.isError, undefined, 'manage_cron create dry-run returned an error');
  const createdJobs = store.list(AGENT_ID);
  assert.equal(createdJobs.length, 1, 'dry-run did not create exactly one temp cron job');
  const createdJob = createdJobs[0]!;
  assert.ok(createdJob.deliverTo, 'temp cron job did not bind delivery context');
  const deleteCronResult = await manageCronTool.handler({
    action: 'delete',
    id: 'content-sm-dry-run',
  });
  assert.equal(deleteCronResult.isError, undefined, 'manage_cron cleanup returned an error');

  return {
    chatLikePolicyAllowsSendMessage: permissionResults.sendMessage.behavior === 'allow',
    chatLikePolicyAllowsSendMedia: permissionResults.sendMedia.behavior === 'allow',
    chatLikePolicyAllowsManageCron: permissionResults.manageCron.behavior === 'allow',
    fakeChannelOnly: true,
    noRealTelegramDelivery: true,
    sendMessageFakeSends: adapter.sentTexts.length,
    sendMediaFakeSends: adapter.sentMedia.length,
    sendMessagePeerId: adapter.sentTexts[0]?.peerId,
    sendMediaPeerId: adapter.sentMedia[0]?.peerId,
    sendMessageThreadId: adapter.sentTexts[0]?.options.threadId,
    sendMediaThreadId: adapter.sentMedia[0]?.options.threadId,
    sendMessageAccountId: adapter.sentTexts[0]?.options.accountId,
    sendMediaAccountId: adapter.sentMedia[0]?.options.accountId,
    tempCronJobsCreated: 1,
    tempCronJobsRemaining: store.list(AGENT_ID).length,
    tempCronDeliverTo: createdJob.deliverTo,
    tempCronCreatedBy: createdJob.createdBy,
    tempCronIgnoredModelSuppliedDeliverTo: createdJob.deliverTo.peer_id !== 'untrusted-model-target',
    cronUpdates,
  };
}

function createFakeTelegramAdapter(): ChannelAdapter & {
  sentTexts: Array<{ peerId: string; text: string; options: SendOptions }>;
  sentMedia: Array<{ peerId: string; media: OutboundMedia; options: SendOptions }>;
} {
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
    supportsApproval: false,
    promptForApproval: async () => {},
    sendText: async (peerId: string, text: string, options: SendOptions = {}) => {
      sentTexts.push({ peerId, text, options });
      return 'fake-text-message-id';
    },
    sendMedia: async (peerId: string, media: OutboundMedia, options: SendOptions = {}) => {
      sentMedia.push({ peerId, media, options });
      return 'fake-media-message-id';
    },
    sentTexts,
    sentMedia,
  };
  return adapter as unknown as ChannelAdapter & {
    sentTexts: Array<{ peerId: string; text: string; options: SendOptions }>;
    sentMedia: Array<{ peerId: string; media: OutboundMedia; options: SendOptions }>;
  };
}

function assertDryRunSafety(assertions: Record<string, unknown>): void {
  const requiredTrue = [
    'chatLikePolicyAllowsSendMessage',
    'chatLikePolicyAllowsSendMedia',
    'chatLikePolicyAllowsManageCron',
    'fakeChannelOnly',
    'noRealTelegramDelivery',
    'tempCronIgnoredModelSuppliedDeliverTo',
  ];
  for (const key of requiredTrue) {
    if (assertions[key] !== true) {
      throw new Error(`content_sm dry-run assertion failed: ${key}`);
    }
  }
  assert.equal(assertions.sendMessageFakeSends, 1, 'send_message fake send count mismatch');
  assert.equal(assertions.sendMediaFakeSends, 1, 'send_media fake send count mismatch');
  assert.equal(assertions.tempCronJobsCreated, 1, 'temp cron create count mismatch');
  assert.equal(assertions.tempCronJobsRemaining, 0, 'temp cron cleanup failed');
  assert.equal(assertions.sendMessagePeerId, DISPATCH_CONTEXT.peerId, 'send_message target peer mismatch');
  assert.equal(assertions.sendMediaPeerId, DISPATCH_CONTEXT.peerId, 'send_media target peer mismatch');
  assert.equal(assertions.sendMessageThreadId, DISPATCH_CONTEXT.threadId, 'send_message thread mismatch');
  assert.equal(assertions.sendMediaThreadId, DISPATCH_CONTEXT.threadId, 'send_media thread mismatch');
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiContentSmDryRunResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stream.write([
    `Pi content_sm_building safe dry run ${result.status}.`,
    `durationMs: ${result.durationMs}`,
    ...(result.error ? [`error: ${result.error}`] : []),
  ].join('\n'));
  stream.write('\n');
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-content-sm-dry-run -- [--json]',
    '',
    'Runs the deterministic content_sm_building fanout/schedule dry-run without real delivery.',
    '',
    'Options:',
    '  --keep-workspace      keep temporary dry-run workspace for inspection',
    '  --json                print structured result',
  ].join('\n');
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiContentSmDryRunCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
