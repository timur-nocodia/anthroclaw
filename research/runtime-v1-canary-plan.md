# Runtime v1 canary plan

Date: 2026-05-16

## Purpose

`runtime-contract-v1` defines the full AnthroClaw feature atlas. This document defines how we prove that atlas before Pi becomes the default runtime.

The compact Pi smoke suite is necessary but not sufficient. It proves auth, workspace mutation, approval routing, Gateway dispatch, and cleanup. It does not yet prove dashboard/operator state, plugin context engines, session transcript visibility, learning artifacts, Buildroom, scheduled work, or rollback. This plan closes that gap.

The machine-readable source is `RUNTIME_CANARY_SCENARIOS` in `src/runtime/contract.ts`. Runtime contract tests assert that every default-runtime blocking feature contract is covered by at least one canary scenario.

The current CLI entrypoint is:

```bash
pnpm smoke:pi-v1-canary -- --list --json
pnpm smoke:pi-v1-canary -- --smoke-only --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000
pnpm smoke:pi-v1-canary -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000
pnpm smoke:pi-v1-canary -- --json --include-gateway-scripted --allow-skip --model anthropic/claude-sonnet-4-6 --timeout-ms 120000
pnpm smoke:pi-sessions-memory -- --json
pnpm smoke:pi-sessions-memory -- --json --gateway --allow-skip --model anthropic/claude-sonnet-4-6 --timeout-ms 120000
```

`--smoke-only` runs only the automated smoke scenarios that exist today. Full mode intentionally returns `incomplete` until the scripted/manual canaries in this document are implemented. Gateway-backed scripted checks are opt-in through `--include-gateway-scripted` because they can use real Pi auth/tokens.

## Evidence Levels

- `smoke`: automated command or CI workflow, usually with real Pi auth.
- `scripted_canary`: deterministic temporary Gateway scenario, not necessarily all wired today.
- `manual_operator_check`: dashboard/operator review with artifact or screenshots.

Default-runtime rollout requires all blocking scenarios to have either passing smoke evidence or a completed scripted/manual canary record.

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

Required checks:

- current: `pnpm smoke:pi-plugins-context -- --json`;
- current: temporary Gateway loads and enables a runtime-neutral canary plugin for one agent;
- current: disabled agent receives no plugin tools;
- current: one read-only plugin tool preserves agent/session/input context;
- current: one policy-sensitive plugin tool rejects wrong session and accepts allowed session;
- current: context-engine assemble/compress trigger;
- current: plugin hook payload attribution and shutdown;
- current: plugin subagent runner path records selected model and tools-disabled contract;
- remaining: bundled LCM/operator-console/file-transfer plugin-specific canary coverage through the same runner.

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

Status: planned scripted canary.

Proves:

- MCP onboarding remains AnthroClaw-owned;
- credential headers are resolved from credential storage, not passed raw to the provider;
- Pi sees external MCP tools only through AnthroClaw custom-tool proxies;
- policy denial for a proxied MCP tool is model-visible;
- logs and artifacts redact credential material.

Required checks:

- fake MCP server with API-key or OAuth-style auth;
- probe/connect/finalize through AnthroClaw onboarding APIs;
- Pi turn calls the proxied tool;
- header resolution from credential store;
- blocked proxied tool returns denial feedback without execution.

### 8. `pi.dashboard-operator`

Status: planned manual operator check.

Proves:

- dashboard shows effective runtime, not hardcoded Claude-only copy;
- agent admin, sessions, runs, interrupts, learning, memory, plugins, and files reflect Pi runs;
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

### 9. `pi.scheduled-buildroom`

Status: planned scripted canary.

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

### 10. `pi.rollback-mixed-runtime`

Status: planned scripted canary.

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

## Default Runtime Gate

Pi cannot become the global default until:

- all four smoke scenarios pass in a real-auth environment;
- planned scripted canaries are either implemented and passing or explicitly waived with a written risk owner;
- the dashboard operator check is completed;
- rollback is exercised;
- `runtime-contract-v1.md` and this plan are updated with evidence links.

## Next Implementation Slice

The next useful code PR should expand `smoke:pi-v1-canary` beyond the current smoke-only runners and add the planned scripted checks incrementally:

1. start with sessions/memory/learning because it is the highest migration risk;
2. add plugin/context checks;
3. add scheduled/Buildroom checks;
4. add rollback/mixed-runtime checks;
5. emit a single JSON artifact keyed by `RUNTIME_CANARY_SCENARIOS` ids.
