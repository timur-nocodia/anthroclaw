# Runtime contract v1

Date: 2026-05-16

## Purpose

Runtime contract v0 answered a narrow question: can a candidate runtime replace the Claude Agent SDK loop for prompt, events, tools, interrupt, checkpoint, and Gateway control?

Runtime contract v1 answers the production question: can a candidate runtime preserve **all AnthroClaw product surfaces** while AnthroClaw keeps ownership of the harness?

This document is intentionally broader than `src/runtime/contract.ts` v0 scenario scoring. The machine-readable source now has two layers:

- `RUNTIME_CONTRACT_SCENARIOS`: compact candidate-comparison scenarios for Claude Agent SDK, Pi, and OpenCode.
- `RUNTIME_FEATURE_CONTRACTS`: full v1 feature atlas covering Gateway, channels, tools, permissions, sessions, memory, learning, plugins, dashboard/API, observability, Buildroom, config/auth, and smoke/CI.

## Contract principle

AnthroClaw owns the harness. A provider runtime may execute model/tool loops, but it must not own:

- product session semantics;
- channel routing;
- operator approvals;
- tool authorization;
- MCP credential handling;
- memory and learning stores;
- plugin APIs;
- dashboard/admin APIs;
- diagnostics and smoke evidence;
- rollback controls.

If a candidate cannot expose enough hooks for a feature, AnthroClaw must either rebuild that feature above the runtime or mark the candidate blocked for default rollout.

## Coverage model

Every v1 feature contract has:

- `id`: stable contract id;
- `domain`: product/runtime domain;
- `surface`: human-readable feature surface;
- `sourceFiles`: primary code owners;
- `requirement`: what must remain true;
- `acceptance`: what proves the contract;
- `evidence`: tests, smoke probes, or docs that currently back it;
- `runtimeImpact`: why runtime migration can break it.

This is the coverage bar for "100% feature map". It does not mean every candidate passes every feature. It means every feature has an explicit contract and evidence owner before migration continues.

## Domains

| Domain | Scope |
| --- | --- |
| `runtime` | Provider-neutral runtime APIs, event normalization, run handles, model/auth storage. |
| `gateway` | Dispatch loop, runtime selection, active-run control, shutdown cleanup. |
| `routing_channels` | Telegram, WhatsApp, Web, direct webhooks, synthetic inbound, cron, heartbeat, session keys. |
| `tools_permissions` | Built-in tools, dynamic tools, external MCP proxies, file ownership, decisions, approvals. |
| `sessions_context` | Provider sessions, transcript access, context assembly, compaction, recall, budgets, titles. |
| `memory_learning` | Memory stores/tools, learning reviews/actions/artifacts, LCM, Honcho. |
| `plugins_extensibility` | Plugin lifecycle, hooks, MCP tools, context engines, subagent runner, bundled plugins. |
| `dashboard_api` | Operator dashboard, APIs, agent admin, MCP onboarding, fleet, channels, runtime status. |
| `observability` | Metrics, route decisions, run records, hooks, webhooks, diagnostics. |
| `buildroom` | Auto-Buildroom workflow, artifacts, policy, tools, notifications, UI/API. |
| `config_auth` | Config schema, runtime config, safety profiles, dashboard auth, provider auth redaction. |
| `ops_ci` | Smoke scripts, manual CI gate, optional dependencies, artifacts. |

## V1 Feature Atlas

### Runtime

| ID | Contract |
| --- | --- |
| `runtime.headless-text` | All non-interactive LLM calls go through `HeadlessRuntime`; title generation, learning, plugin subagents, recall, and smoke probes can select runtime without provider imports. |
| `runtime.event-normalization` | Provider stream events normalize before Gateway/UI/metrics/hooks/plugins consume them. Raw provider event shapes stay inside adapters. |
| `runtime.run-handle` | Interactive runs expose async event iteration plus interrupt, close, and optional rewind through `RuntimeRunHandle`. |
| `runtime.model-auth-storage` | Model ids and provider auth storage are explicit, redacted, and stageable through isolated storage paths. |

### Gateway

