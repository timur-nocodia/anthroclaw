import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  auditPiExpansionReadiness,
} from './pi-expansion-audit.js';
import { redactSecrets } from '../security/redact.js';

interface PiExpansionPacketArgs {
  agentsDir: string;
  agentsDirs: string[];
  agent?: string;
  owner?: string;
  rollback?: string;
  output?: string;
  json: boolean;
  help: boolean;
}

interface PiExpansionPacketDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiExpansionPacket {
  status: 'ready_for_execution' | 'draft';
  agentId: string;
  agentsDir: string;
  auditRoots: string[];
  risk: string;
  recommendedRing: string;
  owner: string | null;
  rollbackPath: string | null;
  blockers: string[];
  automatedEvidence: Array<{ check: string; command: string }>;
  manualEvidence: string[];
  auditCommand: string;
}

export async function runPiExpansionPacketCli(
  argv: string[],
  deps: PiExpansionPacketDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiExpansionPacketArgs;

  try {
    args = parsePiExpansionPacketArgs(argv);
  } catch (err) {
    stderr.write(`${message(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!args.agent) {
    stderr.write(`--agent is required.\n${usage()}\n`);
    return 2;
  }

  try {
    const packet = buildPiExpansionPacket(args);
    const rendered = args.json ? `${JSON.stringify(packet)}\n` : renderMarkdown(packet);
    if (args.output) {
      mkdirSync(dirname(resolve(args.output)), { recursive: true });
      writeFileSync(args.output, rendered, 'utf8');
    }
    stdout.write(rendered);
    return 0;
  } catch (err) {
    stderr.write(`${redactSecrets(message(err))}\n`);
    return 1;
  }
}

export function parsePiExpansionPacketArgs(argv: string[]): PiExpansionPacketArgs {
  const args: PiExpansionPacketArgs = {
    agentsDir: resolve(process.env.OC_AGENTS_DIR ?? 'agents'),
    agentsDirs: [],
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
      case '--agent':
        args.agent = requireValue(argv, ++i, '--agent');
        break;
      case '--owner':
        args.owner = requireValue(argv, ++i, '--owner');
        break;
      case '--rollback':
        args.rollback = requireValue(argv, ++i, '--rollback');
        break;
      case '--output':
        args.output = requireValue(argv, ++i, '--output');
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

  return args;
}

export function buildPiExpansionPacket(args: PiExpansionPacketArgs): PiExpansionPacket {
  if (!args.agent) throw new Error('--agent is required.');
  const audit = auditPiExpansionReadiness({
    agentsDir: args.agentsDir,
    agentsDirs: args.agentsDirs,
    agent: args.agent,
    expectAgents: [args.agent],
  });
  if (audit.coverageGap) {
    throw new Error(`coverage gap for ${args.agent}; audit every live agents-dir before creating an expansion packet.`);
  }
  if (audit.errors.length > 0) {
    throw new Error(`audit errors for ${args.agent}: ${audit.errors.map((err) => err.error).join('; ')}`);
  }
  const agent = audit.agents.find((entry) => entry.id === args.agent);
  if (!agent) throw new Error(`agent not found after audit: ${args.agent}`);

  const automatedEvidence = agent.evidencePlan
    .filter((entry) => entry.mode === 'automated' && entry.command)
    .map((entry) => ({ check: entry.check, command: entry.command as string }));
  const manualEvidence = agent.evidencePlan
    .filter((entry) => entry.mode === 'manual')
    .map((entry) => entry.check);

  return {
    status: args.owner && args.rollback ? 'ready_for_execution' : 'draft',
    agentId: agent.id,
    agentsDir: agent.agentsDir,
    auditRoots: audit.agentsDirs,
    risk: agent.risk,
    recommendedRing: agent.recommendedRing,
    owner: args.owner ?? null,
    rollbackPath: args.rollback ?? null,
    blockers: agent.blockers,
    automatedEvidence,
    manualEvidence,
    auditCommand: buildAuditCommand(audit.agentsDirs, agent.id),
  };
}

function renderMarkdown(packet: PiExpansionPacket): string {
  return [
    `# Pi Expansion Packet: ${packet.agentId}`,
    '',
    `Status: ${packet.status}`,
    `Owner: ${packet.owner ?? 'TBD'}`,
    `Rollback path: ${packet.rollbackPath ?? 'TBD'}`,
    `Risk: ${packet.risk}`,
    `Recommended ring: ${packet.recommendedRing}`,
    `Agent source: ${packet.agentsDir}`,
    '',
    '## Audit Roots',
    ...packet.auditRoots.map((root) => `- ${root}`),
    '',
    '## Blockers',
    ...(packet.blockers.length > 0 ? packet.blockers.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Automated Evidence',
    ...(packet.automatedEvidence.length > 0
      ? packet.automatedEvidence.map((item) => `- [ ] ${item.check}: \`${item.command}\``)
      : ['- none']),
    '',
    '## Manual Evidence',
    ...(packet.manualEvidence.length > 0
      ? packet.manualEvidence.map((item) => `- [ ] ${item}`)
      : ['- none']),
    '',
    '## Audit Command',
    `\`${packet.auditCommand}\``,
    '',
  ].join('\n');
}

function buildAuditCommand(agentsDirs: string[], agentId: string): string {
  const roots = agentsDirs.map((dir) => `--agents-dir ${shellQuote(dir)}`).join(' ');
  return `pnpm runtime:pi-expansion-audit -- ${roots} --expect-agent ${shellQuote(agentId)} --agent ${shellQuote(agentId)} --json`;
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
    'Usage: pnpm runtime:pi-expansion-packet -- --agent <id> [--agents-dir <path>...] [--owner <name>] [--rollback <path>] [--json] [--output <path>]',
    '',
    'Creates a redacted Pi production-expansion packet from runtime:pi-expansion-audit output.',
    '',
    'Options:',
    '  --agent <id>         agent id to package; required',
    '  --agents-dir <path>  agents directory to scan; repeatable',
    '  --owner <name>       accountable rollout owner',
    '  --rollback <path>    rollback path or runbook reference',
    '  --output <path>      also write the rendered packet to a file',
    '  --json               print structured packet',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiExpansionPacketCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
