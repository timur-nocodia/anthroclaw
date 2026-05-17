# Runtime v1 canary plan

Date: 2026-05-16

## Purpose

`runtime-contract-v1` defines the full AnthroClaw feature atlas. This document defines how we prove that atlas before Pi becomes the default runtime.

The compact Pi smoke suite is necessary but not sufficient. It proves auth, workspace mutation, approval routing, Gateway dispatch, and cleanup. It does not yet prove dashboard/operator state; scripted canaries now cover plugin context engines, session transcript visibility, learning artifacts, external MCP, Buildroom, scheduled work, and rollback. This plan closes the remaining gap.

The machine-readable source is `RUNTIME_CANARY_SCENARIOS` in `src/runtime/contract.ts`. Runtime contract tests assert that every default-runtime blocking feature contract is covered by at least one canary scenario.

The current CLI entrypoint is:

```bash
pnpm smoke:pi-v1-canary -- --list --json
pnpm smoke:pi-v1-canary -- --smoke-only --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000
pnpm smoke:pi-v1-canary -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000
pnpm smoke:pi-v1-canary -- --json --include-gateway-scripted --allow-skip --model anthropic/claude-sonnet-4-6 --timeout-ms 120000
pnpm runtime:pi-decision -- --input <pi-v1-canary.log-or-json> --summary <decision.md> --json <decision.json>
pnpm smoke:pi-sessions-memory -- --json
pnpm smoke:pi-sessions-memory -- --json --gateway --allow-skip --model anthropic/claude-sonnet-4-6 --timeout-ms 120000
pnpm smoke:pi-external-mcp -- --json
pnpm smoke:pi-public-escalation -- --json
```

`--smoke-only` runs only the automated smoke scenarios that exist today. Full mode runs the smoke and scripted canary map. Gateway-backed scripted checks are opt-in through `--include-gateway-scripted` because they can use real Pi auth/tokens.

## Evidence Levels

- `smoke`: automated command or CI workflow, usually with real Pi auth.
- `scripted_canary`: deterministic temporary Gateway scenario, not necessarily all wired today.
- `manual_operator_check`: optional dashboard/browser review with artifact or screenshots.

Default-runtime rollout requires all blocking scenarios to have either passing smoke evidence or a completed scripted/manual canary record.

The decision package command turns the full canary JSON into the go/no-go artifact. It remains `BLOCKED` until the canary map passes, the PR stack is merged, and the first production canary window is recorded.

The production canary window runbook is `docs/pi-production-canary-runbook.md`.

Repository-hosted full evidence is available through the manual GitHub Actions workflow **Pi Runtime v1 decision**, which uploads `pi-runtime-v1-decision`.

Evidence captured on 2026-05-16 and 2026-05-17: full `pnpm smoke:pi-v1-canary -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` passed all ten original scenarios with existing local Pi auth storage. The same full canary also passed on the rebased integration candidate PR #95 after the stack was replayed onto current `main`, and PR #95 later merged. After repository secret `PI_AUTH_JSON_B64` was configured for CI, post-merge **Pi Runtime v1 decision** workflow run `25965686443` on `main` passed build, Pi storage preparation, the full ten-scenario canary map, and artifact upload. After the guarded canary CLI merge and exact rollback restore update, workflow run `25969043105` on `main` passed the same ten-scenario map. PR #106 later fixed the focused Pi Web UI/Gateway canary blockers: session continuation now resumes through Pi's session-file reference, outside-workspace filesystem tools are denied, and Pi partial streaming no longer duplicates `text_end`. PR #108 made `pi-workspace-smoke` require an exact `SMOKE_OK` reply. A local full canary from `main` after PR #107 and PR #108 passed all ten scenarios again, with standalone and aggregate workspace smoke both returning exactly `SMOKE_OK`. The limited `example` Web UI production canary then passed and was rolled back with exact backup restore; the regenerated local decision package with `production_canary=passed` and `pr_stack=merged` is `READY`. After Ring 4.5 exposed and fixed the public `escalate` MCP metadata gap, `pi.public-escalation` was added as the eleventh durable canary scenario.

## Canary Scenarios

### 1. `pi.auth-model-preflight`

Command:

```bash
pnpm smoke:pi-auth -- --json --model anthropic/claude-sonnet-4-6
```

Proves:

- Pi package import;
- model registry resolution;
- provider auth readiness;
- redacted diagnostics;
- isolated `--auth-path` / `--models-path` support when used.

Covers:

- `runtime.model-auth-storage`;
- `config.schema-auth`;
- `ops.smoke-ci`.

### 2. `pi.workspace-tools-rewind`

Command:

```bash
pnpm smoke:pi-workspace -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000
```

Proves:

- Pi can edit an explicit workspace;
- AnthroClaw policy observes the mutation path;
- checkpoint dry-run sees a reversible change;
- restore returns the file to the original state.

