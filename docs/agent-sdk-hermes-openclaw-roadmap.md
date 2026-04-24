# Roadmap: OpenClaw Agent Upgrade

Status: historical roadmap, drafted on 2026-04-22
Updated: 2026-04-24
Based on:
- [agent-sdk-hermes-openclaw-audit.md](./agent-sdk-hermes-openclaw-audit.md)
- local integration with `@anthropic-ai/claude-agent-sdk@0.2.116`
- `reference-projects/hermes-agent`

## Goal

Upgrade OpenClaw in the right order:
1. stop bypassing core Agent SDK capabilities,
2. align our runtime with native SDK sessions, permissions, hooks, and skills,
3. then add the Hermes product layers that still provide real leverage.

This is intentionally not a "copy Hermes" plan. It is an SDK-first refactor plan with selective Hermes-inspired additions.

## Current implementation status

The SDK-first roadmap below has been implemented in the current `feat/openclaw-replica` branch.

Closed:
- Phase 1 SDK alignment: permissions, hooks, explicit setting sources, native skill loading.
- Phase 2 session architecture: SDK session service, session store, fork/list/read/delete/title/checkpoint paths.
- Phase 3 skills: `.claude/skills` as canonical layout with thin admin tools.
- Phase 4 retrieval: transcript index and `session_search`.
- Phase 5 delegation: explicit subagent capabilities, portable MCP, registry, UI visibility, and scoped interrupt.
- Phase 6 security: SSRF guard, injection annotations, context budget, and workspace-root restrictions for references.
- Phase 7 observability/cleanup: persistent runtime metrics and Fleet UI exposure, prompt-cache/branching cleanup, stale UI settings removed.

Remaining items are deferred product decisions, not unfinished SDK-native rollout:
- deeper subagent steering UX
- optional assistant-worker remote-control path
- future hardening beyond the current reference-security baseline

Keep the detailed sections below as historical rationale. Do not treat their "Recommended immediate next task" as current.

## Priority order

### P0

1. Replace global `bypassPermissions` with real SDK permission control.
2. Make SDK hooks first-class in runtime.
3. Make settings/skills/session loading explicit instead of implicit.

### P1

1. Normalize session architecture around SDK sessions.
2. Replace the parallel local skill model with SDK-native skills plus a thin management layer.
3. Add `session_search`.
4. Harden subagent orchestration.

### P2

1. Wire security modules that already exist.
2. Add transcript-backed insights.
3. Remove or integrate dormant layers.

## Phase 1: SDK Alignment

### 1. Permissions and approvals

Why first:
- current runtime globally disables the SDK safety model in [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:947) and [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:375).

Target state:
- no default `bypassPermissions` in normal chat execution,
- tool permissions are explicit per agent/session,
- dangerous operations route through SDK permission flow,
- subagents do not inherit an overpowered runtime by accident.

Implementation:
- extend `AgentYmlSchema` in [src/config/schema.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/config/schema.ts:135) with an explicit permission config:
  - `permission_mode`
  - `allowed_tools`
  - `disallowed_tools`
  - optional approval strategy per channel
- build a `buildPermissionOptions()` helper in [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:316) that emits:
  - `permissionMode`
  - `allowedTools`
  - `disallowedTools`
  - `canUseTool`
- add a dedicated permission callback layer:
  - deny unsafe defaults,
  - allow safe read-only tools,
  - optionally ask user for dangerous tool use in interactive channels.

Suggested file set:
- [src/config/schema.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/config/schema.ts:135)
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:316)
- new `src/sdk/permissions.ts`
- tests under `test/`

Acceptance:
- `bypassPermissions` is gone from default runtime path,
- read-only agents can run without prompting on every turn,
- dangerous tools are denied or gated consistently,
- subagent tool permissions are narrower than parent by default.

Complexity:
- medium

### 2. SDK hooks instead of only app webhooks

Why now:
- our local hook emitter in [src/hooks/emitter.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/hooks/emitter.ts:5) is notification-only.

Target state:
- keep current webhook/script hooks for app integrations,
- add SDK hooks for control-plane logic.

Implementation:
- create a hook bridge that maps runtime policy into SDK hooks:
  - `PreToolUse`
  - `PostToolUse`
  - `PermissionRequest`
  - `SessionStart`
  - `SessionEnd`
  - `PreCompact`
- use SDK hooks for:
  - permission enforcement,
  - context sanitation,
  - audit logging,
  - future approval UX events.

Suggested file set:
- new `src/sdk/hooks.ts`
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:947)
- optionally keep [src/hooks/emitter.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/hooks/emitter.ts:5) as outward-facing integration only

Acceptance:
- query options now pass `hooks`,
- runtime policy no longer depends on ad hoc wrapper logic alone,
- hook events can be logged or surfaced for debugging.

Complexity:
- medium

### 3. Explicit SDK settings and skill loading

Why now:
- today we rely on a parallel `skills/` convention and do not explicitly control SDK `settingSources` or `skills`.

Target state:
- skill loading path is explicit,
- CLAUDE/skills behavior is deterministic,
- repo conventions are aligned with SDK-native structure.

