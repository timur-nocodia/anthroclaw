import 'dotenv/config';
import Database from 'better-sqlite3';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Agent } from '../agent/agent.js';
import { DecisionStore } from '../decisions/store.js';
import { LearningStore } from '../learning/store.js';
import { runLearningReview } from '../learning/runner.js';
import type { LearningActionRecord } from '../learning/types.js';
import { DEFAULT_PI_MODEL_ID } from '../runtime/pi-headless.js';

const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';
const AGENT_ID = 'timur_agent';
const CHANNEL_ID = 'telegram';
const ACCOUNT_ID = 'default';
const DEFAULT_PEER_ID = '48705953';
const DEFAULT_SENDER_ID = '48705953';
const RUN_ID = 'timur-agent-learning-propose-smoke-run';
const SESSION_KEY = `${AGENT_ID}:telegram:dm:${DEFAULT_PEER_ID}`;

interface PiTimurAgentLearningProposeSmokeArgs {
  agentsDir: string;
  dataRoot?: string;
  model?: string;
  authPath?: string;
  modelsPath?: string;
  peerId: string;
  senderId: string;
  timeoutMs: number;
  keepData: boolean;
  allowSkip: boolean;
  json: boolean;
  help: boolean;
}

interface PiTimurAgentLearningProposeSmokeDeps {
  makeWorkspace?: () => string;
  preflightPiRuntime?: () => Promise<void>;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface LearningActionSummary {
  id: string;
  type: string;
  status: string;
  confidence?: number;
  title: string;
  appliedAt?: number;
}

interface PiTimurAgentLearningProposeSmokeResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  agentId: string;
  agentsDir: string;
  dataDir: string;
  peerId: string;
  review?: {
    id: string;
    status: string;
    mode: string;
    trigger: string;
    actionCount: number;
  };
  actions: LearningActionSummary[];
  decisions: {
    total: number;
    pending: number;
    approved: number;
    applied: number;
  };
  artifacts: {
    total: number;
    kinds: Record<string, number>;
  };
  memoryWrites: number;
  skillSnapshots: number;
  error?: string;
}

