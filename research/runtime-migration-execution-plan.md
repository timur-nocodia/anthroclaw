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

Status: draft PR #45 added an optional `HeadlessRuntime` adapter shell. Draft PR #46 adds explicit `runtime: 'pi'` selection for headless probes. Draft PR #47 adds local config/CLI opt-in for tools-disabled headless smoke runs. Draft PR #48 adds headless session metadata plumbing for continuation probes. Full Pi tool/Gateway proof points remain open.

Goal:

- add a minimal Pi adapter behind the runtime interfaces;
- run it only from tests or an explicit experimental CLI/config flag;
- prove prompt, events, basic tools, approval gate, and session mapping.

Minimum spike scenarios:

- prompt returns streamed assistant text;
- read/write/bash/edit-style tools can be wrapped by AnthroClaw policy;
- denied tool call returns model-visible feedback;
- session can continue across two prompts;
- event mapping is sufficient for Gateway UI.

Decision gate:

- if Pi hooks/events are enough, continue Pi-first;
- if Pi requires deep forking too early, benchmark OpenCode adapter before committing further.

### PR 5: OpenCode benchmark adapter

Goal:

- run an OpenCode server/client adapter against the same runtime contract;
- compare event/session/permission/MCP parity against Pi.

Decision gate:

- choose OpenCode only if its server boundary is cleaner than rebuilding missing Pi features;
- otherwise keep OpenCode as a parity and UX reference.

## Rules for the migration

- Do not replace Claude SDK behavior and introduce a new candidate in the same PR.
- Do not let candidate-specific event shapes leak into Gateway.
- AnthroClaw owns permissions, capability cutoff, channel approvals, session mirror, metrics, and plugin hooks.
- Candidate runtimes provide the model/tool loop substrate only.
- Every new adapter must pass the same acceptance tests before being considered production-capable.

## Near-term next action

Continue the stacked migration from the smallest safe seam outward: use the local Pi headless smoke path to prove model loading, event text, and session metadata with the real package, then add tool-policy parity tests before attempting Gateway streaming.
