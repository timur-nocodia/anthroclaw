# AnthroClaw Integration Model

Status: Draft

Purpose: describe how Auto-Buildroom fits into AnthroClaw alongside ordinary agents, including the distinction between an `Agent` and a `Buildroom` / buildroom squad.

This document is an AnthroClaw product adaptation of the Hermes/OpenClaw Auto-think / Auto-build pattern, not a literal runtime design.

## Integration Thesis

Auto-Buildroom should not replace ordinary AnthroClaw agents.

It should add a second kind of user-facing object:

```text
Agent = conversational worker.
Buildroom = coordinated agent squad with artifacts, approvals, QA, and trust state.
```

This lets a user keep normal agents for chat, support, coding, content, or personal workflows while also running one or more Buildrooms for accountable autonomous work.

The product model:

```text
ordinary agents keep working normally
Buildroom runs beside them as a controlled operating room
ordinary agents may provide signals, but they do not get buildroom authority by default
```

## Original Concept Mapping

The integration model preserves the original role separation while adapting it to AnthroClaw's agent and gateway primitives.

| Original concept | AnthroClaw product concept |
| --- | --- |
| Research agent | Research role / evidence collector |
| Research vault | Filesystem-backed research vault |
| Subconscious | Pattern-noticing role and subconscious room |
| Dreamer / Auto-think | Idea contract generator |
| Build intent marker | Signal artifact, not approval |
| Signal board | Buildroom signal state |
| Main | Approval and scope gate |
| Product plan | Approved work contract |
| Coder | Bounded builder role |
| QA | Independent verifier |
| Verification delta | Claims vs evidence comparison |
| Trust reporting | Trust state and operator report |
| Retention | Keep/improve/park/prune/ghost/reopen decision |
| Control room | Buildroom operator surface |

The key adaptation is that AnthroClaw already has ordinary routed agents. Auto-Buildroom should coordinate a Buildroom squad beside those agents rather than turning every existing agent into an autonomous builder.

## Current AnthroClaw Fit

The current repo appears to provide the primitives Auto-Buildroom should build around. These have been observed in the codebase at the product-planning level and should be verified again during implementation:

- per-agent folders: `agents/{id}/agent.yml` and `agents/{id}/AGENTS.md`;
- route-based dispatch through the gateway;
- per-agent `plugins` config;
- built-in MCP tools;
- subagents;
- cron jobs;
- hooks;
- quick commands;
- safety profiles;
- operator-facing Telegram/WhatsApp channels;
- native Agent SDK runtime calls.

Observed code anchors:

- `src/config/schema.ts` defines `plugins`, `subagents`, `cron`, `hooks`, `quick_commands`, and `safety_profile` in `AgentYmlSchema`.
- `src/gateway.ts` and `src/agent/agent.ts` call native Agent SDK `query()` and `createSdkMcpServer()`.
- `agents/example/agent.yml` demonstrates per-agent config shape.

Auto-Buildroom should use these primitives rather than inventing a separate agent universe.

The main addition is the Buildroom control plane:

```text
Buildroom Orchestrator
  -> references AnthroClaw agents as role agents
  -> stores artifacts and state
  -> enforces approvals and policies
  -> invokes role runs through the native runtime
  -> renders operator summaries
```

## Two User-Facing Object Types

### Agent

An Agent is a conversational worker.

It has:

- routes;
- memory;
- tools;
- sessions;
- cron jobs;
- hooks;
- a system prompt;
- optional plugin config.

Example:

```text
agents/amina/
agents/code-helper/
agents/content-writer/
agents/support-bot/
```

An ordinary agent responds to messages.

```text
message -> route -> agent -> query() -> response
```

### Buildroom

A Buildroom is a coordinated work system.

It has:

- role assignments;
- watched sources;
- policy boundaries;
- artifact storage;
- approval state;
- build state;
- QA and trust state;
- operator reports.

A Buildroom does not primarily respond to every message. It runs staged workflows.

```text
signal/event/command/cron
-> buildroom orchestrator
-> role run
-> artifact
-> policy transition
-> next stage or operator decision
```

## Buildroom Squad

Product-wise, a Buildroom appears as one operating room. Internally, it may use several AnthroClaw agents.

Example:

```text
agents/
  amina/
  code-helper/
  content-writer/

  buildroom-operator/
  buildroom-research/
  buildroom-subconscious/
  buildroom-main/
  buildroom-builder/
  buildroom-qa/
  buildroom-trust/
```