export async function runPiTimurAgentLearningProposeSmokeCli(
  argv: string[],
  deps: PiTimurAgentLearningProposeSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTimurAgentLearningProposeSmokeArgs;

  try {
    args = parsePiTimurAgentLearningProposeSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-timur-agent-learning-propose-'));
  let shouldRemoveWorkspace = !args.keepData;

  try {
    await (deps.preflightPiRuntime ?? ensurePiRuntimeImportable)();
    const result = await withTimeout(runPiTimurAgentLearningProposeSmoke({
      ...args,
      workspace,
    }), args.timeoutMs);
    writeResult(stdout, args.json, result);
    return result.status === 'failed' ? 1 : 0;
  } catch (err) {
    const error = errorMessage(err);
    const status = args.allowSkip && isSkippableSmokeError(error) ? 'skipped' : 'failed';
    const result: PiTimurAgentLearningProposeSmokeResult = {
      status,
      runtime: 'pi',
      agentId: AGENT_ID,
      agentsDir: join(workspace, 'agents'),
      dataDir: args.dataRoot ? resolve(args.dataRoot) : join(workspace, 'data'),
      peerId: args.peerId,
      actions: [],
      decisions: { total: 0, pending: 0, approved: 0, applied: 0 },
      artifacts: { total: 0, kinds: {} },
      memoryWrites: 0,
      skillSnapshots: 0,
      error,
    };
    writeResult(status === 'failed' ? stderr : stdout, args.json, result);
    if (status === 'failed') shouldRemoveWorkspace = false;
    return status === 'skipped' ? 0 : 1;
  } finally {
    if (shouldRemoveWorkspace) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export async function runPiTimurAgentLearningProposeSmoke(input: PiTimurAgentLearningProposeSmokeArgs & {
  workspace: string;
}): Promise<PiTimurAgentLearningProposeSmokeResult> {
  const agentsDir = join(input.workspace, 'agents');
  const dataDir = input.dataRoot ? resolve(input.dataRoot) : join(input.workspace, 'data');
  const sourceAgentDir = join(resolve(input.agentsDir), AGENT_ID);
  const targetAgentDir = join(agentsDir, AGENT_ID);
  cpSync(sourceAgentDir, targetAgentDir, { recursive: true });

  const learningStore = new LearningStore(join(dataDir, 'learning.sqlite'));
  const decisionStore = new DecisionStore(join(dataDir, 'decision-center.sqlite'));
  const agent = await Agent.load(targetAgentDir, dataDir);

  try {
    if (!agent.config.learning.enabled || agent.config.learning.mode !== 'propose') {
      throw new Error(`timur_agent learning must remain enabled in propose mode, got enabled=${agent.config.learning.enabled} mode=${agent.config.learning.mode}.`);
    }

    const result = await runLearningReview({
      job: {
        id: 'timur-agent-learning-propose-smoke-job',
        agentId: AGENT_ID,
        sessionKey: SESSION_KEY,
        runId: RUN_ID,
        traceId: 'timur-agent-learning-propose-smoke-trace',
        sdkSessionId: 'timur-agent-learning-propose-smoke-sdk-session',
        triggers: ['user_correction'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        coalescedCount: 0,
        metadata: {
          userText: [
            'Запомни устойчивое правило для timur_agent:',
            'в финальных инженерных ответах мне нужны короткие итоги, проверки и следующий gate, без длинной мотивационной воды.',
            'Это постоянное предпочтение оператора, а не одноразовая задача.',
          ].join('\n'),
          assistantText: 'Принял. Буду держать финалы короткими: что изменено, чем проверено, какой следующий gate.',
          channel: CHANNEL_ID,
          originChannel: CHANNEL_ID,
          originAccountId: ACCOUNT_ID,
          originPeerId: input.peerId,
          originSenderId: input.senderId,
          originMessageId: 'timur-agent-learning-propose-smoke-message',
          peerHash: 'timur-agent-learning-propose-smoke-peer-hash',
          toolCalls: 0,
          recoveredToolErrors: 0,
          skillOrMemoryActivity: false,
          compressionOrLcmActivity: false,
        },
      },
      agent,
      dataDir,
      store: learningStore,
      decisionStore,
      defaultModel: input.model,
      headlessRuntime: {
        runtime: 'pi',
        runtimeOptions: {
          pi: {
            ...(input.authPath ? { authStoragePath: input.authPath } : {}),
            ...(input.modelsPath ? { modelsPath: input.modelsPath } : {}),
          },
        },
      },
    });

    const reviews = learningStore.listReviews({ agentId: AGENT_ID, runId: RUN_ID });
    const review = reviews[0];
    if (!review) throw new Error('Learning propose smoke did not persist a review.');
    if (review.status !== 'completed') throw new Error(`Learning propose smoke review status is ${review.status}, expected completed.`);
    if (review.mode !== 'propose') throw new Error(`Learning propose smoke review mode is ${review.mode}, expected propose.`);

    const actions = learningStore.listActions({ agentId: AGENT_ID });
    assertProposedActions(actions);

    const decisions = decisionStore.listDecisions({ agentId: AGENT_ID });
    assertDecisionStatuses(decisions);

    const artifacts = learningStore.listArtifacts({ reviewId: review.id });
    if (artifacts.length === 0) throw new Error('Learning propose smoke did not persist learning artifacts.');

    const memoryWrites = countMemoryEntries(join(dataDir, 'memory-db', `${AGENT_ID}.sqlite`));
    const skillSnapshots = learningStore.listSkillSnapshots({ agentId: AGENT_ID }).length;
    if (memoryWrites !== 0) throw new Error(`Learning propose smoke wrote ${memoryWrites} memory entr${memoryWrites === 1 ? 'y' : 'ies'} without approval.`);
    if (skillSnapshots !== 0) throw new Error(`Learning propose smoke created ${skillSnapshots} skill snapshot(s) without approval.`);

    return {
      status: 'passed',
      runtime: 'pi',
      agentId: AGENT_ID,
      agentsDir,
      dataDir,
      peerId: input.peerId,
      review: {
        id: review.id,
        status: review.status,
        mode: review.mode,
        trigger: review.trigger,
        actionCount: actions.length,
      },
      actions: summarizeActions(actions),
      decisions: {
        total: decisions.length,
        pending: decisions.filter((decision) => decision.status === 'pending').length,
        approved: decisions.filter((decision) => decision.status === 'approved').length,
        applied: decisions.filter((decision) => decision.status === 'applied').length,
      },
      artifacts: {
        total: artifacts.length,
        kinds: countBy(artifacts.map((artifact) => artifact.kind)),
      },
      memoryWrites,
      skillSnapshots,
    };
  } finally {
    agent.memoryStore.close();
    learningStore.close();
    decisionStore.close();
  }
}

export function parsePiTimurAgentLearningProposeSmokeArgs(argv: string[]): PiTimurAgentLearningProposeSmokeArgs {
  const args: PiTimurAgentLearningProposeSmokeArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    model: DEFAULT_PI_MODEL_ID,
    peerId: DEFAULT_PEER_ID,
    senderId: DEFAULT_SENDER_ID,
    timeoutMs: 120_000,
    keepData: false,
    allowSkip: false,
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
      case '--data-root':
        args.dataRoot = resolve(requireValue(argv, ++i, '--data-root'));
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
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
        break;
      case '--sender-id':
        args.senderId = requireValue(argv, ++i, '--sender-id');
        break;
      case '--timeout-ms':
        args.timeoutMs = positiveInteger(requireValue(argv, ++i, '--timeout-ms'), '--timeout-ms');
        break;
      case '--keep-data':
        args.keepData = true;
        break;
      case '--allow-skip':
        args.allowSkip = true;
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

function assertProposedActions(actions: LearningActionRecord[]): void {
  if (actions.length === 0) {
    throw new Error('Learning propose smoke persisted no learning actions.');
  }
  const unsafe = actions
    .filter((action) => action.status !== 'proposed' || action.appliedAt !== undefined)
    .map((action) => `${action.id}:${action.actionType}:${action.status}:appliedAt=${action.appliedAt ?? 'null'}`);
  if (unsafe.length > 0) {
    throw new Error(`Learning propose smoke found non-proposed/applied action(s): ${unsafe.join(', ')}`);
  }
}

function assertDecisionStatuses(decisions: Array<{ id: string; status: string }>): void {
  const unsafe = decisions
    .filter((decision) => decision.status !== 'pending')
    .map((decision) => `${decision.id}:${decision.status}`);
  if (unsafe.length > 0) {
    throw new Error(`Learning propose smoke found non-pending decision(s): ${unsafe.join(', ')}`);
  }
}

function summarizeActions(actions: LearningActionRecord[]): LearningActionSummary[] {
  return actions.map((action) => ({
    id: action.id,
    type: action.actionType,
    status: action.status,
    confidence: action.confidence,
    title: action.title,
    appliedAt: action.appliedAt,
  }));
}

function countMemoryEntries(memoryDbPath: string): number {
  const db = new Database(memoryDbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM memory_entries').get() as { count: number };
    return row.count;
  } finally {
    db.close();
  }
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

async function ensurePiRuntimeImportable(): Promise<void> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
  try {
    await dynamicImport(PI_PACKAGE_NAME);
  } catch (err) {
    throw new Error(`Pi timur_agent learning propose smoke requires optional package ${PI_PACKAGE_NAME}. Original error: ${errorMessage(err)}`);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Pi timur_agent learning propose smoke timeout after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTimurAgentLearningProposeSmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi timur_agent learning propose smoke passed.',
      `review: ${result.review?.id ?? '<none>'}`,
      `actions: ${JSON.stringify(result.actions)}`,
      `decisions: ${JSON.stringify(result.decisions)}`,
      `memoryWrites: ${result.memoryWrites}`,
      `skillSnapshots: ${result.skillSnapshots}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi timur_agent learning propose smoke ${result.status}: ${result.error ?? 'unknown error'}\n`);
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function isSkippableSmokeError(error: string): boolean {
  return error.includes(PI_PACKAGE_NAME)
    || error.includes('Provider') && error.includes('credentials')
    || error.includes('auth');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-timur-agent-learning-propose-smoke -- [--json] [--allow-skip]',
    '',
    'Options:',
    '  --agents-dir <path>   source agents directory containing timur_agent (default: agents)',
    '  --data-root <path>    data root for the temp copied agent (default: temp workspace data)',
    '  --model <id>          Pi model id (default: runtime default)',
    '  --auth-path <path>    Pi auth storage path',
    '  --models-path <path>  Pi model registry storage path',
    '  --peer-id <id>        fake Telegram peer id (default: operator peer)',
    '  --sender-id <id>      fake Telegram sender id (default: operator peer)',
    '  --timeout-ms <n>      review timeout in ms (default: 120000)',
    '  --keep-data           keep temp workspace for inspection',
    '  --allow-skip          return success when optional Pi setup is unavailable',
    '  --json                emit JSON',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentLearningProposeSmokeCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
