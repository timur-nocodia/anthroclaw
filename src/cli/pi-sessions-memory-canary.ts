import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChannelAdapter, InboundMessage, SendOptions, OutboundMedia } from '../channels/types.js';
import { GlobalConfigSchema } from '../config/schema.js';
import { Gateway } from '../gateway.js';
import { FileSessionStore } from '../sdk/session-store.js';
import { TranscriptIndex } from '../session/transcript-index.js';
import { SessionSearchService } from '../session/session-search.js';
import { generateSessionTitle } from '../session/title-generator.js';
import { MemoryStore } from '../memory/store.js';
import { LearningStore } from '../learning/store.js';
import { parseLearningReviewOutput, persistLearningReviewResult } from '../learning/reviewer.js';
import { applyMemoryCandidateAction } from '../learning/memory-applier.js';
import { logger } from '../logger.js';
import { DEFAULT_PI_MODEL_ID } from '../runtime/pi-headless.js';

interface PiSessionsMemoryCanaryArgs {
  json: boolean;
  keepWorkspace: boolean;
  gateway: boolean;
  allowSkip: boolean;
  model?: string;
  authPath?: string;
  modelsPath?: string;
  timeoutMs: number;
  help: boolean;
}

interface PiSessionsMemoryCanaryDeps {
  GatewayCtor?: new () => Gateway;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiSessionsMemoryCanaryResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  scenario: 'pi.sessions-memory-learning';
  durationMs: number;
  workspacePath?: string;
  assertions: Record<string, unknown>;
  error?: string;
}

