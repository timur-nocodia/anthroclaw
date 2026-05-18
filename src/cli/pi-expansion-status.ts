import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditPiExpansionReadiness } from './pi-expansion-audit.js';
import { redactSecrets } from '../security/redact.js';

type ExpansionState =
  | 'blocked'
  | 'packet_missing'
  | 'pending_live_evidence'
  | 'evidence_open'
  | 'ready_for_execution'
  | 'operator_review'
  | 'closed'
  | 'no_packet_required';

interface PiExpansionStatusArgs {
  agentsDir: string;
  agentsDirs: string[];
  packetsDir: string;
  agent?: string;
  failOnOpen: boolean;
  json: boolean;
  help: boolean;
}

interface PiExpansionStatusDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PacketSummary {
  present: boolean;
  path?: string;
  status?: string;
  uncheckedItems: number;
}

interface AgentExpansionStatus {
  id: string;
  risk: string;
  recommendedRing: string;
  agentsDir: string;
  packet: PacketSummary;
  state: ExpansionState;
  blockers: string[];
  nextActions: string[];
}

interface PiExpansionStatus {
  status: 'passed' | 'attention';
  agentsDirs: string[];
  packetsDir: string;
  summary: {
    totalAgents: number;
    highOrCriticalAgents: number;
    closedAgents: number;
    openAgents: number;
    packetMissing: number;
    blockedAgents: number;
  };
  agents: AgentExpansionStatus[];
  gaps: {
    packetCoverageGap: boolean;
    missingPackets: string[];
    auditErrors: Array<{ agentId: string; error: string }>;
    skippedDirectories: Array<{ agentsDir: string; name: string; reason: string }>;
  };
}

