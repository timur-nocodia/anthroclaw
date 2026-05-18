# Runtime v1 parity matrix

Date: 2026-05-17

## Purpose

This document answers one operational question: how close is the Pi-backed Runtime v1 path to the old Claude Agent SDK-centered harness, and what still needs proof before every production agent can be treated as migrated?

It is intentionally stricter than "the default flip is done". The default Runtime v1 rollout is complete, but product parity has several layers:

- contract parity: every AnthroClaw feature surface is named and owned;
- test parity: every feature surface has unit or integration evidence;
- Pi canary parity: every default-runtime blocking feature is covered by a Pi smoke or scripted canary;
- production rollout parity: selected real agents/channels have controlled live evidence;
- fleet parity: every production agent, channel, tool class, and side-effect path has passed its own rollout gate.

## Current Verdict

Default Runtime v1 parity is green. Fleet-wide live parity is still in expansion mode.

| Scope | Status | Meaning |
| --- | --- | --- |
| Feature contract coverage | Complete | `RUNTIME_FEATURE_CONTRACTS` covers all major runtime, Gateway, channel, tool, session, memory, learning, plugin, dashboard, observability, Buildroom, config, and ops surfaces. |
| Default-runtime canary coverage | Complete | All default-runtime blocking contracts are mapped to at least one `RUNTIME_CANARY_SCENARIOS` entry. |
| Pi default rollout | Complete | Pi is the default runtime after local, durable CI, live pull, Ring 1-4.5, rollback, and monitoring evidence. |
| Low-risk live usage | Complete for `example` and `pi_telegram_lab` | Web UI, allowlisted Telegram DM, operator commands, and post-turn monitor evidence are closed. |
| Business-critical dry-run coverage | Complete for `leads_agent` | Public escalation, plugin context, learning mode, dry-run, and monitor evidence are closed without live customer delivery. |
| High-risk group/content expansion | Pre-live gate passed for `content_sm_building` | Multi-root audit, peer/topic confirmation, fake delivery, cron cleanup, and monitor passed; real controlled group turn remains explicitly pending. |
| Remaining fleet expansion | Open | Any additional live-only agent, group, WhatsApp, media, external MCP, or proactive side-effect path must get its own expansion packet and operator go/no-go. |

## Evidence Levels

| Level | Name | Bar |
| --- | --- | --- |
| L0 | Contracted | The feature exists in `RUNTIME_FEATURE_CONTRACTS` with owner files, requirement, acceptance, and runtime impact. |
| L1 | Unit/integration | The feature has focused tests outside the provider SDK. |
| L2 | Scripted Pi canary | A deterministic `smoke:pi-*` canary proves the AnthroClaw-owned behavior under Pi-shaped execution. |
| L3 | Real Pi smoke | A real-auth Pi smoke or durable CI run proves the provider path. |
| L4 | Controlled production live | A real Gateway/channel/operator path ran under Pi with rollback and monitor evidence. |
| L5 | Fleet signoff | The exact production agent/channel/tool combination is accepted and monitored. |

## Progress Scoreboard

| Area | Contract count | Highest common level | Current state |
| --- | ---: | --- | --- |
| Runtime | 4 | L3-L4 | Headless, event stream, run handle, auth/model storage are canary-covered and default-live proven. |
| Gateway | 4 | L4 | Runtime selection, dispatch, active control, and shutdown are covered by smoke/canary plus live rollout. |
| Routing and channels | 3 | L4, with fleet exceptions | Web and Telegram DM are live-proven. Cron/heartbeat and controlled side effects are live-proven on `example`. WhatsApp/customer and group expansion remain per-agent gates. |
| Tools and permissions | 6 | L4, with high-risk tools gated per agent | Built-in policy, approvals, file ownership, custom tools, external MCP proxy, side-effect gate contract, `send_message`, `manage_cron`, and escalation have canary/live evidence. `send_media` and broad group fanout stay expansion-gated. |
| Sessions and context | 3 | L2-L4 | Continuation and operator visibility are canary-covered; live session continuity is proven for selected flows. Deeper label/export UI parity remains non-blocking follow-up. |
| Memory and learning | 3 | L2-L4 | Memory, learning, artifacts, LCM/plugin context are scripted-canary covered; `leads_agent` learning mode is audited as propose-only. |
| Plugins | 4 | L2 | Registry, subagent runner, operator-console, LCM, and file-transfer are scripted-canary covered. Deeper live plugin workloads remain expansion-specific. |
| Dashboard and API | 4 | L2 | Operator API contract is scripted-canary covered; browser UX screenshots are optional and not a default-runtime blocker. |
| Observability | 2 | L4 | Metrics, runs, tool events, diagnostics, monitor, and hooks are canary-covered; live monitor is the ongoing production guard. |
| Buildroom | 2 | L2-L4 | Scheduled Buildroom canary passed; live cron/proactive notification paths were proven on controlled `example` flows. Production Buildroom rooms remain expansion-specific. |
| Config, auth, and ops | 2 | L3-L4 | Config/auth/schema/secret redaction and repeatable smoke/CI are closed for default rollout. |

