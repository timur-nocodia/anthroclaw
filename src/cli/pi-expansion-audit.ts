import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAgentYml } from '../config/loader.js';
import type { AgentYml } from '../config/schema.js';
import { redactSecrets } from '../security/redact.js';

type ExpansionRisk = 'low' | 'medium' | 'high' | 'critical';
type RecommendedRing = 'ring2' | 'ring3' | 'ring4';

interface PiExpansionAuditArgs {
  agentsDir: string;
  agent?: string;
  expectAgents: string[];
  maxRisk?: ExpansionRisk;
  json: boolean;
  help: boolean;
}

interface PiExpansionAuditDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface AgentExpansionAudit {
  id: string;
  risk: ExpansionRisk;
  recommendedRing: RecommendedRing;
  safetyProfile?: string;
  runtimeProvider?: string;
  routes: string[];
  tools: string[];
  plugins: string[];
  externalMcpServers: string[];
  cronJobs: number;
  notifications: {
    enabled: boolean;
    routes: number;
    subscriptions: number;
  };
  learningMode?: string;
  blockers: string[];
  requiredChecks: string[];
  notes: string[];
}

interface PiExpansionAuditResult {
  status: 'passed' | 'attention';
  agentsDir: string;
  summary: {
    totalAgents: number;
    byRisk: Record<ExpansionRisk, number>;
    byRecommendedRing: Record<RecommendedRing, number>;
    recommendedNextAgents: string[];
  };
  agents: AgentExpansionAudit[];
  riskBudgetExceeded: boolean;
  coverageGap: boolean;
  expectedAgentsMissing: string[];
  skippedDirectories: Array<{ name: string; reason: string }>;
  errors: Array<{ agentId: string; error: string }>;
}

const RISK_ORDER: ExpansionRisk[] = ['low', 'medium', 'high', 'critical'];
const HIGH_RISK_TOOLS = new Set([
  'send_message',
  'send_media',
  'manage_cron',
  'manage_skills',
  'connect_mcp',
  'buildroom_submit_signal',
  'buildroom_submit_session_summary',
]);

