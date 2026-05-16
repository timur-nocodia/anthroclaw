import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent } from '../agent/agent.js';
import { DecisionStore } from '../decisions/store.js';
import { Gateway } from '../gateway.js';
import { LearningStore } from '../learning/store.js';
import { metrics } from '../metrics/collector.js';
import { MetricsStore } from '../metrics/store.js';
import type { SdkSessionMessageView } from '../sdk/sessions.js';
import { redactSecrets } from '../security/redact.js';

interface PiDashboardOperatorCanaryArgs {
  json: boolean;
  keepWorkspace: boolean;
  allowSkip: boolean;
  model: string;
  authPath?: string;
  modelsPath?: string;
  timeoutMs: number;
  help: boolean;
}

interface PiDashboardOperatorCanaryDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiDashboardOperatorCanaryResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  scenario: 'pi.dashboard-operator';
  durationMs: number;
  workspacePath?: string;
  assertions: Record<string, unknown>;
  error?: string;
}

const SCENARIO_ID = 'pi.dashboard-operator' as const;
const AGENT_ID = 'pi-dashboard-agent';
const SESSION_ID = 'pi-dashboard-session-1';
const SESSION_KEY = `${AGENT_ID}:telegram:dm:dashboard-peer`;
const RUN_ID = 'pi-dashboard-run-1';
const ROUTE_DECISION_ID = 'pi-dashboard-route-1';
const NOW = Date.parse('2026-05-16T00:00:00.000Z');
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';