## Full Contract Matrix

| Contract | Domain | Pi evidence | Current parity | Remaining proof |
| --- | --- | --- | --- | --- |
| `runtime.headless-text` | runtime | `pi.aggregate-real-auth` | L3 | None for default runtime; new headless consumers should stay behind `HeadlessRuntime`. |
| `runtime.event-normalization` | runtime | `pi.workspace-tools-rewind`, `pi.aggregate-real-auth` | L3-L4 | Keep provider raw events inside adapters. |
| `runtime.run-handle` | runtime | `pi.workspace-tools-rewind`, `pi.aggregate-real-auth` | L3-L4 | None for default runtime. |
| `runtime.model-auth-storage` | runtime | `pi.auth-model-preflight`, `pi.aggregate-real-auth`, `pi.rollback-mixed-runtime` | L3-L4 | Keep real secrets out of repo, logs, and artifacts. |
| `gateway.runtime-selection` | gateway | `pi.gateway-channel-approval`, `pi.aggregate-real-auth`, `pi.rollback-mixed-runtime` | L4 | None for default runtime. |
| `gateway.dispatch-streaming` | gateway | `pi.gateway-channel-approval`, `pi.aggregate-real-auth` | L4 | Continue checking streamed/final text for new UI flows. |
| `gateway.active-control` | gateway | `pi.workspace-tools-rewind`, `pi.gateway-channel-approval` | L3-L4 | Long-running real workloads still need operator monitoring. |
| `gateway.shutdown-cleanup` | gateway | `pi.gateway-channel-approval`, `pi.aggregate-real-auth` | L3-L4 | Watch for post-shutdown writes in future cron/Buildroom expansions. |
| `routing.session-key` | routing_channels | `pi.gateway-channel-approval` | L4 | Process-restart session alias proof remains useful for future hardening. |
| `routing.channels` | routing_channels | `pi.gateway-channel-approval`, `pi.public-escalation` | L4 for Web/Telegram DM, L2-L3 for other channels | WhatsApp customer delivery and Telegram group threads require per-agent live gates. |
| `routing.cron-heartbeat` | routing_channels | `pi.scheduled-buildroom` | L4 for controlled `example` cron/proactive flows | Production recurring jobs remain expansion-gated. |
| `tools.builtin-tool-policy` | tools_permissions | `pi.workspace-tools-rewind`, `pi.gateway-channel-approval`, `pi.aggregate-real-auth`, `pi.public-escalation` | L4 | Keep exact denial feedback visible to the model. |
| `tools.dynamic-dispatch-tools` | tools_permissions | `pi.gateway-channel-approval`, `pi.external-mcp-proxy`, `pi.scheduled-buildroom`, `pi.public-escalation` | L4 for selected tools | `send_media` and group fanout require live agent-specific proof. |
| `tools.side-effect-gates` | tools_permissions | `src/runtime/__tests__/side-effect-gate.test.ts`; `src/runtime/__tests__/live-send-message-gate.test.ts`; `src/runtime/__tests__/live-send-media-gate.test.ts`; `src/runtime/__tests__/live-notification-gate.test.ts`; `src/runtime/__tests__/cron-notification-gate.test.ts`; `src/runtime/__tests__/buildroom-handoff-gate.test.ts`; `src/runtime/__tests__/admin-config-gate.test.ts`; `src/runtime/__tests__/mcp-file-transfer-gate.test.ts`; `src/runtime/__tests__/honcho-local-gate.test.ts`; `src/runtime/__tests__/learning-propose-gate.test.ts`; `runtime:pi-live-send-message-gate`; `runtime:pi-live-send-media-gate`; `runtime:pi-live-notification-gate`; `runtime:pi-cron-notification-gate`; `runtime:pi-buildroom-handoff-gate`; `runtime:pi-admin-config-gate`; `runtime:pi-mcp-file-transfer-gate`; `runtime:pi-honcho-local-gate`; `runtime:pi-learning-propose-gate`; `docs/runtime-side-effect-gates.md` | L1-L2 for message, media, notification, fake cron/notification, temp-only Buildroom handoff, temp-only admin/config, temp-only MCP/file-transfer, temp-only Honcho local, and propose-only learning gates | Memory-read parity smoke still needs the same generic extraction. |
| `tools.external-mcp-proxy` | tools_permissions | `pi.external-mcp-proxy` | L2 | Real network-backed external MCP calls remain per-agent expansion evidence. |
| `tools.file-ownership` | tools_permissions | `pi.workspace-tools-rewind` | L3 | Cross-agent real worktrees remain Buildroom/worker expansion evidence. |
| `tools.decisions-approvals` | tools_permissions | `pi.gateway-channel-approval`, `pi.aggregate-real-auth` | L3-L4 | Channel-specific approval UX differences should stay explicit. |
| `sessions.provider-store` | sessions_context | `pi.gateway-channel-approval`, `pi.sessions-memory-learning`, `pi.rollback-mixed-runtime` | L2-L4 | Session label/export UI parity is a non-blocking follow-up. |
| `sessions.context-assembly` | sessions_context | `pi.plugins-context-tools` | L2 | More live LCM/context-engine workloads can be added when agents need them. |
| `sessions.budget-recall-title` | sessions_context | `pi.sessions-memory-learning` | L2 | None for default runtime; continue monitoring long sessions. |
| `memory.search-write-review` | memory_learning | `pi.sessions-memory-learning` | L2-L4 | Live memory write paths should be agent-gated; `pi_telegram_lab` exposes operator memory commands but uses propose-only learning. |
| `learning.review-actions` | memory_learning | `pi.sessions-memory-learning`; `runtime:pi-learning-propose-gate`; `runtime:pi-timur-agent-learning-propose-smoke` | L2-L4 | Auto-apply learning should remain gated; live agents are currently propose-only where audited. |
| `learning.lcm-honcho` | memory_learning | `pi.plugins-context-tools`; `runtime:pi-honcho-local-gate`; `runtime:pi-timur-agent-honcho-local-smoke` | L2 | Deeper semantic LCM/Honcho query quality remains a follow-up, not a default-runtime blocker. |
| `plugins.registry-lifecycle` | plugins_extensibility | `pi.plugins-context-tools` | L2 | Live plugin-heavy agents need expansion packets. |
| `plugins.subagent-runner` | plugins_extensibility | `pi.plugins-context-tools` | L2 | Real plugin subagent workloads remain expansion-specific. |
| `plugins.operator-console` | plugins_extensibility | `pi.plugins-context-tools` | L2 | Peer pause/list-peers Gateway-store integration can be deepened later. |
| `plugins.file-transfer` | plugins_extensibility | `pi.plugins-context-tools` | L2 | Real file transfer usage should stay path-policy gated. |
| `dashboard.agent-admin` | dashboard_api | `pi.dashboard-operator`, `pi.rollback-mixed-runtime` | L2 | Browser UX screenshot pass remains optional unless UI changes. |
| `dashboard.mcp-onboarding` | dashboard_api | `pi.external-mcp-proxy`, `pi.dashboard-operator` | L2 | Full fake-server probe/connect/finalize flow can be deepened later. |
| `dashboard.fleet-settings` | dashboard_api | `pi.dashboard-operator` | L2 | Add screenshots only when changing dashboard UI. |
| `dashboard.channels-ops` | dashboard_api | `pi.dashboard-operator` | L2 | Route simulation should be re-run for new live channel accounts. |
| `observability.metrics-runs` | observability | `pi.workspace-tools-rewind`, `pi.gateway-channel-approval`, `pi.aggregate-real-auth`, `pi.sessions-memory-learning`, `pi.dashboard-operator`, `pi.scheduled-buildroom`, `pi.public-escalation` | L4 | `runtime:pi-monitor` remains the normal operator health check. |
| `observability.hooks-webhooks` | observability | `pi.plugins-context-tools`, `pi.external-mcp-proxy`, `pi.sessions-memory-learning` | L2-L4 | Real external webhook consumers need their own rollout evidence if enabled. |
| `buildroom.workflow` | buildroom | `pi.scheduled-buildroom` | L2-L4 | Production Buildroom rooms/worktrees remain expansion-specific. |
| `buildroom.agent-tools` | buildroom | `pi.scheduled-buildroom` | L2 | Real Buildroom handoff use should be canaried per source agent/session. |
| `config.schema-auth` | config_auth | `pi.auth-model-preflight`, `pi.aggregate-real-auth`, `pi.external-mcp-proxy`, `pi.dashboard-operator`, `pi.public-escalation`, `pi.rollback-mixed-runtime` | L3-L4 | Continue secret scans before every PR. |
| `ops.smoke-ci` | ops_ci | `pi.auth-model-preflight`, `pi.workspace-tools-rewind`, `pi.gateway-channel-approval`, `pi.aggregate-real-auth`, `pi.rollback-mixed-runtime` | L3 | Keep manual CI decision workflow available for future runtime changes. |