export async function runPiExpansionAuditCli(
  argv: string[],
  deps: PiExpansionAuditDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiExpansionAuditArgs;

  try {
    args = parsePiExpansionAuditArgs(argv);
  } catch (err) {
    stderr.write(`${message(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const result = auditPiExpansionReadiness(args);
    stdout.write(args.json ? `${JSON.stringify(result)}\n` : renderHuman(result));
    return result.riskBudgetExceeded || result.coverageGap ? 1 : 0;
  } catch (err) {
    stderr.write(`${redactSecrets(message(err))}\n`);
    return 1;
  }
}

export function parsePiExpansionAuditArgs(argv: string[]): PiExpansionAuditArgs {
  const args: PiExpansionAuditArgs = {
    agentsDir: resolve(process.env.OC_AGENTS_DIR ?? 'agents'),
    expectAgents: [],
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
        args.agentsDir = requireValue(argv, ++i, '--agents-dir');
        break;
      case '--agent':
        args.agent = requireValue(argv, ++i, '--agent');
        break;
      case '--expect-agent':
        args.expectAgents.push(requireValue(argv, ++i, '--expect-agent'));
        break;
      case '--max-risk':
        args.maxRisk = parseRisk(requireValue(argv, ++i, '--max-risk'));
        break;
      case '--json':
        args.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

export function auditPiExpansionReadiness(input: {
  agentsDir: string;
  agent?: string;
  expectAgents?: string[];
  maxRisk?: ExpansionRisk;
}): PiExpansionAuditResult {
  const agentsDir = resolve(input.agentsDir);
  if (!existsSync(agentsDir)) {
    throw new Error(`agents directory not found: ${agentsDir}`);
  }

  const inventory = discoverAgentInventory(agentsDir, input.agent);
  const agentIds = inventory.agentIds;
  const agents: AgentExpansionAudit[] = [];
  const errors: Array<{ agentId: string; error: string }> = [];

  for (const agentId of agentIds) {
    try {
      const yml = loadAgentYml(resolve(agentsDir, agentId));
      agents.push(classifyAgent(agentId, yml));
    } catch (err) {
      errors.push({ agentId, error: redactSecrets(message(err)) });
    }
  }

  agents.sort((a, b) => riskScore(b.risk) - riskScore(a.risk) || a.id.localeCompare(b.id));
  const riskBudgetExceeded = input.maxRisk
    ? agents.some((agent) => riskScore(agent.risk) > riskScore(input.maxRisk as ExpansionRisk))
    : false;
  const byRisk = countBy(RISK_ORDER, agents.map((agent) => agent.risk));
  const rings: RecommendedRing[] = ['ring2', 'ring3', 'ring4'];
  const byRecommendedRing = countBy(rings, agents.map((agent) => agent.recommendedRing));
  const expectedAgentsMissing = [...new Set(input.expectAgents ?? [])]
    .filter((agentId) => !agentIds.includes(agentId))
    .sort();
  const coverageGap = expectedAgentsMissing.length > 0;

  return {
    status: agents.some((agent) => agent.risk === 'high' || agent.risk === 'critical')
        || errors.length > 0
        || coverageGap
      ? 'attention'
      : 'passed',
    agentsDir,
    summary: {
      totalAgents: agents.length,
      byRisk,
      byRecommendedRing,
      recommendedNextAgents: agents
        .filter((agent) => agent.risk === 'low' && agent.blockers.length === 0)
        .map((agent) => agent.id),
    },
    agents,
    riskBudgetExceeded,
    coverageGap,
    expectedAgentsMissing,
    skippedDirectories: inventory.skippedDirectories,
    errors,
  };
}

function classifyAgent(agentId: string, yml: AgentYml): AgentExpansionAudit {
  const blockers: string[] = [];
  const requiredChecks = new Set<string>([
    'runtime:pi-monitor before and after expansion',
  ]);
  const notes: string[] = [];
  const routes = yml.routes.map((route) => `${route.channel}:${route.scope}`);
  const tools = yml.mcp_tools ?? [];
  const plugins = Object.entries(yml.plugins ?? {})
    .filter(([, config]) => config.enabled !== false)
    .map(([name]) => name)
    .sort();
  const externalMcpServers = Object.keys(yml.external_mcp_servers ?? {}).sort();
  let risk: ExpansionRisk = 'low';
  let recommendedRing: RecommendedRing = 'ring2';

  if (yml.safety_profile === 'public') {
    raise('critical');
    blockers.push('public safety profile');
    requiredChecks.add('public-profile policy canary');
  }

  for (const route of yml.routes) {
    const hasExplicitPeers = (route.peers && route.peers.length > 0)
      || ((yml.allowlist?.[route.channel] ?? []).length > 0);
    if (route.channel === 'whatsapp') {
      raise('critical');
      blockers.push('WhatsApp route');
      requiredChecks.add('customer-facing dry run with no real customer delivery');
    }
    if (route.scope === 'group' || route.scope === 'any') {
      raise('high');
      blockers.push(`${route.channel} ${route.scope} route`);
      requiredChecks.add('allowlisted peer/thread confirmation');
    }
    if (!hasExplicitPeers) {
      raise(route.channel === 'whatsapp' ? 'critical' : 'high');
      blockers.push(`${route.channel} route without explicit peers`);
    }
  }

  if (tools.includes('escalate')) {
    raise(yml.safety_profile === 'public' ? 'critical' : 'medium');
    blockers.push('operator escalation tool');
    requiredChecks.add('smoke:pi-public-escalation');
  }

  const highRiskTools = tools.filter((tool) => HIGH_RISK_TOOLS.has(tool)).sort();
  if (highRiskTools.length > 0) {
    raise('high');
    blockers.push(`high-risk tools: ${highRiskTools.join(', ')}`);
    requiredChecks.add('tool-specific controlled fanout or scheduled-work evidence');
  }

  if (externalMcpServers.length > 0) {
    raise('high');
    blockers.push(`external MCP servers: ${externalMcpServers.length}`);
    requiredChecks.add('smoke:pi-external-mcp');
  }

  const enabledCronJobs = (yml.cron ?? []).filter((job) => job.enabled !== false);
  if (enabledCronJobs.length > 0) {
    raise('high');
    blockers.push(`enabled cron jobs: ${enabledCronJobs.length}`);
    requiredChecks.add('controlled live cron delivery canary');
  }

  const notifications = yml.notifications ?? { enabled: false, routes: {}, subscriptions: [] };
  if (notifications.enabled || notifications.subscriptions.length > 0) {
    raise('high');
    blockers.push('proactive notifications');
    requiredChecks.add('controlled proactive notification canary');
  }

  if (plugins.length > 0) {
    raise('medium');
    requiredChecks.add('smoke:pi-plugins-context');
  }

  if (yml.learning.mode === 'auto_private') {
    raise('high');
    blockers.push('learning auto_private');
    requiredChecks.add('learning approve/apply rollback evidence');
  } else if (yml.learning.enabled && yml.learning.mode === 'propose') {
    requiredChecks.add('learning review remains propose-only or has operator approval evidence');
  }

  if (yml.safety_overrides?.permission_mode === 'bypass') {
    raise('critical');
    blockers.push('permission bypass override');
  }

  if (yml.runtime?.headless?.provider && yml.runtime.headless.provider !== 'pi') {
    notes.push(`per-agent runtime override: ${yml.runtime.headless.provider}`);
  }

  if (riskScore(risk) === riskScore('medium')) recommendedRing = 'ring3';
  if (riskScore(risk) >= riskScore('high')) recommendedRing = 'ring4';

  return {
    id: agentId,
    risk,
    recommendedRing,
    safetyProfile: yml.safety_profile,
    runtimeProvider: yml.runtime?.headless?.provider,
    routes,
    tools: tools.slice().sort(),
    plugins,
    externalMcpServers,
    cronJobs: enabledCronJobs.length,
    notifications: {
      enabled: notifications.enabled,
      routes: Object.keys(notifications.routes).length,
      subscriptions: notifications.subscriptions.length,
    },
    learningMode: yml.learning.mode,
    blockers: [...new Set(blockers)],
    requiredChecks: [...requiredChecks].sort(),
    notes,
  };

  function raise(next: ExpansionRisk): void {
    if (riskScore(next) > riskScore(risk)) risk = next;
  }
}

function discoverAgentInventory(
  agentsDir: string,
  onlyAgent?: string,
): { agentIds: string[]; skippedDirectories: Array<{ name: string; reason: string }> } {
  const agentIds: string[] = [];
  const skippedDirectories: Array<{ name: string; reason: string }> = [];
  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (onlyAgent && entry.name !== onlyAgent) continue;
    if (existsSync(resolve(agentsDir, entry.name, 'agent.yml'))) {
      agentIds.push(entry.name);
    } else {
      skippedDirectories.push({ name: entry.name, reason: 'missing agent.yml' });
    }
  }
  return {
    agentIds: agentIds.sort(),
    skippedDirectories: skippedDirectories.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function renderHuman(result: PiExpansionAuditResult): string {
  const lines = [
    `Pi expansion audit ${result.status}.`,
    `agentsDir: ${result.agentsDir}`,
    `totalAgents: ${result.summary.totalAgents}`,
    `byRisk: ${JSON.stringify(result.summary.byRisk)}`,
    '',
    ...result.agents.map((agent) => [
      `${agent.id}: ${agent.risk} -> ${agent.recommendedRing}`,
      `  routes: ${agent.routes.join(', ') || 'none'}`,
      `  blockers: ${agent.blockers.join('; ') || 'none'}`,
      `  requiredChecks: ${agent.requiredChecks.join('; ')}`,
    ].join('\n')),
  ];
  if (result.errors.length > 0) {
    lines.push('', 'Errors:', ...result.errors.map((err) => `${err.agentId}: ${err.error}`));
  }
  if (result.expectedAgentsMissing.length > 0) {
    lines.push('', `Missing expected agents: ${result.expectedAgentsMissing.join(', ')}`);
  }
  if (result.skippedDirectories.length > 0) {
    lines.push('', 'Skipped directories:', ...result.skippedDirectories.map((entry) => `${entry.name}: ${entry.reason}`));
  }
  return `${lines.join('\n')}\n`;
}

function countBy<T extends string>(keys: readonly T[], values: T[]): Record<T, number> {
  const out = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
  for (const value of values) out[value] += 1;
  return out;
}

function riskScore(risk: ExpansionRisk): number {
  return RISK_ORDER.indexOf(risk);
}

function parseRisk(value: string): ExpansionRisk {
  if ((RISK_ORDER as readonly string[]).includes(value)) return value as ExpansionRisk;
  throw new Error(`--max-risk must be one of: ${RISK_ORDER.join(', ')}`);
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
    'Usage: pnpm runtime:pi-expansion-audit -- [--json] [--agents-dir <path>]',
    '',
    'Audits agent.yml files for post-default Pi production expansion risk.',
    '',
    'Options:',
    '  --agents-dir <path>  agents directory to scan (default: OC_AGENTS_DIR or ./agents)',
    '  --agent <id>         scan only one agent id',
    '  --expect-agent <id>  fail with a coverage gap when an expected agent.yml is absent; repeatable',
    '  --max-risk <risk>    exit 1 when any agent exceeds low|medium|high|critical',
    '  --json               print structured result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiExpansionAuditCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