Covers:

- runtime handle and event normalization;
- active control;
- built-in tool policy;
- file ownership/workspace boundaries;
- metrics and smoke evidence.

### 3. `pi.gateway-channel-approval`

Command:

```bash
pnpm smoke:pi-gateway -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000
```

Proves:

- Pi runs through Gateway dispatch;
- channel-shaped inbound context reaches the runtime;
- approval broker observes and resolves a write/edit request;
- session id is recorded;
- workspace mutation is verified;
- shutdown is quiet.

Covers:

- Gateway runtime selection, dispatch, active control, cleanup;
- session keys and channel routing;
- tool policy and decisions;
- provider session store visibility;
- run/usage observability.

### 4. `pi.aggregate-real-auth`

Command:

```bash
pnpm smoke:pi-all -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000
```

Also run the manual GitHub Actions **Pi smoke** workflow using repository secrets.

Proves:

- auth, workspace, and Gateway probes pass together;
- CI/staging credentials are file-scoped and redacted;
- the workflow artifact can act as a migration decision record.

Covers:

- the current hard automated gate before deeper canaries.

### 5. `pi.plugins-context-tools`

Status: scripted canary runner available for deterministic Gateway/plugin harness coverage.

Proves:

- plugin discovery/lifecycle remains runtime-neutral;
- plugin MCP tools remain agent-scoped through the Gateway plugin registry;
- plugin subagent runner uses the selected runtime with tools disabled;
- context engine assemble/compress semantics remain intact;
- plugin hook payloads preserve agent/session attribution.
- bundled LCM, operator-console, and file-transfer plugin APIs remain compatible with the registry/context contract.

Required checks:

- current: `pnpm smoke:pi-plugins-context -- --json`;
- current: temporary Gateway loads and enables a runtime-neutral canary plugin for one agent;
- current: disabled agent receives no plugin tools;
- current: one read-only plugin tool preserves agent/session/input context;
- current: one policy-sensitive plugin tool rejects wrong session and accepts allowed session;
- current: context-engine assemble/compress trigger;
- current: plugin hook payload attribution and shutdown;
- current: plugin subagent runner path records selected model and tools-disabled contract;
- current: real bundled LCM compiled manifest entry/register path, tool namespace, mirror hook, grep/status, and context engine assemble/compress through a deterministic registry/context harness;
- current: real bundled operator-console compiled manifest entry/register path, tool namespace, peer-summary memory callback, authorized delegate dispatch payload, denied delegate policy, and escalation event payload;
- current: real bundled file-transfer compiled manifest entry/register path, tool namespace, safe directory listing, file read/write, and outside-root denial;
- remaining: deeper LCM `expand_query` semantic quality check and operator-console peer pause/list-peers Gateway-store integration.

### 6. `pi.sessions-memory-learning`

Status: scripted canary runner available for the storage/protocol path, with opt-in Gateway two-turn continuation checks through `--gateway`.

Proves:

- session transcript storage remains searchable through transcript recall;
- title generation still runs through the runtime-neutral title adapter contract;
- memory search/write/review remains AnthroClaw-owned;
- learning review parsing/persistence produces memory candidate actions;
- applied learning memory preserves run/session provenance;
- learning artifacts are exported, persisted, and redacted;
- learning queue shutdown drains active work and drops pending writes;
- opt-in Gateway mode preserves Pi session continuity and memory influence evidence across two dispatches.

Required checks:

- current: `pnpm smoke:pi-sessions-memory -- --json`;
- current opt-in: `pnpm smoke:pi-sessions-memory -- --json --gateway --allow-skip --model anthropic/claude-sonnet-4-6 --timeout-ms 120000`;
- current: session store append, transcript index search, recall summary;
- current: title normalization through injected query function;
- current: learning review/action persistence;
- current: high-confidence private memory candidate apply and memory search;
- current: learning artifact file/snippet/manifest export with secret redaction;
- current: learning artifact rows retain review/run/session linkage;
- current: learning queue `stop({ drainActive: true })` drains active work and clears pending work;
- current opt-in: real Pi two-turn continuation through Gateway session mapping;
- current opt-in: `listAgentSessions`, `getAgentSessionDetails`, `listAgentRuns`, `listRouteDecisions`;
- current opt-in: prefetch memory influence event for the continued session;
- remaining: session label/export UI parity;

### 7. `pi.external-mcp-proxy`

Status: scripted canary runner available for deterministic credential/proxy/Pi custom-tool bridge coverage.

Proves:

- MCP onboarding remains AnthroClaw-owned;
- credential headers are resolved from credential storage, not passed raw to the provider;
- Pi sees external MCP tools only through AnthroClaw custom-tool proxies;
- policy denial for a proxied MCP tool is model-visible;
- logs and artifacts redact credential material.

