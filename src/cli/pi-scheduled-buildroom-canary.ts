import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent } from '../agent/agent.js';
import type { BuildroomArtifact } from '../auto-buildroom/artifacts/model.js';
import { FileArtifactStore } from '../auto-buildroom/artifacts/store.js';
import { BuildroomLockHeldError, FileBuildroomLock } from '../auto-buildroom/locks/lock.js';
import { evaluatePathPolicy, normalizeRepoPath } from '../auto-buildroom/policy/paths.js';
import {
  loadBuildroomRoomConfig,
  roomRoot,
} from '../auto-buildroom/storage/init.js';
import { createBuildroomHandoffTool } from '../agent/tools/buildroom-handoff.js';
import { createBuildroomSessionSummaryTool } from '../agent/tools/buildroom-session-summary.js';
import { createManageCronTool } from '../agent/tools/manage-cron.js';
import type { ToolResult } from '../agent/tools/types.js';
import { DynamicCronStore } from '../cron/dynamic-store.js';
import { CronScheduler } from '../cron/scheduler.js';
import { HEARTBEAT_FILENAME } from '../heartbeat/constants.js';
import { HeartbeatHistoryStore } from '../heartbeat/history.js';
import { HeartbeatRunner, type HeartbeatRunRequest } from '../heartbeat/runner.js';
import { HeartbeatStateStore } from '../heartbeat/state-store.js';
import { redactSecrets } from '../security/redact.js';
import { runBuildroomCli } from './buildroom.js';

interface PiScheduledBuildroomCanaryArgs {
  json: boolean;
  keepWorkspace: boolean;
  allowSkip: boolean;
  timeoutMs: number;
  help: boolean;
}

interface PiScheduledBuildroomCanaryDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiScheduledBuildroomCanaryResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  scenario: 'pi.scheduled-buildroom';
  durationMs: number;
  workspacePath?: string;
  assertions: Record<string, unknown>;
  error?: string;
}

const SCENARIO_ID = 'pi.scheduled-buildroom' as const;
const AGENT_ID = 'pi-scheduled-agent';
const ROOM_ID = 'anthroclaw-core';
const SOURCE_SESSION_ID = 'pi-scheduled-session-1';
const NOW = '2026-05-16T00:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const TELEGRAM_NOTIFICATION_ROUTE = 'telegram_thread:-1001234567890:2';

export async function runPiScheduledBuildroomCanaryCli(
  argv: string[],
  deps: PiScheduledBuildroomCanaryDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiScheduledBuildroomCanaryArgs;

  try {
    args = parsePiScheduledBuildroomCanaryArgs(argv);
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
    workspacePath = await mkdtemp(join(tmpdir(), 'pi-scheduled-buildroom-canary-'));
    const assertions = await runScheduledBuildroomCanary({
      workspacePath,
      timeoutMs: args.timeoutMs,
    });
    const result: PiScheduledBuildroomCanaryResult = {
      status: 'passed',
      runtime: 'pi',
      scenario: SCENARIO_ID,
      durationMs: Date.now() - startedAt,
      ...(args.keepWorkspace ? { workspacePath } : {}),
      assertions,
    };
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result: PiScheduledBuildroomCanaryResult = {
      status: 'failed',
      runtime: 'pi',
      scenario: SCENARIO_ID,
      durationMs: Date.now() - startedAt,
      ...(args.keepWorkspace && workspacePath ? { workspacePath } : {}),
      assertions: {},
      error: redactSecrets(err instanceof Error ? err.message : String(err)),
    };
    writeResult(stderr, args.json, result);
    return args.allowSkip ? 0 : 1;
  } finally {
    if (workspacePath && !args.keepWorkspace) {
      await rm(workspacePath, { recursive: true, force: true });
    }
  }
}

