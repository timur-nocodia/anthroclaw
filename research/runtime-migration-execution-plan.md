# Runtime migration execution plan

Date: 2026-05-15

## Current decision

AnthroClaw should own the harness/control plane. The replacement path is **Pi-first**, with **OpenCode as parity benchmark** and **Codex App Server as a follow-up spike** if its third-party runtime surface is stable enough.

The immediate implementation strategy is not to swap runtimes directly. First, protect a runtime boundary around the current Claude Agent SDK behavior, then use that boundary to compare candidates.

## Workstream order

### PR 1: Claude runtime boundary baseline

Status: draft PR #41.

Goal:

- add `src/runtime` as the runtime seam;
- keep current Claude Agent SDK behavior unchanged;
- route the highest-risk direct value imports from Gateway/headless/warm paths through the Claude adapter;
- document the replacement requirements and candidate analysis.

Definition of done:

- `Gateway` no longer imports Claude SDK runtime functions directly;
- headless review no longer imports Claude SDK `query` directly;
- warm query pool no longer imports Claude SDK `startup` directly;
- adapter delegation is unit-tested;
- full test suite passes after plugin build.

### PR 2: Runtime-owned event and run contract

Status: draft PR #42, followed by draft PR #43 for moving active run registries onto `RuntimeRunHandle`.

Goal:

- add normalized `RuntimeEvent` types for the events AnthroClaw already consumes;
- add a thin `RuntimeRunHandle` contract for async iteration, interrupt, and close semantics;
- wrap existing Claude `Query` behind this contract without changing Gateway logic yet.

Definition of done:

- no user-visible behavior change;
- existing SDK event extraction still works;
- new contract has tests with synthetic streams;
- Gateway still consumes Claude events through existing extractor functions.

### PR 3: Headless runtime contract

Status: draft PR #44.

Goal:

- move title generation, memory extraction, plugin subagent runner, learning review, and session recall onto a `HeadlessRuntime` interface;
- keep Claude implementation as default;
- make this path the first candidate test target because it has no channel streaming or subagent UI pressure.

Definition of done:

- all current headless review tests pass;
- no headless path imports Claude SDK directly outside the runtime adapter;
- tool-denied invariant remains tested.

### PR 4: Pi spike, non-production path

Status: draft PR #45 added an optional `HeadlessRuntime` adapter shell. Draft PR #46 adds explicit `runtime: 'pi'` selection for headless probes. Draft PR #47 adds local config/CLI opt-in for tools-disabled headless smoke runs. Draft PR #48 adds headless session metadata plumbing for continuation probes. Draft PR #49 adds ModelRegistry-like resolution and explicit Pi tool policy mapping. Draft PR #50 adds Pi `tool_call` denial feedback through an inline policy extension. Draft PR #51 adds Pi session event normalization into AnthroClaw `RuntimeEvent`. Draft PR #52 adds Claude SDK event normalization and moves Gateway stream loops for partial text, usage, and tool lifecycle onto `RuntimeEvent`. Draft PR #53 adds a non-default Gateway bridge that runs web/channel queries through the configured Pi headless runtime when `runtime.headless.provider: pi`. Draft PR #54 adds a Pi `RuntimeRunHandle` over `AgentSession.subscribe()` and makes the opt-in Gateway Pi path consume streamed `RuntimeEvent` values. Draft PR #55 routes the opt-in Gateway Pi path's per-run tool policy through AnthroClaw `buildAllowedTools()`, `createCanUseTool()`, and `ApprovalBroker` for built-in Pi tool approval semantics. Draft PR #56 exposes local AnthroClaw per-dispatch tools through Pi `customTools`. Draft PR #57 exposes configured external MCP servers to Pi through AnthroClaw-owned custom-tool proxies. Draft PR #58 registers Pi runtime handles with AnthroClaw active-run, interrupt, session-alias, and checkpoint-control registries. Draft PR #61 adds AnthroClaw-owned workspace snapshot rewind to Pi `RuntimeRunHandle`. Draft PR #62 adds an opt-in real Pi workspace smoke probe for edit + dry-run + restore verification. Draft PR #63 adds an opt-in Gateway-level Pi smoke probe for channel dispatch, approval routing, and workspace mutation. Draft PR #64 adds a sequential aggregate `smoke:pi-all` gate for Pi-authenticated environments. Draft PR #65 makes the Pi SDK package a pinned optional dependency and reports Gateway runtime failures before secondary file-verification symptoms. Draft PR #66 adds a standalone Pi auth/model preflight and makes the aggregate gate stop before runtime probes when auth is not ready.

Goal:

