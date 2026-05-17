import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPublicEscalationCanary } from './pi-public-escalation-canary.js';
import { redactSecrets } from '../security/redact.js';

interface PiLeadsAgentDryRunArgs {
  json: boolean;
  keepWorkspace: boolean;
  help: boolean;
}

interface PiLeadsAgentDryRunDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiLeadsAgentDryRunResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  scenario: 'pi.leads-agent-safe-dry-run';
  agentId: 'leads_agent';
  durationMs: number;
  workspacePath?: string;
  assertions: Record<string, unknown>;
  error?: string;
}

export async function runPiLeadsAgentDryRunCli(
  argv: string[],
  deps: PiLeadsAgentDryRunDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiLeadsAgentDryRunArgs;

  try {
    args = parsePiLeadsAgentDryRunArgs(argv);
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
    workspacePath = await mkdtemp(join(tmpdir(), 'pi-leads-agent-dry-run-'));
    const assertions = await runPublicEscalationCanary(workspacePath);
    assertDryRunSafety(assertions);
    const result: PiLeadsAgentDryRunResult = {
      status: 'passed',
      runtime: 'pi',
      scenario: 'pi.leads-agent-safe-dry-run',
      agentId: 'leads_agent',
      durationMs: Date.now() - startedAt,
      ...(args.keepWorkspace ? { workspacePath } : {}),
      assertions,
    };
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result: PiLeadsAgentDryRunResult = {
      status: 'failed',
      runtime: 'pi',
      scenario: 'pi.leads-agent-safe-dry-run',
      agentId: 'leads_agent',
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

export function parsePiLeadsAgentDryRunArgs(argv: string[]): PiLeadsAgentDryRunArgs {
  const args: PiLeadsAgentDryRunArgs = {
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

function assertDryRunSafety(assertions: Record<string, unknown>): void {
  const requiredTrue = [
    'simulatedCustomerRequest',
    'publicProfileAllowsEscalate',
    'publicProfileDeniesUnknownPluginTool',
    'escalationLogged',
    'noRealCustomerDelivery',
    'sendMessageNotInvoked',
    'leadExportNotGenerated',
    'externalMcpNotInvoked',
  ];
  for (const key of requiredTrue) {
    if (assertions[key] !== true) {
      throw new Error(`dry-run safety assertion failed: ${key}`);
    }
  }
  if (assertions.escalationAgentId !== 'leads_agent') {
    throw new Error('dry-run escalation was not attributed to leads_agent');
  }
  if (assertions.escalationRows !== 1) {
    throw new Error('dry-run wrote an unexpected escalation row count');
  }
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiLeadsAgentDryRunResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stream.write([
    `Pi leads_agent safe dry run ${result.status}.`,
    `durationMs: ${result.durationMs}`,
    ...(result.error ? [`error: ${result.error}`] : []),
  ].join('\n'));
  stream.write('\n');
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-leads-agent-dry-run -- [--json]',
    '',
    'Runs the deterministic leads_agent customer-facing dry-run without real delivery.',
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
  runPiLeadsAgentDryRunCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