Required checks:

- current: `pnpm smoke:pi-external-mcp -- --json`;
- current: external MCP server config is parsed through `AgentYmlSchema` before proxy construction;
- current: API-key credential resolves from a credential store into an Authorization header without mutating raw agent config;
- current: only `allowed_tools` are exposed as Claude-compatible `mcp__server__tool` custom tools;
- current: injected Pi runtime receives the proxied MCP tool through `customTools` / `defineTool`;
- current: allowed Pi custom-tool execution calls the AnthroClaw-owned MCP proxy and forwards normalized content;
- current: denied Pi custom-tool execution returns model-visible denial without calling upstream MCP;
- current: canary JSON artifacts redact credential material;
- note: this runner is deterministic and does not use `--gateway`, `--auth-path`, or `--models-path`; the aggregate runner intentionally does not forward those flags to this scenario;
- remaining: full probe/connect/finalize API flow against a fake MCP server with persisted pending rows.

### 8. `pi.dashboard-operator`

Status: scripted canary implemented for the operator API evidence path.

Scope note: this is API/data-contract evidence against Pi-shaped Gateway state. A browser screenshot pass remains optional non-blocking UX evidence.

Proves:

- dashboard/API data shows effective runtime, not hardcoded Claude-only copy;
- agent admin, sessions, runs, interrupts, learning, memory, plugins, and files expose Pi-shaped run state;
- MCP onboarding/status remains credential-safe;
- channel route-test and pause/notification surfaces remain accurate;
- diagnostics export includes runtime state without secrets.

Required checks:

- `/api/gateway/status`;
- `/api/agents`;
- `/api/agents/:id/sessions`;
- `/api/agents/:id/runs`;
- `/api/agents/:id/learning`;
- `/api/plugins`;
- `/api/mcp/*`;
- `/api/diagnostics/export`.

Evidence command:

- `pnpm smoke:pi-dashboard-operator -- --json`

### 9. `pi.scheduled-buildroom`

Status: scripted canary implemented.

Proves:

- cron/heartbeat runs use the same runtime/session/tool policy as live messages;
- Buildroom workflow state and operator controls remain runtime-compatible;
- Buildroom handoff/session-summary tools keep source agent/session binding;
- artifacts, locks, path policy, QA, retention, and notifications remain inspectable.

Required checks:

- `manage_cron` scheduled run;
- heartbeat-style dispatch;
- Buildroom init/status/pause/resume/kill-switch;
- Buildroom tool call with source session context;
- artifact and notification evidence.

Evidence command:

- `pnpm smoke:pi-scheduled-buildroom -- --json`

### 10. `pi.public-escalation`

Status: scripted canary implemented.

Proves:

- public-facing agents can call the operator escalation path through prefixed MCP tool policy;
- `MCP_META.escalate` remains registered as public-safe, non-destructive, and not hard-blacklisted;
- `allowed_mcp_tools` may allow the local tool name while still denying unknown plugin MCP tools in `safety_profile=public`;
- escalation output is AnthroClaw-owned JSONL under isolated `OC_DATA_DIR`, not provider conversation state.

Required checks:

- public profile policy allows `mcp__leads_agent-tools__escalate`;
- public profile policy denies an unknown `mcp__leads_agent-tools__*` plugin tool;
- escalation tool writes exactly one `leads_agent` JSONL row;
- temporary workspace/data paths are removed unless `--keep-workspace` is requested.

Evidence command:

- `pnpm smoke:pi-public-escalation -- --json`

### 11. `pi.rollback-mixed-runtime`

Status: scripted canary implemented.

Proves:

- one agent canary-runs on Pi while the global default remains Claude;
- one agent can remain pinned to Claude when global Pi config exists;
- bad Pi auth on an explicitly Pi-enabled agent fails loudly;
- rollback to Claude does not corrupt product session visibility.

Required checks:

- per-agent Pi opt-in;
- per-agent Claude opt-out;
- explicit bad-auth failure;
- rollback and session inspection.

Evidence command:

- `pnpm smoke:pi-rollback-runtime -- --json`

## Default Runtime Gate

Pi cannot become the global default until:

- all four smoke scenarios pass in a real-auth environment;
- scripted canaries are implemented and passing in CI or explicitly waived with a written risk owner;
- the dashboard operator canary is completed;
- rollback is exercised;
- `runtime-contract-v1.md` and this plan are updated with evidence links.

## Next Implementation Slice

The next useful PR should close the remaining rollout evidence gap:

1. execute the first production canary window runbook and attach the redacted evidence;
2. rerun the durable Runtime v1 decision workflow from `main` with `production_canary=passed` and `fail_on_blocked=true`;
3. if the decision package is `READY`, prepare the smallest possible default-runtime flip with explicit rollback instructions.