In the UI/CLI, this should not feel like seven unrelated agents. It should appear as one Buildroom:

```text
Buildrooms
  AnthroClaw Core
    Operator: buildroom-operator
    Research: buildroom-research
    Subconscious: buildroom-subconscious
    Main Review: buildroom-main
    Builder: buildroom-builder
    QA: buildroom-qa
    Trust: buildroom-trust
```

## Recommended v0.1 Shape

For v0.1, keep the visible surface small:

```text
one Buildroom
one operator-facing agent or CLI surface
internal role runners or role agents
manual approval only
filesystem-backed artifacts
safe docs/test demo
```

More precisely:

```text
v0.1 may automate research, signal detection, and proposal generation.
v0.1 must not automate build execution without explicit operator approval.
```

The first implementation does not need every role to be a separately routed public chat agent.

Recommended path:

1. Add a Buildroom plugin/control-plane.
2. Add one operator-facing command surface.
3. Store all Buildroom artifacts in a project-local root.
4. Run role stages through native Agent SDK calls or deterministic fixtures.
5. Let role agents become explicit and configurable after the artifact/policy model is stable.

This avoids turning the first release into agent roster management.

## Non-Goals For v0.1

Auto-Buildroom v0.1 must not try to prove the whole long-term autonomy story at once.

Non-goals:

- Buildroom is not a replacement for ordinary agents.
- Buildroom is not a second runtime.
- Buildroom does not grant build powers to watched agents.
- Buildroom does not auto-approve proposals.
- Buildroom does not post, deploy, release, or edit production config.
- Buildroom does not treat chat messages as durable approvals unless routed through the approval surface.
- Buildroom does not require a full web dashboard.
- Buildroom does not require every role to be a separately visible chat agent.

## Relationship To Ordinary Agents

Ordinary agents remain normal AnthroClaw agents.

They can be connected to a Buildroom in three modes.

### Mode 1: Isolated

The ordinary agent has no Buildroom relationship.

```text
user -> ordinary agent -> response
```

This is the default.

### Mode 2: Watched Signal Source

The Buildroom may read approved summaries, events, or session metadata from selected agents.

```text
ordinary agent sessions/events -> Buildroom Research -> findings
```

The ordinary agent does not know or care that it is being watched.

Important rule:

```text
watching is not authority
```

The watched agent cannot approve, build, or verify work merely because its sessions became signals.

### Mode 3: Handoff Source

An ordinary agent may explicitly hand a signal to the Buildroom through a controlled tool or command.

Example:

```text
Amina notices repeated operator friction
-> proposes signal to Buildroom
-> Buildroom stores signal
-> Research/Subconscious decide whether it matters
```

Important rule:

```text
handoff is not approval
```

The ordinary agent can say "this may be worth looking at." It cannot say "build this."

## Buildroom Authority Boundaries

Auto-Buildroom authority must be narrower than normal chat authority.

An ordinary agent may:

- chat with users;
- use its configured tools;
- write memory;
- answer questions;
- optionally propose signals.

A Buildroom may:

- collect approved signals;
- create artifacts;
- request approvals;
- run scoped builds;
- run QA;
- render trust reports.

A Buildroom must not:

- grant ordinary agents new build powers by default;
- approve its own proposals;
- bypass native runtime permissions;
- write outside approved paths;
- treat a chat message as a durable approval without identity checks;
- convert every observed signal into a task.

## Configuration Model Direction

AnthroClaw already supports global plugin config and per-agent plugin config. Auto-Buildroom should use that split.

Global/default config should describe plugin-wide defaults:

```yaml
plugins:
  autoBuildroom:
    defaults:
      root: ".anthroclaw/auto-buildroom"
      mode: "manual_approval"
      operatorIds:
        - "telegram:48705953"
      blockedPaths:
        - ".env"
        - "**/*secret*"
        - "**/*token*"
```

Buildroom config should describe one operating room:

