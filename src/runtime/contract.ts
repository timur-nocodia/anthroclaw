export type RuntimeContractStatus = 'pass' | 'partial' | 'fail' | 'not-applicable';

export type RuntimeContractCandidateId = 'claude-agent-sdk' | 'pi' | 'opencode';

export type RuntimeContractScenarioId =
  | 'headless_text_response'
  | 'session_continuation'
  | 'runtime_event_stream'
  | 'interrupt_active_run'
  | 'timeout_abort'
  | 'checkpoint_rewind'
  | 'tool_policy_denial'
  | 'custom_tool_execution'
  | 'external_mcp_proxy'
  | 'gateway_active_run_control';

export interface RuntimeContractScenario {
  id: RuntimeContractScenarioId;
  category: 'headless' | 'streaming' | 'control' | 'tools' | 'gateway';
  requirement: string;
  acceptance: string;
  productionRequired: boolean;
}

export interface RuntimeContractCandidateStatus {
  candidate: RuntimeContractCandidateId;
  scenario: RuntimeContractScenarioId;
  status: RuntimeContractStatus;
  evidence: string;
  notes?: string;
}

export interface RuntimeContractProgress {
  candidate: RuntimeContractCandidateId;
  total: number;
  pass: number;
  partial: number;
  fail: number;
  notApplicable: number;
  requiredBlockingGaps: number;
  scorePercent: number;
}

export const RUNTIME_CONTRACT_SCENARIOS: RuntimeContractScenario[] = [
  {
    id: 'headless_text_response',
    category: 'headless',
    requirement: 'Run a non-interactive prompt and return non-empty assistant text.',
    acceptance: 'HeadlessRuntime.run() returns text and, when the provider exposes it, a session id.',
    productionRequired: true,
  },
  {
    id: 'session_continuation',
    category: 'headless',
    requirement: 'Continue an existing conversation through the AnthroClaw session id field.',
    acceptance: 'HeadlessRunInput.sessionId reaches the provider without forcing a new provider session.',
    productionRequired: true,
  },
  {
    id: 'runtime_event_stream',
    category: 'streaming',
    requirement: 'Expose provider output as normalized RuntimeEvent values.',
    acceptance: 'RuntimeRunHandle async iteration emits AnthroClaw event types with runtime, runId, timestamp, and session context.',
    productionRequired: true,
  },
  {
    id: 'interrupt_active_run',
    category: 'control',
    requirement: 'Interrupt an active provider run through the shared runtime handle contract.',
    acceptance: 'RuntimeRunHandle.interrupt() reaches the provider abort primitive and closes provider resources.',
    productionRequired: true,
  },
  {
    id: 'timeout_abort',
    category: 'control',
    requirement: 'Abort hung headless runs instead of leaking provider work.',
    acceptance: 'Configured timeout rejects the run and calls the provider abort primitive when available.',
    productionRequired: true,
  },
  {
    id: 'checkpoint_rewind',
    category: 'control',
    requirement: 'Handle file rewind requests without corrupting AnthroClaw session/control aliases.',
    acceptance: 'A runtime either rewinds files through a provider primitive or returns an explicit unsupported-runtime result.',
    productionRequired: true,
  },
  {
    id: 'tool_policy_denial',
    category: 'tools',
    requirement: 'Keep AnthroClaw permission policy authoritative for provider tool calls.',
    acceptance: 'Denied tool calls receive model-visible feedback and do not execute the underlying tool.',
    productionRequired: true,
  },
  {
    id: 'custom_tool_execution',
    category: 'tools',
    requirement: 'Expose AnthroClaw-owned local tools through the candidate harness.',
    acceptance: 'Per-dispatch custom tools are registered with the provider and still pass through AnthroClaw policy.',
    productionRequired: true,
  },
  {
    id: 'external_mcp_proxy',
    category: 'tools',
    requirement: 'Expose configured external MCP tools without giving the provider direct ownership of policy.',
    acceptance: 'External MCP tools are proxied as AnthroClaw-owned custom tools with normalized results and denial behavior.',
    productionRequired: true,
  },
  {
    id: 'gateway_active_run_control',
    category: 'gateway',
    requirement: 'Run web/channel Gateway turns through the same active-run, interrupt, and checkpoint-control registries.',
    acceptance: 'Gateway can register, interrupt, alias, and checkpoint-control a candidate runtime run through RuntimeRunHandle.',
    productionRequired: true,
  },
];