| ID | Contract |
| --- | --- |
| `gateway.runtime-selection` | Global and per-agent runtime config merge predictably; per-agent Pi canary and per-agent Claude rollback are both supported. |
| `gateway.dispatch-streaming` | Web/channel dispatch preserves partial text, final text, channel sends, Web UI updates, run completion, failures, and cleanup across runtimes. |
| `gateway.active-control` | Active runs remain discoverable, interruptible, aliasable, and checkpoint-controllable by session key/run id/UI/API. |
| `gateway.shutdown-cleanup` | `Gateway.stop()` stops queues, drains runtime/learning work, unloads plugins, closes stores, and leaves no post-shutdown writes. |

### Routing And Channels

| ID | Contract |
| --- | --- |
| `routing.session-key` | Product session keys remain stable across channel, peer, group, thread, sender, and runtime session id mappings. |
| `routing.channels` | Telegram, WhatsApp, Web, webhooks, and synthetic inbound route through the same agent/session/policy path. |
| `routing.cron-heartbeat` | Scheduled cron and heartbeat runs reuse the same runtime/session/tool policy as live user messages. |

### Tools And Permissions

| ID | Contract |
| --- | --- |
| `tools.builtin-tool-policy` | Built-in provider tools execute only after AnthroClaw allow/ask/deny policy, safety profiles, protected path checks, and approval broker decisions. |
| `tools.dynamic-dispatch-tools` | Per-dispatch tools like `send_message`, `send_media`, `manage_cron`, `connect_mcp`, and Buildroom tools capture current channel/session context. |
| `tools.external-mcp-proxy` | Remote MCP tools are proxied as AnthroClaw-owned custom tools; credential headers and policy stay outside provider ownership. |
| `tools.file-ownership` | Subagent and cross-agent file writes respect workspace boundaries and ownership claims. |
| `tools.decisions-approvals` | Human approval requests are deliverable, resumable, auditable, re-sendable, and sender-authenticated. |

### Sessions And Context

| ID | Contract |
| --- | --- |
| `sessions.provider-store` | Runtime transcripts, metadata, labels, titles, search, fork/delete/export, and session details remain operator-visible. |
| `sessions.context-assembly` | Context engines, legacy compressor, LCM, memory prefetch, and plugin assemble/compress hooks produce provider-compatible prompt payloads. |
| `sessions.budget-recall-title` | Iteration budget, session recall, title generation, and headless summarization work through selected runtime. |

### Memory And Learning

| ID | Contract |
| --- | --- |
| `memory.search-write-review` | Agent memory remains searchable, reviewable, redactable, attributable, and independent of provider conversation state. |
| `learning.review-actions` | Post-run learning proposes/applies memory and skill actions, exports redacted artifacts, and exposes review decisions. |
| `learning.lcm-honcho` | LCM and external memory plugins keep context-engine, hook mirror, search, status, and dashboard surfaces. |

### Plugins And Extensibility

| ID | Contract |
| --- | --- |
| `plugins.registry-lifecycle` | Plugin manifest discovery, registration, enablement, config schema, hooks, tools, context engines, hot reload, and shutdown remain runtime-neutral. |
| `plugins.subagent-runner` | Plugins run headless subagents only through the runtime contract, with tools disabled unless explicitly allowed. |
| `plugins.operator-console` | Operator-console capabilities, delegation, peer pause, peer summary, and escalation keep cross-agent policy gates. |
| `plugins.file-transfer` | File-transfer tools preserve plugin config validation, path policy, and workspace boundaries. |

### Dashboard And API

| ID | Contract |
| --- | --- |
| `dashboard.agent-admin` | Agent admin/chat/config/session/run/interrupt/file/skill/memory/plugin/learning APIs continue to expose effective runtime state and controls. |
| `dashboard.mcp-onboarding` | MCP probe/connect/OAuth/API-key/finalize/status UI remains AnthroClaw-managed and credential-safe. |
| `dashboard.fleet-settings` | Fleet, gateway status, diagnostics, metrics, alerts, deployment state, logs, and runtime status remain operator-visible. |
| `dashboard.channels-ops` | Channel binding, route simulation, active pauses, pause events, notification tests, and account inventory keep working. |