Implementation:
- decide canonical project layout:
  - preferred: `.claude/skills/*/SKILL.md`
- add explicit `settingSources` in runtime instead of relying on defaults,
- decide whether each agent loads:
  - all discovered skills,
  - explicit allowlisted skills only.

Suggested file set:
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:947)
- [src/agent/agent.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/agent/agent.ts:137)
- `agents/*` layout changes as needed

Acceptance:
- skill loading is explicit and reproducible,
- we no longer need `skills-index.md` as a runtime crutch.

Complexity:
- medium

## Phase 2: Session Architecture

### 4. Move from lightweight session maps to SDK-native session primitives

Why:
- current session state in [src/agent/agent.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/agent/agent.ts:33) tracks only `sessionKey -> sessionId`, timestamps, and counts.

Target state:
- OpenClaw remains in control of routing/session ownership,
- but SDK sessions become the source of truth for transcript-aware behavior.

Implementation:
- keep `sessionKey -> sessionId` mapping only as routing glue,
- add explicit use of:
  - `continue`
  - `resume`
  - `forkSession`
  - optional `enableFileCheckpointing`
- introduce a session service wrapper around SDK APIs:
  - create/resume/fork/list/read session messages
- decide whether to use native disk persistence only or attach `sessionStore`.

Suggested file set:
- new `src/sdk/sessions.ts`
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:947)
- [src/agent/agent.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/agent/agent.ts:185)

Acceptance:
- session operations are centralized,
- transcript access no longer requires ad hoc future hacks,
- forking a session becomes a supported primitive rather than an unused local idea.

Complexity:
- medium to high

### 5. Replace summary-reset flow with transcript-aware compaction

Why:
- current approach resets sessions after summary save in [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:836).

Target state:
- compaction and reset become deliberate policies,
- session continuity is not broken prematurely,
- compaction can use SDK `PreCompact` hooks later.

Implementation:
- refactor `SessionCompressor` to work with session metadata and transcript size, not only message count,
- separate:
  - summarization,
  - compaction,
  - hard reset.

Suggested file set:
- [src/session/compressor.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/session/compressor.ts:1)
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:836)

Acceptance:
- session reset is no longer the default answer to long context,
- summaries are still persisted, but only as one of several control tools.

Complexity:
- medium

## Phase 3: Skills

### 6. Retire the parallel local skill model

Why:
- current `list_skills` and `skills-index.md` flow duplicates native SDK skill mechanics.

Target state:
- SDK-native skills become primary,
- OpenClaw-specific additions are thin and product-oriented.

Implementation:
- deprecate custom runtime reliance on:
  - `list_skills`
  - generated `skills-index.md`
- migrate useful existing skills into `.claude/skills`
- keep a lightweight discovery or admin tool only if needed for channel UX.

Suggested file set:
- [src/agent/agent.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/agent/agent.ts:76)
- [src/agent/tools/list-skills.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/agent/tools/list-skills.ts:1)

Acceptance:
- agent behavior does not depend on our parallel skill indexing path,
- skills behave like first-class SDK constructs.

Complexity:
- medium

### 7. Add skill management on top of SDK-native skills

Why:
- Hermes still wins here with `skill_manage`.

Target state:
- the agent can create and evolve procedural knowledge safely.

Implementation:
- add a new management tool inspired by Hermes:
  - `create`
  - `edit`
  - `patch`
  - `write_file`
  - `remove_file`
- keep strong safeguards:
  - frontmatter validation,
  - path validation,
  - atomic writes,
  - size limits,
  - security scan.

Suggested file set:
- new `src/agent/tools/manage-skills.ts`
- optional `src/security/skill-guard.ts`
- `.claude/skills/`

Acceptance:
- agent-managed skills are possible,
- invalid or dangerous writes are blocked,
- new skills immediately fit SDK-native loading.

Complexity:
- high

## Phase 4: Retrieval and Memory

### 8. Build `session_search`

Why:
- this is the clearest Hermes feature that remains valuable after SDK alignment.

Target state:
- the agent can recall prior sessions by topic,
- recall results are summaries, not raw transcript dumps.

Implementation:
- create a transcript indexer using SDK session transcripts as source,
- back it with SQLite FTS,
- expose a tool that:
  - searches by query,
  - ranks sessions,
  - summarizes top matches,
  - returns compact recall context.

Suggested file set:
- new `src/session/session-search.ts`
- new `src/agent/tools/session-search.ts`
- optional transcript ingestion job or lazy indexer

Acceptance:
- agent can answer “we discussed this last week” style prompts with grounded recall,
- recall does not flood context with full transcripts.

Complexity:
- high

### 9. Revisit memory architecture after `session_search`

Why:
- right now memory, session summary, wiki, and recall are overlapping concepts.

Target state:
- clear separation:
  - declarative memory,
  - procedural skills,
  - historical session recall.

Implementation:
- keep `memory_*` tools,
- reduce misuse of summary-as-memory for things that should be retrieved from session history.

Complexity:
- medium

## Phase 5: Delegation