export const RUNTIME_CONTRACT_MATRIX: RuntimeContractCandidateStatus[] = [
  claude('headless_text_response', 'pass', 'Existing Claude Agent SDK headless adapter is the production baseline.'),
  claude('session_continuation', 'pass', 'Existing session plumbing is preserved behind HeadlessRunInput.sessionId.'),
  claude('runtime_event_stream', 'pass', 'Claude SDK events normalize into AnthroClaw RuntimeEvent values.'),
  claude('interrupt_active_run', 'pass', 'Existing active-run control remains backed by Claude SDK abort handling.'),
  claude('timeout_abort', 'pass', 'Headless Claude paths keep timeout and abort safeguards.'),
  claude('checkpoint_rewind', 'pass', 'Existing checkpoint control remains the baseline behavior.'),
  claude('tool_policy_denial', 'pass', 'Existing AnthroClaw permission broker remains authoritative.'),
  claude('custom_tool_execution', 'pass', 'Existing local tools remain available through the Claude-backed Gateway path.'),
  claude('external_mcp_proxy', 'pass', 'Existing external MCP configuration remains available on the Claude-backed path.'),
  claude('gateway_active_run_control', 'pass', 'Production Gateway path remains Claude-backed while the runtime boundary is introduced.'),

  pi('headless_text_response', 'pass', 'PiHeadlessRuntime.run() is covered by injected-session tests.'),
  pi('session_continuation', 'pass', 'PiHeadlessRuntime forwards HeadlessRunInput.sessionId into createAgentSession().'),
  pi('runtime_event_stream', 'pass', 'PiRuntimeRunHandle normalizes AgentSession.subscribe() events into RuntimeEvent.'),
  pi('interrupt_active_run', 'pass', 'PiRuntimeRunHandle.interrupt() calls AgentSession.abort().'),
  pi('timeout_abort', 'pass', 'Pi headless timeout path calls AgentSession.abort(), unsubscribes, and disposes.'),
  pi('checkpoint_rewind', 'pass', 'Pi RuntimeRunHandle rewinds file changes through AnthroClaw-owned workspace snapshots when Gateway supplies an explicit cwd.'),
  pi('tool_policy_denial', 'pass', 'Pi tool policy extension returns model-visible denial feedback.'),
  pi('custom_tool_execution', 'pass', 'Pi customTools bridge registers AnthroClaw tools and rechecks policy before execute.'),
  pi('external_mcp_proxy', 'pass', 'Configured external MCP tools are proxied through AnthroClaw custom tools.'),
  pi('gateway_active_run_control', 'pass', 'Opt-in Pi Gateway path registers runtime handles with active-run/session/checkpoint control.'),

  opencode('headless_text_response', 'pass', 'OpenCodeHeadlessRuntime.run() maps session.prompt results into HeadlessRunResult.'),
  opencode('session_continuation', 'pass', 'OpenCodeHeadlessRuntime skips session.create when HeadlessRunInput.sessionId is provided.'),
  opencode('runtime_event_stream', 'pass', 'OpenCodeRuntimeRunHandle emits minimal text.delta and run.completed events.'),
  opencode('interrupt_active_run', 'pass', 'OpenCodeRuntimeRunHandle.interrupt() calls session.abort().'),
  opencode('timeout_abort', 'pass', 'OpenCode headless timeout path calls session.abort().'),
  opencode('checkpoint_rewind', 'pass', 'OpenCodeRuntimeRunHandle maps rewindFiles() to session.revert() when available.'),
  opencode('tool_policy_denial', 'fail', 'OpenCode adapter does not yet route provider tools through AnthroClaw policy.'),
  opencode('custom_tool_execution', 'fail', 'OpenCode adapter does not yet expose AnthroClaw custom tools.'),
  opencode('external_mcp_proxy', 'fail', 'OpenCode adapter does not yet proxy configured external MCP tools.'),
  opencode('gateway_active_run_control', 'fail', 'OpenCode is currently a headless benchmark adapter, not a Gateway runtime path.'),
];

export function listRuntimeContractScenarios(): RuntimeContractScenario[] {
  return [...RUNTIME_CONTRACT_SCENARIOS];
}

export function listRuntimeContractMatrix(candidate?: RuntimeContractCandidateId): RuntimeContractCandidateStatus[] {
  return RUNTIME_CONTRACT_MATRIX
    .filter((entry) => candidate === undefined || entry.candidate === candidate)
    .map((entry) => ({ ...entry }));
}

export function runtimeContractProgress(candidate: RuntimeContractCandidateId): RuntimeContractProgress {
  const entries = listRuntimeContractMatrix(candidate);
  const blocking = runtimeContractBlockingGaps(candidate);
  const countedEntries = entries.filter((entry) => entry.status !== 'not-applicable');
  const score = countedEntries.reduce((total, entry) => total + statusWeight(entry.status), 0);
  return {
    candidate,
    total: entries.length,
    pass: countStatus(entries, 'pass'),
    partial: countStatus(entries, 'partial'),
    fail: countStatus(entries, 'fail'),
    notApplicable: countStatus(entries, 'not-applicable'),
    requiredBlockingGaps: blocking.length,
    scorePercent: countedEntries.length === 0
      ? 100
      : Math.round((score / countedEntries.length) * 100),
  };
}

export function runtimeContractBlockingGaps(
  candidate: RuntimeContractCandidateId,
): RuntimeContractCandidateStatus[] {
  const productionRequired = new Set(
    RUNTIME_CONTRACT_SCENARIOS
      .filter((scenario) => scenario.productionRequired)
      .map((scenario) => scenario.id),
  );
  return listRuntimeContractMatrix(candidate)
    .filter((entry) =>
      productionRequired.has(entry.scenario)
      && (entry.status === 'partial' || entry.status === 'fail')
    );
}

function claude(
  scenario: RuntimeContractScenarioId,
  status: RuntimeContractStatus,
  evidence: string,
  notes?: string,
): RuntimeContractCandidateStatus {
  return { candidate: 'claude-agent-sdk', scenario, status, evidence, notes };
}

function pi(
  scenario: RuntimeContractScenarioId,
  status: RuntimeContractStatus,
  evidence: string,
  notes?: string,
): RuntimeContractCandidateStatus {
  return { candidate: 'pi', scenario, status, evidence, notes };
}

function opencode(
  scenario: RuntimeContractScenarioId,
  status: RuntimeContractStatus,
  evidence: string,
  notes?: string,
): RuntimeContractCandidateStatus {
  return { candidate: 'opencode', scenario, status, evidence, notes };
}

function statusWeight(status: RuntimeContractStatus): number {
  if (status === 'pass' || status === 'not-applicable') return 1;
  if (status === 'partial') return 0.5;
  return 0;
}

function countStatus(entries: RuntimeContractCandidateStatus[], status: RuntimeContractStatus): number {
  return entries.filter((entry) => entry.status === status).length;
}