export async function runPiExpansionStatusCli(
  argv: string[],
  deps: PiExpansionStatusDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiExpansionStatusArgs;

  try {
    args = parsePiExpansionStatusArgs(argv);
  } catch (err) {
    stderr.write(`${message(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const result = buildPiExpansionStatus(args);
    stdout.write(args.json ? `${JSON.stringify(result)}\n` : renderHuman(result));
    return args.failOnOpen && result.status === 'attention' ? 1 : 0;
  } catch (err) {
    stderr.write(`${redactSecrets(message(err))}\n`);
    return 1;
  }
}

export function parsePiExpansionStatusArgs(argv: string[]): PiExpansionStatusArgs {
  const args: PiExpansionStatusArgs = {
    agentsDir: resolve(process.env.OC_AGENTS_DIR ?? 'agents'),
    agentsDirs: [],
    packetsDir: resolve('research/pi-expansion-packets'),
    failOnOpen: false,
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
        args.agentsDirs.push(requireValue(argv, ++i, '--agents-dir'));
        break;
      case '--packets-dir':
        args.packetsDir = requireValue(argv, ++i, '--packets-dir');
        break;
      case '--agent':
        args.agent = requireValue(argv, ++i, '--agent');
        break;
      case '--fail-on-open':
        args.failOnOpen = true;
        break;
      case '--json':
        args.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.agentsDirs.length === 0) {
    args.agentsDirs.push(args.agentsDir);
  } else {
    args.agentsDir = args.agentsDirs[0] ?? args.agentsDir;
  }

  args.packetsDir = resolve(args.packetsDir);
  return args;
}

export function buildPiExpansionStatus(input: {
  agentsDir: string;
  agentsDirs?: string[];
  packetsDir: string;
  agent?: string;
}): PiExpansionStatus {
  const agentsDirs = input.agentsDirs ?? [input.agentsDir];
  const audit = auditPiExpansionReadiness({
    agentsDir: input.agentsDir,
    agentsDirs,
    agent: input.agent,
    requirePacketsDir: input.packetsDir,
  });
  const packetsDir = resolve(input.packetsDir);
  const agents = audit.agents.map((agent) => {
    const packet = readPacketSummary(packetsDir, agent.id);
    const state = classifyState({
      packet,
      isPacketRequired: agent.risk === 'high' || agent.risk === 'critical',
      hasAuditError: audit.errors.some((err) => err.agentId === agent.id),
    });
    return {
      id: agent.id,
      risk: agent.risk,
      recommendedRing: agent.recommendedRing,
      agentsDir: agent.agentsDir,
      packet,
      state,
      blockers: agent.blockers,
      nextActions: buildNextActions({
        agentId: agent.id,
        agentsDirs: audit.agentsDirs,
        packetsDir,
        packet,
        state,
        evidencePlan: agent.evidencePlan,
      }),
    };
  });

  const openAgents = agents.filter((agent) => agent.state !== 'closed' && agent.state !== 'no_packet_required');
  const blockedAgents = agents.filter((agent) => agent.state === 'blocked');

  return {
    status: audit.coverageGap || audit.packetCoverageGap || audit.errors.length > 0 || openAgents.length > 0
      ? 'attention'
      : 'passed',
    agentsDirs: audit.agentsDirs,
    packetsDir,
    summary: {
      totalAgents: agents.length,
      highOrCriticalAgents: agents.filter((agent) => agent.risk === 'high' || agent.risk === 'critical').length,
      closedAgents: agents.filter((agent) => agent.state === 'closed').length,
      openAgents: openAgents.length,
      packetMissing: agents.filter((agent) => agent.state === 'packet_missing').length,
      blockedAgents: blockedAgents.length,
    },
    agents,
    gaps: {
      packetCoverageGap: audit.packetCoverageGap,
      missingPackets: audit.packetCoverage?.missing ?? [],
      auditErrors: audit.errors,
      skippedDirectories: audit.skippedDirectories,
    },
  };
}

function readPacketSummary(packetsDir: string, agentId: string): PacketSummary {
  const path = resolve(packetsDir, `${agentId}.md`);
  if (!existsSync(path)) return { present: false, uncheckedItems: 0 };
  const body = readFileSync(path, 'utf8');
  return {
    present: true,
    path,
    status: parsePacketStatus(body),
    uncheckedItems: (body.match(/^- \[ \]/gm) ?? []).length,
  };
}

function parsePacketStatus(body: string): string | undefined {
  const match = body.match(/^Status:\s*(.+)$/m);
  return match ? match[1].trim() : undefined;
}

function classifyState(input: {
  packet: PacketSummary;
  isPacketRequired: boolean;
  hasAuditError: boolean;
}): ExpansionState {
  if (input.hasAuditError) return 'blocked';
  if (!input.packet.present) return input.isPacketRequired ? 'packet_missing' : 'no_packet_required';
  if (input.packet.uncheckedItems > 0) return 'evidence_open';

  const status = (input.packet.status ?? '').toLowerCase();
  if (status.includes('pending') || status.includes('pre-live')) return 'pending_live_evidence';
  if (status.includes('ready_for_execution')) return 'ready_for_execution';
  if (status.includes('closed') || status.includes('passed')) return 'closed';
  return 'operator_review';
}

function buildNextActions(input: {
  agentId: string;
  agentsDirs: string[];
  packetsDir: string;
  packet: PacketSummary;
  state: ExpansionState;
  evidencePlan: Array<{ check: string; mode: 'automated' | 'manual'; command?: string }>;
}): string[] {
  if (input.state === 'closed' || input.state === 'no_packet_required') {
    return ['Keep runtime:pi-monitor as the repeatable health check before and after future expansion.'];
  }
  if (input.state === 'packet_missing') {
    return [
      `Create packet: pnpm runtime:pi-expansion-packet -- ${input.agentsDirs.map((dir) => `--agents-dir ${shellQuote(dir)}`).join(' ')} --agent ${shellQuote(input.agentId)} --output ${shellQuote(resolve(input.packetsDir, `${input.agentId}.md`))}`,
    ];
  }

  const actions = input.evidencePlan.map((entry) => (
    entry.command
      ? `Run ${entry.check}: ${entry.command}`
      : `Close manual evidence: ${entry.check}`
  ));
  if (input.state === 'ready_for_execution' || input.state === 'operator_review' || input.state === 'pending_live_evidence') {
    actions.push('Record explicit operator go/no-go before any live side effect.');
  }
  if (input.packet.uncheckedItems > 0) {
    actions.push(`Resolve ${input.packet.uncheckedItems} unchecked packet item(s).`);
  }
  return [...new Set(actions)];
}

function renderHuman(result: PiExpansionStatus): string {
  const lines = [
    `Pi expansion status ${result.status}.`,
    `agentsDirs: ${result.agentsDirs.join(', ')}`,
    `packetsDir: ${result.packetsDir}`,
    `summary: total=${result.summary.totalAgents}, highOrCritical=${result.summary.highOrCriticalAgents}, closed=${result.summary.closedAgents}, open=${result.summary.openAgents}, packetMissing=${result.summary.packetMissing}`,
    '',
    ...result.agents.map((agent) => [
      `${agent.id}: ${agent.state} (${agent.risk}/${agent.recommendedRing})`,
      `  packet: ${agent.packet.present ? agent.packet.status ?? 'present' : 'missing'}`,
      `  blockers: ${agent.blockers.join('; ') || 'none'}`,
      `  next: ${agent.nextActions.join(' | ')}`,
    ].join('\n')),
  ];
  if (result.gaps.auditErrors.length > 0) {
    lines.push('', 'Audit errors:', ...result.gaps.auditErrors.map((err) => `${err.agentId}: ${err.error}`));
  }
  if (result.gaps.missingPackets.length > 0) {
    lines.push('', `Missing packets: ${result.gaps.missingPackets.join(', ')}`);
  }
  if (result.gaps.skippedDirectories.length > 0) {
    lines.push('', 'Skipped directories:', ...result.gaps.skippedDirectories.map((entry) => `${entry.name}: ${entry.reason}`));
  }
  return `${lines.join('\n')}\n`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-expansion-status -- [--agents-dir <path>...] [--packets-dir <path>] [--agent <id>] [--json] [--fail-on-open]',
    '',
    'Summarizes post-default Pi fleet expansion state from runtime:pi-expansion-audit and expansion packets.',
    '',
    'Options:',
    '  --agents-dir <path>  agents directory to scan; repeatable',
    '  --packets-dir <path> packet directory (default: research/pi-expansion-packets)',
    '  --agent <id>         summarize only one agent id',
    '  --fail-on-open       exit 1 when any packet/evidence state is still open',
    '  --json               print structured result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiExpansionStatusCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
