import 'dotenv/config';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk';
import type { Agent } from '../agent/agent.js';
import type { ChannelAdapter, InboundMessage } from '../channels/types.js';
import type { GlobalConfig } from '../config/schema.js';
import { Gateway } from '../gateway.js';
import { metrics } from '../metrics/collector.js';
import { DEFAULT_PI_MODEL_ID, PiHeadlessRuntime } from '../runtime/pi-headless.js';
import { redactSecrets } from '../security/redact.js';
import type { HeadlessReviewRuntimeConfig } from '../sdk/headless-runtime-config.js';
import { FileSessionStore } from '../sdk/session-store.js';

interface PiRollbackMixedRuntimeCanaryArgs {
  json: boolean;
  keepWorkspace: boolean;
  allowSkip: boolean;
  model: string;
  authPath?: string;
  modelsPath?: string;
  timeoutMs: number;
  help: boolean;
}

interface PiRollbackMixedRuntimeCanaryDeps {
  GatewayCtor?: new () => Gateway;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiRollbackMixedRuntimeCanaryResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  scenario: 'pi.rollback-mixed-runtime';
  durationMs: number;
  workspacePath?: string;
  assertions: Record<string, unknown>;
  error?: string;
}

type RuntimeProbeGateway = {
  getHeadlessReviewRuntimeOptions(agent?: Agent): HeadlessReviewRuntimeConfig;
  shouldUsePiGatewayRuntime(agent: Agent): boolean;
};

type RuntimeSelection = {
  runtime: 'claude-agent-sdk' | 'pi';
  usesPi: boolean;
  authStoragePath?: string;
  modelsPath?: string;
};

const SCENARIO_ID = 'pi.rollback-mixed-runtime' as const;
const PI_OPT_IN_AGENT_ID = 'pi-opt-in-agent';
const CLAUDE_OPT_OUT_AGENT_ID = 'claude-opt-out-agent';
const DEFAULT_AGENT_ID = 'default-agent';
const ROLLBACK_AGENT_ID = 'rollback-agent';
const BAD_PI_AGENT_ID = 'bad-pi-agent';
const SESSION_ID = 'pi-rollback-session-1';
const SESSION_KEY = `${ROLLBACK_AGENT_ID}:telegram:dm:rollback-peer`;
const ROUTE_DECISION_ID = 'pi-rollback-route-1';
const RUN_ID = 'pi-rollback-run-1';