```yaml
buildrooms:
  anthroclaw-core:
    enabled: true
    root: ".anthroclaw/auto-buildroom/rooms/anthroclaw-core"
    mode: "manual_approval"
    roles:
      operator: buildroom-operator
      research: buildroom-research
      subconscious: buildroom-subconscious
      main: buildroom-main
      builder: buildroom-builder
      qa: buildroom-qa
      trust: buildroom-trust
    watch:
      agents:
        - amina
        - code-helper
      sources:
        - repo
        - docs
        - tests
        - sessions
    allowedPaths:
      - "docs/**"
      - "tests/**"
      - "plugins/auto-buildroom/**"
    blockedPaths:
      - ".env"
      - "**/.env"
      - "**/*secret*"
      - "**/*token*"
```

This schema is conceptual. The final implementation should follow the real AnthroClaw config constraints and avoid adding unrecognized keys until the schema supports them.

## Operator Surfaces

Buildroom should be accessible without disrupting ordinary chat.

Primary surfaces:

- CLI: `anthroclaw buildroom ...`;
- Telegram commands: `/buildroom status`, `/buildroom approve ...`;
- Markdown reports in the buildroom root;
- later: static HTML report or dashboard panel.

Ordinary agent chat should not become cluttered with Buildroom internals unless the operator explicitly asks for them.

## Runtime Boundary

Auto-Buildroom is not a runtime fork.

All role execution should go through AnthroClaw's existing native Agent SDK runtime integration.

The Buildroom orchestrator may:

- choose the next stage;
- assemble the role prompt;
- pass approved context;
- store receipts;
- enforce pre-run and post-run policy;
- render reports.

The native runtime still owns:

- model execution;
- tool calls;
- permissions;
- approvals;
- sessions;
- cancellation;
- logs;
- error semantics.

This boundary protects AnthroClaw from a dangerous second orchestration stack.

## Storage Boundary

Ordinary agent memory and Buildroom receipts should not be mixed.

Memory is for durable preferences, stable facts, and user/project context.

Buildroom artifacts are for audit, approval, execution, QA, and trust.

Recommended project-local root:

```text
.anthroclaw/auto-buildroom/
  rooms/
    anthroclaw-core/
      research-vault/
      subconscious-room/
      buildroom/
        ideas/
        approvals/
        plans/
        builds/
        qa/
        deltas/
        trust/
        operator/
```

This lets a user delete or archive Buildroom state without corrupting ordinary agent memory.

## Receipt Minimum Standard

A receipt is not a Markdown summary.

Every durable Buildroom receipt should include at least:

- `id`;
- `type`;
- `producer`;
- `role`;
- `parentIds`;
- `inputRefs`;
- `outputRefs`;
- `claims`;
- `evidence`;
- `decision`;
- `status`;
- `timestamp`;
- `traceId`;
- `contentHash`.

Operator summaries may render receipts into Markdown, Telegram text, or HTML, but the source of truth should remain structured.

Hard rule:

```text
If there is no receipt, the Buildroom should behave as if the action did not happen.
```

## MVP Integration Scenario

The first real integration should look like this:

1. User creates `anthroclaw-core` Buildroom for the local repo.
2. Ordinary agents continue working normally.
3. Buildroom Research inspects repo/docs/tests and approved recent session summaries.
4. Dreamer proposes one safe docs/test/operator-summary improvement.
5. Main Review locks scope to docs/tests only.
6. Operator approves manually through CLI or Telegram.
7. Builder runs within allowed paths.
8. QA independently verifies.
9. Trust Report explains result.
10. Operator sees a receipt chain.

This proves the coexistence model:

```text
normal agents stay useful
Buildroom adds accountable autonomous work
```

## Product Decisions For v0.1

These are product decisions for the first implementation slice, not suggestions.

### 1. Buildroom Configuration Location

Decision: v0.1 uses project-local Buildroom configuration under `.anthroclaw/auto-buildroom/`.

Rationale: A Buildroom is scoped to a repository, allowed paths, local artifacts, and operator decisions. Global config may provide defaults later, but v0.1 should avoid adding global schema surface before the workflow stabilizes.

Default:

```text
.anthroclaw/auto-buildroom/buildroom.yml
```

or, for a named room:

```text
.anthroclaw/auto-buildroom/rooms/anthroclaw-core/buildroom.yml
```

### 2. Role Agents Versus Internal Role Runners

Decision: v0.1 role execution is internal to the Buildroom control plane. Roles are visible in artifacts and receipts, but they are not exposed as separate ordinary AnthroClaw agents by default.

Rationale: The first release should prove the artifact and policy workflow, not agent roster management. Explicit role agents can be added later once the Buildroom model is stable.

Default:

