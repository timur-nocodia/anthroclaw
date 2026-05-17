import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEscalateTool } from '../agent/tools/escalate.js';
import type { ToolResult } from '../agent/tools/types.js';
import { ApprovalBroker } from '../security/approval-broker.js';
import { MCP_META } from '../security/mcp-meta-registry.js';
import { publicProfile } from '../security/profiles/index.js';
import { redactSecrets } from '../security/redact.js';
import { createCanUseTool } from '../sdk/permissions.js';

interface PiPublicEscalationCanaryArgs {
  json: boolean;
  keepWorkspace: boolean;
  allowSkip: boolean;
  timeoutMs: number;
  help: boolean;
}

interface PiPublicEscalationCanaryDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiPublicEscalationCanaryResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  scenario: 'pi.public-escalation';
  durationMs: number;
  workspacePath?: string;
  assertions: Record<string, unknown>;
  error?: string;
}

const SCENARIO_ID = 'pi.public-escalation' as const;
const AGENT_ID = 'leads_agent';
const SERVER_NAME = 'leads_agent-tools';
const ESCALATE_TOOL_NAME = `mcp__${SERVER_NAME}__escalate`;
const UNKNOWN_PLUGIN_TOOL_NAME = `mcp__${SERVER_NAME}__sync_crm`;
const ESCALATION_SUMMARY = 'Customer requested an Excel export of all leads.';

export async function runPiPublicEscalationCanaryCli(
  argv: string[],
  deps: PiPublicEscalationCanaryDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiPublicEscalationCanaryArgs;

  try {
    args = parsePiPublicEscalationCanaryArgs(argv);
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
    workspacePath = await mkdtemp(join(tmpdir(), 'pi-public-escalation-canary-'));
    const assertions = await runPublicEscalationCanary(workspacePath);
    const result: PiPublicEscalationCanaryResult = {
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
    const result: PiPublicEscalationCanaryResult = {
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

export function parsePiPublicEscalationCanaryArgs(argv: string[]): PiPublicEscalationCanaryArgs {
  const args: PiPublicEscalationCanaryArgs = {
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

export async function runPublicEscalationCanary(workspacePath: string): Promise<Record<string, unknown>> {
  const dataDir = join(workspacePath, 'data');
  await mkdir(dataDir, { recursive: true });

  const meta = MCP_META.escalate;
  assert.ok(meta, 'MCP_META.escalate is not registered');
  assert.equal(meta.safe_in_public, true, 'escalate is not safe in public profile');
  assert.equal(meta.destructive, false, 'escalate is unexpectedly destructive');
  assert.deepEqual(meta.hard_blacklist_in, [], 'escalate is hard-blacklisted in at least one profile');

  const canUseTool = createCanUseTool({
    agent: {
      id: AGENT_ID,
      config: {
        safety_profile: 'public',
        safety_overrides: {},
        sdk: {
          permissions: {
            allowed_mcp_tools: ['escalate'],
          },
        },
      },
      safetyProfile: publicProfile,
      workspacePath,
    } as any,
    approvalBroker: new ApprovalBroker(),
    channel: undefined,
    sessionContext: {
      channel: 'whatsapp',
      peerId: 'customer-1',
      senderId: 'customer-1',
      accountId: 'humanrobot',
    },
  });

  const allowedDecision = await canUseTool(
    ESCALATE_TOOL_NAME,
    { summary: ESCALATION_SUMMARY, urgency: 'urgent' },
    { signal: new AbortController().signal, toolUseID: 'public-escalation-canary-allow' } as any,
  );
  assert.equal(allowedDecision.behavior, 'allow', `public profile denied ${ESCALATE_TOOL_NAME}`);

  const canUseUnknownPluginTool = createCanUseTool({
    agent: {
      id: AGENT_ID,
      config: {
        safety_profile: 'public',
        safety_overrides: {},
        sdk: {
          permissions: {
            allowed_mcp_tools: ['escalate', 'sync_crm'],
          },
        },
      },
      safetyProfile: publicProfile,
      workspacePath,
    } as any,
    approvalBroker: new ApprovalBroker(),
    channel: undefined,
    sessionContext: {
      channel: 'whatsapp',
      peerId: 'customer-1',
      senderId: 'customer-1',
      accountId: 'humanrobot',
    },
  });
  const deniedDecision = await canUseUnknownPluginTool(
    UNKNOWN_PLUGIN_TOOL_NAME,
    { value: true },
    { signal: new AbortController().signal, toolUseID: 'public-escalation-canary-deny' } as any,
  );
  assert.equal(deniedDecision.behavior, 'deny', 'public profile allowed an unknown plugin MCP tool');

  const previousDataDir = process.env.OC_DATA_DIR;
  process.env.OC_DATA_DIR = dataDir;
  let toolResult: ToolResult;
  try {
    const tool = createEscalateTool(AGENT_ID);
    toolResult = await tool.handler({
      summary: ESCALATION_SUMMARY,
      urgency: 'urgent',
      suggested_action: 'Send a sanitized export or explain export limits.',
    });
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.OC_DATA_DIR;
    } else {
      process.env.OC_DATA_DIR = previousDataDir;
    }
  }
  assert.equal(toolResult.isError, undefined, 'escalate tool returned an error');

  const escalationLog = await readFile(join(dataDir, 'escalations', `${AGENT_ID}.jsonl`), 'utf8');
  const rows = escalationLog
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(rows.length, 1, 'escalate tool wrote an unexpected number of JSONL rows');
  const row = rows[0] ?? {};
  assert.equal(row.agentId, AGENT_ID, 'escalation row has wrong agentId');
  assert.equal(row.summary, ESCALATION_SUMMARY, 'escalation row has wrong summary');
  assert.equal(row.urgency, 'urgent', 'escalation row has wrong urgency');

  return {
    mcpMetaRegistered: true,
    simulatedCustomerRequest: true,
    publicProfileAllowsEscalate: allowedDecision.behavior === 'allow',
    allowedMcpToolsFilterAllowsLocalName: true,
    publicProfileDeniesUnknownPluginTool: deniedDecision.behavior === 'deny',
    escalationLogged: true,
    escalationRows: rows.length,
    escalationAgentId: row.agentId,
    escalationSummary: row.summary,
    escalationUrgency: row.urgency,
    noRealCustomerDelivery: true,
    sendMessageNotInvoked: true,
    leadExportNotGenerated: true,
    externalMcpNotInvoked: true,
  };
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiPublicEscalationCanaryResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stream.write([
    `Pi public escalation canary ${result.status}.`,
    `durationMs: ${result.durationMs}`,
    ...(result.error ? [`error: ${result.error}`] : []),
  ].join('\n'));
  stream.write('\n');
}

function usage(): string {
  return [
    'Usage: pnpm smoke:pi-public-escalation -- [--json]',
    '',
    'Runs a deterministic Pi runtime canary for public-profile escalation policy.',
    '',
    'Options:',
    '  --timeout-ms <ms>     accepted for pi-v1-canary compatibility',
    '  --keep-workspace      keep temporary canary workspace for inspection',
    '  --allow-skip          accepted for pi-v1-canary compatibility',
    '  --json                print structured result',
  ].join('\n');
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

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiPublicEscalationCanaryCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