- add a Pi adapter behind the runtime interfaces;
- run it only from tests or an explicit experimental CLI/config flag;
- prove prompt, events, basic tools, custom AnthroClaw tools, approval gate, system prompt override, and session mapping.

Minimum spike scenarios:

- prompt returns streamed assistant text;
- read/write/bash/edit-style tools can be wrapped by AnthroClaw policy;
- local AnthroClaw tools can be passed to Pi as `customTools`;
- external MCP tools can be proxied through AnthroClaw-owned custom tools;
- denied tool call returns model-visible feedback;
- session can continue across two prompts;
- Pi Gateway runs can be interrupted through the shared active-run control plane;
- checkpoint rewind restores explicit-cwd Gateway workspace files through AnthroClaw-owned snapshots;
- local smoke probe can exercise real Pi workspace edit and rewind behavior outside the unit-test mock layer;
- Gateway smoke probe can exercise channel dispatch, tool approval routing, session mapping, and file mutation outside the unit-test mock layer when Pi is installed/authenticated;
- event mapping is sufficient for Gateway UI.

Decision gate:

- if Pi hooks/events are enough, continue Pi-first;
- if Pi requires deep forking too early, benchmark OpenCode adapter before committing further.

### PR 5: OpenCode benchmark adapter

Status: draft PR #59 adds an optional OpenCode headless runtime adapter behind the existing runtime registry. It is a benchmark adapter, not a production Gateway path.

Goal:

- run an OpenCode server/client adapter against the same runtime contract;
- compare event/session/permission/MCP parity against Pi.

Minimum benchmark scenarios:

- create an OpenCode session and send a prompt through `session.prompt`;
- resume an existing OpenCode session id through the same `HeadlessRunInput.sessionId` field used by Pi;
- emit normalized `RuntimeEvent` values from the benchmark `runHandle`;
- interrupt a running OpenCode session through `session.abort`;
- map AnthroClaw checkpoint rewind requests to OpenCode `session.revert` where available.

Decision gate:

- choose OpenCode only if its server boundary is cleaner than rebuilding missing Pi features;
- otherwise keep OpenCode as a parity and UX reference.

### PR 6: Runtime contract acceptance harness

Status: draft PR #60 formalizes the runtime contract and adds shared acceptance tests for Pi and OpenCode adapters.

Goal:

- turn the migration decision into a scenario matrix rather than a vague runtime preference;
- keep a machine-readable source of truth for candidate pass/partial/fail status;
- add reusable acceptance coverage for text, session continuation, normalized event streaming, interrupt, timeout abort, and rewind capability shape;
- document exactly which gaps block production migration.

Definition of done:

- `src/runtime/contract.ts` lists every production-required scenario and every candidate status;
- the matrix covers Claude Agent SDK, Pi, and OpenCode for the same scenarios;
- Pi and OpenCode pass the shared acceptance harness for the runtime behaviors they currently expose;
- research docs show the current score and blockers without implying OpenCode is production-ready.

## Rules for the migration

- Do not replace Claude SDK behavior and introduce a new candidate in the same PR.
- Do not let candidate-specific event shapes leak into Gateway.
- AnthroClaw owns permissions, capability cutoff, channel approvals, session mirror, metrics, and plugin hooks.
- Candidate runtimes provide the model/tool loop substrate only.
- Every new adapter must pass the same acceptance tests before being considered production-capable.

## Near-term next action

Continue the stacked migration from the smallest safe seam outward: with model loading, event text, session metadata, explicit tool policy, model-visible denial feedback, Pi event normalization, Claude-path Gateway `RuntimeEvent` consumption, a non-default Pi Gateway bridge, streamed Pi `RuntimeRunHandle` consumption, built-in Pi tool approval routed through AnthroClaw's permission broker, Pi-hosted custom AnthroClaw tools, external MCP proxying, active-run/session/checkpoint-control registry parity, an OpenCode headless benchmark adapter, a shared runtime acceptance contract, Pi workspace snapshot rewind, an opt-in real Pi workspace smoke probe, an opt-in Gateway Pi smoke probe, an aggregate Pi smoke gate, reproducible Pi package setup, and explicit Pi auth preflight covered, the next useful proof is running `pnpm smoke:pi-auth -- --model anthropic/claude-sonnet-4-6 --json` and then `pnpm smoke:pi-all -- --json` in a Pi-authenticated environment. A local unauthenticated run now reaches Pi and fails at provider credentials instead of package resolution. An OpenCode Gateway benchmark path should come next only if that real Pi run exposes a hard SDK/runtime mismatch or if we need hard evidence that OpenCode's server boundary can carry AnthroClaw permission/event/tool parity more cheaply than hardening Pi.