```text
one Buildroom
one operator surface
internal Research / Dreamer / Main / Builder / QA / Trust roles
```

### 3. Safe Session Summary Format For Watched Agents

Decision: v0.1 watches sanitized session summaries, not raw ordinary-agent transcripts.

Rationale: Buildroom should gather signals without turning ordinary chat history into uncontrolled context material.

Minimum summary fields:

```yaml
id: session-summary-2026-05-11-001
sourceAgentId: code-helper
sourceSessionId: session_xxx
createdAt: 2026-05-11T12:00:00Z
summary:
  userIntent: "Short sanitized description of what the user wanted."
  observedFriction:
    - "Concrete friction observed in the session."
  candidateSignals:
    - type: friction
      text: "Potential signal for Buildroom Research."
      confidence: medium
  evidenceRefs:
    - type: session
      ref: session_xxx
      excerpt: "Short sanitized excerpt or pointer, not full transcript."
privacy:
  rawTranscriptIncluded: false
  piiRedacted: true
  secretsRedacted: true
allowedUse:
  canBeUsedForResearch: true
  canCreateIdeaCandidate: true
  canApproveWork: false
```

Rule:

```text
Watch summaries, not raw sessions.
```

### 4. Handoff From Ordinary Agents

Decision: v0.1 handoff from ordinary agents requires an explicit controlled handoff tool. Quick commands may be added later as a UX wrapper, but the durable artifact must be created through the same structured tool path.

Rationale: Handoff is not approval. A structured tool makes the boundary visible, auditable, and policy-checkable.

Default handoff shape:

```yaml
sourceAgentId: code-helper
sourceSessionId: session_xxx
targetBuildroom: anthroclaw-core
signalType: friction
summary: "What the agent noticed."
evidenceRefs:
  - type: session-summary
    ref: session-summary-2026-05-11-001
confidence: medium
requestedAction: research_only
authority:
  canApprove: false
  canBuild: false
```

### 5. Artifact Root

Decision: v0.1 stores Buildroom state under `.anthroclaw/auto-buildroom`.

Rationale: The Buildroom is an AnthroClaw product surface in v0.1. A namespaced root avoids collisions with unrelated tools and keeps ordinary agent memory separate from Buildroom audit artifacts.

Default structure:

```text
.anthroclaw/
  auto-buildroom/
    buildroom.yml
    rooms/
      anthroclaw-core/
        research-vault/
        subconscious-room/
        buildroom/
          ideas/
          approvals/
          plans/
          builds/
          qa/
          deltas/
          trust/
          operator/
```

### 6. Approval Route

Decision: v0.1 accepts approvals only through the Buildroom operator surface: CLI Buildroom commands or dedicated Buildroom Telegram commands.

Rationale: Approval is an authority boundary. Accepting approvals through arbitrary trusted routes makes context ambiguous and risks accidental privilege escalation.

Allowed approval routes:

```text
anthroclaw buildroom approve <id>
/buildroom approve <id>
```

Not allowed in v0.1:

```text
ordinary agent chat approval
watched session approval
handoff approval
implicit approval from "yes" in unrelated context
```

Approval identity must be a first-class policy boundary, not message text.

## Future Reconsiderations

These are intentionally deferred until the v0.1 workflow is stable:

- Global Buildroom config may come later after the project-local schema proves itself.
- Explicit role agents may be exposed later for customization.
- Raw session watching may become explicit opt-in later.
- Quick commands may wrap the controlled handoff tool later.
- `.buildroom` may become a portable non-AnthroClaw root later.
- Approval through more routes may be added after the identity model is hardened.
- Multiple Buildrooms per repo may be added after one-room workflows are stable.

## Assumptions To Verify Against Codebase

Before implementation, verify these assumptions in the real AnthroClaw codebase:

1. Plugin config can safely support a Buildroom-level config surface without unrecognized-key crashes.
2. Existing plugin hooks can observe the events needed for research, summaries, and operator reporting.
3. Native Agent SDK calls can be wrapped with a narrow runtime adapter without changing session or permission semantics.
4. Existing subagent support is appropriate for role agents, or role runners should call the runtime directly.
5. Current CLI structure can host `anthroclaw buildroom ...` commands.
6. Telegram command handling can route Buildroom approvals through a trusted operator surface.
7. Session summaries can be exposed to Research without leaking private raw conversations by default.