### Observability

| ID | Contract |
| --- | --- |
| `observability.metrics-runs` | All runtimes emit enough run, route, usage, tool, interrupt, memory influence, and diagnostic events for inspection. |
| `observability.hooks-webhooks` | Lifecycle and tool events emit stable hook/webhook payloads for plugins and external integrations. |

### Buildroom

| ID | Contract |
| --- | --- |
| `buildroom.workflow` | Buildroom init/pause/resume/kill-switch/mode/status, artifacts, path policy, locks, QA, retention, and notifications remain runtime-compatible. |
| `buildroom.agent-tools` | Buildroom handoff and session-summary tools bind source agent/session context and enforce policy when surfaced to runtime custom tools. |

### Config, Auth, And Operations

| ID | Contract |
| --- | --- |
| `config.schema-auth` | Runtime config, safety profiles, dashboard auth, API keys, provider auth status, and secret redaction remain explicit and validated. |
| `ops.smoke-ci` | Real-runtime smoke evidence is reproducible locally and in manual CI without requiring personal machine state. |

## Evidence Requirements

Evidence levels:

- **unit**: focused test for parser, store, tool, adapter, schema, or policy.
- **integration**: Gateway/UI/API/plugin test across subsystem boundary.
- **smoke**: real provider or real workflow probe, usually opt-in.
- **canary**: real agent running under production-like operator observation.

Phase 1 is complete when every feature contract has at least unit or integration evidence. Default-runtime rollout additionally requires smoke/canary evidence for runtime-sensitive contracts:

- `runtime.*`;
- `gateway.*`;
- `routing.channels`;
- `routing.cron-heartbeat`;
- `tools.*`;
- `sessions.provider-store`;
- `sessions.context-assembly`;
- `memory.search-write-review`;
- `learning.review-actions`;
- `plugins.*`;
- `dashboard.agent-admin`;
- `observability.metrics-runs`;
- `ops.smoke-ci`.

## Candidate Interpretation

### Claude Agent SDK

Claude remains the production baseline. Passing v1 means no existing product feature regresses while runtime boundaries are introduced.

### Pi

Pi is the primary migration candidate. It has passed the compact v0 contract, but v1 requires feature-level proof across dashboard, plugins, learning, memory, sessions, and Buildroom surfaces before default rollout.

### OpenCode

OpenCode remains a benchmark adapter until it can satisfy Gateway, tool policy, custom tools, external MCP proxying, plugins, dashboard observability, and canary requirements.

## Immediate Gaps

1. Dashboard runtime copy still contains Claude-native language in the fleet advanced settings panel. This should become effective-runtime status rather than a hardcoded statement.
2. The compact candidate score says Pi has no v0 blockers, but v1 still needs canary evidence across real agents and dashboard/operator workflows.
3. OpenCode should not be upgraded beyond benchmark unless it gets Gateway-path evidence comparable to Pi smoke.
4. Buildroom native-agent adapter must be explicitly audited before any global default flip.
5. Session transcript ownership is the highest-risk area if a runtime cannot expose provider transcripts; AnthroClaw may need a provider-neutral transcript mirror for Pi default rollout.
6. Current tests cover most control-plane surfaces in focused slices, but there is no single all-domain Pi canary that exercises runtime selection, channel routing, approvals, plugin tools/context engines, session transcript visibility, memory/learning, dashboard-visible state, metrics, and shutdown cleanup together.
7. Channel parity is intentionally uneven: Telegram supports interactive approvals while WhatsApp currently does not. V1 should treat this as a channel capability contract, not as an accidental runtime difference.

## Phase 1 Exit Criteria

- `RUNTIME_FEATURE_CONTRACTS` covers every major product surface.
- Runtime contract tests assert feature ids are unique, evidence-backed, and cover every domain.
- This document names every domain and contract.
- Follow-up work is filed against concrete feature ids rather than vague runtime parity.
- No default-runtime flip proceeds until feature contracts move from documented coverage to smoke/canary evidence.
- A follow-up canary plan exists for the all-domain Pi run that proves the feature atlas under one runtime candidate.
