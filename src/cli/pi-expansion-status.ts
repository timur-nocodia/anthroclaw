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

type OpenEvidenceKind =
  | 'operatorApproval'
  | 'postExpansionMonitor'
  | 'liveAction'
  | 'automated'
  | 'manual';

const OPEN_EVIDENCE_KINDS: OpenEvidenceKind[] = [
  'operatorApproval',
  'postExpansionMonitor',
  'liveAction',
  'automated',
  'manual',
];

interface PiExpansionStatusArgs {
  agentsDir: string;
  agentsDirs: string[];
  packetsDir: string;
  agent?: string;
  failOnOpen: boolean;
  allowedOpenKinds: OpenEvidenceKind[];
  openOnly: boolean;
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
  checkedItems: number;
  uncheckedItems: number;
  totalItems: number;
  uncheckedLabels: string[];
  uncheckedByKind: Record<OpenEvidenceKind, number>;
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
    closedEvidenceItems: number;
    openEvidenceItems: number;
    totalEvidenceItems: number;
    evidenceProgressPercent: number;
    openEvidenceByKind: Record<OpenEvidenceKind, number>;
  };
  agents: AgentExpansionStatus[];
  gaps: {
    packetCoverageGap: boolean;
    missingPackets: string[];
    auditErrors: Array<{ agentId: string; error: string }>;
    skippedDirectories: Array<{ agentsDir: string; name: string; reason: string }>;
  };
}

interface PiExpansionStatusPolicy {
  failOnOpen: boolean;
  allowedOpenKinds: OpenEvidenceKind[];
  exitCode: 0 | 1;
  passed: boolean;
  reason: string;
  disallowedOpenEvidenceByKind: Record<OpenEvidenceKind, number>;
  violations: PiExpansionStatusPolicyViolation[];
}

interface PiExpansionStatusPolicyViolation {
  agentId?: string;
  kind: OpenEvidenceKind | 'auditError' | 'blocked' | 'packetMissing' | 'packetCoverageGap' | 'openState';
  label: string;
  path?: string;
}

type PiExpansionStatusCliOutput = PiExpansionStatus & {
  policy: PiExpansionStatusPolicy;
};

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
    const policy = evaluatePiExpansionStatusPolicy(result, args);
    const output = withPolicy(result, policy);
    const renderedResult = args.openOnly ? filterOpenAgents(output) : output;
    stdout.write(args.json ? `${JSON.stringify(renderedResult)}\n` : renderHuman(renderedResult));
    return policy.exitCode;
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
    allowedOpenKinds: [],
    openOnly: false,
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
      case '--allow-open-kind':
        args.allowedOpenKinds.push(parseOpenEvidenceKind(requireValue(argv, ++i, '--allow-open-kind')));
        break;
      case '--open-only':
        args.openOnly = true;
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

function parseOpenEvidenceKind(value: string): OpenEvidenceKind {
  if (isOpenEvidenceKind(value)) return value;
  throw new Error(`Unknown open evidence kind: ${value}. Expected one of: ${OPEN_EVIDENCE_KINDS.join(', ')}`);
}

function isOpenEvidenceKind(value: string): value is OpenEvidenceKind {
  return (OPEN_EVIDENCE_KINDS as string[]).includes(value);
}

function evaluatePiExpansionStatusPolicy(
  result: PiExpansionStatus,
  args: Pick<PiExpansionStatusArgs, 'failOnOpen' | 'allowedOpenKinds'>,
): PiExpansionStatusPolicy {
  const allowedKinds = new Set(args.allowedOpenKinds);
  const base = {
    failOnOpen: args.failOnOpen,
    allowedOpenKinds: [...args.allowedOpenKinds],
    disallowedOpenEvidenceByKind: emptyOpenEvidenceBreakdown(),
    violations: [] as PiExpansionStatusPolicyViolation[],
  };

  if (!args.failOnOpen) return {
    ...base,
    exitCode: 0,
    passed: true,
    reason: 'fail-on-open disabled',
  };

  if (result.status !== 'attention') return {
    ...base,
    exitCode: 0,
    passed: true,
    reason: 'expansion status passed',
  };

  if (args.allowedOpenKinds.length === 0) return {
    ...base,
    exitCode: 1,
    passed: false,
    reason: 'open expansion work remains',
    violations: collectPolicyViolations(result),
  };

  const disallowedOpenEvidenceByKind = OPEN_EVIDENCE_KINDS.reduce((totals, kind) => {
    totals[kind] = allowedKinds.has(kind) ? 0 : result.summary.openEvidenceByKind[kind];
    return totals;
  }, emptyOpenEvidenceBreakdown());
  const disallowedOpenEvidence = OPEN_EVIDENCE_KINDS.some((kind) => disallowedOpenEvidenceByKind[kind] > 0);
  if (disallowedOpenEvidence) return {
    ...base,
    disallowedOpenEvidenceByKind,
    exitCode: 1,
    passed: false,
    reason: 'disallowed open evidence kinds remain',
    violations: collectPolicyViolations(result, allowedKinds),
  };

  const openEvidenceItems = result.summary.openEvidenceItems;
  const openEvidenceOnly = (
    result.gaps.auditErrors.length === 0
    && !result.gaps.packetCoverageGap
    && result.gaps.missingPackets.length === 0
    && result.summary.packetMissing === 0
    && result.summary.blockedAgents === 0
    && result.summary.openAgents > 0
    && openEvidenceItems > 0
    && result.agents.every((agent) => (
      agent.state === 'closed'
      || agent.state === 'no_packet_required'
      || (agent.state === 'evidence_open' && agent.packet.uncheckedItems > 0)
    ))
  );

  if (!openEvidenceOnly) return {
    ...base,
    exitCode: 1,
    passed: false,
    reason: 'non-evidence expansion blockers remain',
    violations: collectPolicyViolations(result, allowedKinds),
  };

  return {
    ...base,
    exitCode: 0,
    passed: true,
    reason: 'only allowed open evidence kinds remain',
  };
}

