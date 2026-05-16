import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSessionStore } from '../sdk/session-store.js';
import { TranscriptIndex } from '../session/transcript-index.js';
import { SessionSearchService } from '../session/session-search.js';
import { generateSessionTitle } from '../session/title-generator.js';
import { MemoryStore } from '../memory/store.js';
import { LearningStore } from '../learning/store.js';
import { parseLearningReviewOutput, persistLearningReviewResult } from '../learning/reviewer.js';
import { applyMemoryCandidateAction } from '../learning/memory-applier.js';
import { logger } from '../logger.js';

interface PiSessionsMemoryCanaryArgs {
  json: boolean;
  keepWorkspace: boolean;
  help: boolean;
}

interface PiSessionsMemoryCanaryDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiSessionsMemoryCanaryResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  scenario: 'pi.sessions-memory-learning';
  durationMs: number;
  workspacePath?: string;
  assertions: Record<string, unknown>;
  error?: string;
}

const SCENARIO_ID = 'pi.sessions-memory-learning' as const;

export async function runPiSessionsMemoryCanaryCli(
  argv: string[],
  deps: PiSessionsMemoryCanaryDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiSessionsMemoryCanaryArgs;

  try {
    args = parsePiSessionsMemoryCanaryArgs(argv);
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
  let memoryStore: MemoryStore | undefined;
  let learningStore: LearningStore | undefined;

  try {
    workspacePath = await mkdtemp(join(tmpdir(), 'pi-sessions-memory-canary-'));
    await mkdir(join(workspacePath, 'sdk-sessions'), { recursive: true });

    const projectKey = join(workspacePath, 'project');
    const sessionId = 'pi-canary-session-1';
    const sessionKey = 'pi-canary-agent:telegram:dm:peer-1';
    const runId = 'pi-canary-run-1';
    const traceId = 'pi-canary-trace-1';
    const agentId = 'pi-canary-agent';

    const sessionStore = new FileSessionStore(join(workspacePath, 'sdk-sessions'));
    await sessionStore.append({ projectKey, sessionId }, [
      {
        type: 'user',
        uuid: 'user-1',
        timestamp: '2026-05-16T00:00:00.000Z',
        message: {
          content: [{
            type: 'text',
            text: 'Remember that the Pi runtime migration must preserve session recall and learning memory.',
          }],
        },
      },
      {
        type: 'assistant',
        uuid: 'assistant-1',
        timestamp: '2026-05-16T00:00:01.000Z',
        message: {
          content: [{
            type: 'text',
            text: 'The durable note is that Lego-style Pi harness adoption depends on memory provenance.',
          }],
        },
      },
    ]);

    const sessionSearch = new SessionSearchService({
      projectKey,
      sessionStore,
      transcriptIndex: new TranscriptIndex(join(workspacePath, 'transcripts.sqlite')),
      summarizeSession: async (request) => {
        assert(request.sessionId === sessionId, 'session summary received the wrong session id');
        assert(request.transcript.some((entry) => entry.text.includes('Pi runtime migration')), 'session summary missed transcript text');
        return 'Pi runtime migration requires session recall, learning memory, and provenance.';
      },
    });
    const recall = await sessionSearch.searchWithSummaries('Pi runtime migration learning memory', 2, 2);
    assert(recall.length === 1, 'session recall did not return exactly one matching session');
    assert(recall[0]?.sessionId === sessionId, 'session recall returned the wrong session');
    assert(recall[0]?.summary?.includes('learning memory'), 'session recall summary was not attached');

    const title = await generateSessionTitle(
      'Remember that Pi runtime migration must preserve memory.',
      'I will keep session recall and provenance intact.',
      async (prompt) => {
        assert(prompt.includes('Pi runtime migration'), 'title generator prompt lost the session topic');
        return 'Title: Pi Runtime Memory Migration';
      },
    );
    assert(title === 'Pi Runtime Memory Migration', 'session title normalization failed');

    memoryStore = new MemoryStore(join(workspacePath, 'memory.sqlite'));
    learningStore = new LearningStore(join(workspacePath, 'learning.sqlite'));
    const activeLearningStore = learningStore;
    const review = learningStore.createReview({
      id: 'pi-canary-review-1',
      agentId,
      sessionKey,
      runId,
      traceId,
      sdkSessionId: sessionId,
      trigger: 'post_run_canary',
      mode: 'auto_private',
      model: 'pi-canary-scripted',
      input: {
        recallSummary: recall[0]?.summary,
        title,
      },
      metadata: {
        runtime: 'pi',
        scenario: SCENARIO_ID,
      },
    });
    const parsedReview = parseLearningReviewOutput(JSON.stringify({
      actions: [{
        type: 'memory_candidate',
        confidence: 0.93,
        title: 'Runtime migration preference',
        rationale: 'The transcript established a durable migration preference.',
        payload: {
          kind: 'runtime-migration',
          text: 'Prefer Lego-style Pi harness adoption when replacing the Anthropic Agent SDK, while preserving session recall and learning memory provenance.',
          reason: 'Captured during Pi v1 sessions/memory canary.',
        },
      }],
    }));
    const actions = withoutInfoLogs(() => persistLearningReviewResult({
      store: activeLearningStore,
      reviewId: review.id,
      agentId,
      result: parsedReview,
      completedAt: Date.parse('2026-05-16T00:00:02.000Z'),
    }));
    assert(actions.length === 1, 'learning review did not persist one action');

    const applied = applyMemoryCandidateAction({
      memoryStore,
      action: actions[0]!,
      safetyProfile: 'private',
      mode: 'auto_private',
      agentId,
      runId,
      traceId,
      sessionKey,
      sdkSessionId: sessionId,
      channel: 'telegram',
      peerHash: 'peer-hash-1',
      now: () => new Date('2026-05-16T00:00:03.000Z'),
    });
    assert(applied.autoApproved, 'high-confidence private learning memory was not auto-approved');
    assert(applied.entry.provenance.source === 'learning_candidate', 'memory provenance source was not preserved');
    assert(applied.entry.provenance.sdkSessionId === sessionId, 'memory provenance lost sdkSessionId');

    const memoryHits = memoryStore.textSearch('Pi harness adoption', 3);
    assert(memoryHits.length >= 1, 'memory search did not find the applied learning memory');
    assert(memoryHits[0]?.path === applied.entry.path, 'memory search returned an unexpected path');

    const completedReview = learningStore.getReview(review.id);
    assert(completedReview?.status === 'completed', 'learning review was not completed');
    const result: PiSessionsMemoryCanaryResult = {
      status: 'passed',
      runtime: 'pi',
      scenario: SCENARIO_ID,
      durationMs: Date.now() - startedAt,
      ...(args.keepWorkspace ? { workspacePath } : {}),
      assertions: {
        recalledSessions: recall.length,
        title,
        learningActions: actions.length,
        memoryEntryPath: applied.entry.path,
        memoryHits: memoryHits.length,
        reviewStatus: completedReview.status,
      },
    };
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result: PiSessionsMemoryCanaryResult = {
      status: 'failed',
      runtime: 'pi',
      scenario: SCENARIO_ID,
      durationMs: Date.now() - startedAt,
      ...(args.keepWorkspace && workspacePath ? { workspacePath } : {}),
      assertions: {},
      error: err instanceof Error ? err.message : String(err),
    };
    writeResult(stderr, args.json, result);
    return 1;
  } finally {
    learningStore?.close();
    memoryStore?.close();
    if (workspacePath && !args.keepWorkspace) {
      await rm(workspacePath, { recursive: true, force: true });
    }
  }
}

export function parsePiSessionsMemoryCanaryArgs(argv: string[]): PiSessionsMemoryCanaryArgs {
  const args: PiSessionsMemoryCanaryArgs = {
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function withoutInfoLogs<T>(fn: () => T): T {
  const previousLevel = logger.level;
  logger.level = 'silent';
  try {
    return fn();
  } finally {
    logger.level = previousLevel;
  }
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiSessionsMemoryCanaryResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stream.write([
    `Pi sessions/memory canary ${result.status}.`,
    `scenario: ${result.scenario}`,
    `durationMs: ${result.durationMs}`,
    result.error ? `error: ${result.error}` : undefined,
    result.workspacePath ? `workspacePath: ${result.workspacePath}` : undefined,
  ].filter(Boolean).join('\n'));
  stream.write('\n');
}

function usage(): string {
  return [
    'Usage: pnpm smoke:pi-sessions-memory -- [--json] [--keep-workspace]',
    '',
    'Runs the Pi scripted canary for sessions, memory, learning, recall, and title generation.',
    '',
    'Options:',
    '  --keep-workspace  keep the temporary canary workspace for inspection',
    '  --json            print structured result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiSessionsMemoryCanaryCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
