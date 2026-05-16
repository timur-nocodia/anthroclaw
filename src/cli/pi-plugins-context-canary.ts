import 'dotenv/config';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { HeadlessRunInput, HeadlessRuntime } from '../runtime/headless.js';
import { GlobalConfigSchema } from '../config/schema.js';
import { Gateway } from '../gateway.js';
import { runSubagent } from '../plugins/subagent-runner.js';
import { DEFAULT_PI_MODEL_ID } from '../runtime/pi-headless.js';

interface PiPluginsContextCanaryArgs {
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

interface PiPluginsContextCanaryDeps {
  GatewayCtor?: new () => Gateway;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiPluginsContextCanaryResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  scenario: 'pi.plugins-context-tools';
  durationMs: number;
  workspacePath?: string;
  assertions: Record<string, unknown>;
  error?: string;
}

const SCENARIO_ID = 'pi.plugins-context-tools' as const;
const AGENT_ID = 'pi-plugin-canary-agent';
const DISABLED_AGENT_ID = 'pi-plugin-disabled-agent';
const PLUGIN_NAME = 'pi-canary-plugin';
const SESSION_KEY = `${AGENT_ID}:telegram:dm:pi-plugin-peer`;

export async function runPiPluginsContextCanaryCli(
  argv: string[],
  deps: PiPluginsContextCanaryDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiPluginsContextCanaryArgs;

  try {
    args = parsePiPluginsContextCanaryArgs(argv);
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
    workspacePath = await mkdtemp(join(tmpdir(), 'pi-plugins-context-canary-'));
    const gatewayAssertions = await runGatewayPluginCanary({
      GatewayCtor: deps.GatewayCtor ?? Gateway,
      workspacePath,
      authPath: args.authPath,
      modelsPath: args.modelsPath,
    });
    const subagentAssertions = await runPluginSubagentCanary({
      model: args.model ?? DEFAULT_PI_MODEL_ID,
      timeoutMs: args.timeoutMs,
    });
    const result: PiPluginsContextCanaryResult = {
      status: 'passed',
      runtime: 'pi',
      scenario: SCENARIO_ID,
      durationMs: Date.now() - startedAt,
      ...(args.keepWorkspace ? { workspacePath } : {}),
      assertions: {
        ...gatewayAssertions,
        subagent: subagentAssertions,
      },
    };
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const status = args.allowSkip && isSkippableCanaryError(error) ? 'skipped' : 'failed';
    const result: PiPluginsContextCanaryResult = {
      status,
      runtime: 'pi',
      scenario: SCENARIO_ID,
      durationMs: Date.now() - startedAt,
      ...(workspacePath ? { workspacePath } : {}),
      assertions: {},
      error,
    };
    writeResult(status === 'failed' ? stderr : stdout, args.json, result);
    return status === 'skipped' ? 0 : 1;
  } finally {
    if (workspacePath && !args.keepWorkspace) {
      await rm(workspacePath, { recursive: true, force: true });
    }
  }
}

export function parsePiPluginsContextCanaryArgs(argv: string[]): PiPluginsContextCanaryArgs {
  const args: PiPluginsContextCanaryArgs = {
    json: false,
    keepWorkspace: false,
    gateway: false,
    allowSkip: false,
    model: DEFAULT_PI_MODEL_ID,
    timeoutMs: 60_000,
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

async function runGatewayPluginCanary(input: {
  GatewayCtor: new () => Gateway;
  workspacePath: string;
  authPath?: string;
  modelsPath?: string;
}): Promise<Record<string, unknown>> {
  const workspacePath = resolve(input.workspacePath);
  const agentsDir = join(workspacePath, 'agents');
  const dataDir = join(workspacePath, 'data');
  const pluginsDir = join(workspacePath, 'plugins');
  await writeCanaryAgent(agentsDir, AGENT_ID, true);
  await writeCanaryAgent(agentsDir, DISABLED_AGENT_ID, false);
  await writeCanaryPlugin(pluginsDir, dataDir);

  const gateway = new input.GatewayCtor();
  const pluginDataDir = join(dataDir, PLUGIN_NAME);
  let pluginLoaded = false;
  try {
    await gateway.start(GlobalConfigSchema.parse({
      defaults: {
        model: DEFAULT_PI_MODEL_ID,
        embedding_provider: 'off',
        embedding_model: 'text-embedding-3-small',
        debounce_ms: 0,
      },
      runtime: {
        headless: {
          provider: 'pi',
          ...(input.authPath || input.modelsPath
            ? { pi: { ...(input.authPath ? { auth_path: input.authPath } : {}), ...(input.modelsPath ? { models_path: input.modelsPath } : {}) } }
            : {}),
        },
      },
    }), agentsDir, dataDir, pluginsDir);

    const loadedPlugins = gateway.pluginRegistry.listPlugins().map((entry) => entry.manifest.name);
    assert(loadedPlugins.includes(PLUGIN_NAME), 'canary plugin was not loaded');
    pluginLoaded = true;
    assert(gateway.pluginRegistry.isEnabledFor(AGENT_ID, PLUGIN_NAME), 'canary plugin was not enabled for the canary agent');
    assert(!gateway.pluginRegistry.isEnabledFor(DISABLED_AGENT_ID, PLUGIN_NAME), 'canary plugin leaked into disabled agent');

    const enabledTools = gateway.pluginRegistry.getMcpToolsForAgent(AGENT_ID);
    const disabledTools = gateway.pluginRegistry.getMcpToolsForAgent(DISABLED_AGENT_ID);
    const toolNames = enabledTools.map((tool) => tool.name).sort();
    assert(toolNames.includes(`${PLUGIN_NAME}_inspect`), 'read-only plugin tool was not exposed');
    assert(toolNames.includes(`${PLUGIN_NAME}_policy_gate`), 'policy-sensitive plugin tool was not exposed');
    assert(disabledTools.length === 0, 'plugin tools were exposed to disabled agent');

    const inspectTool = enabledTools.find((tool) => tool.name === `${PLUGIN_NAME}_inspect`);
    const policyTool = enabledTools.find((tool) => tool.name === `${PLUGIN_NAME}_policy_gate`);
    assert(inspectTool, 'missing inspect tool');
    assert(policyTool, 'missing policy gate tool');

    const inspectText = firstText(await inspectTool.handler({ marker: 'inspect-marker' }, {
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    }));
    assert(inspectText.includes(AGENT_ID), 'read-only plugin tool lost agent context');
    assert(inspectText.includes(SESSION_KEY), 'read-only plugin tool lost session context');
    assert(inspectText.includes('inspect-marker'), 'read-only plugin tool lost input payload');

    const deniedText = firstText(await policyTool.handler({ action: 'write' }, {
      agentId: AGENT_ID,
      sessionKey: 'wrong-session',
    }));
    assert(deniedText.includes('denied'), 'policy-sensitive plugin tool did not reject wrong session');
    const allowedText = firstText(await policyTool.handler({ action: 'write' }, {
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    }));
    assert(allowedText.includes('allowed'), 'policy-sensitive plugin tool did not accept allowed session');

    const hooks = gateway.pluginRegistry.listAllHooks();
    const afterQueryHook = hooks.find((hook) => hook.pluginName === PLUGIN_NAME && hook.event === 'on_after_query');
    assert(afterQueryHook, 'canary plugin hook was not registered');
    const emitter = gateway._hookEmitters.get(AGENT_ID);
    assert(emitter, 'canary agent hook emitter was not created');
    await emitter.emit('on_after_query', {
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
      newMessages: [{ role: 'user', content: 'plugin hook marker' }],
    });
    const hookLog = await readFile(join(pluginDataDir, 'hook.jsonl'), 'utf8');
    assert(hookLog.includes(AGENT_ID) && hookLog.includes(SESSION_KEY), 'plugin hook payload lost agent/session attribution');

    const engineEntry = gateway.pluginRegistry.getContextEngine(AGENT_ID);
    assert(engineEntry?.name === PLUGIN_NAME, 'canary context engine was not selected for agent');
    const assembleResult = await engineEntry.engine.assemble?.({
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
      messages: [{ role: 'user', content: 'assemble input' }],
    });
    assert(Array.isArray(assembleResult?.messages), 'context engine assemble did not return messages');
    assert(JSON.stringify(assembleResult).includes('canary-assembled'), 'context engine assemble did not transform context');
    const compressResult = await engineEntry.engine.compress?.({
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
      messages: [{ role: 'user', content: 'compress input' }],
      currentTokens: 50_000,
    });
    assert(Array.isArray(compressResult?.messages), 'context engine compress did not return messages');
    assert(JSON.stringify(compressResult).includes('canary-compressed'), 'context engine compress did not transform context');

    return {
      gateway: true,
      loadedPlugins: loadedPlugins.length,
      enabledForAgent: true,
      disabledAgentTools: disabledTools.length,
      toolNames,
      readOnlyTool: true,
      policyTool: true,
      hooks: hooks.length,
      contextEngine: engineEntry.name,
      assembleMessages: assembleResult.messages.length,
      compressMessages: compressResult.messages.length,
      sessionAttribution: true,
    };
  } finally {
    await gateway.stop();
    if (pluginLoaded) {
      assert(existsSync(join(pluginDataDir, 'shutdown.log')), 'plugin shutdown did not run');
    }
  }
}

async function runPluginSubagentCanary(input: {
  model: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  let seenInput: HeadlessRunInput | undefined;
  const runtime: HeadlessRuntime = {
    id: 'pi-canary-headless',
    async runText(runInput) {
      seenInput = runInput;
      return 'plugin subagent canary result';
    },
  };

  const result = await runSubagent({
    prompt: 'Summarize plugin canary state.',
    systemPrompt: 'Return a compact canary summary.',
    model: input.model,
    timeoutMs: input.timeoutMs,
    runtime,
  });

  assert(result === 'plugin subagent canary result', 'plugin subagent runner returned unexpected text');
  assert(seenInput?.purpose === 'runSubagent', 'plugin subagent runner did not tag purpose');
  assert(seenInput?.toolDenyMessage === 'Tools disabled in plugin subagent.', 'plugin subagent runner did not request tool denial');
  assert(!seenInput?.customTools?.length, 'plugin subagent runner received custom tools');
  assert(seenInput?.model === input.model, 'plugin subagent runner lost model selection');
  return {
    runtime: runtime.id,
    purpose: seenInput.purpose,
    toolsDisabled: true,
    model: seenInput.model,
  };
}

async function writeCanaryAgent(agentsDir: string, agentId: string, pluginEnabled: boolean): Promise<void> {
  const agentDir = join(agentsDir, agentId);
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'CLAUDE.md'), `# ${agentId}\n`, 'utf8');
  const channel = pluginEnabled ? 'telegram' : 'whatsapp';
  await writeFile(join(agentDir, 'agent.yml'), [
    'safety_profile: trusted',
    'routes:',
    `  - channel: ${channel}`,
    '    scope: dm',
    'runtime:',
    '  headless:',
    '    provider: pi',
    'plugins:',
    `  ${PLUGIN_NAME}:`,
    `    enabled: ${pluginEnabled ? 'true' : 'false'}`,
  ].join('\n') + '\n', 'utf8');
}

async function writeCanaryPlugin(pluginsDir: string, dataDir: string): Promise<void> {
  const pluginDir = join(pluginsDir, PLUGIN_NAME);
  const manifestDir = join(pluginDir, '.claude-plugin');
  await mkdir(manifestDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(manifestDir, 'plugin.json'), JSON.stringify({
    name: PLUGIN_NAME,
    version: '0.0.1',
    description: 'Runtime migration canary plugin.',
    entry: 'index.mjs',
  }, null, 2), 'utf8');
  await writeFile(join(pluginDir, 'index.mjs'), pluginSource(), 'utf8');
}

function pluginSource(): string {
  return `
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(${JSON.stringify(join(process.cwd(), 'package.json'))});
const { z } = require('zod');
const agentId = ${JSON.stringify(AGENT_ID)};
const sessionKey = ${JSON.stringify(SESSION_KEY)};

export async function register(ctx) {
  ctx.registerMcpTool({
    name: 'inspect',
    description: 'Read-only plugin context inspection canary.',
    inputSchema: z.object({ marker: z.string().optional() }),
    handler: async (input, toolCtx) => ({
      content: [{ type: 'text', text: JSON.stringify({
        marker: input.marker,
        agentId: toolCtx.agentId,
        sessionKey: toolCtx.sessionKey ?? null,
      }) }],
    }),
  });

  ctx.registerMcpTool({
    name: 'policy_gate',
    description: 'Policy-sensitive plugin tool context canary.',
    inputSchema: z.object({ action: z.string() }),
    handler: async (_input, toolCtx) => {
      const allowed = toolCtx.agentId === agentId && toolCtx.sessionKey === sessionKey;
      return { content: [{ type: 'text', text: allowed ? 'allowed' : 'denied' }] };
    },
  });

  ctx.registerHook('on_after_query', async (payload) => {
    appendFileSync(join(ctx.dataDir, 'hook.jsonl'), JSON.stringify({
      agentId: payload.agentId,
      sessionKey: payload.sessionKey,
      messages: Array.isArray(payload.newMessages) ? payload.newMessages.length : 0,
    }) + '\\n');
  });

  ctx.registerContextEngine({
    assemble: async (input) => ({
      messages: [
        ...input.messages,
        { role: 'system', content: 'canary-assembled:' + input.agentId + ':' + input.sessionKey },
      ],
    }),
    compress: async (input) => ({
      messages: [
        { role: 'system', content: 'canary-compressed:' + input.agentId + ':' + input.sessionKey + ':' + input.messages.length },
      ],
    }),
  });

  return {
    shutdown() {
      appendFileSync(join(ctx.dataDir, 'shutdown.log'), 'shutdown\\n');
    },
  };
}
`.trimStart();
}

function firstText(result: { content: Array<{ type: 'text'; text: string }> }): string {
  return result.content[0]?.text ?? '';
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
  result: PiPluginsContextCanaryResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }
  stream.write([
    `Pi plugins/context canary ${result.status}.`,
    `durationMs: ${result.durationMs}`,
    `scenario: ${result.scenario}`,
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
    'Usage: pnpm smoke:pi-plugins-context -- [--json] [--keep-workspace]',
    '',
    'Runs the scripted Pi runtime v1 plugin/context canary.',
    '',
    'Options:',
    '  --json                print structured result',
    '  --keep-workspace      keep temporary canary workspace for inspection',
    '  --gateway             accepted for pi-v1-canary compatibility',
    '  --allow-skip          exit 0 for skippable optional runtime/auth errors',
    `  --model <model>       model recorded for plugin subagent runner (default: ${DEFAULT_PI_MODEL_ID})`,
    '  --auth-path <path>    optional Pi auth.json path recorded in Gateway config',
    '  --models-path <path>  optional Pi models.json path recorded in Gateway config',
    '  --timeout-ms <ms>     positive integer timeout for plugin subagent runner',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiPluginsContextCanaryCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
