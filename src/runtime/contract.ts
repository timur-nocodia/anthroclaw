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

export type RuntimeFeatureContractDomain =
  | 'runtime'
  | 'gateway'
  | 'routing_channels'
  | 'tools_permissions'
  | 'sessions_context'
  | 'memory_learning'
  | 'plugins_extensibility'
  | 'dashboard_api'
  | 'observability'
  | 'buildroom'
  | 'config_auth'
  | 'ops_ci';

export interface RuntimeFeatureContract {
  id: string;
  domain: RuntimeFeatureContractDomain;
  surface: string;
  sourceFiles: string[];
  requirement: string;
  acceptance: string;
  evidence: string[];
  runtimeImpact: string;
}

export type RuntimeCanaryScenarioKind =
  | 'smoke'
  | 'scripted_canary'
  | 'manual_operator_check';

export interface RuntimeCanaryScenario {
  id: string;
  kind: RuntimeCanaryScenarioKind;
  title: string;
  objective: string;
  coversFeatureContracts: string[];
  evidenceCommand?: string;
  evidenceArtifact?: string;
  steps: string[];
  blockingForDefaultRuntime: boolean;
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

export const RUNTIME_FEATURE_CONTRACTS: RuntimeFeatureContract[] = [
  feature(
    'runtime.headless-text',
    'runtime',
    'Headless runtime calls',
    ['src/runtime/headless.ts', 'src/runtime/headless-registry.ts', 'src/cli/headless-runtime.ts'],
    'Every non-interactive LLM call must go through HeadlessRuntime selection instead of importing a provider SDK directly.',
    'Title generation, learning review, plugin subagent runs, session recall, and smoke probes can select Claude or Pi through the same input contract.',
    ['src/runtime/__tests__/headless-registry.test.ts', 'src/cli/__tests__/headless-runtime.test.ts'],
    'Any default-runtime replacement must preserve text output, model selection, cwd, timeout, and optional session metadata.',
  ),
  feature(
    'runtime.event-normalization',
    'runtime',
    'RuntimeEvent stream',
    ['src/runtime/events.ts', 'src/runtime/claude-events.ts', 'src/runtime/pi-events.ts'],
    'Provider event streams must normalize before Gateway, UI, metrics, hooks, or plugins consume them.',
    'Normalized events carry runtime, runId, timestamp, session context, text deltas, tool lifecycle, usage, completion, and failure where available.',
    ['src/runtime/__tests__/claude-events.test.ts', 'src/runtime/__tests__/pi-events.test.ts', 'src/runtime/__tests__/runtime-acceptance.test.ts'],
    'No product feature may depend on raw Claude, Pi, or OpenCode event shapes outside the adapter layer.',
  ),
  feature(
    'runtime.run-handle',
    'runtime',
    'RuntimeRunHandle',
    ['src/runtime/types.ts', 'src/runtime/pi-headless.ts', 'src/runtime/opencode-headless.ts'],
    'Interactive Gateway runs must expose a provider-neutral async event iterator plus interrupt, close, and optional rewind controls.',
    'Gateway can consume events, interrupt active work, close subscriptions, and keep checkpoint controls registered through one handle shape.',
    ['src/runtime/__tests__/runtime-acceptance.test.ts', 'src/runtime/__tests__/pi-headless.test.ts', 'src/runtime/__tests__/opencode-headless.test.ts'],
    'Candidate runtimes that cannot provide a run handle cannot become the default Gateway runtime.',
  ),
  feature(
    'runtime.model-auth-storage',
    'runtime',
    'Model and auth resolution',
    ['src/runtime/pi-headless.ts', 'src/cli/pi-auth-smoke.ts', 'src/config/schema.ts'],
    'Runtime model ids and provider auth storage must be explicit, redacted, and stageable through isolated paths.',
    'Pi can resolve legacy Claude model ids, load model/auth storage from global or per-agent config, and report auth readiness without printing secrets.',
    ['src/cli/__tests__/pi-auth-smoke.test.ts', 'test/config/schema.test.ts'],
    'Default-runtime rollout depends on deterministic model resolution and non-leaky auth diagnostics.',
  ),
  feature(
    'gateway.runtime-selection',
    'gateway',
    'Global and per-agent runtime selection',
    ['src/config/schema.ts', 'src/gateway.ts', 'src/sdk/headless-runtime-config.ts'],
    'Runtime selection must merge global and per-agent config while preserving explicit per-agent opt-in and opt-out.',
    'An agent can opt into Pi while the global default remains Claude, and can opt back to Claude when global Pi is later enabled.',
    ['test/config/schema.test.ts', 'test/gateway-sdk-success.test.ts'],
    'Canary rollout is impossible without per-agent runtime selection and predictable merge semantics.',
  ),
  feature(
    'gateway.dispatch-streaming',
    'gateway',
    'Web and channel dispatch loop',
    ['src/gateway.ts', 'ui/app/api/agents/[agentId]/chat/route.ts', 'src/channels/types.ts'],
    'The Gateway dispatch loop must preserve partial text, final text, channel sends, Web UI updates, run completion, failures, and cleanup across runtimes.',
    'Claude and opt-in Pi runs both produce channel/Web responses and update run/session metrics through the Gateway path.',
    ['test/gateway-sdk-success.test.ts', 'test/gateway-web.test.ts', 'src/cli/__tests__/pi-gateway-smoke.test.ts'],
    'A candidate that works only in headless mode is not production-capable.',
  ),
  feature(
    'gateway.active-control',
    'gateway',
    'Active runs, interrupts, and checkpoint control',
    ['src/gateway.ts', 'src/routing/queue-manager.ts', 'ui/app/api/agents/[agentId]/interrupts/route.ts'],
    'Active runs must be discoverable and interruptible by session key, run id, and UI/API surfaces.',
    'Gateway registers active runtime handles, records interrupt events, and exposes active run state through API/UI.',
    ['test/gateway-interrupt.test.ts', 'src/runtime/__tests__/runtime-acceptance.test.ts'],
    'Runtime replacement must keep operator controls working during long or stuck runs.',
  ),
  feature(
    'gateway.shutdown-cleanup',
    'gateway',
    'Gateway shutdown and resource cleanup',
    ['src/gateway.ts', 'src/learning/queue.ts', 'src/routing/queue-manager.ts'],
    'Gateway.stop() must stop queueing, drain or close runtime work, unload plugins, and close stores without post-shutdown writes.',
    'Learning queue drain and Pi prewarm bypass keep real Pi smoke shutdown quiet.',
    ['src/learning/__tests__/queue.test.ts', 'test/gateway-manage-cron-warm.test.ts'],
    'A runtime canary is not acceptable if it leaves sessions, subscriptions, stores, or learning jobs dangling.',
  ),
  feature(
    'routing.session-key',
    'routing_channels',
    'Session key and route decision model',
    ['src/routing/session-key.ts', 'src/gateway.ts', 'src/session/group-isolation.ts'],
    'Product session keys must stay stable across channel, peer, group, thread, sender, and runtime session id mappings.',
    'Routing decisions, group isolation, web aliases, and runtime session ids can be resolved back to user-visible sessions.',
    ['test/routing/session-key.test.ts', 'test/session/group-isolation.test.ts', 'test/gateway-session-mailbox.test.ts'],
    'Provider session ids are implementation details; channel/session behavior must remain AnthroClaw-owned.',
  ),
  feature(
    'routing.channels',
    'routing_channels',
    'Telegram, WhatsApp, Web, webhooks, and synthetic inbound',
    ['src/channels', 'src/webhooks', 'src/gateway.ts', 'src/__tests__/gateway-synthetic-inbound.test.ts'],
    'All inbound transports must route through the same agent/session/policy path and all outbound sends must preserve channel context.',
    'Telegram approvals, WhatsApp human takeover, direct webhooks, Web chat, and synthetic plugin dispatch have focused coverage.',
    ['src/channels/__tests__/telegram-approval.test.ts', 'src/__tests__/gateway-human-takeover.test.ts', 'test/webhooks/gateway-direct.test.ts'],
    'Runtime adapters must receive enough sessionContext to preserve channel-specific approval and send_message semantics.',
  ),
  feature(
    'routing.cron-heartbeat',
    'routing_channels',
    'Cron, heartbeat, and scheduled dispatch',
    ['src/cron', 'src/heartbeat', 'src/gateway.ts', 'src/agent/tools/manage-cron.ts'],
    'Scheduled runs must reuse the same runtime/session/tool policy as live user messages.',
    'Cron delivery, manage_cron, heartbeat runner, and cron session continuity are covered.',
    ['test/cron/delivery-contract.test.ts', 'src/heartbeat/__tests__/runner.test.ts', 'src/__tests__/cron-session-continuity.test.ts'],
    'Default runtime must not create a separate semantics for scheduled agent work.',
  ),
  feature(
    'tools.builtin-tool-policy',
    'tools_permissions',
    'Built-in tool allow/ask/deny policy',
    ['src/sdk/permissions.ts', 'src/security', 'src/agent/tools'],
    'Read, Write, Edit, Bash, WebFetch/Search, and built-in MCP-like tools must remain gated by AnthroClaw policy before execution.',
    'Safety profiles, capability cutoff, protected paths, dangerous Bash, and approval broker decisions are unit/e2e covered.',
    ['src/security/__tests__/approval-broker.test.ts', 'test/gateway-approval-callback.test.ts', 'src/security/__tests__/builtin-tool-meta.test.ts'],
    'Provider-native tools may be used only when their execution can be mediated by AnthroClaw.',
  ),
  feature(
    'tools.dynamic-dispatch-tools',
    'tools_permissions',
    'Per-dispatch AnthroClaw tools',
    ['src/gateway.ts', 'src/agent/tools/send-message.ts', 'src/agent/tools/send-media.ts', 'src/agent/tools/connect-mcp.ts'],
    'Tools that need channel/session context must be rebuilt per dispatch and cannot be static process-global provider tools.',
    'send_message, send_media, manage_cron, connect_mcp, Buildroom handoff, and session summary tools bind current dispatch context.',
    ['src/agent/tools/__tests__/connect-mcp.test.ts', 'src/agent/tools/__tests__/buildroom-handoff.test.ts', 'src/agent/tools/__tests__/send-message-pause-suppress.test.ts'],
    'Runtime adapters must expose a custom-tool bridge that can capture per-run context.',
  ),
  feature(
    'tools.external-mcp-proxy',
    'tools_permissions',
    'External MCP proxy tools',
    ['src/runtime/external-mcp-custom-tools.ts', 'src/sdk/external-mcp.ts', 'src/integrations/mcp-onboarding'],
    'External MCP servers must be proxied through AnthroClaw-owned tools so credential headers, policy, and denial behavior stay local.',
    'MCP discovery/onboarding, OAuth/API-key credential handling, header resolution, and Pi custom-tool proxying have tests.',
    ['src/runtime/__tests__/external-mcp-custom-tools.test.ts', 'src/sdk/__tests__/resolve-external-mcp-headers.test.ts', 'test/integration/mcp-onboarding-oauth.test.ts'],
    'A runtime that directly owns remote MCP loses AnthroClaw security and audit control.',
  ),
  feature(
    'tools.file-ownership',
    'tools_permissions',
    'Subagent file ownership and workspace boundaries',
    ['src/sdk/file-ownership.ts', 'src/sdk/subagent-policy.ts', 'src/gateway.ts'],
    'Cross-agent and subagent file writes must respect workspace boundaries and ownership claims.',
    'Gateway records file ownership events and exposes ownership state to the dashboard/API.',
    ['test/gateway-file-ownership.test.ts', 'test/sdk/subagent-mcp.test.ts'],
    'Runtime replacement must preserve path ownership even if subagents are reimplemented above the provider.',
  ),
  feature(
    'tools.decisions-approvals',
    'tools_permissions',
    'Decision center and human approval lifecycle',
    ['src/decisions', 'src/security/approval-broker.ts', 'ui/app/api/routing/decisions/route.ts'],
    'Human approval requests must be deliverable, resumable, auditable, re-sendable, and sender-authenticated.',
    'Decision store, renderer, callback parsing, gateway wiring, and UI decision APIs are covered.',
    ['src/decisions/__tests__/gateway-wiring.test.ts', 'src/decisions/__tests__/store.test.ts', 'ui/__tests__/api/learning-decisions.test.ts'],
    'Runtime adapters must surface approval requests through AnthroClaw instead of provider-specific UI.',
  ),
  feature(
    'sessions.provider-store',
    'sessions_context',
    'Provider session store and transcript access',
    ['src/sdk/session-store.ts', 'src/sdk/sessions.ts', 'src/session/transcript-index.ts'],
    'Runtime session transcripts, metadata, labels, titles, search, fork/delete/export, and read-only details must remain operator-visible.',
    'SDK session store, session service, session search, export, labels, and title paths are covered.',
    ['test/sdk/session-store.test.ts', 'test/sdk/sessions.test.ts', 'test/session/session-search.test.ts', 'ui/__tests__/lib/export-session.test.ts'],
    'If a candidate cannot expose transcripts, AnthroClaw must mirror them itself before default rollout.',
  ),
  feature(
    'sessions.context-assembly',
    'sessions_context',
    'Context assembly and compaction',
    ['src/gateway.ts', 'src/session/compressor.ts', 'src/plugins/types.ts', 'plugins/lcm/src/engine.ts'],
    'Context engines, legacy compressor, LCM, memory prefetch, and plugin assemble/compress hooks must produce provider-compatible prompt payloads.',
    'Plugin assemble/compress delegation and LCM engine behavior are covered.',
    ['src/plugins/__tests__/assemble-delegation.test.ts', 'src/plugins/__tests__/compressor-delegation.test.ts', 'plugins/lcm/tests/engine.test.ts'],
    'Runtime adapters must accept assembled context without leaking provider-specific message arrays above the adapter layer.',
  ),
  feature(
    'sessions.budget-recall-title',
    'sessions_context',
    'Iteration budget, recall, and title generation',
    ['src/session/budget.ts', 'src/session/title-generator.ts', 'src/agent/tools/session-search.ts'],
    'Budget enforcement, session recall, title generation, and headless summarization must work through the selected runtime.',
    'Budget, title fallback, session search, and recall option tests cover this surface.',
    ['test/session/budget.test.ts', 'test/session/title-generator.test.ts', 'test/agent/tools/session-search.test.ts'],
    'A provider change must not break operator-facing session organization or runaway-turn safeguards.',
  ),
  feature(
    'memory.search-write-review',
    'memory_learning',
    'Memory search, write, review, doctor, and influence',
    ['src/memory', 'src/agent/tools/memory-search.ts', 'src/agent/tools/memory-wiki.ts'],
    'Agent memory must remain searchable, reviewable, redactable, and attributable independent of provider runtime.',
    'Memory store/search/doctor, memory tool, review status, and influence metrics are covered.',
    ['test/memory/store.test.ts', 'test/memory/search.test.ts', 'test/agent/tools/memory-search.test.ts', 'test/gateway-memory-review.test.ts'],
    'Runtime replacement must preserve memory as AnthroClaw data, not provider conversation state.',
  ),
  feature(
    'learning.review-actions',
    'memory_learning',
    'Learning review, actions, artifacts, and decisions',
    ['src/learning', 'src/decisions', 'ui/app/api/agents/[agentId]/learning/route.ts'],
    'Post-run learning must propose/apply memory and skill actions, export redacted artifacts, and expose review decisions to operators.',
    'Learning runner, reviewer parser, store, appliers, artifacts, observability, and UI/API tests cover this flow.',
    ['src/learning/__tests__/runner.test.ts', 'src/learning/__tests__/store.test.ts', 'src/learning/__tests__/artifacts.test.ts', 'ui/__tests__/api/learning-decisions.test.ts'],
    'Runtime adapters must not change learning triggers, artifact redaction, or action approval semantics.',
  ),
  feature(
    'learning.lcm-honcho',
    'memory_learning',
    'LCM and external memory plugins',
    ['plugins/lcm/src', 'plugins/honcho/src', 'ui/app/api/agents/[agentId]/lcm'],
    'Long-context memory and external memory plugins must keep their context-engine, hook mirror, search, status, and dashboard surfaces.',
    'LCM contract/tool/status/dag tests and Honcho context/tool tests cover this surface.',
    ['plugins/lcm/tests/contract.test.ts', 'test/lcm-e2e.test.ts', 'plugins/honcho/tests/context.test.ts'],
    'Runtime replacement must keep hook payloads and session keys stable enough for memory plugins.',
  ),
  feature(
    'plugins.registry-lifecycle',
    'plugins_extensibility',
    'Plugin discovery, registry, lifecycle, and config hot reload',
    ['src/plugins', 'src/gateway.ts', 'ui/app/api/plugins/route.ts'],
    'Plugin manifests, registration, enablement, config schema, hooks, tools, context engines, and shutdown must stay runtime-neutral.',
    'Plugin discovery, registry, loader, e2e, config, and hot-change tests cover this surface.',
    ['src/plugins/__tests__/registry.test.ts', 'src/plugins/__tests__/loader.test.ts', 'src/plugins/__tests__/integration/e2e.test.ts', 'ui/__tests__/api/plugins.test.ts'],
    'Runtime adapters must treat plugin tools and context engines as AnthroClaw extension points.',
  ),
  feature(
    'plugins.subagent-runner',
    'plugins_extensibility',
    'Plugin runSubagent contract',
    ['src/plugins/types.ts', 'src/plugins/context.ts', 'src/plugins/__tests__/subagent-runner.test.ts'],
    'Plugins may run headless subagents only through the runtime contract with tools disabled unless explicitly allowed.',
    'Plugin subagent runner tests cover runtime selection, timeout, cwd, and no-tool invariants.',
    ['src/plugins/__tests__/subagent-runner.test.ts', 'src/plugins/__tests__/contract.test.ts'],
    'Provider SDK imports must not become plugin API.',
  ),
  feature(
    'plugins.operator-console',
    'plugins_extensibility',
    'Operator-console plugin tools',
    ['plugins/operator-console/src', 'src/agent/tools/manage-operator-console.ts'],
    'Operator-console capabilities, delegation, peer pause, peer summary, and escalation must keep their cross-agent policy gates.',
    'Operator-console plugin tests cover permissions and each registered tool.',
    ['plugins/operator-console/tests/permissions.test.ts', 'plugins/operator-console/tests/delegate-to-peer.test.ts', 'plugins/operator-console/tests/peer-summary.test.ts'],
    'Runtime custom-tool execution must preserve plugin tool context and cross-agent authorization.',
  ),
  feature(
    'plugins.file-transfer',
    'plugins_extensibility',
    'File-transfer plugin',
    ['plugins/file-transfer/src'],
    'File-transfer tools must preserve path policy, workspace boundaries, and plugin config validation.',
    'File-transfer policy and tool tests cover this plugin.',
    ['plugins/file-transfer/tests/policy.test.ts', 'plugins/file-transfer/tests/tools.test.ts'],
    'Runtime replacement must not bypass plugin-level path policy.',
  ),
  feature(
    'dashboard.agent-admin',
    'dashboard_api',
    'Agent admin, chat, config, sessions, runtime status, and files',
    ['ui/app/(dashboard)/agents/page.tsx', 'ui/app/(dashboard)/chat/[agentId]/page.tsx', 'ui/app/api/agents'],
    'Dashboard APIs must expose the same agent config, effective runtime, sessions, runs, interrupts, files, skills, memory, plugins, and learning state.',
    'Agent, chat, config, sessions, learning, files, plugins, and safety UI/API tests cover this surface.',
    ['ui/__tests__/api/config-save-via-writer.test.ts', 'ui/__tests__/components/plugins-panel.test.tsx', 'ui/__tests__/api/learning-decisions.test.ts'],
    'Runtime migration must update dashboard copy and status data without removing operator controls.',
  ),
  feature(
    'dashboard.mcp-onboarding',
    'dashboard_api',
    'MCP onboarding UI and API',
    ['ui/app/api/mcp', 'ui/app/mcp', 'ui/__tests__/components/AddMcpWizard.test.tsx'],
    'MCP probe/connect/OAuth/API-key/finalize/status UI must remain AnthroClaw-managed and credential-safe.',
    'MCP probe/connect/OAuth/status API tests and wizard component tests cover the flow.',
    ['ui/__tests__/api/mcp-probe.test.ts', 'ui/__tests__/api/mcp-connect.test.ts', 'ui/__tests__/api/mcp-oauth.test.ts'],
    'Runtime adapters consume resolved MCP proxy tools, not raw dashboard credentials.',
  ),
  feature(
    'dashboard.fleet-settings',
    'dashboard_api',
    'Fleet, gateway status, diagnostics, metrics, and logs',
    ['ui/app/(dashboard)/fleet', 'ui/app/api/fleet', 'ui/app/api/gateway/status/route.ts', 'ui/app/api/diagnostics/export/route.ts'],
    'Fleet/operator surfaces must report runtime health, diagnostics, active input, metrics, alerts, deployment state, and logs.',
    'Fleet lib tests, diagnostics component tests, log-buffer tests, and gateway status callers cover this surface.',
    ['ui/__tests__/lib/fleet.test.ts', 'ui/__tests__/components/diagnostics.test.tsx', 'ui/__tests__/lib/log-buffer.test.ts'],
    'Runtime v1 must include dashboard-visible runtime status, not only backend config.',
  ),
  feature(
    'dashboard.channels-ops',
    'dashboard_api',
    'Channels, pauses, notifications, accounts, and route tests',
    ['ui/app/api/channels', 'ui/app/api/notifications/test/route.ts', 'ui/app/api/agents/[agentId]/route-test/route.ts'],
    'Operator UI must keep channel binding, route simulation, active pauses, pause events, notification tests, and account inventory working.',
    'Route-test, pauses, notifications, binding, and channel behavior component tests cover this surface.',
    ['ui/__tests__/api/route-test.test.ts', 'ui/__tests__/api/pauses.test.ts', 'ui/__tests__/api/notifications-test.test.ts'],
    'Runtime selection must not bypass channel-specific policy or route diagnostics.',
  ),
  feature(
    'observability.metrics-runs',
    'observability',
    'Metrics, agent runs, route decisions, usage, and cost',
    ['src/metrics', 'src/gateway.ts', 'ui/app/api/metrics/route.ts'],
    'All runtimes must emit enough run, route, usage, tool, interrupt, memory influence, and diagnostic events for operator inspection.',
    'Gateway run listing, route decisions, integration audit, and Pi smoke summary capture provide evidence.',
    ['test/gateway-integration-audit.test.ts', 'src/cli/__tests__/pi-smoke-suite.test.ts'],
    'A runtime can answer correctly and still fail migration if observability regresses.',
  ),
  feature(
    'observability.hooks-webhooks',
    'observability',
    'Hooks, plugin hooks, and webhooks',
    ['src/hooks', 'src/webhooks', 'src/plugins/types.ts'],
    'Lifecycle and tool events must emit stable hook/webhook payloads for plugins and external integrations.',
    'Hook emitter, direct webhooks, plugin hook registration, and on_after_query payload contract tests cover this surface.',
    ['test/gateway-on-after-query-payload.test.ts', 'test/webhooks/gateway-direct.test.ts', 'src/plugins/__tests__/registry.test.ts'],
    'Provider event normalization must preserve hook-worthy lifecycle details.',
  ),
  feature(
    'buildroom.workflow',
    'buildroom',
    'Auto-Buildroom workflow and artifacts',
    ['src/auto-buildroom', 'docs/Auto-Buildroom', 'ui/app/api/buildroom'],
    'Buildroom init/pause/resume/kill-switch/mode/status, artifacts, path policy, locks, QA, retention, and notifications must stay runtime-compatible.',
    'Buildroom CLI, e2e, policy, artifact, storage, notification, and UI API tests cover this surface.',
    ['src/auto-buildroom/__tests__/e2e-mode-b.test.ts', 'src/cli/__tests__/buildroom.test.ts', 'ui/__tests__/api/buildroom.test.ts'],
    'If Buildroom invokes native agents, runtime replacement must preserve operator controls and artifact evidence.',
  ),
  feature(
    'buildroom.agent-tools',
    'buildroom',
    'Buildroom handoff and session summary tools',
    ['src/agent/tools/buildroom-handoff.ts', 'src/agent/tools/buildroom-session-summary.ts', 'src/gateway.ts'],
    'Buildroom tools must bind source agent/session context and enforce policy when surfaced to runtime custom tools.',
    'Buildroom handoff/session-summary tool tests cover context binding and result shape.',
    ['src/agent/tools/__tests__/buildroom-handoff.test.ts', 'src/agent/tools/__tests__/buildroom-session-summary.test.ts'],
    'Runtime tool adapters must keep Buildroom as an AnthroClaw subsystem, not a provider-specific feature.',
  ),
  feature(
    'config.schema-auth',
    'config_auth',
    'Global/agent config, safety profiles, auth, and secrets',
    ['src/config/schema.ts', 'src/security/profiles', 'ui/app/api/auth', 'ui/app/api/config/route.ts'],
    'Runtime config, safety profiles, dashboard auth, API keys, Claude/Pi auth status, and secret redaction must remain explicit and validated.',
    'Config schema, auth API, safety profile validation, profiles baseline, and Pi auth smoke tests cover this surface.',
    ['test/config/schema.test.ts', 'ui/__tests__/api/auth.test.ts', 'ui/__tests__/api/safety-profile-validate.test.ts', 'src/cli/__tests__/pi-auth-smoke.test.ts'],
    'Runtime migration must not make credentials ambient or silently downgrade safety profiles.',
  ),
  feature(
    'ops.smoke-ci',
    'ops_ci',
    'Smoke scripts, CI gate, package optionality, and diagnostics artifacts',
    ['src/cli/pi-*.ts', '.github/workflows', 'docs/pi-smoke-gate.md'],
    'Real-runtime evidence must be reproducible locally and in manual CI without requiring personal machine state.',
    'Pi auth/workspace/gateway/all smoke tests and manual workflow summary/artifacts cover this surface.',
    ['src/cli/__tests__/pi-auth-smoke.test.ts', 'src/cli/__tests__/pi-gateway-smoke.test.ts', 'src/cli/__tests__/pi-smoke-suite.test.ts'],
    'No runtime becomes default without a repeatable real-auth smoke gate and redacted artifacts.',
  ),
];

export const DEFAULT_RUNTIME_BLOCKING_FEATURE_CONTRACTS = [
  'runtime.headless-text',
  'runtime.event-normalization',
  'runtime.run-handle',
  'runtime.model-auth-storage',
  'gateway.runtime-selection',
  'gateway.dispatch-streaming',
  'gateway.active-control',
  'gateway.shutdown-cleanup',
  'routing.session-key',
  'routing.channels',
  'routing.cron-heartbeat',
  'tools.builtin-tool-policy',
  'tools.dynamic-dispatch-tools',
  'tools.external-mcp-proxy',
  'tools.file-ownership',
  'tools.decisions-approvals',
  'sessions.provider-store',
  'sessions.context-assembly',
  'sessions.budget-recall-title',
  'memory.search-write-review',
  'learning.review-actions',
  'learning.lcm-honcho',
  'plugins.registry-lifecycle',
  'plugins.subagent-runner',
  'plugins.operator-console',
  'plugins.file-transfer',
  'dashboard.agent-admin',
  'dashboard.mcp-onboarding',
  'dashboard.fleet-settings',
  'dashboard.channels-ops',
  'observability.metrics-runs',
  'observability.hooks-webhooks',
  'buildroom.workflow',
  'buildroom.agent-tools',
  'config.schema-auth',
  'ops.smoke-ci',
] as const;

export const RUNTIME_CANARY_SCENARIOS: RuntimeCanaryScenario[] = [
  canary(
    'pi.auth-model-preflight',
    'smoke',
    'Pi auth and model registry preflight',
    'Prove the optional Pi package imports, the target model resolves, provider auth is configured through redacted storage, and staging paths work.',
    ['runtime.model-auth-storage', 'config.schema-auth', 'ops.smoke-ci'],
    [
      'Run the auth smoke with the same model and storage paths intended for staging.',
      'Verify the result is passed, not skipped.',
      'Verify stdout/stderr and artifacts do not contain provider credential values.',
    ],
    {
      evidenceCommand: 'pnpm smoke:pi-auth -- --json --model anthropic/claude-sonnet-4-6',
      evidenceArtifact: 'pi-auth-smoke JSON result',
    },
  ),
  canary(
    'pi.workspace-tools-rewind',
    'smoke',
    'Pi workspace edit, approval, and rewind smoke',
    'Prove Pi can mutate an explicit workspace through AnthroClaw policy, produce a checkpoint candidate, dry-run rewind, and restore files.',
    [
      'runtime.run-handle',
      'runtime.event-normalization',
      'gateway.active-control',
      'tools.builtin-tool-policy',
      'tools.file-ownership',
      'observability.metrics-runs',
      'ops.smoke-ci',
    ],
    [
      'Run the workspace smoke in a Pi-authenticated environment.',
      'Verify edit/write policy is observed.',
      'Verify dry-run rewind reports a reversible file change.',
      'Verify restore returns the file to the before state.',
    ],
    {
      evidenceCommand: 'pnpm smoke:pi-workspace -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000',
      evidenceArtifact: 'pi-workspace-smoke JSON result',
    },
  ),
  canary(
    'pi.gateway-channel-approval',
    'smoke',
    'Pi Gateway channel dispatch and approval smoke',
    'Prove Pi runs through Gateway dispatch with channel context, session mapping, approval routing, workspace mutation, metrics, and clean shutdown.',
    [
      'gateway.runtime-selection',
      'gateway.dispatch-streaming',
      'gateway.active-control',
      'gateway.shutdown-cleanup',
      'routing.session-key',
      'routing.channels',
      'tools.builtin-tool-policy',
      'tools.dynamic-dispatch-tools',
      'tools.decisions-approvals',
      'sessions.provider-store',
      'observability.metrics-runs',
      'ops.smoke-ci',
    ],
    [
      'Run the Gateway smoke with global or per-agent Pi runtime enabled.',
      'Verify a channel-shaped inbound message dispatches through Gateway.',
      'Verify the approval broker observes at least one request and sender-authenticated approval resolves it.',
      'Verify the workspace file changed, a session id was recorded, and no shutdown cleanup error appears.',
    ],
    {
      evidenceCommand: 'pnpm smoke:pi-gateway -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000',
      evidenceArtifact: 'pi-gateway-smoke JSON result',
    },
  ),
  canary(
    'pi.aggregate-real-auth',
    'smoke',
    'Pi aggregate real-auth smoke gate',
    'Prove auth, workspace, and Gateway runtime probes pass together and produce a single redacted decision artifact.',
    [
      'runtime.headless-text',
      'runtime.event-normalization',
      'runtime.run-handle',
      'runtime.model-auth-storage',
      'gateway.runtime-selection',
      'gateway.dispatch-streaming',
      'gateway.shutdown-cleanup',
      'tools.builtin-tool-policy',
      'tools.decisions-approvals',
      'observability.metrics-runs',
      'config.schema-auth',
      'ops.smoke-ci',
    ],
    [
      'Run aggregate smoke locally without allow-skip.',
      'Run the manual GitHub Actions Pi smoke workflow with repository secrets.',
      'Attach the workflow summary and normalized JSON artifact to the migration decision record.',
    ],
    {
      evidenceCommand: 'pnpm smoke:pi-all -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000',
      evidenceArtifact: 'Pi smoke workflow pi-smoke-result artifact',
    },
  ),
  canary(
    'pi.plugins-context-tools',
    'scripted_canary',
    'Plugin tools and context-engine canary',
    'Prove Pi Gateway dispatch preserves plugin lifecycle, plugin MCP tools, plugin subagent runner, context-engine assemble/compress semantics, and bundled plugin API compatibility.',
    [
      'sessions.context-assembly',
      'learning.lcm-honcho',
      'plugins.registry-lifecycle',
      'plugins.subagent-runner',
      'plugins.operator-console',
      'plugins.file-transfer',
      'observability.hooks-webhooks',
    ],
    [
      'Start a temporary Gateway with a runtime-neutral plugin enabled for a Pi canary agent.',
      'Exercise one read-only plugin MCP tool and one policy-sensitive plugin MCP tool with agent/session context.',
      'Run a context-engine assemble/compress trigger.',
      'Run a plugin subagent prompt through the configured runtime with tools disabled.',
      'Verify plugin hook payloads keep agentId/sessionKey and plugin shutdown is clean.',
      'Load real bundled LCM, operator-console, and file-transfer compiled manifest entries through PluginRegistry/createPluginContext.',
      'Exercise LCM mirror/search/status/context-engine, operator-console memory/delegate/escalate payload policy, and file-transfer path-boundary tools.',
    ],
    {
      evidenceCommand: 'pnpm smoke:pi-plugins-context -- --json',
      evidenceArtifact: 'pi-v1-canary plugin/context JSON section',
    },
  ),
  canary(
    'pi.external-mcp-proxy',
    'scripted_canary',
    'External MCP onboarding and proxy canary',
    'Prove MCP onboarding, credential resolution, external MCP proxy tools, and provider-visible custom-tool execution stay AnthroClaw-owned under Pi.',
    [
      'tools.external-mcp-proxy',
      'dashboard.mcp-onboarding',
      'tools.dynamic-dispatch-tools',
      'config.schema-auth',
      'observability.hooks-webhooks',
    ],
    [
      'Validate the external MCP server block through AgentYmlSchema before proxy construction.',
      'Resolve API-key credential_ref entries from a credential store into external MCP headers.',
      'Expose only allowed external MCP tools as Claude-compatible custom tool names.',
      'Dispatch an injected Pi canary turn that receives and executes the proxied MCP custom tool.',
      'Verify headers are resolved from the credential store and redacted from logs/artifacts.',
      'Verify denial behavior remains model-visible when policy blocks the proxied tool.',
    ],
    {
      evidenceCommand: 'pnpm smoke:pi-external-mcp -- --json',
      evidenceArtifact: 'pi-v1-canary external-mcp JSON section',
    },
  ),
  canary(
    'pi.sessions-memory-learning',
    'scripted_canary',
    'Sessions, memory, learning, and recall canary',
    'Prove Pi-backed runs preserve session transcript visibility, recall/title/budget behavior, memory influence, learning reviews, redacted artifacts, and operator decisions.',
    [
      'sessions.provider-store',
      'sessions.budget-recall-title',
      'memory.search-write-review',
      'learning.review-actions',
      'observability.metrics-runs',
      'observability.hooks-webhooks',
    ],
    [
      'Run the storage/protocol canary without real Pi usage.',
      'Optionally run two Pi Gateway turns in the same product session and verify continuation.',
      'List session details, title, route decisions, runs, and transcript-derived search evidence.',
      'Write/search/review memory and record memory influence in opt-in Gateway mode.',
      'Trigger a learning review and verify actions and artifact rows are visible.',
      'Verify artifact file/snippet exports redact secret-like content.',
      'Verify learning queue drains active work and drops pending writes before Gateway shutdown.',
    ],
    {
      evidenceCommand: 'pnpm smoke:pi-sessions-memory -- --json',
      evidenceArtifact: 'pi-v1-canary sessions/memory/learning JSON section',
    },
  ),
  canary(
    'pi.dashboard-operator',
    'manual_operator_check',
    'Dashboard and operator API canary',
    'Prove operator-facing APIs and dashboard panels show the effective runtime, sessions, runs, interrupts, learning, plugins, MCP, channels, metrics, and diagnostics after Pi runs.',
    [
      'dashboard.agent-admin',
      'dashboard.mcp-onboarding',
      'dashboard.fleet-settings',
      'dashboard.channels-ops',
      'observability.metrics-runs',
      'config.schema-auth',
    ],
    [
      'Open the dashboard against a Pi canary Gateway.',
      'Verify agent config shows effective runtime and redacted Pi storage paths.',
      'Verify sessions/runs/interrupts/learning/memory/plugin panels reflect the Pi run.',
      'Verify MCP onboarding/status and channel route-test surfaces still work.',
      'Export diagnostics and confirm runtime status appears without secrets.',
    ],
    { evidenceArtifact: 'manual canary checklist with screenshots or diagnostics export' },
  ),
  canary(
    'pi.scheduled-buildroom',
    'scripted_canary',
    'Scheduled work and Buildroom canary',
    'Prove scheduled agent work, Buildroom workflow state, Buildroom tools, artifacts, path policy, and notifications remain compatible with Pi runtime rollout.',
    [
      'routing.cron-heartbeat',
      'buildroom.workflow',
      'buildroom.agent-tools',
      'tools.dynamic-dispatch-tools',
      'observability.metrics-runs',
    ],
    [
      'Run a temporary manage_cron job against a Pi canary agent.',
      'Run a heartbeat-style scheduled prompt and verify session continuity.',
      'Run Buildroom init/status/pause/resume/kill-switch API checks.',
      'Exercise Buildroom handoff/session-summary tools with source session binding.',
      'Verify artifacts, locks, path policy, and notifications remain inspectable.',
    ],
    { evidenceArtifact: 'future pi-v1-canary scheduled/buildroom JSON section' },
  ),
  canary(
    'pi.rollback-mixed-runtime',
    'scripted_canary',
    'Per-agent rollback and mixed-runtime canary',
    'Prove global/per-agent runtime selection supports Pi canary, Claude fallback opt-out, bad-auth behavior, and rollback without corrupting session state.',
    [
      'gateway.runtime-selection',
      'runtime.model-auth-storage',
      'config.schema-auth',
      'sessions.provider-store',
      'dashboard.agent-admin',
      'ops.smoke-ci',
    ],
    [
      'Run one agent with per-agent Pi while global default remains Claude.',
      'Run a second agent explicitly pinned to Claude while global Pi config is present.',
      'Verify bad Pi auth on an explicitly Pi-enabled agent fails loudly instead of silently falling back.',
      'Roll the Pi canary agent back to Claude and verify the same product session remains inspectable.',
    ],
    { evidenceCommand: 'pnpm smoke:pi-rollback-runtime -- --json' },
  ),
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

export function listRuntimeFeatureContracts(domain?: RuntimeFeatureContractDomain): RuntimeFeatureContract[] {
  return RUNTIME_FEATURE_CONTRACTS
    .filter((entry) => domain === undefined || entry.domain === domain)
    .map((entry) => ({
      ...entry,
      sourceFiles: [...entry.sourceFiles],
      evidence: [...entry.evidence],
    }));
}

export function listRuntimeCanaryScenarios(): RuntimeCanaryScenario[] {
  return RUNTIME_CANARY_SCENARIOS.map((entry) => ({
    ...entry,
    coversFeatureContracts: [...entry.coversFeatureContracts],
    steps: [...entry.steps],
  }));
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

function feature(
  id: string,
  domain: RuntimeFeatureContractDomain,
  surface: string,
  sourceFiles: string[],
  requirement: string,
  acceptance: string,
  evidence: string[],
  runtimeImpact: string,
): RuntimeFeatureContract {
  return { id, domain, surface, sourceFiles, requirement, acceptance, evidence, runtimeImpact };
}

function canary(
  id: string,
  kind: RuntimeCanaryScenarioKind,
  title: string,
  objective: string,
  coversFeatureContracts: string[],
  steps: string[],
  evidence?: Pick<RuntimeCanaryScenario, 'evidenceCommand' | 'evidenceArtifact'>,
): RuntimeCanaryScenario {
  return {
    id,
    kind,
    title,
    objective,
    coversFeatureContracts,
    steps,
    blockingForDefaultRuntime: true,
    ...evidence,
  };
}

function statusWeight(status: RuntimeContractStatus): number {
  if (status === 'pass' || status === 'not-applicable') return 1;
  if (status === 'partial') return 0.5;
  return 0;
}

function countStatus(entries: RuntimeContractCandidateStatus[], status: RuntimeContractStatus): number {
  return entries.filter((entry) => entry.status === status).length;
}