export function parsePiScheduledBuildroomCanaryArgs(argv: string[]): PiScheduledBuildroomCanaryArgs {
  const args: PiScheduledBuildroomCanaryArgs = {
    json: false,
    keepWorkspace: false,
    allowSkip: false,
    timeoutMs: 5_000,
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
      case '--allow-skip':
        args.allowSkip = true;
        break;
      case '--timeout-ms':
        args.timeoutMs = parsePositiveInt(requireValue(argv, ++i, '--timeout-ms'), '--timeout-ms');
        break;
      case '--model':
      case '--auth-path':
      case '--models-path':
        i += 1;
        break;
      case '--gateway':
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function runScheduledBuildroomCanary(input: {
  workspacePath: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const projectRoot = join(input.workspacePath, 'project');
  const dataDir = join(input.workspacePath, 'data');
  const agentWorkspacePath = join(input.workspacePath, 'agents', AGENT_ID);
  await Promise.all([
    mkdir(projectRoot, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(agentWorkspacePath, { recursive: true }),
  ]);

  const cron = await exerciseManageCron(dataDir);
  const heartbeat = await exerciseHeartbeat(agentWorkspacePath, dataDir, input.timeoutMs);
  const buildroom = await exerciseBuildroom(projectRoot);
  const buildroomTools = await exerciseBuildroomTools(projectRoot);
  const notifications = await exerciseBuildroomTrustNotification(projectRoot);
  const policyAndLocks = exercisePathPolicyAndLocks(projectRoot);

  const store = new FileArtifactStore({ projectRoot, roomId: ROOM_ID });
  const artifacts = store.listArtifacts();
  const config = loadBuildroomRoomConfig(projectRoot, ROOM_ID);

  assert.ok(artifacts.length >= 4, 'Buildroom canary did not persist enough evidence artifacts');
  assert.ok(artifacts.every((artifact) => artifact.contentHash.startsWith('sha256:')), 'Buildroom artifacts are missing content hashes');
  assert.ok(config.paths.allowed.length > 0, 'Buildroom path policy has no allowed paths');
  assert.ok(config.paths.blocked.includes('agents/**'), 'Buildroom path policy does not block agent config paths');

  return {
    cron,
    heartbeat,
    buildroom,
    buildroomTools,
    notifications,
    artifacts: {
      total: artifacts.length,
      types: artifacts.map((artifact) => artifact.type).sort(),
      contentHashesVerified: true,
    },
    pathPolicy: policyAndLocks.pathPolicy,
    locks: policyAndLocks.locks,
  };
}

async function exerciseManageCron(dataDir: string): Promise<Record<string, unknown>> {
  const store = new DynamicCronStore(join(dataDir, 'dynamic-cron.json'));
  let updates = 0;
  const tool = createManageCronTool(
    AGENT_ID,
    store,
    () => {
      updates += 1;
    },
    {
      agentId: AGENT_ID,
      channel: 'telegram',
      peerId: '-1001234567890',
      senderId: '123456789',
      accountId: 'main',
      threadId: '2',
    },
  );

  await assertToolOk(tool.handler({
    action: 'create',
    id: 'pi-scheduled-canary',
    schedule: '*/5 * * * *',
    prompt: 'Run the scheduled Buildroom canary check.',
  }), 'manage_cron create failed');
  await assertToolOk(tool.handler({ action: 'list' }), 'manage_cron list failed');
  await assertToolOk(tool.handler({
    action: 'toggle',
    id: 'pi-scheduled-canary',
    enabled: false,
  }), 'manage_cron toggle failed');

  const [job] = store.list(AGENT_ID);
  assert.ok(job, 'manage_cron did not persist the job');
  assert.equal(job.deliverTo?.channel, 'telegram');
  assert.equal(job.deliverTo?.peer_id, '-1001234567890');
  assert.equal(job.deliverTo?.thread_id, '2');
  assert.equal(job.createdBy?.sender_id, '123456789');
  assert.equal(job.enabled, false);
  assert.equal(updates, 2);

  return {
    created: true,
    listed: true,
    toggled: true,
    deliverToBound: true,
    updates,
    jobId: job.id,
  };
}

async function exerciseHeartbeat(
  agentWorkspacePath: string,
  dataDir: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  await writeFile(
    join(agentWorkspacePath, HEARTBEAT_FILENAME),
    [
      'Pi scheduled Buildroom canary context.',
      '',
      'tasks:',
      '  - name: buildroom-followup',
      '    interval: 1m',
      '    prompt: Verify scheduled Buildroom handoff state.',
    ].join('\n'),
    'utf-8',
  );

  const stateStore = new HeartbeatStateStore(join(dataDir, 'heartbeat-state.json'));
  const historyStore = new HeartbeatHistoryStore(
    join(dataDir, 'heartbeat-output'),
    join(dataDir, 'heartbeat-runs.jsonl'),
  );
  const agent = {
    id: AGENT_ID,
    workspacePath: agentWorkspacePath,
    config: {
      safety_profile: 'trusted',
      heartbeat: {
        enabled: true,
        every: '1m',
        target: 'none',
        isolated_session: false,
        show_ok: false,
        ack_token: 'HEARTBEAT_OK',
        prompt: 'Run scheduled AnthroClaw work through the selected runtime.',
      },
    },
  } as Agent;
  const requests: HeartbeatRunRequest[] = [];
  let nowMs = NOW_MS;
  const runner = new HeartbeatRunner({
    listAgents: () => [agent],
    stateStore,
    historyStore,
    isSessionActive: () => false,
    nowMs: () => nowMs,
    retryMs: Math.min(timeoutMs, 100),
    runHeartbeat: async (request) => {
      requests.push(request);
      return {
        response: 'Scheduled Buildroom heartbeat delivered.',
        delivered: true,
      };
    },
  });

  runner.start();
  const outcome = await runner.runNow(AGENT_ID);
  nowMs += 1_000;

  let scheduledOutcome: Awaited<ReturnType<HeartbeatRunner['runNow']>> | undefined;
  let scheduledPrompt: string | undefined;
  let scheduledTimeout: ReturnType<typeof setTimeout> | undefined;
  let resolveScheduled: (() => void) | undefined;
  let rejectScheduled: ((err: unknown) => void) | undefined;
  const scheduledFire = new Promise<void>((resolve, reject) => {
    resolveScheduled = resolve;
    rejectScheduled = reject;
    scheduledTimeout = setTimeout(
      () => reject(new Error(`Cron scheduler did not fire within ${timeoutMs}ms`)),
      timeoutMs,
    );
    scheduledTimeout.unref?.();
  });
  const scheduler = new CronScheduler(async (job) => {
    try {
      scheduledPrompt = job.prompt;
      scheduledOutcome = await runner.runNow(job.agentId);
      resolveScheduled?.();
    } catch (err) {
      rejectScheduled?.(err);
    }
  });
  scheduler.addJob({
    id: 'pi-scheduled-heartbeat',
    agentId: AGENT_ID,
    schedule: '* * * * * *',
    prompt: 'Scheduler callback should invoke the heartbeat runtime path.',
    enabled: true,
  });
  assert.deepEqual(scheduler.listJobs(), [`${AGENT_ID}:pi-scheduled-heartbeat`]);
  try {
    await scheduledFire;
  } finally {
    if (scheduledTimeout) clearTimeout(scheduledTimeout);
    scheduler.stop();
  }
  runner.stop();

  assert.equal(outcome.status, 'completed');
  assert.equal(scheduledOutcome?.status, 'completed');
  assert.equal(scheduledPrompt, 'Scheduler callback should invoke the heartbeat runtime path.');
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.sessionKey, `${AGENT_ID}:heartbeat`);
  assert.equal(requests[1]?.sessionKey, `${AGENT_ID}:heartbeat`);
  assert.deepEqual(requests[0]?.taskNames, ['buildroom-followup']);
  assert.match(requests[0]?.prompt ?? '', /Verify scheduled Buildroom handoff state/);

  const state = stateStore.getAgent(AGENT_ID);
  const runs = historyStore.listRuns();
  const run = runs[0];
  assert.equal(state.tasks['buildroom-followup']?.lastStatus, 'ok');
  assert.ok(state.lastDeliveredHash, 'heartbeat delivery hash was not recorded');
  assert.equal(run?.status, 'delivered');
  assert.ok(run?.responseHash, 'heartbeat run history is missing response hash');

  return {
    completed: true,
    sessionKey: requests[0]?.sessionKey,
    taskNames: requests[0]?.taskNames,
    delivered: run?.delivered === true,
    stateRecorded: Boolean(state.lastDeliveredHash),
    schedulerTriggered: scheduledOutcome?.status === 'completed',
    schedulerJobs: ['pi-scheduled-agent:pi-scheduled-heartbeat'],
    requestCount: requests.length,
  };
}

async function exerciseBuildroom(projectRoot: string): Promise<Record<string, unknown>> {
  await runBuildroomCommand([
    'init',
    '--root', projectRoot,
    '--operator', 'cli:user:pi-canary',
    '--telegram-notification-route', TELEGRAM_NOTIFICATION_ROUTE,
  ]);
  const status = await runBuildroomCommand(['status', '--root', projectRoot, '--json']);
  assert.equal(status.parsed?.ok, true);
  assert.equal(status.parsed?.roomId, ROOM_ID);

  await runBuildroomCommand(['pause', '--root', projectRoot]);
  assert.equal(loadBuildroomRoomConfig(projectRoot, ROOM_ID).paused, true);
  await runBuildroomCommand(['resume', '--root', projectRoot]);
  assert.equal(loadBuildroomRoomConfig(projectRoot, ROOM_ID).paused, false);
  await runBuildroomCommand(['kill-switch', 'on', '--root', projectRoot]);
  assert.equal(loadBuildroomRoomConfig(projectRoot, ROOM_ID).killSwitchActive, true);
  await runBuildroomCommand(['kill-switch', 'off', '--root', projectRoot]);
  assert.equal(loadBuildroomRoomConfig(projectRoot, ROOM_ID).killSwitchActive, false);

  const config = loadBuildroomRoomConfig(projectRoot, ROOM_ID);
  assert.deepEqual(config.notifications.routes, [TELEGRAM_NOTIFICATION_ROUTE]);

  return {
    initialized: true,
    statusOk: true,
    paused: true,
    resumed: true,
    killSwitchOn: true,
    killSwitchOff: true,
    notificationRoutes: config.notifications.routes.length,
  };
}

async function exerciseBuildroomTools(projectRoot: string): Promise<Record<string, unknown>> {
  const sessionSummaryTool = createBuildroomSessionSummaryTool({
    projectRoot,
    roomId: ROOM_ID,
    sourceAgentId: AGENT_ID,
    sourceSessionId: SOURCE_SESSION_ID,
    now: () => NOW,
  });
  await assertToolOk(sessionSummaryTool.handler({
    user_intent: 'Keep scheduled Buildroom work compatible with Pi runtime rollout.',
    observed_friction: ['scheduled handoff requires source session continuity'],
    candidate_signals: [{
      type: 'runtime_migration',
      text: 'Scheduled Buildroom path needs runtime-neutral tool evidence.',
      confidence: 'high',
    }],
    evidence_excerpt: 'Sanitized scheduled session pointer.',
  }), 'Buildroom session summary tool failed');

  const store = new FileArtifactStore({ projectRoot, roomId: ROOM_ID });
  const summaries = store.listArtifacts('session_summary');
  const summary = summaries[0];
  assert.ok(summary, 'session_summary artifact was not persisted');
  assert.equal(summary.payload.sourceAgentId, AGENT_ID);
  assert.equal(summary.payload.sourceSessionId, SOURCE_SESSION_ID);

  const handoffTool = createBuildroomHandoffTool({
    projectRoot,
    roomId: ROOM_ID,
    sourceAgentId: AGENT_ID,
    sourceSessionId: SOURCE_SESSION_ID,
    now: () => NOW,
  });
  await assertToolOk(handoffTool.handler({
    signal_type: 'runtime_migration',
    summary: 'Pi scheduled Buildroom canary generated a sanitized handoff.',
    evidence_summary_id: summary.id,
    confidence: 'high',
    requested_action: 'create_idea_candidate',
  }), 'Buildroom handoff tool failed');

  const handoffs = store.listArtifacts('handoff_signal');
  const handoff = handoffs[0];
  assert.ok(handoff, 'handoff_signal artifact was not persisted');
  assert.equal(handoff.payload.sourceSessionId, SOURCE_SESSION_ID);
  assert.equal(handoff.parentIds[0], summary.id);
  assert.equal(handoff.payload.requestedAction, 'create_idea_candidate');

  return {
    sessionSummaryArtifacts: summaries.length,
    handoffArtifacts: handoffs.length,
    sourceSessionBound: true,
    summaryId: summary.id,
    handoffId: handoff.id,
  };
}

async function exerciseBuildroomTrustNotification(projectRoot: string): Promise<Record<string, unknown>> {
  const store = new FileArtifactStore({ projectRoot, roomId: ROOM_ID });
  const build = store.writeArtifact(artifact('build_20260516_pi_scheduled_canary', 'coder_receipt', {
    runtimeStatus: 'completed',
    builderClaims: ['Scheduled Buildroom canary produced deterministic evidence.'],
    postRunPolicyResult: {
      allowed: true,
      changedFiles: [],
      violations: [],
    },
  }));
  store.writeArtifact({
    ...artifact('qa_20260516_pi_scheduled_canary', 'qa_report', {
      qaStatus: 'pass',
      evidence: [{
        claim: 'Scheduled Buildroom canary produced deterministic evidence.',
        status: 'confirmed',
      }],
    }),
    parentIds: [build.id],
    inputRefs: [{ kind: 'artifact', ref: build.id }],
  });

  const notifications: Array<{ routes: string[]; text: string }> = [];
  await runBuildroomCommand(
    ['trust', build.id, '--root', projectRoot],
    {
      notify: async (notification) => {
        notifications.push(notification);
      },
    },
  );

  const trusts = store.listArtifacts('trust_report');
  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0]?.routes, [TELEGRAM_NOTIFICATION_ROUTE]);
  assert.match(notifications[0]?.text ?? '', /Buildroom trust: CLEAN/);
  assert.equal(trusts.length, 1);

  return {
    delivered: notifications.length,
    routes: notifications[0]?.routes.length ?? 0,
    trustArtifacts: trusts.length,
    textIncludesSafetyNotice: notifications[0]?.text.includes('Notification only.') === true,
  };
}

function exercisePathPolicyAndLocks(projectRoot: string): {
  pathPolicy: Record<string, unknown>;
  locks: Record<string, unknown>;
} {
  const config = loadBuildroomRoomConfig(projectRoot, ROOM_ID);
  const allowed = evaluatePathPolicy({
    paths: ['docs/Auto-Buildroom/examples/canary.md'],
    allowedPaths: config.paths.allowed,
    blockedPaths: config.paths.blocked,
  });
  const blocked = evaluatePathPolicy({
    paths: ['agents/pi-scheduled-agent/agent.yml'],
    allowedPaths: ['**'],
    blockedPaths: config.paths.blocked,
  });
  const escaped = evaluatePathPolicy({
    paths: ['../.env'],
    allowedPaths: config.paths.allowed,
    blockedPaths: config.paths.blocked,
  });

  assert.equal(normalizeRepoPath('docs/Auto-Buildroom/../guide.md'), 'docs/guide.md');
  assert.equal(allowed.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.violations[0]?.reason, 'blocked_path');
  assert.equal(escaped.allowed, false);
  assert.equal(escaped.violations[0]?.reason, 'path_escape');

  const lock = new FileBuildroomLock({ projectRoot });
  const handle = lock.acquire({
    roomId: ROOM_ID,
    approvalId: 'approval_20260516_pi_scheduled_canary',
    buildPlanId: 'plan_20260516_pi_scheduled_canary',
    owner: 'pi-scheduled-buildroom-canary',
    now: NOW,
  });
  assert.equal(lock.isHeld(handle.idempotencyKey), true);
  assert.throws(
    () => lock.acquire({
      roomId: ROOM_ID,
      approvalId: 'approval_20260516_pi_scheduled_canary',
      buildPlanId: 'plan_20260516_pi_scheduled_canary',
      owner: 'pi-scheduled-buildroom-canary-duplicate',
      now: NOW,
    }),
    BuildroomLockHeldError,
  );
  lock.release(handle);
  assert.equal(lock.isHeld(handle.idempotencyKey), false);

  return {
    pathPolicy: {
      allowed: config.paths.allowed,
      blocked: config.paths.blocked,
      allowedPathAccepted: allowed.allowed,
      blockedPathRejected: blocked.violations.some((violation) => violation.matchedPattern === 'agents/**'),
      escapeRejected: escaped.violations[0]?.reason === 'path_escape',
    },
    locks: {
      root: join(roomRoot(projectRoot, ROOM_ID), 'worktrees'),
      acquired: true,
      duplicateRejected: true,
      released: true,
      idempotencyKey: handle.idempotencyKey,
    },
  };
}

async function runBuildroomCommand(
  argv: string[],
  deps: Parameters<typeof runBuildroomCli>[2] = {},
): Promise<{ code: number; output: string; parsed?: Record<string, unknown> }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runBuildroomCli(argv, {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  }, deps);
  const output = out.join('\n');
  const error = err.join('\n');
  assert.equal(code, 0, `Buildroom command failed (${argv.join(' ')}): ${error || output}`);

  let parsed: Record<string, unknown> | undefined;
  if (output.trim().startsWith('{')) {
    parsed = JSON.parse(output) as Record<string, unknown>;
  }
  return { code, output, parsed };
}