export async function runPiDashboardOperatorCanaryCli(
  argv: string[],
  deps: PiDashboardOperatorCanaryDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiDashboardOperatorCanaryArgs;

  try {
    args = parsePiDashboardOperatorCanaryArgs(argv);
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
  let metricsStore: MetricsStore | undefined;

  try {
    workspacePath = await mkdtemp(join(tmpdir(), 'pi-dashboard-operator-canary-'));
    await mkdir(join(workspacePath, 'data'), { recursive: true });
    metricsStore = new MetricsStore(join(workspacePath, 'data', 'metrics.sqlite'));
    metrics._reset();
    metrics.setStore(metricsStore);

    const assertions = await runDashboardOperatorCanary({
      workspacePath,
      model: args.model,
      authPath: args.authPath,
      modelsPath: args.modelsPath,
    });
    const result: PiDashboardOperatorCanaryResult = {
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
    const result: PiDashboardOperatorCanaryResult = {
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
    metrics._reset();
    metricsStore?.close();
    if (workspacePath && !args.keepWorkspace) {
      await rm(workspacePath, { recursive: true, force: true });
    }
  }
}

export function parsePiDashboardOperatorCanaryArgs(argv: string[]): PiDashboardOperatorCanaryArgs {
  const args: PiDashboardOperatorCanaryArgs = {
    json: false,
    keepWorkspace: false,
    allowSkip: false,
    model: DEFAULT_MODEL,
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
      case '--gateway':
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function runDashboardOperatorCanary(input: {
  workspacePath: string;
  model: string;
  authPath?: string;
  modelsPath?: string;
}): Promise<Record<string, unknown>> {
  const dataDir = join(input.workspacePath, 'data');
  const agentWorkspacePath = join(input.workspacePath, 'agents', AGENT_ID);
  await mkdir(agentWorkspacePath, { recursive: true });

  const learning = seedLearningAndDecisionStores(dataDir);
  const gateway = new Gateway();
  const agent = createOperatorAgent({
    workspacePath: agentWorkspacePath,
    model: input.model,
    authPath: input.authPath ?? join(input.workspacePath, 'private', 'pi-auth.json'),
    modelsPath: input.modelsPath ?? join(input.workspacePath, 'private', 'pi-models.json'),
  });
  installGatewayFakes(gateway, agent);
  seedMetrics(input.model);

  const status = gateway.getStatus();
  const agentConfig = summarizeAgentConfig(agent);
  const sessions = await gateway.listAgentSessions(AGENT_ID);
  const details = await gateway.getAgentSessionDetails(AGENT_ID, SESSION_ID);
  const runs = gateway.listAgentRuns({ agentId: AGENT_ID });
  const routeDecisions = gateway.listRouteDecisions({ agentId: AGENT_ID });
  const interrupts = gateway.listAgentInterrupts({ agentId: AGENT_ID });
  const plugins = summarizePlugins(gateway);
  const agentPlugins = summarizeAgentPlugins(gateway, AGENT_ID);
  const mcp = gateway.listMcpServerPreflight();
  const diagnostics = gateway.exportDiagnostics({
    includeLogs: false,
    runId: RUN_ID,
  });

  assert.deepEqual(status.agents, [AGENT_ID]);
  assert.equal(agentConfig.runtimeProvider, 'pi');
  assert.equal(agentConfig.authPathRedacted, true);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.sessionId, SESSION_ID);
  assert.equal(sessions[0]?.provenance?.runId, RUN_ID);
  assert.equal(details.messages.length, 2);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.status, 'succeeded');
  assert.equal(routeDecisions.length, 1);
  assert.equal(routeDecisions[0]?.outcome, 'delivered');
  assert.equal(interrupts.length, 1);
  assert.equal(plugins.loaded, 1);
  assert.equal(agentPlugins.enabled, 1);
  assert.equal(mcp.some((entry) => entry.serverName === 'operator_notes'), true);
  assert.equal(learning.actions, 1);
  assert.equal(learning.decisions, 1);
  assert.equal(diagnostics.manifest.contentPolicy, 'metadata-only');
  assert.equal(diagnostics.runs.length, 1);
  assert.equal(diagnostics.routeDecisions.length, 1);
  assert.equal(diagnostics.interrupts.length, 1);
  assert.equal(diagnostics.integrationAuditEvents.length, 1);
  assert.equal(diagnostics.memoryInfluenceEvents.length, 1);

  const serialized = JSON.stringify({
    status,
    agentConfig,
    sessions,
    details,
    runs,
    routeDecisions,
    interrupts,
    plugins,
    agentPlugins,
    mcp,
    learning,
    diagnostics,
  });
  if (input.authPath) {
    assert.equal(serialized.includes(input.authPath), false, 'explicit auth path leaked into dashboard canary JSON');
  }
  if (input.modelsPath) {
    assert.equal(serialized.includes(input.modelsPath), false, 'explicit models path leaked into dashboard canary JSON');
  }

  return {
    gatewayStatus: {
      agents: status.agents.length,
      activeSessions: status.activeSessions,
      channelsInspectable: true,
    },
    agentConfig,
    sessions: {
      rows: sessions.length,
      detailsMessages: details.messages.length,
      provenanceRunId: sessions[0]?.provenance?.runId,
    },
    runs: {
      rows: runs.length,
      status: runs[0]?.status,
      routeDecisions: routeDecisions.length,
      interrupts: interrupts.length,
    },
    learning,
    plugins,
    agentPlugins,
    mcp: {
      servers: mcp.length,
      externalServerPresent: mcp.some((entry) => entry.serverName === 'operator_notes'),
    },
    diagnostics: {
      contentPolicy: diagnostics.manifest.contentPolicy,
      runs: diagnostics.runs.length,
      routeDecisions: diagnostics.routeDecisions.length,
      diagnosticEvents: diagnostics.diagnosticEvents.length,
      interrupts: diagnostics.interrupts.length,
      integrationAuditEvents: diagnostics.integrationAuditEvents.length,
      memoryInfluenceEvents: diagnostics.memoryInfluenceEvents.length,
      secretsRedacted: true,
    },
  };
}

function createOperatorAgent(input: {
  workspacePath: string;
  model: string;
  authPath: string;
  modelsPath: string;
}): Agent {
  return {
    id: AGENT_ID,
    workspacePath: input.workspacePath,
    config: {
      model: input.model,
      safety_profile: 'trusted',
      runtime: {
        headless: {
          provider: 'pi',
          pi: {
            auth_path: input.authPath,
            models_path: input.modelsPath,
          },
        },
      },
      routes: [{
        channel: 'telegram',
        scope: 'dm',
        account: 'main',
        peers: ['dashboard-peer'],
        mention_only: false,
      }],
      pairing: { mode: 'open' },
      learning: {
        mode: 'propose',
        review_interval: 5,
        triggers: ['manual'],
      },
      plugins: {
        'operator-console': { enabled: true },
      },
      external_mcp_servers: {
        operator_notes: {
          type: 'http',
          url: 'https://mcp.example.invalid/mcp',
          credential_ref: 'cred_operator_notes',
          allowed_tools: ['search_notes'],
        },
      },
    },
    mcpServer: { name: 'pi-dashboard-agent-tools' },
    tools: [{ name: 'memory_search' }, { name: 'manage_cron' }],
    getSessionCount: () => 1,
    getSessionId: (sessionKey: string) => (sessionKey === SESSION_KEY ? SESSION_ID : undefined),
    getSessionIdByValue: (sessionId: string) => (sessionId === SESSION_ID ? SESSION_KEY : undefined),
    listSessionMappings: () => [{
      sessionKey: SESSION_KEY,
      sessionId: SESSION_ID,
      messageCount: 2,
      lastUsed: NOW + 20,
      started: NOW,
    }],
  } as unknown as Agent;
}

function installGatewayFakes(gateway: Gateway, agent: Agent): void {
  const mutable = gateway as unknown as {
    agents: Map<string, Agent>;
    channels: Map<string, unknown>;
    globalConfig: Record<string, unknown>;
    startedAt: number;
    sdkSessionService: Record<string, unknown>;
    pluginCatalog: Record<string, unknown>;
    pluginRegistry: Record<string, unknown>;
  };
  mutable.agents.set(AGENT_ID, agent);
  mutable.channels = new Map();
  mutable.globalConfig = {
    features: { sdk_active_input: false },
    runtime: {
      headless: {
        provider: 'pi',
        pi: {
          auth_path: '[REDACTED_PATH]',
          models_path: '[REDACTED_PATH]',
        },
      },
    },
  };
  mutable.startedAt = NOW;
  mutable.sdkSessionService = createSessionServiceFake();
  mutable.pluginCatalog = {
    entries: [{
      name: 'operator-console',
      version: '0.1.0',
      sourceType: 'bundled',
      pluginDir: 'plugins/operator-console',
      manifest: {
        name: 'operator-console',
        version: '0.1.0',
        description: 'Operator controls',
      },
      loaded: true,
      status: 'ok',
    }],
    duplicates: [],
  };
  mutable.pluginRegistry = {
    listPlugins: () => [{
      manifest: {
        name: 'operator-console',
        version: '0.1.0',
        description: 'Operator controls',
      },
      instance: {},
    }],
    getMcpToolsForPlugin: (name: string) => (
      name === 'operator-console'
        ? [{ name: 'operator_console_delegate' }, { name: 'operator_console_peer_summary' }]
        : []
    ),
    hasContextEngineForPlugin: () => false,
    isEnabledFor: (agentId: string, name: string) => agentId === AGENT_ID && name === 'operator-console',
  };
}

function createSessionServiceFake(): Record<string, unknown> {
  const messages: SdkSessionMessageView[] = [
    {
      type: 'user',
      uuid: 'pi-dashboard-user-1',
      sessionId: SESSION_ID,
      text: 'Show me the Pi dashboard operator state.',
      message: { role: 'user', content: [{ type: 'text', text: 'Show me the Pi dashboard operator state.' }] },
    },
    {
      type: 'assistant',
      uuid: 'pi-dashboard-assistant-1',
      sessionId: SESSION_ID,
      text: 'Pi runtime state is visible to the operator.',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Pi runtime state is visible to the operator.' }] },
    },
  ];
  return {
    listAgentSessions: async () => [{
      sessionId: SESSION_ID,
      summary: 'Pi dashboard canary',
      lastModified: NOW + 20,
      createdAt: NOW,
      cwd: 'redacted-workspace',
    }],
    getAgentSessionTitle: async () => 'Pi dashboard canary',
    getAgentSessionLabels: async () => ['pi', 'dashboard', 'operator'],
    getAgentSessionInfo: async () => ({
      sessionId: SESSION_ID,
      summary: 'Pi dashboard canary',
      lastModified: NOW + 20,
      createdAt: NOW,
      cwd: 'redacted-workspace',
    }),
    getAgentSessionMessages: async () => messages,
  };
}

function seedMetrics(model: string): void {
  metrics.recordRouteDecision({
    id: ROUTE_DECISION_ID,
    timestamp: NOW,
    messageId: 'pi-dashboard-message-1',
    channel: 'telegram',
    accountId: 'main',
    chatType: 'dm',
    peerId: 'dashboard-peer',
    senderId: 'dashboard-user',
    candidates: [{
      agentId: AGENT_ID,
      channel: 'telegram',
      accountId: 'main',
      scope: 'dm',
      mentionOnly: false,
      priority: 0,
    }],
    winnerAgentId: AGENT_ID,
    accessAllowed: true,
    accessReason: 'allowlisted',
    queueAction: 'dispatch',
    sessionKey: SESSION_KEY,
    outcome: 'delivered',
  });
  metrics.recordAgentRunStart({
    runId: RUN_ID,
    traceId: RUN_ID,
    startedAt: NOW + 1,
    agentId: AGENT_ID,
    sessionKey: SESSION_KEY,
    sdkSessionId: SESSION_ID,
    source: 'channel',
    channel: 'telegram',
    accountId: 'main',
    peerId: 'dashboard-peer',
    messageId: 'pi-dashboard-message-1',
    routeDecisionId: ROUTE_DECISION_ID,
    status: 'running',
    model,
  });
  metrics.recordAgentRunFinish({
    runId: RUN_ID,
    completedAt: NOW + 20,
    status: 'succeeded',
    sdkSessionId: SESSION_ID,
    usage: {
      inputTokens: 20,
      outputTokens: 10,
      durationMs: 19,
    },
  });
  metrics.recordInterrupt({
    timestamp: NOW + 21,
    agentId: AGENT_ID,
    runId: RUN_ID,
    sessionKey: SESSION_KEY,
    sdkSessionId: SESSION_ID,
    targetId: RUN_ID,
    requestedBy: 'dashboard',
    result: 'interrupted',
    reason: 'operator-inspection',
  });
  metrics.recordIntegrationAuditEvent({
    timestamp: NOW + 22,
    agentId: AGENT_ID,
    sessionKey: SESSION_KEY,
    runId: RUN_ID,
    sdkSessionId: SESSION_ID,
    toolName: 'mcp__operator_notes__search_notes',
    provider: 'operator-notes',
    capabilityId: 'notes.search',
    status: 'completed',
  });
  metrics.recordMemoryInfluenceEvent({
    timestamp: NOW + 23,
    agentId: AGENT_ID,
    sessionKey: SESSION_KEY,
    runId: RUN_ID,
    sdkSessionId: SESSION_ID,
    source: 'prefetch',
    query: 'dashboard operator migration',
    refs: [{ path: 'memory/runtime-v1.md', score: 0.9 }],
  });
}

function seedLearningAndDecisionStores(dataDir: string): Record<string, unknown> {
  const learningStore = new LearningStore(join(dataDir, 'learning.sqlite'));
  const decisionStore = new DecisionStore(join(dataDir, 'decisions.sqlite'));
  try {
    const review = learningStore.createReview({
      id: 'pi-dashboard-review-1',
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
      runId: RUN_ID,
      traceId: RUN_ID,
      sdkSessionId: SESSION_ID,
      trigger: 'manual',
      mode: 'propose',
      model: DEFAULT_MODEL,
      startedAt: NOW + 30,
      input: { reason: 'dashboard operator canary' },
    });
    learningStore.completeReview(review.id, {
      status: 'completed',
      completedAt: NOW + 40,
      output: { summary: 'operator-visible learning state' },
    });
    const action = learningStore.addAction({
      id: 'pi-dashboard-action-1',
      reviewId: review.id,
      agentId: AGENT_ID,
      actionType: 'memory_candidate',
      status: 'proposed',
      confidence: 0.9,
      title: 'Remember dashboard migration evidence',
      rationale: 'Operator API can inspect learning state.',
      payload: { text: 'Dashboard operator canary observed Pi runtime state.' },
      createdAt: NOW + 41,
    });
    learningStore.addArtifact({
      id: 'pi-dashboard-artifact-1',
      reviewId: review.id,
      agentId: AGENT_ID,
      runId: RUN_ID,
      kind: 'manifest',
      path: 'data/learning-artifacts/pi-dashboard/manifest.json',
      contentHash: 'sha256:dashboard',
      sizeBytes: 100,
      reason: 'dashboard operator canary',
      createdAt: NOW + 42,
    });
    decisionStore.createDecision({
      id: 'pi-dashboard-decision-1',
      shortCode: 'PIDA01',
      kind: 'learning_memory',
      scope: 'agent',
      actor: 'admin',
      status: 'pending',
      agentId: AGENT_ID,
      learningActionId: action.id,
      reviewId: review.id,
      subject: 'Dashboard migration memory',
      body: 'Approve dashboard canary memory candidate.',
      risk: 'low',
      payload: { actionId: action.id },
      originChannel: 'dashboard',
      createdAt: NOW + 43,
    });

    return {
      reviews: learningStore.listReviews({ agentId: AGENT_ID }).length,
      actions: learningStore.listActions({ agentId: AGENT_ID }).length,
      artifacts: learningStore.listArtifacts({ reviewId: review.id }).length,
      decisions: decisionStore.listDecisions({ agentId: AGENT_ID }).length,
    };
  } finally {
    learningStore.close();
    decisionStore.close();
  }
}

function summarizeAgentConfig(agent: Agent): Record<string, unknown> {
  const config = agent.config as {
    model?: string;
    runtime?: { headless?: { provider?: string; pi?: { auth_path?: string; models_path?: string } } };
    plugins?: Record<string, { enabled?: boolean }>;
    external_mcp_servers?: Record<string, unknown>;
  };
  const pi = config.runtime?.headless?.pi;
  return {
    id: agent.id,
    model: config.model,
    runtimeProvider: config.runtime?.headless?.provider,
    authPathRedacted: Boolean(pi?.auth_path),
    modelsPathRedacted: Boolean(pi?.models_path),
    enabledPlugins: Object.entries(config.plugins ?? {})
      .filter(([, value]) => value?.enabled === true)
      .map(([name]) => name),
    externalMcpServers: Object.keys(config.external_mcp_servers ?? {}),
  };
}

function summarizePlugins(gateway: Gateway): Record<string, unknown> {
  const registry = (gateway as unknown as { pluginRegistry: {
    listPlugins(): Array<{ manifest: { name: string } }>;
    getMcpToolsForPlugin(name: string): unknown[];
    hasContextEngineForPlugin(name: string): boolean;
  } }).pluginRegistry;
  const entries = registry.listPlugins();
  return {
    loaded: entries.length,
    names: entries.map((entry) => entry.manifest.name),
    toolCount: entries.reduce((sum, entry) => sum + registry.getMcpToolsForPlugin(entry.manifest.name).length, 0),
    contextEngines: entries.filter((entry) => registry.hasContextEngineForPlugin(entry.manifest.name)).length,
  };
}

function summarizeAgentPlugins(gateway: Gateway, agentId: string): Record<string, unknown> {
  const registry = (gateway as unknown as { pluginRegistry: {
    listPlugins(): Array<{ manifest: { name: string } }>;
    isEnabledFor(agentId: string, name: string): boolean;
  } }).pluginRegistry;
  const names = registry.listPlugins().map((entry) => entry.manifest.name);
  const enabled = names.filter((name) => registry.isEnabledFor(agentId, name));
  return {
    known: names.length,
    enabled: enabled.length,
    enabledNames: enabled,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiDashboardOperatorCanaryResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stream.write([
    `Pi dashboard operator canary ${result.status}.`,
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
    'Usage: pnpm smoke:pi-dashboard-operator -- [--json]',
    '',
    'Runs the deterministic Pi dashboard/operator API runtime-v1 canary.',
    '',
    'Options:',
    `  --model <model>       model recorded in operator run evidence (default: ${DEFAULT_MODEL})`,
    '  --auth-path <path>    optional Pi auth path, redacted from output',
    '  --models-path <path>  optional Pi models path, redacted from output',
    '  --timeout-ms <ms>     accepted for aggregate canary compatibility',
    '  --keep-workspace      keep temporary smoke workspace for inspection',
    '  --allow-skip          exit 0 if the probe fails',
    '  --json                print structured result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiDashboardOperatorCanaryCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