export async function runPiRollbackMixedRuntimeCanaryCli(
  argv: string[],
  deps: PiRollbackMixedRuntimeCanaryDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiRollbackMixedRuntimeCanaryArgs;

  try {
    args = parsePiRollbackMixedRuntimeCanaryArgs(argv);
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
    workspacePath = await mkdtemp(join(tmpdir(), 'pi-rollback-mixed-runtime-canary-'));
    const assertions = await runRollbackMixedRuntimeCanary({
      GatewayCtor: deps.GatewayCtor ?? Gateway,
      workspacePath,
      model: args.model,
      authPath: args.authPath,
      modelsPath: args.modelsPath,
      timeoutMs: args.timeoutMs,
    });
    const result: PiRollbackMixedRuntimeCanaryResult = {
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
    const result: PiRollbackMixedRuntimeCanaryResult = {
      status: 'failed',
      runtime: 'pi',
      scenario: SCENARIO_ID,
      durationMs: Date.now() - startedAt,
      ...(args.keepWorkspace && workspacePath ? { workspacePath } : {}),
      assertions: {},
      error: redactSecrets(err instanceof Error ? err.message : String(err)),
    };
    writeResult(stderr, args.json, result);
    return args.allowSkip && isOptionalPiSetupError(result.error) ? 0 : 1;
  } finally {
    metrics.setStore(null);
    if (workspacePath && !args.keepWorkspace) {
      await rm(workspacePath, { recursive: true, force: true });
    }
  }
}

export function parsePiRollbackMixedRuntimeCanaryArgs(argv: string[]): PiRollbackMixedRuntimeCanaryArgs {
  const args: PiRollbackMixedRuntimeCanaryArgs = {
    json: false,
    keepWorkspace: false,
    allowSkip: false,
    model: DEFAULT_PI_MODEL_ID,
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

async function runRollbackMixedRuntimeCanary(input: {
  GatewayCtor: new () => Gateway;
  workspacePath: string;
  model: string;
  authPath?: string;
  modelsPath?: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const agentsDir = join(input.workspacePath, 'agents');
  const dataDir = join(input.workspacePath, 'data');
  const pluginsDir = join(input.workspacePath, 'plugins');
  await mkdir(agentsDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(pluginsDir, { recursive: true });

  await Promise.all([
    writeAgentConfig(agentsDir, DEFAULT_AGENT_ID),
    writeAgentConfig(agentsDir, PI_OPT_IN_AGENT_ID, { provider: 'pi' }),
    writeAgentConfig(agentsDir, CLAUDE_OPT_OUT_AGENT_ID, { provider: 'claude-agent-sdk' }),
    writeAgentConfig(agentsDir, ROLLBACK_AGENT_ID, { provider: 'pi' }),
    writeAgentConfig(agentsDir, BAD_PI_AGENT_ID, {
      provider: 'pi',
      pi: {
        auth_path: join(input.workspacePath, 'bad-pi-gateway-auth.json'),
        models_path: join(input.workspacePath, 'bad-pi-gateway-models.json'),
      },
    }),
  ]);

  const globalClaudeGateway = await startGateway(input.GatewayCtor, globalConfig('claude-agent-sdk'), agentsDir, dataDir, pluginsDir);
  let perAgentPiSelection: RuntimeSelection;
  let gatewayBadPiFailure: Record<string, unknown>;
  try {
    perAgentPiSelection = inspectAgentRuntime(globalClaudeGateway, PI_OPT_IN_AGENT_ID);
    assert.equal(perAgentPiSelection.runtime, 'pi', 'per-agent Pi opt-in did not override the Claude global default');
    assert.equal(perAgentPiSelection.usesPi, true, 'per-agent Pi opt-in was not selected by Gateway');
    gatewayBadPiFailure = await runGatewayBadPiFailureCheck(globalClaudeGateway);
  } finally {
    await globalClaudeGateway.stop();
    metrics.setStore(null);
  }

  const globalPiAuthPath = input.authPath ?? join(input.workspacePath, 'pi-auth.json');
  const globalPiModelsPath = input.modelsPath ?? join(input.workspacePath, 'pi-models.json');
  const globalPiGateway = await startGateway(
    input.GatewayCtor,
    globalConfig('pi', {
      auth_path: globalPiAuthPath,
      models_path: globalPiModelsPath,
    }),
    agentsDir,
    dataDir,
    pluginsDir,
  );
  let defaultPiSelection: RuntimeSelection;
  let claudeOptOutSelection: RuntimeSelection;
  let rollbackPiSelection: RuntimeSelection;
  try {
    defaultPiSelection = inspectAgentRuntime(globalPiGateway, DEFAULT_AGENT_ID);
    claudeOptOutSelection = inspectAgentRuntime(globalPiGateway, CLAUDE_OPT_OUT_AGENT_ID);
    rollbackPiSelection = inspectAgentRuntime(globalPiGateway, ROLLBACK_AGENT_ID);
    assert.equal(defaultPiSelection.runtime, 'pi', 'global Pi default was not selected for an unpinned agent');
    assert.equal(defaultPiSelection.authStoragePath, globalPiAuthPath, 'global Pi auth path was not applied');
    assert.equal(defaultPiSelection.modelsPath, globalPiModelsPath, 'global Pi models path was not applied');
    assert.equal(claudeOptOutSelection.runtime, 'claude-agent-sdk', 'per-agent Claude opt-out did not override global Pi');
    assert.equal(claudeOptOutSelection.usesPi, false, 'per-agent Claude opt-out still selected Pi');
    assert.equal(rollbackPiSelection.runtime, 'pi', 'rollback candidate did not start on Pi');

    await seedRollbackSession(globalPiGateway, dataDir);
    const sessionsBeforeRollback = await globalPiGateway.listAgentSessions(ROLLBACK_AGENT_ID);
    assert(
      sessionsBeforeRollback.some((session) => session.sessionId === SESSION_ID),
      'rollback candidate Pi session was not visible before rollback',
    );
  } finally {
    await globalPiGateway.stop();
    metrics.setStore(null);
  }

  await writeAgentConfig(agentsDir, ROLLBACK_AGENT_ID, { provider: 'claude-agent-sdk' });

  const rollbackGateway = await startGateway(
    input.GatewayCtor,
    globalConfig('pi', {
      auth_path: globalPiAuthPath,
      models_path: globalPiModelsPath,
    }),
    agentsDir,
    dataDir,
    pluginsDir,
  );
  let rollbackClaudeSelection: RuntimeSelection;
  let sessionRows = 0;
  let detailMessageCount = 0;
  let runRows = 0;
  let routeRows = 0;
  try {
    rollbackClaudeSelection = inspectAgentRuntime(rollbackGateway, ROLLBACK_AGENT_ID);
    assert.equal(rollbackClaudeSelection.runtime, 'claude-agent-sdk', 'rollback agent did not switch back to Claude');
    assert.equal(rollbackClaudeSelection.usesPi, false, 'rollback agent still selected Pi after rollback');

    const sessions = await rollbackGateway.listAgentSessions(ROLLBACK_AGENT_ID);
    const session = sessions.find((candidate) => candidate.sessionId === SESSION_ID);
    assert(session, 'rolled-back agent lost product session visibility');
    assert(session.activeKeys.includes(SESSION_KEY), 'rolled-back agent lost active session key visibility');
    sessionRows = sessions.length;

    const details = await rollbackGateway.getAgentSessionDetails(ROLLBACK_AGENT_ID, SESSION_ID);
    assert(details.messageCount >= 2, 'rolled-back session message count was not inspectable');
    detailMessageCount = details.messageCount;

    const runs = rollbackGateway.listAgentRuns({
      agentId: ROLLBACK_AGENT_ID,
      sdkSessionId: SESSION_ID,
      status: 'succeeded',
      limit: 10,
    });
    assert(runs.some((run) => run.runId === RUN_ID), 'rolled-back agent lost run visibility');
    runRows = runs.length;

    const decisions = rollbackGateway.listRouteDecisions({
      agentId: ROLLBACK_AGENT_ID,
      sessionKey: SESSION_KEY,
      limit: 10,
    });
    assert(decisions.some((decision) => decision.id === ROUTE_DECISION_ID), 'rolled-back agent lost route decision visibility');
    routeRows = decisions.length;
  } finally {
    await rollbackGateway.stop();
    metrics.setStore(null);
  }

  const badAuthError = await captureBadPiAuthError({
    model: input.model,
    authPath: join(input.workspacePath, 'bad-pi-auth.json'),
    modelsPath: join(input.workspacePath, 'bad-pi-models.json'),
    timeoutMs: input.timeoutMs,
  });
  assert.match(badAuthError, /bad Pi auth canary/i, 'bad Pi auth did not fail loudly');

  return {
    perAgentPiOptIn: perAgentPiSelection,
    globalPiDefault: defaultPiSelection,
    perAgentClaudeOptOut: claudeOptOutSelection,
    rollbackStartedOnPi: rollbackPiSelection.usesPi,
    rollbackToClaude: rollbackClaudeSelection,
    gatewayBadPiFailure,
    badPiAuthFailedLoudly: true,
    sessionVisibilityPreserved: true,
    sessionRows,
    detailMessageCount,
    runRows,
    routeRows,
  };
}

async function startGateway(
  GatewayCtor: new () => Gateway,
  config: GlobalConfig,
  agentsDir: string,
  dataDir: string,
  pluginsDir: string,
): Promise<Gateway> {
  const gateway = new GatewayCtor();
  try {
    await gateway.start(config, agentsDir, dataDir, pluginsDir);
  } catch (err) {
    await gateway.stop().catch(() => undefined);
    throw err;
  }
  return gateway;
}

async function runGatewayBadPiFailureCheck(gateway: Gateway): Promise<Record<string, unknown>> {
  const sentText: string[] = [];
  gateway._setChannel('telegram', createCanaryChannel(sentText));

  await gateway.dispatch({
    channel: 'telegram',
    accountId: 'canary-account',
    chatType: 'dm',
    peerId: `${BAD_PI_AGENT_ID}-peer`,
    senderId: 'bad-pi-user',
    senderName: 'Bad Pi Canary',
    text: 'Exercise explicit Pi bad auth without Claude fallback.',
    messageId: 'bad-pi-message-1',
    mentionedBot: false,
    raw: {},
  } satisfies InboundMessage);

  const failedRuns = gateway.listAgentRuns({
    agentId: BAD_PI_AGENT_ID,
    status: 'failed',
    limit: 10,
  });
  const succeededRuns = gateway.listAgentRuns({
    agentId: BAD_PI_AGENT_ID,
    status: 'succeeded',
    limit: 10,
  });
  assert.equal(failedRuns.length, 1, 'Gateway did not record an explicit Pi bad-auth failure');
  assert.equal(succeededRuns.length, 0, 'Gateway recorded a succeeded run for explicit Pi bad-auth failure');
  assert.match(failedRuns[0]?.error ?? '', /Pi|pi|auth|optional package/i, 'Gateway bad-auth failure did not retain Pi/runtime error context');

  return {
    failedRuns: failedRuns.length,
    succeededRuns: succeededRuns.length,
    errorContextRecorded: true,
    userFallbackMessages: sentText.length,
  };
}

function createCanaryChannel(sentText: string[]): ChannelAdapter {
  return {
    id: 'telegram',
    supportsApproval: false,
    onMessage() {},
    async start() {},
    async stop() {},
    async sendText(_peerId, text) {
      sentText.push(text);
      return `msg-${sentText.length}`;
    },
    async editText() {},
    async deleteText() {},
    async sendMedia() {
      return 'media-1';
    },
    async sendTyping() {},
    async promptForApproval() {},
  };
}

function inspectAgentRuntime(gateway: Gateway, agentId: string): RuntimeSelection {
  const agent = gateway.getAgent(agentId);
  assert(agent, `Agent ${agentId} was not loaded`);
  const probe = gateway as unknown as RuntimeProbeGateway;
  const options = probe.getHeadlessReviewRuntimeOptions(agent);
  const runtime = options.runtime === 'pi' ? 'pi' : 'claude-agent-sdk';
  return {
    runtime,
    usesPi: probe.shouldUsePiGatewayRuntime(agent),
    ...(options.runtimeOptions?.pi?.authStoragePath ? { authStoragePath: options.runtimeOptions.pi.authStoragePath } : {}),
    ...(options.runtimeOptions?.pi?.modelsPath ? { modelsPath: options.runtimeOptions.pi.modelsPath } : {}),
  };
}

async function seedRollbackSession(gateway: Gateway, dataDir: string): Promise<void> {
  const agent = gateway.getAgent(ROLLBACK_AGENT_ID);
  assert(agent, 'Rollback canary agent was not loaded');
  agent.setSessionId(SESSION_KEY, SESSION_ID);
  agent.incrementMessageCount(SESSION_KEY);
  agent.incrementMessageCount(SESSION_KEY);

  const sessionStore = new FileSessionStore(join(dataDir, 'sdk-sessions'));
  await sessionStore.append({ projectKey: agent.workspacePath, sessionId: SESSION_ID }, [
    sessionEntry('user', 'pi-rollback-user-1', 'Pi rollback session should remain visible after runtime rollback.'),
    sessionEntry('assistant', 'pi-rollback-assistant-1', 'Pi rollback session visibility is preserved.'),
  ]);

  metrics.recordRouteDecision({
    id: ROUTE_DECISION_ID,
    channel: 'telegram',
    accountId: 'canary-account',
    chatType: 'dm',
    peerId: 'rollback-peer',
    senderId: 'rollback-user',
    candidates: [{
      agentId: ROLLBACK_AGENT_ID,
      channel: 'telegram',
      accountId: 'canary-account',
      scope: 'dm',
      mentionOnly: false,
      priority: 0,
    }],
    winnerAgentId: ROLLBACK_AGENT_ID,
    accessAllowed: true,
    sessionKey: SESSION_KEY,
    outcome: 'delivered',
  });
  metrics.recordAgentRunStart({
    runId: RUN_ID,
    traceId: RUN_ID,
    agentId: ROLLBACK_AGENT_ID,
    sessionKey: SESSION_KEY,
    sdkSessionId: SESSION_ID,
    source: 'channel',
    channel: 'telegram',
    accountId: 'canary-account',
    peerId: 'rollback-peer',
    messageId: 'pi-rollback-message-1',
    routeDecisionId: ROUTE_DECISION_ID,
    status: 'running',
    model: DEFAULT_PI_MODEL_ID,
  });
  metrics.recordAgentRunFinish({
    runId: RUN_ID,
    status: 'succeeded',
    sdkSessionId: SESSION_ID,
    usage: {
      inputTokens: 12,
      outputTokens: 8,
      durationMs: 1,
    },
  });
}

function sessionEntry(type: 'user' | 'assistant', uuid: string, text: string): SessionStoreEntry {
  return {
    type,
    uuid,
    session_id: SESSION_ID,
    timestamp: '2026-05-16T00:00:00.000Z',
    message: {
      role: type,
      content: [{ type: 'text', text }],
    },
  } as SessionStoreEntry;
}

async function captureBadPiAuthError(input: {
  model: string;
  authPath: string;
  modelsPath: string;
  timeoutMs: number;
}): Promise<string> {
  const runtime = new PiHeadlessRuntime({
    authStoragePath: input.authPath,
    modelsPath: input.modelsPath,
    importPiCodingAgent: async () => ({
      createAgentSession: async () => {
        throw new Error('createAgentSession should not run when bad auth fails model setup.');
      },
      AuthStorage: {
        create: () => {
          throw new Error('bad Pi auth canary: auth storage rejected credentials');
        },
      },
      ModelRegistry: {
        create: () => ({
          find: () => undefined,
        }),
      },
    }),
  });

  try {
    await runtime.runText({
      prompt: 'This call should fail during Pi auth setup.',
      model: input.model,
      timeoutMs: input.timeoutMs,
      purpose: 'pi rollback bad-auth canary',
    });
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error('bad Pi auth canary unexpectedly succeeded');
}

async function writeAgentConfig(
  agentsDir: string,
  agentId: string,
  runtime?: {
    provider: 'claude-agent-sdk' | 'pi';
    pi?: { auth_path?: string; models_path?: string };
  },
): Promise<void> {
  const agentDir = join(agentsDir, agentId);
  await mkdir(agentDir, { recursive: true });
  const runtimeBlock = runtime
    ? [
      'runtime:',
      '  headless:',
      `    provider: ${runtime.provider}`,
      ...(runtime.pi ? [
        '    pi:',
        ...(runtime.pi.auth_path ? [`      auth_path: ${runtime.pi.auth_path}`] : []),
        ...(runtime.pi.models_path ? [`      models_path: ${runtime.pi.models_path}`] : []),
      ] : []),
    ].join('\n')
    : '';
  const body = [
    runtimeBlock,
    'safety_profile: trusted',
    'routes:',
    '  - channel: telegram',
    '    scope: dm',
    '    peers:',
    `      - ${agentId === ROLLBACK_AGENT_ID ? 'rollback-peer' : `${agentId}-peer`}`,
    'pairing:',
    '  mode: open',
    '',
  ].filter(Boolean).join('\n');
  await writeFile(join(agentDir, 'agent.yml'), body, 'utf-8');
}

function globalConfig(
  provider: 'claude-agent-sdk' | 'pi',
  pi?: { auth_path?: string; models_path?: string },
): GlobalConfig {
  return {
    defaults: {
      model: 'claude-sonnet-4-6',
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
      debounce_ms: 0,
    },
    features: {
      sdk_active_input: false,
    },
    runtime: {
      headless: {
        provider,
        ...(pi ? { pi } : {}),
      },
    },
  };
}

function isOptionalPiSetupError(error?: string): boolean {
  if (!error) return false;
  return /optional package|cannot find package|missing pi/i.test(error);
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiRollbackMixedRuntimeCanaryResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }
  stream.write([
    `Pi rollback mixed-runtime canary ${result.status}.`,
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
    'Usage: pnpm smoke:pi-rollback-runtime -- [--json] [--keep-workspace]',
    '',
    'Runs the deterministic Pi rollback and mixed-runtime canary.',
    '',
    'Options:',
    `  --model <model>       model used for the bad-auth Pi probe (default: ${DEFAULT_PI_MODEL_ID})`,
    '  --auth-path <path>    optional global Pi auth path used by runtime-selection checks',
    '  --models-path <path>  optional global Pi models path used by runtime-selection checks',
    '  --timeout-ms <ms>     positive integer timeout for the bad-auth probe',
    '  --keep-workspace      keep temporary canary workspace for inspection',
    '  --allow-skip          exit 0 for optional Pi setup failures',
    '  --json                print structured result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiRollbackMixedRuntimeCanaryCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