### 10. Harden subagent orchestration

Why:
- current subagents in [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:1323) are mostly prompt/model/tool wrapping.

Target state:
- child agents are bounded, predictable, and observable.

Implementation:
- explicit per-child:
  - tools
  - permissions
  - skill set
  - prompt scope
- add:
  - timeouts,
  - depth limits,
  - progress summaries,
  - stale child handling.

Suggested file set:
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:1323)
- new `src/sdk/subagents.ts`

Acceptance:
- subagents cannot freely inherit parent power,
- long-running delegated tasks expose progress,
- recursion and runaway delegation are controlled.

Complexity:
- medium to high

## Phase 6: Security and Context Hardening

### 11. Wire the security modules we already have

Why:
- `validateUrl()` and `scanForInjection()` exist but are not in the main execution path.

Implementation:
- apply [src/security/ssrf.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/security/ssrf.ts:91) to `@url`,
- run [src/security/injection-scanner.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/security/injection-scanner.ts:81) on:
  - injected references,
  - selected tool outputs,
  - optional inbound user context blocks.

Suggested file set:
- [src/references/parser.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/references/parser.ts:130)
- new `src/security/context-guard.ts`
- SDK `PreToolUse` / `PostToolUse` hooks

Acceptance:
- unsafe URLs are blocked before fetch,
- obvious prompt-injection patterns are surfaced or blocked before context injection.

Complexity:
- low to medium

### 12. Add budget-aware context references

Target state:
- references are useful but bounded.

Implementation:
- add total reference budget,
- stronger truncation strategy,
- allowed-root restrictions for file/folder references,
- optional structured formatting per ref type.

Complexity:
- medium

## Phase 7: Observability and Cleanup

### 13. Replace in-memory insights with persisted analytics

Status:
- Done in `8e4c2a5`; surfaced in Fleet UI by `39c4772`.

Why:
- current [src/metrics/insights.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/metrics/insights.ts:27) is too thin for product tuning.

Implementation:
- persist usage and session analytics,
- correlate:
  - model,
  - tool usage,
  - latency,
  - failures,
  - session volume,
  - cost.
- optionally expose an internal insights command or dashboard feed.

Suggested file set:
- `src/metrics/insights.ts`
- new `src/metrics/store.ts`
- `src/gateway.ts`

Acceptance:
- analytics survive process restarts,
- product decisions can be based on real historical usage.

Complexity:
- medium

### 14. Remove or integrate dormant layers

Status:
- Closed for stale file references. `prompt-cache` and `branching` are gone; `mirror` and `title-generator` remain wired/tested product helpers.

Review and decide:
- [src/session/prompt-cache.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/session/prompt-cache.ts:1)
- [src/session/branching.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/session/branching.ts:1)
- [src/session/mirror.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/session/mirror.ts:1)
- [src/session/title-generator.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/session/title-generator.ts:1)
- `CredentialPool` in [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:61)

Rule:
- if a layer is valuable, wire it into runtime with tests,
- otherwise remove it.

Complexity:
- low to medium

## Suggested sprint breakdown

### Sprint 1

- permission config and `buildPermissionOptions()`
- SDK hook bridge skeleton
- remove default `bypassPermissions`
- explicit `settingSources`

Expected outcome:
- the runtime becomes meaningfully safer without major product change.

### Sprint 2

- SDK session service
- explicit `continue` / `resume` / `forkSession`
- compaction/reset cleanup

Expected outcome:
- session behavior becomes a stable base for retrieval and delegation.

### Sprint 3

- skill migration strategy
- deprecate `skills-index.md`
- introduce `manage-skills` tool

Expected outcome:
- skills become SDK-native and extensible.

### Sprint 4

- `session_search`
- transcript indexing
- retrieval summaries

Expected outcome:
- the agent gains real long-term recall.

### Sprint 5

- delegation hardening
- progress summaries
- timeout/depth policy

Expected outcome:
- subagents become production-safe rather than just available.

### Sprint 6

- SSRF/injection integration
- persisted insights
- dormant layer cleanup

Expected outcome:
- runtime is cleaner, safer, and easier to tune.

## What not to do yet

Do not do these before Phase 1 and 2 are complete:
- port the Hermes TUI
- port its multi-platform gateway complexity
- build a large plugin ecosystem
- add more local abstractions that duplicate SDK hooks/sessions/skills
- deepen memory architecture before `session_search` exists

## Historical recommended immediate next task

This was the correct first task before the rollout. It is now complete.

If implementation starts now, the next task should be defined from a new product/runtime scope, not this closed roadmap.

Original first task:

`Replace global bypass permissions with an SDK-native permission layer and hook bridge.`

Why:
- it has the best risk reduction,
- it forces a clean SDK integration shape,
- it makes every later capability safer to ship.

## Definition of success

This roadmap is successful when:
- OpenClaw uses the Agent SDK as the primary runtime architecture, not just as a thin query transport,
- our duplicate local layers are reduced,
- Hermes-inspired features are added only where they materially improve product capability,
- the resulting agent is safer, more recall-capable, and easier to evolve.