## Agent Expansion Matrix

| Agent | Risk | Current state | Next gate |
| --- | --- | --- | --- |
| `example` | high by tool inventory, controlled test scope | Default-runtime canary, Web UI, Telegram DM, cron, proactive notification, recurring cron, `send_message`, escalation policy, rollback, and monitor evidence are closed. | Keep as regression canary; no active blocker. |
| `pi_telegram_lab` | low/ring2 | Live Telegram DM and operator command suite are closed with monitor evidence. | Keep `runtime:pi-telegram-lab-readiness`, operator smoke, and post-turn checks as repeatable health probes. |
| `timur_agent` | high/operator lab | Tracked full-featured parity lab config exists with Pi runtime, memory/session tools, learning, delivery/media/cron/notifications/admin tools, MCP onboarding, LCM, operator-console, file-transfer, Buildroom tools, connected default Telegram route, expansion packet, operator command smoke, full live read-only command suite, post-expansion monitor evidence, Pi memory/session read smoke, Pi propose-only learning smoke, fake-only cron/proactive notification smoke, fake-only messaging/media smoke, temp-only admin/config smoke, temp-only Buildroom handoff smoke, temp-only MCP/file-transfer smoke, and temp-only Honcho local smoke. | Operator can continue manual end-to-end use; next engineering gate is an explicitly operator-approved live action or new production-agent expansion packet. |
| `leads_agent` | critical/customer-facing | Public escalation, plugin context, learning propose-only audit, safe dry-run, and monitor evidence are closed; no live customer-facing delivery was performed. | Explicit operator go/no-go before any WhatsApp/customer live expansion. |
| `content_sm_building` | high/group/media/cron/external MCP | Pre-live-turn gate passed: multi-root audit, explicit peer/topic confirmation, fake `send_message`/`send_media`, temp cron cleanup, and monitor. | Controlled real group turn plus immediate `runtime:pi-monitor`; requires explicit operator approval. |
| `project-manager` | high by audit queue | Detected in live multi-root audit queue, no expansion packet recorded here. | Create packet before any Pi live expansion. |

## What Counts As Done From Here

The migration should not be measured as one remaining giant task. It should be measured by closing expansion packets.

For each new production agent/channel/tool expansion:

1. Run `runtime:pi-expansion-audit` against every exact live `agents-dir` root.
2. Generate or update the expansion packet.
3. Close automated evidence: relevant `smoke:pi-*`, safe dry-run, and `runtime:pi-monitor`.
4. Close manual evidence: owner, rollback path, allowlisted route confirmation, and explicit go/no-go.
5. Run exactly one controlled live turn for the riskiest side effect.
6. Run post-expansion `runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`.
7. Record the result in the packet and this matrix if it changes fleet status.

## Practical Answer

The expected parity is strong enough to keep Pi as the default AnthroClaw runtime now. The remaining work is not "does Pi replace the Agent SDK harness?" but "which exact production agents and side-effect surfaces have been accepted under the new harness?"

The old Claude Agent SDK-centered kernel is no longer the product contract. Runtime v1 is the contract. Pi is currently the only replacement path with enough integrated evidence to carry the default runtime, while higher-risk live agents continue through explicit expansion gates.