const SCENARIO_ID = 'pi.sessions-memory-learning' as const;
const GATEWAY_AGENT_ID = 'pi-session-canary';
const GATEWAY_CHANNEL_ID = 'telegram';
const GATEWAY_ACCOUNT_ID = 'default';
const GATEWAY_PEER_ID = 'pi-session-canary-peer';
const GATEWAY_SENDER_ID = 'pi-session-canary-sender';

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
    const gatewayWorkspacePath = workspacePath;
    assert(gatewayWorkspacePath, 'canary workspace was not initialized');
    const gatewayAssertions = args.gateway
      ? await withoutInfoLogsAsync(() => runGatewaySessionCanary({
        GatewayCtor: deps.GatewayCtor,
        workspacePath: gatewayWorkspacePath,
        model: args.model,
        authPath: args.authPath,
        modelsPath: args.modelsPath,
        timeoutMs: args.timeoutMs,
      }))
      : undefined;
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
        ...(gatewayAssertions ? { gateway: gatewayAssertions } : {}),
      },
    };
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const status = args.gateway && args.allowSkip && isSkippableGatewayError(error) ? 'skipped' : 'failed';
    const result: PiSessionsMemoryCanaryResult = {
      status,
      runtime: 'pi',
      scenario: SCENARIO_ID,
      durationMs: Date.now() - startedAt,
      ...(args.keepWorkspace && workspacePath ? { workspacePath } : {}),
      assertions: {},
      error,
    };
    writeResult(status === 'failed' ? stderr : stdout, args.json, result);
    return status === 'skipped' ? 0 : 1;
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
    gateway: false,
    allowSkip: false,
    timeoutMs: 120_000,
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
      case '--gateway':
        args.gateway = true;
        break;
      case '--allow-skip':
        args.allowSkip = true;
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
      case '--timeout-ms':
        args.timeoutMs = parsePositiveInt(requireValue(argv, ++i, '--timeout-ms'), '--timeout-ms');
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function runGatewaySessionCanary(input: {
  GatewayCtor?: new () => Gateway;
  workspacePath: string;
  model?: string;
  authPath?: string;
  modelsPath?: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const gatewayRoot = join(input.workspacePath, 'gateway');
  const agentsDir = join(gatewayRoot, 'agents');
  const dataDir = join(gatewayRoot, 'data');
  const pluginsDir = join(gatewayRoot, 'plugins');
  const agentDir = join(agentsDir, GATEWAY_AGENT_ID);
  await mkdir(agentDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(pluginsDir, { recursive: true });
  await writeFile(join(agentDir, 'agent.yml'), gatewayAgentYml(input.model), 'utf8');

  const GatewayCtor = input.GatewayCtor ?? Gateway;
  const gateway = new GatewayCtor();
  const sentText: string[] = [];
  try {
    await gateway.start(gatewayConfig({
      authPath: input.authPath,
      modelsPath: input.modelsPath,
    }), agentsDir, dataDir, pluginsDir);
    gateway._setChannel(GATEWAY_CHANNEL_ID, createGatewayCanaryChannel(sentText));

    const agent = gateway.getAgent(GATEWAY_AGENT_ID);
    assert(agent, 'Gateway canary agent was not loaded');
    agent.memoryStore.indexFile(
      'memory/canary/pi-gateway-session.md',
      'Lego Pi harness provenance should be visible to Gateway memory prefetch and influence tracking.',
      {
        source: 'index',
        agentId: GATEWAY_AGENT_ID,
      },
    );

    await withTimeout(gateway.dispatch(gatewayMessage(
      'gateway-session-canary-1',
      'Reply with exactly: Lego Pi harness provenance.',
    )), input.timeoutMs);
    await waitForSettledPrefetch();

    const firstSessions = await gateway.listAgentSessions(GATEWAY_AGENT_ID);
    const sessionId = firstSessions.find((session) =>
      session.provenance?.source === 'channel' && session.provenance?.status === 'succeeded',
    )?.sessionId ?? firstSessions[0]?.sessionId;
    assert(sessionId, 'Gateway did not expose a session after the first Pi turn');

    await withTimeout(gateway.dispatch(gatewayMessage(
      'gateway-session-canary-2',
      'Continue the Lego Pi harness provenance session and reply with exactly: session continuity confirmed.',
    )), input.timeoutMs);

    const sessions = await gateway.listAgentSessions(GATEWAY_AGENT_ID);
    const session = sessions.find((candidate) => candidate.sessionId === sessionId);
    assert(session, 'Gateway did not preserve the Pi session id across turns');
    assert(session.activeKeys.includes(`${GATEWAY_AGENT_ID}:telegram:dm:${GATEWAY_PEER_ID}`), 'Gateway session active key was not preserved');
    assert(session.messageCount >= 2, 'Gateway session message count did not include both turns');

    const details = await gateway.getAgentSessionDetails(GATEWAY_AGENT_ID, sessionId);
    assert(details.messageCount >= 2, 'Gateway session details did not include both turns');

    const runs = gateway.listAgentRuns({
      agentId: GATEWAY_AGENT_ID,
      sdkSessionId: sessionId,
      status: 'succeeded',
      limit: 10,
    });
    assert(runs.length >= 2, 'Gateway did not record two successful Pi runs for the same session');

    const decisions = gateway.listRouteDecisions({
      agentId: GATEWAY_AGENT_ID,
      sessionKey: `${GATEWAY_AGENT_ID}:telegram:dm:${GATEWAY_PEER_ID}`,
      limit: 10,
    });
    assert(decisions.length >= 2, 'Gateway did not record route decisions for both turns');

    const influenceEvents = gateway.listMemoryInfluenceEvents({
      agentId: GATEWAY_AGENT_ID,
      sdkSessionId: sessionId,
      source: 'prefetch',
      limit: 10,
    });
    assert(influenceEvents.length >= 1, 'Gateway did not record memory prefetch influence for the continued Pi session');

    return {
      sessionId,
      sentText: sentText.length,
      sessions: sessions.length,
      detailsMessageCount: details.messageCount,
      runs: runs.length,
      routeDecisions: decisions.length,
      memoryInfluenceEvents: influenceEvents.length,
      provenanceStatus: session.provenance?.status,
    };
  } finally {
    await gateway.stop().catch(() => undefined);
  }
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

async function withoutInfoLogsAsync<T>(fn: () => Promise<T>): Promise<T> {
  const previousLevel = logger.level;
  logger.level = 'silent';
  try {
    return await fn();
  } finally {
    logger.level = previousLevel;
  }
}

function gatewayConfig(input: { authPath?: string; modelsPath?: string }) {
  return GlobalConfigSchema.parse({
    defaults: {
      model: DEFAULT_PI_MODEL_ID,
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
      debounce_ms: 0,
    },
    runtime: {
      headless: {
        provider: 'pi',
        pi: {
          ...(input.authPath ? { auth_path: input.authPath } : {}),
          ...(input.modelsPath ? { models_path: input.modelsPath } : {}),
        },
      },
    },
  });
}

function gatewayAgentYml(model?: string): string {
  return [
    'safety_profile: trusted',
    ...(model ? [`model: ${JSON.stringify(model)}`] : []),
    'routes:',
    '  - channel: telegram',
    '    scope: dm',
    'pairing:',
    '  mode: open',
    'display:',
    '  toolProgress: off',
    '',
  ].join('\n');
}

function gatewayMessage(messageId: string, text: string): InboundMessage {
  return {
    channel: GATEWAY_CHANNEL_ID,
    accountId: GATEWAY_ACCOUNT_ID,
    chatType: 'dm',
    peerId: GATEWAY_PEER_ID,
    senderId: GATEWAY_SENDER_ID,
    senderName: 'Pi Gateway Session Canary',
    text,
    messageId,
    mentionedBot: true,
    raw: {},
  };
}

function createGatewayCanaryChannel(sentText: string[]): ChannelAdapter {
  return {
    id: GATEWAY_CHANNEL_ID,
    supportsApproval: false,
    onMessage() {},
    async start() {},
    async stop() {},
    async sendText(_peerId: string, text: string, _opts?: SendOptions) {
      sentText.push(text);
      return `pi-session-canary-outbound-${sentText.length}`;
    },
    async editText() {},
    async deleteText() {},
    async sendMedia(_peerId: string, _media: OutboundMedia, _opts?: SendOptions) {
      return 'pi-session-canary-media-1';
    },
    async sendTyping() {},
    async promptForApproval() {},
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Pi sessions/memory Gateway canary timeout after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForSettledPrefetch(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

function isSkippableGatewayError(message: string): boolean {
  return /@earendil-works\/pi-coding-agent|optional package|api key|auth|oauth|credential|model registry/i
    .test(message);
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
    'Usage: pnpm smoke:pi-sessions-memory -- [--json] [--gateway] [--keep-workspace]',
    '',
    'Runs the Pi scripted canary for sessions, memory, learning, recall, and title generation.',
    '',
    'Options:',
    '  --gateway          also run two-turn Gateway Pi session continuity checks',
    `  --model <model>     model override for the Gateway canary (default: ${DEFAULT_PI_MODEL_ID})`,
    '  --auth-path <path>  optional Pi auth.json path for the Gateway canary',
    '  --models-path <path> optional Pi models.json path for the Gateway canary',
    '  --timeout-ms <ms>   positive integer dispatch timeout for the Gateway canary',
    '  --allow-skip        exit 0 when Gateway Pi runtime/auth setup is unavailable',
    '  --keep-workspace    keep the temporary canary workspace for inspection',
    '  --json              print structured result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiSessionsMemoryCanaryCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
