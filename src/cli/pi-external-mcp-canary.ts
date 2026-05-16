import 'dotenv/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CredentialRef, CredentialStore, StoredCredential } from '../agent/credentials/index.js';
import { AgentYmlSchema } from '../config/schema.js';
import { resolveExternalMcpHeaders } from '../sdk/external-mcp.js';
import type { HeadlessCustomTool, HeadlessToolCall } from '../runtime/headless.js';
import {
  buildExternalMcpCustomTools,
  type ExternalMcpToolClient,
} from '../runtime/external-mcp-custom-tools.js';
import {
  DEFAULT_PI_MODEL_ID,
  PiHeadlessRuntime,
  type PiAgentSessionLike,
  type PiCreateAgentSession,
  type PiCustomToolDefinition,
} from '../runtime/pi-headless.js';

interface PiExternalMcpCanaryArgs {
  json: boolean;
  keepWorkspace: boolean;
  allowSkip: boolean;
  model: string;
  authPath?: string;
  modelsPath?: string;
  timeoutMs: number;
  gateway: boolean;
  help: boolean;
}

interface PiExternalMcpCanaryDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiExternalMcpCanaryResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  scenario: 'pi.external-mcp-proxy';
  durationMs: number;
  workspacePath?: string;
  assertions: Record<string, unknown>;
  error?: string;
}