async function assertToolOk(resultPromise: Promise<ToolResult>, message: string): Promise<ToolResult> {
  const result = await resultPromise;
  assert.equal(result.isError, undefined, `${message}: ${result.content.map((part) => part.text).join('\n')}`);
  return result;
}

function artifact(
  id: string,
  type: BuildroomArtifact['type'],
  payload: Record<string, unknown>,
): BuildroomArtifact {
  return {
    id,
    type,
    schemaVersion: 'auto-buildroom/v1',
    status: 'completed',
    createdAt: NOW,
    producer: { role: 'pi_scheduled_buildroom_canary', runId: `run_${id}` },
    room: { id: ROOM_ID },
    parentIds: [],
    inputRefs: [],
    outputRefs: [],
    runtimeRefs: [{
      runtime: 'pi',
      runId: 'pi-scheduled-buildroom-canary',
      sessionId: SOURCE_SESSION_ID,
    }],
    traceId: 'trace_pi_scheduled_buildroom_canary',
    redaction: {
      rawTranscriptsIncluded: false,
      secretsRedacted: true,
      redactedFields: [],
    },
    contentHash: '',
    payload,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiScheduledBuildroomCanaryResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stream.write([
    `Pi scheduled Buildroom canary ${result.status}.`,
    `durationMs: ${result.durationMs}`,
    result.error ? `error: ${result.error}` : undefined,
  ].filter(Boolean).join('\n'));
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
    'Usage: pnpm smoke:pi-scheduled-buildroom -- [--json]',
    '',
    'Runs the deterministic Pi scheduled work and Buildroom runtime-v1 canary.',
    '',
    'Options:',
    '  --timeout-ms <ms>     positive integer timeout for heartbeat retry scheduling',
    '  --keep-workspace      keep temporary smoke workspace for inspection',
    '  --allow-skip          exit 0 if the probe fails',
    '  --json                print structured result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiScheduledBuildroomCanaryCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