function collectPolicyViolations(
  result: PiExpansionStatus,
  allowedKinds?: Set<OpenEvidenceKind>,
): PiExpansionStatusPolicyViolation[] {
  const violations: PiExpansionStatusPolicyViolation[] = [];
  for (const agent of result.agents) {
    for (const label of agent.packet.uncheckedLabels) {
      const kind = classifyOpenEvidenceLabel(label);
      if (!allowedKinds?.has(kind)) {
        violations.push({
          agentId: agent.id,
          kind,
          label,
          path: agent.packet.path,
        });
      }
    }

    if (agent.state === 'packet_missing') {
      violations.push({
        agentId: agent.id,
        kind: 'packetMissing',
        label: 'expansion packet is missing',
      });
    } else if (agent.state === 'blocked') {
      violations.push({
        agentId: agent.id,
        kind: 'blocked',
        label: agent.blockers.join('; ') || 'audit error blocks expansion',
        path: agent.packet.path,
      });
    } else if (
      agent.state !== 'closed'
      && agent.state !== 'no_packet_required'
      && agent.state !== 'evidence_open'
    ) {
      violations.push({
        agentId: agent.id,
        kind: 'openState',
        label: `agent expansion state is ${agent.state}`,
        path: agent.packet.path,
      });
    }
  }

  for (const err of result.gaps.auditErrors) {
    violations.push({
      agentId: err.agentId,
      kind: 'auditError',
      label: err.error,
    });
  }

  for (const agentId of result.gaps.missingPackets) {
    if (!violations.some((violation) => violation.kind === 'packetMissing' && violation.agentId === agentId)) {
      violations.push({
        agentId,
        kind: 'packetCoverageGap',
        label: 'required expansion packet is missing from packet coverage',
      });
    }
  }

  return violations;
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
  const totalEvidenceItems = agents.reduce((total, agent) => total + agent.packet.totalItems, 0);
  const closedEvidenceItems = agents.reduce((total, agent) => total + agent.packet.checkedItems, 0);
  const openEvidenceByKind = agents.reduce(
    (totals, agent) => addOpenEvidenceBreakdown(totals, agent.packet.uncheckedByKind),
    emptyOpenEvidenceBreakdown(),
  );

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
      closedEvidenceItems,
      openEvidenceItems: totalEvidenceItems - closedEvidenceItems,
      totalEvidenceItems,
      evidenceProgressPercent: totalEvidenceItems === 0
        ? 100
        : Math.round((closedEvidenceItems / totalEvidenceItems) * 100),
      openEvidenceByKind,
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

function withPolicy(result: PiExpansionStatus, policy: PiExpansionStatusPolicy): PiExpansionStatusCliOutput {
  return {
    ...result,
    policy,
  };
}

function filterOpenAgents<T extends PiExpansionStatus>(result: T): T {
  return {
    ...result,
    agents: result.agents.filter((agent) => agent.state !== 'closed' && agent.state !== 'no_packet_required'),
  };
}

function readPacketSummary(packetsDir: string, agentId: string): PacketSummary {
  const path = resolve(packetsDir, `${agentId}.md`);
  if (!existsSync(path)) return {
    present: false,
    checkedItems: 0,
    uncheckedItems: 0,
    totalItems: 0,
    uncheckedLabels: [],
    uncheckedByKind: emptyOpenEvidenceBreakdown(),
  };
  const body = readFileSync(path, 'utf8');
  const uncheckedLabels = parseUncheckedLabels(body);
  const checkedItems = parseCheckedCount(body);
  const uncheckedByKind = uncheckedLabels.reduce((totals, label) => {
    totals[classifyOpenEvidenceLabel(label)] += 1;
    return totals;
  }, emptyOpenEvidenceBreakdown());
  return {
    present: true,
    path,
    status: parsePacketStatus(body),
    checkedItems,
    uncheckedItems: uncheckedLabels.length,
    totalItems: checkedItems + uncheckedLabels.length,
    uncheckedLabels,
    uncheckedByKind,
  };
}

function emptyOpenEvidenceBreakdown(): Record<OpenEvidenceKind, number> {
  return {
    operatorApproval: 0,
    postExpansionMonitor: 0,
    liveAction: 0,
    automated: 0,
    manual: 0,
  };
}

function addOpenEvidenceBreakdown(
  left: Record<OpenEvidenceKind, number>,
  right: Record<OpenEvidenceKind, number>,
): Record<OpenEvidenceKind, number> {
  return {
    operatorApproval: left.operatorApproval + right.operatorApproval,
    postExpansionMonitor: left.postExpansionMonitor + right.postExpansionMonitor,
    liveAction: left.liveAction + right.liveAction,
    automated: left.automated + right.automated,
    manual: left.manual + right.manual,
  };
}

function classifyOpenEvidenceLabel(label: string): OpenEvidenceKind {
  const normalized = label.toLowerCase();
  if (
    normalized.includes('operator go/no-go')
    || normalized.includes('operator approval')
    || normalized.includes('approved by operator')
  ) return 'operatorApproval';
  if (
    normalized.includes('post-expansion monitor')
    || normalized.includes('monitor after expansion')
    || normalized.includes('runtime:pi-monitor after expansion')
  ) return 'postExpansionMonitor';
  if (
    normalized.includes('controlled live')
    || normalized.includes('live group')
    || normalized.includes('live turn')
  ) return 'liveAction';
  if (
    normalized.includes('pnpm ')
    || normalized.includes('runtime:')
    || normalized.includes('smoke:')
  ) return 'automated';
  return 'manual';
}

function parsePacketStatus(body: string): string | undefined {
  const match = body.match(/^Status:\s*(.+)$/m);
  return match ? match[1].trim() : undefined;
}

function parseUncheckedLabels(body: string): string[] {
  return [...body.matchAll(/^- \[ \]\s+(.+)$/gm)]
    .map((match) => (match[1] ?? '').trim())
    .filter(Boolean);
}

function parseCheckedCount(body: string): number {
  return (body.match(/^- \[x\]\s+/gmi) ?? []).length;
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
  if (input.packet.uncheckedLabels.length > 0) {
    return input.packet.uncheckedLabels.map((label) => `Resolve packet item: ${label}`);
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

function renderHuman(result: PiExpansionStatus & { policy?: PiExpansionStatusPolicy }): string {
  const lines = [
    `Pi expansion status ${result.status}.`,
    `agentsDirs: ${result.agentsDirs.join(', ')}`,
    `packetsDir: ${result.packetsDir}`,
    `summary: total=${result.summary.totalAgents}, highOrCritical=${result.summary.highOrCriticalAgents}, closed=${result.summary.closedAgents}, open=${result.summary.openAgents}, packetMissing=${result.summary.packetMissing}, evidence=${result.summary.closedEvidenceItems}/${result.summary.totalEvidenceItems} (${result.summary.evidenceProgressPercent}%)`,
    `openEvidenceByKind: operatorApproval=${result.summary.openEvidenceByKind.operatorApproval}, postExpansionMonitor=${result.summary.openEvidenceByKind.postExpansionMonitor}, liveAction=${result.summary.openEvidenceByKind.liveAction}, automated=${result.summary.openEvidenceByKind.automated}, manual=${result.summary.openEvidenceByKind.manual}`,
    ...(result.policy
      ? [`policy: passed=${result.policy.passed}, exitCode=${result.policy.exitCode}, reason=${result.policy.reason}, allowedOpenKinds=${result.policy.allowedOpenKinds.join(',') || 'none'}, violations=${result.policy.violations.length}`]
      : []),
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
  if (result.policy && result.policy.violations.length > 0) {
    lines.push('', 'Policy violations:', ...result.policy.violations.map((violation) => (
      `${violation.agentId ?? 'fleet'}: ${violation.kind}: ${violation.label}`
    )));
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
    'Usage: pnpm runtime:pi-expansion-status -- [--agents-dir <path>...] [--packets-dir <path>] [--agent <id>] [--json] [--open-only] [--fail-on-open] [--allow-open-kind <kind>...]',
    '',
    'Summarizes post-default Pi fleet expansion state from runtime:pi-expansion-audit and expansion packets.',
    '',
    'Options:',
    '  --agents-dir <path>  agents directory to scan; repeatable',
    '  --packets-dir <path> packet directory (default: research/pi-expansion-packets)',
    '  --agent <id>         summarize only one agent id',
    '  --open-only          print only agents with open packet/evidence work; summary still covers the full scan',
    '  --fail-on-open       exit 1 when any packet/evidence state is still open',
    `  --allow-open-kind <kind> with --fail-on-open, exit 0 when the only open work is in allowed kinds (${OPEN_EVIDENCE_KINDS.join(', ')}); repeatable`,
    '  --json               print structured result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiExpansionStatusCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