const SCENARIO_ID = 'pi.external-mcp-proxy' as const;
const AGENT_ID = 'pi-external-mcp-agent';
const MCP_SERVER_NAME = 'canary_mcp';
const MCP_TOOL_NAME = 'lookup';
const MCP_BLOCKED_TOOL_NAME = 'delete_secret';
const MCP_CUSTOM_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${MCP_TOOL_NAME}`;
const MCP_SERVICE = 'mcp:canary';
const CANARY_TOKEN = 'pi-external-mcp-canary-token';

export async function runPiExternalMcpCanaryCli(
  argv: string[],
  deps: PiExternalMcpCanaryDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiExternalMcpCanaryArgs;

  try {
    args = parsePiExternalMcpCanaryArgs(argv);
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
    workspacePath = await mkdtemp(join(tmpdir(), 'pi-external-mcp-canary-'));
    const assertions = await runExternalMcpProxyCanary({
      workspacePath,
      model: args.model,
      timeoutMs: args.timeoutMs,
    });
    const result: PiExternalMcpCanaryResult = {
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
    const error = err instanceof Error ? err.message : String(err);
    const status = args.allowSkip && isSkippableCanaryError(error) ? 'skipped' : 'failed';
    const result: PiExternalMcpCanaryResult = {
      status,
      runtime: 'pi',
      scenario: SCENARIO_ID,
      durationMs: Date.now() - startedAt,
      ...(workspacePath ? { workspacePath } : {}),
      assertions: {},
      error: redactCanarySecrets(error),
    };
    writeResult(status === 'failed' ? stderr : stdout, args.json, result);
    return status === 'skipped' ? 0 : 1;
  } finally {
    if (workspacePath && !args.keepWorkspace) {
      await rm(workspacePath, { recursive: true, force: true });
    }
  }
}

async function runExternalMcpProxyCanary(input: {
  workspacePath: string;
  model: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const workspacePath = resolve(input.workspacePath);
  const store = new MemoryCredentialStore();
  await store.set({ agentId: AGENT_ID, service: MCP_SERVICE }, {
    kind: 'mcp_apikey',
    service: MCP_SERVICE,
    account: 'canary',
    scopes: ['lookup'],
    mcpUrl: 'https://mcp.canary.invalid/mcp',
    token: CANARY_TOKEN,
    scheme: 'Bearer',
    createdAt: Date.now(),
  });

  const rawServers = {
    [MCP_SERVER_NAME]: {
      type: 'http' as const,
      url: 'https://mcp.canary.invalid/mcp',
      credential_ref: MCP_SERVICE,
      allowed_tools: [MCP_TOOL_NAME],
    },
  };
  const parsedAgentConfig = AgentYmlSchema.parse({
    runtime: { headless: { provider: 'pi' } },
    routes: [{ channel: 'telegram', scope: 'dm' }],
    safety_profile: 'trusted',
    external_mcp_servers: rawServers,
  });
  assert(parsedAgentConfig.external_mcp_servers?.[MCP_SERVER_NAME]?.type === 'http', 'external MCP canary server did not pass agent.yml schema');
  const resolvedServers = await resolveExternalMcpHeaders(rawServers, store, { agentId: AGENT_ID });
  const resolvedServer = resolvedServers[MCP_SERVER_NAME];
  assert(resolvedServer?.type === 'http', 'external MCP credential resolver dropped canary HTTP server');
  assert(resolvedServer.headers?.Authorization === `Bearer ${CANARY_TOKEN}`, 'external MCP credential resolver did not materialize Authorization header');
  assert(!JSON.stringify(rawServers).includes(CANARY_TOKEN), 'raw external MCP spec contains credential material');
  assert(store.getCalls.length === 1, 'external MCP credential resolver did not read credential store exactly once');
  assert(store.getCalls[0]?.accessReason === `mcp_load:${MCP_SERVER_NAME}`, 'external MCP credential resolver used unexpected audit reason');

  const clientCalls: Array<{ phase: 'list' | 'call'; serverName: string; toolName?: string; headers?: Record<string, string>; args?: Record<string, unknown> }> = [];
  const client: ExternalMcpToolClient = {
    async listTools(serverName, server) {
      clientCalls.push({
        phase: 'list',
        serverName,
        headers: server.type === 'http' || server.type === 'sse' ? server.headers : undefined,
      });
      return [
        {
          name: MCP_TOOL_NAME,
          description: 'Lookup canary data',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        },
        {
          name: MCP_BLOCKED_TOOL_NAME,
          description: 'Must never be exposed',
          inputSchema: { type: 'object' },
        },
      ];
    },
    async callTool(serverName, server, toolName, args) {
      clientCalls.push({
        phase: 'call',
        serverName,
        toolName,
        headers: server.type === 'http' || server.type === 'sse' ? server.headers : undefined,
        args,
      });
      return {
        content: [{ type: 'text', text: `lookup:${String(args.q ?? '')}` }],
        structuredContent: { ok: true, q: args.q },
      };
    },
  };
  const errors: Array<{ message: string; context: Record<string, unknown> }> = [];
  const customTools = await buildExternalMcpCustomTools({
    servers: resolvedServers,
    cwd: workspacePath,
    requestTimeoutMs: input.timeoutMs,
    clientName: 'pi-external-mcp-canary',
    client,
    onError: (err, context) => errors.push({ message: err.message, context }),
  });
  assert(errors.length === 0, 'external MCP custom tool bridge emitted unexpected errors');
  assert(customTools.map((tool) => tool.name).join(',') === MCP_CUSTOM_TOOL_NAME, 'external MCP custom tool bridge exposed wrong tools');
  assert(!customTools.some((tool) => tool.name.includes(MCP_BLOCKED_TOOL_NAME)), 'external MCP custom tool bridge exposed disallowed tool');

  const allowRun = await runPiCustomToolBridge({
    workspacePath,
    model: input.model,
    customTools,
    decision: 'allow',
  });
  assert(allowRun.text === 'pi external mcp canary done', 'Pi custom tool bridge returned unexpected text');
  assert(allowRun.toolNames.includes(MCP_CUSTOM_TOOL_NAME), 'Pi did not receive external MCP custom tool name');
  assert(allowRun.definedToolNames.includes(MCP_CUSTOM_TOOL_NAME), 'Pi defineTool did not receive external MCP custom tool');
  assert(firstResultText(allowRun.executionResult) === 'lookup:alpha', 'Pi external MCP custom tool returned wrong content');
  assert(allowRun.decisions[0]?.toolName === MCP_CUSTOM_TOOL_NAME, 'Pi custom tool policy saw wrong tool name');

  const denyRun = await runPiCustomToolBridge({
    workspacePath,
    model: input.model,
    customTools,
    decision: 'deny',
  });
  assert(resultDetails(denyRun.executionResult).denied === true, 'Pi custom tool bridge did not return model-visible denial');
  assert(firstResultText(denyRun.executionResult) === 'canary policy denial', 'Pi custom tool denial returned wrong message');

  const callEntries = clientCalls.filter((call) => call.phase === 'call');
  assert(callEntries.length === 1, 'external MCP upstream call count changed after denied Pi execution');
  assert(callEntries[0]?.headers?.Authorization === `Bearer ${CANARY_TOKEN}`, 'external MCP upstream call missed materialized Authorization header');
  assert(callEntries[0]?.args?.q === 'alpha', 'external MCP upstream call received wrong arguments');

  const redactedArtifact = redactCanarySecrets(JSON.stringify({
    resolvedServers,
    clientCalls,
    allowRun,
    denyRun,
  }));
  assert(!redactedArtifact.includes(CANARY_TOKEN), 'external MCP canary artifact leaked credential material');

  return {
    credentialHeadersResolved: true,
    credentialStoreReads: store.getCalls.length,
    exposedTools: customTools.map((tool) => tool.name),
    disallowedToolHidden: true,
    piCustomToolDefined: true,
    piCustomToolExecuted: true,
    piPolicyDenied: true,
    upstreamCalls: callEntries.length,
    redaction: true,
    agentSchemaValidated: true,
  };
}

async function runPiCustomToolBridge(input: {
  workspacePath: string;
  model: string;
  customTools: HeadlessCustomTool[];
  decision: 'allow' | 'deny';
}): Promise<{
  text: string;
  toolNames: string[];
  definedToolNames: string[];
  executionResult?: Record<string, unknown>;
  decisions: HeadlessToolCall[];
}> {
  const session = createSession([{ type: 'assistant_text_delta', delta: 'pi external mcp canary done' }]);
  let createOptions: Record<string, unknown> | undefined;
  const definedTools: PiCustomToolDefinition[] = [];
  const createAgentSession: PiCreateAgentSession = async (options) => {
    createOptions = options;
    return { session };
  };
  const decisions: HeadlessToolCall[] = [];
  const runtime = new PiHeadlessRuntime({
    createAgentSession,
    createOptions: {
      resourceLoader: {
        getExtensions: () => ({ extensions: [], errors: [], runtime: {} }),
      },
    },
    importPiCodingAgent: async () => ({
      defineTool(definition) {
        definedTools.push(definition);
        return definition;
      },
    }),
  });
  const text = await runtime.runText({
    prompt: 'Exercise the external MCP proxy custom tool.',
    model: input.model,
    cwd: input.workspacePath,
    customTools: input.customTools,
    toolPolicy: {
      mode: 'allow-list',
      tools: input.customTools.map((tool) => tool.name),
      canUseTool: async (toolCall) => {
        decisions.push(toolCall);
        return input.decision === 'allow'
          ? { behavior: 'allow' as const }
          : { behavior: 'deny' as const, message: 'canary policy denial' };
      },
    },
  });
  assert(createOptions, 'Pi runtime did not create a session');
  const toolNames = Array.isArray(createOptions.tools) ? createOptions.tools.map(String) : [];
  const piTool = definedTools.find((tool) => tool.name === MCP_CUSTOM_TOOL_NAME);
  assert(piTool, 'Pi runtime did not define external MCP custom tool');
  const executionResult = await piTool.execute(`${input.decision}-call`, { q: 'alpha' });
  return {
    text,
    toolNames,
    definedToolNames: definedTools.map((tool) => tool.name),
    executionResult,
    decisions,
  };
}

function createSession(events: unknown[]): PiAgentSessionLike {
  let listener: ((event: unknown) => void) | undefined;
  return {
    async prompt() {
      for (const event of events) listener?.(event);
    },
    subscribe(next) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    async abort() {},
    dispose() {},
  };
}

function firstResultText(result: Record<string, unknown> | undefined): string | undefined {
  const content = result?.content;
  if (!Array.isArray(content)) return undefined;
  const first = content[0];
  return first && typeof first === 'object' && 'text' in first
    ? String((first as { text?: unknown }).text)
    : undefined;
}

function resultDetails(result: Record<string, unknown> | undefined): Record<string, unknown> {
  const details = result?.details;
  return details && typeof details === 'object' && !Array.isArray(details)
    ? details as Record<string, unknown>
    : {};
}

class MemoryCredentialStore implements CredentialStore {
  readonly getCalls: Array<{ ref: CredentialRef; accessReason: string }> = [];
  private readonly values = new Map<string, StoredCredential>();

  async get(ref: CredentialRef, accessReason: string): Promise<StoredCredential> {
    this.getCalls.push({ ref, accessReason });
    const credential = this.values.get(this.key(ref));
    if (!credential) throw new Error(`missing credential: ${ref.agentId}:${ref.service}`);
    return credential;
  }

  async set(ref: CredentialRef, credential: StoredCredential): Promise<void> {
    this.values.set(this.key(ref), credential);
  }

  async list(): Promise<[]> {
    return [];
  }

  async delete(ref: CredentialRef): Promise<void> {
    this.values.delete(this.key(ref));
  }

  private key(ref: CredentialRef): string {
    return `${ref.agentId}:${ref.service}`;
  }
}

export function parsePiExternalMcpCanaryArgs(argv: string[]): PiExternalMcpCanaryArgs {
  const args: PiExternalMcpCanaryArgs = {
    json: false,
    keepWorkspace: false,
    allowSkip: false,
    model: DEFAULT_PI_MODEL_ID,
    timeoutMs: 60_000,
    gateway: false,
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
      case '--gateway':
        args.gateway = true;
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

function redactCanarySecrets(value: string): string {
  return value.replaceAll(CANARY_TOKEN, '[REDACTED_MCP_TOKEN]');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isSkippableCanaryError(message: string): boolean {
  return /optional package|api key|auth|oauth|credential|model registry/i.test(message);
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiExternalMcpCanaryResult,
): void {
  const safeResult = JSON.parse(redactCanarySecrets(JSON.stringify(result))) as PiExternalMcpCanaryResult;
  if (json) {
    stream.write(`${JSON.stringify(safeResult)}\n`);
    return;
  }
  stream.write([
    `Pi external MCP canary ${safeResult.status}.`,
    `durationMs: ${safeResult.durationMs}`,
    `scenario: ${safeResult.scenario}`,
  ].join('\n'));
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
    'Usage: pnpm smoke:pi-external-mcp -- [--json] [--keep-workspace]',
    '',
    'Runs the scripted Pi runtime v1 external MCP proxy canary.',
    '',
    'Options:',
    '  --json                print structured result',
    '  --keep-workspace      keep temporary canary workspace for inspection',
    '  --gateway             accepted for pi-v1-canary compatibility',
    '  --allow-skip          exit 0 for skippable optional runtime/auth errors',
    `  --model <model>       model recorded for injected Pi runtime (default: ${DEFAULT_PI_MODEL_ID})`,
    '  --auth-path <path>    accepted for pi-v1-canary compatibility',
    '  --models-path <path>  accepted for pi-v1-canary compatibility',
    '  --timeout-ms <ms>     positive integer timeout for external MCP requests',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiExternalMcpCanaryCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
