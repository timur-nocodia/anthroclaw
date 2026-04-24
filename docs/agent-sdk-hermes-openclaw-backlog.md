# Backlog: Agent SDK Refactor and Hermes-Inspired Upgrades

Status: prepared on 2026-04-22
Updated: 2026-04-24
Related docs:
- [agent-sdk-hermes-openclaw-audit.md](./agent-sdk-hermes-openclaw-audit.md)
- [agent-sdk-hermes-openclaw-roadmap.md](./agent-sdk-hermes-openclaw-roadmap.md)

## Current implementation status

This backlog is now historical for the SDK-native rollout. The core runtime work has landed in these commits:

- `3333de2` — SDK-native runtime rollout: explicit SDK permissions, hooks, sessions, checkpoint/fork/rewind, prompt suggestions, partial messages, subagent tracking, `session_search`, and safe skill management.
- `c6aee46` — instance skill catalog and SDK-native agent skill attach/detach flow.
- `d7579e2` — frontend controls for Claude Agent SDK runtime settings.
- `55975d9` — chat-side subagent run visibility and parent-session scoped interrupt controls.
- `0f5c74a` — chat debug rail, reference hardening, and runtime status cleanup.
- `e8741e6` — removed the legacy generated skills index surface.
- `8e4c2a5` — persistent runtime metrics store and 30-day metrics snapshot.
- `39c4772` — Fleet UI exposure for persistent runtime metrics and removal of dead UI settings.

No item in this backlog is still a blocking SDK-native rollout task.

Closed cleanup scope:
- `FRONTEND-SESSION-DEBUG`: closed by `0f5c74a` and `55975d9`.
- `SECURITY-REFERENCES`: closed by `0f5c74a`.
- `DOCS-CLEANUP`: this document is now aligned as a historical backlog.
- `DORMANT-LAYERS`: stale file references are closed; `prompt-cache` and `branching` are no longer in the tree, while `mirror` and `title-generator` remain wired/tested helpers.
- `OC-020`: closed by `8e4c2a5` and surfaced in UI by `39c4772`.

Deferred product scope, not unfinished SDK-native rollout:
- deeper subagent steering UX beyond current visibility/interruption
- optional assistant-worker remote-control adoption, if a future non-primary runtime needs it
- future security hardening beyond the current SSRF/injection/reference-budget baseline

## How to use this file

This is a historical execution backlog, not the current task list.

Each item below is a candidate PR-sized slice with:
- goal
- concrete file scope
- dependencies
- tests
- done criteria

Recommended rule:
- do these in order,
- do not start a later high-level item if its dependency is still unresolved,
- keep each PR narrow enough to verify in isolation.

## Epic 1: SDK-Native Runtime Control

### OC-001 Remove global `bypassPermissions`

Status:
- Done in `3333de2`.

Goal:
- stop running the main agent loop in unconditional bypass mode.

Current code:
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:947)
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:375)

Changes:
- add a `buildPermissionOptions()` helper
- replace hardcoded:
  - `permissionMode: 'bypassPermissions'`
  - `allowDangerouslySkipPermissions: true`
- introduce default-safe runtime behavior for normal sessions

Files:
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:316)
- new `src/sdk/permissions.ts`

Tests:
- `test/gateway.test.ts`
- `test/gateway-web.test.ts`

Done when:
- no default chat path uses global `bypassPermissions`
- runtime still executes normal read-only work
- permission config is generated through one helper instead of duplicated objects

Dependencies:
- none

Priority:
- `P0`

### OC-002 Extend agent config with SDK permission settings

Status:
- Done in `3333de2` and surfaced in UI by `d7579e2`.

Goal:
- allow each agent to declare permission behavior explicitly.

Changes:
- add config fields such as:
  - `permission_mode`
  - `allowed_tools`
  - `disallowed_tools`
  - optional approval policy

Files:
- [src/config/schema.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/config/schema.ts:135)
- [src/config/loader.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/config/loader.ts:1)
- docs if config format is user-facing

Tests:
- `test/config/schema.test.ts`
- `test/config/loader.test.ts`

Done when:
- agent YAML can express SDK permission knobs cleanly
- invalid combinations are rejected by schema

Dependencies:
- none

Priority:
- `P0`

### OC-003 Add `canUseTool` policy layer

Status:
- Done in `3333de2`.

Goal:
- centralize allow/deny/ask decisions for tool execution.

Changes:
- implement channel-aware decision policy
- safe read-only tools should be auto-allowed
- dangerous tools should be denied or escalated
- subagents should not inherit unsafe defaults

Files:
- new `src/sdk/permissions.ts`
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:947)
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:1323)

Tests:
- `test/gateway.test.ts`
- `test/gateway-subagents.test.ts`

Done when:
- tool permission policy is no longer implicit
- parent and child agents have separate effective power envelopes

Dependencies:
- `OC-001`
- `OC-002`

Priority:
- `P0`

### OC-004 Introduce SDK hook bridge

Status:
- Done in `3333de2`.

Goal:
- use Agent SDK hooks for control-plane logic rather than only app-level notifications.

Changes:
- add hook wiring for:
  - `PreToolUse`
  - `PostToolUse`
  - `PermissionRequest`
  - `SessionStart`
  - `SessionEnd`
  - `PreCompact`
- keep [src/hooks/emitter.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/hooks/emitter.ts:5) only for webhook/script integrations

Files:
- new `src/sdk/hooks.ts`
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:947)
- possibly [src/hooks/emitter.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/hooks/emitter.ts:5)

Tests:
- `test/hooks/emitter.test.ts` if legacy behavior changes
- new `test/sdk/hooks.test.ts`

Done when:
- query options pass SDK `hooks`
- SDK hooks can influence execution path
- local app hooks remain non-blocking outbound integrations

Dependencies:
- `OC-001`

Priority:
- `P0`

### OC-005 Make `settingSources` and skill loading explicit

Status:
- Done in `3333de2`, with skill catalog management added in `c6aee46`.

Goal:
- remove ambiguity around filesystem settings and skill loading.

Changes:
- explicitly pass `settingSources`
- decide whether project skills are loaded from `.claude`
- optionally pass `skills` allowlist for sessions

Files:
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:947)
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:375)

Tests:
- `test/gateway.test.ts`
- `test/gateway-web.test.ts`

Done when:
- runtime does not depend on undocumented default loading behavior
- skill/system prompt loading is deterministic

Dependencies:
- none

Priority:
- `P0`

## Epic 2: Session Architecture

### OC-006 Create SDK session service

Status:
- Done in `3333de2`.

Goal:
- centralize all SDK session operations behind one internal service.

Changes:
- wrap:
  - `resume`
  - `continue`
  - `forkSession`
  - `getSessionMessages`
  - `listSessions`
- keep `sessionKey -> sessionId` only as routing glue

Files:
- new `src/sdk/sessions.ts`
- [src/agent/agent.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/agent/agent.ts:185)
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:947)

Tests:
- `test/agent/session-pruning.test.ts`
- `test/session/session-policy.test.ts`
- new `test/sdk/sessions.test.ts`

Done when:
- gateway no longer directly owns every session behavior detail
- future transcript-aware features have one integration point

Dependencies:
- `OC-001`

Priority:
- `P1`

### OC-007 Add explicit fork/checkpoint support

Status:
- Done in `3333de2`; frontend controls landed in `d7579e2`.

Goal:
- make session branching and file rewind real SDK-backed features instead of dormant ideas.

Changes:
- enable optional `forkSession`
- decide whether to use `enableFileCheckpointing`
- evaluate whether [src/session/branching.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/session/branching.ts:1) should wrap SDK forks or be removed

Files:
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:947)
- [src/session/branching.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/session/branching.ts:1)
- new `src/sdk/sessions.ts`

Tests:
- `test/session/branching.test.ts`
- new SDK session tests

Done when:
- branching is tied to actual SDK session behavior
- dead-local-only branch logic is gone or justified

Dependencies:
- `OC-006`

Priority:
- `P1`

### OC-008 Refactor session compression/reset policy

Status:
- Mostly done in `3333de2`; keep future changes focused on policy tuning, not SDK wiring.

Goal:
- stop treating summary-and-reset as the only answer to growing context.

Changes:
- separate:
  - summarize
  - compact
  - reset
- make compression decisions based on better session signals than only message count

Files:
- [src/session/compressor.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/session/compressor.ts:1)
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:836)

Tests:
- `test/session/compressor.test.ts`
- `test/session/session-policy.test.ts`

Done when:
- auto-compress does not necessarily destroy active session continuity
- reset logic is policy-driven and explicit

Dependencies:
- `OC-006`

Priority:
- `P1`

## Epic 3: Skills

### OC-009 Migrate to SDK-native skill layout

Status:
- Done in `c6aee46`; `.claude/skills` is the canonical attached-agent layout.

Goal:
- make `.claude/skills` the canonical skill format.

Changes:
- inventory current `skills/` usage
- migrate useful project skills into `.claude/skills`
- remove runtime dependence on generated `skills-index.md`

Files:
- [src/agent/agent.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/agent/agent.ts:137)
- [src/agent/tools/list-skills.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/agent/tools/list-skills.ts:1)
- project skill directories

Tests:
- `test/agent/agent.test.ts`
- any skill-discovery tests added for new layout

Done when:
- SDK-native skills work without the local index workaround
- the agent’s prompt path no longer depends on `skills-index.md`

Dependencies:
- `OC-005`

Priority:
- `P1`

### OC-010 Decide fate of `list_skills`

Status:
- Done as compatibility/admin behavior. It now reflects workspace skills rather than being the primary runtime skill model.

Goal:
- either reduce `list_skills` to a thin compatibility/admin tool or remove it.

Changes:
- evaluate whether channel UX still needs a skill discovery tool
- if kept, make it reflect `.claude/skills` rather than the old local convention

Files:
- [src/agent/tools/list-skills.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/agent/tools/list-skills.ts:1)
- [src/channels/telegram.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/channels/telegram.ts:119)

Tests:
- `test/agent/agent.test.ts`
- channel command tests if behavior changes

Done when:
- no duplicate skill model remains

Dependencies:
- `OC-009`

Priority:
- `P1`

### OC-011 Add safe skill management tool

Status:
- Done in `3333de2`; catalog UI landed in `c6aee46`.

Goal:
- bring Hermes-style procedural self-improvement on top of SDK-native skills.

Changes:
- new tool with:
  - create
  - edit
  - patch
  - write_file
  - remove_file
- safeguards:
  - frontmatter validation
  - path restrictions
  - atomic writes
  - size limits
  - security scan if present

Files:
- new `src/agent/tools/manage-skills.ts`
- optional `src/security/skill-guard.ts`

Tests:
- new `test/agent/manage-skills.test.ts`

Done when:
- agent-managed skill lifecycle exists
- unsafe writes are blocked predictably

Dependencies:
- `OC-009`

Priority:
- `P1`

## Epic 4: Retrieval and Memory

### OC-012 Add transcript index service

Status:
- Done in `3333de2`.

Goal:
- prepare SDK-backed transcript retrieval for `session_search`.

Changes:
- ingest SDK session transcripts into SQLite FTS
- define indexing triggers:
  - lazy on demand
  - background sync
  - per-session update

Files:
- new `src/session/transcript-index.ts`
- new `src/sdk/sessions.ts`

Tests:
- new `test/session/transcript-index.test.ts`

Done when:
- transcript search works independently of UI/gateway code

Dependencies:
- `OC-006`

Priority:
- `P1`

### OC-013 Add `session_search` tool

Status:
- Done in `3333de2`.

Goal:
- give the agent real cross-session recall.

Changes:
- implement query -> FTS -> ranking -> per-session summary pipeline
- return compact structured recall instead of raw transcript dumps

Files:
- new `src/agent/tools/session-search.ts`
- new `src/session/session-search.ts`

Tests:
- new `test/session/session-search.test.ts`

Done when:
- the agent can retrieve and summarize relevant prior sessions
- recall stays bounded and context-friendly

Dependencies:
- `OC-012`

Priority:
- `P1`

### OC-014 Rebalance memory vs session recall responsibilities

Status:
- Mostly done by adding `session_search`; remaining work is product guidance and prompt tuning.

Goal:
- stop overloading summary memory with what should be transcript retrieval.

Changes:
- keep `memory_*` tools for declarative/user facts
- shift historical conversation recall to `session_search`

Files:
- [src/memory/store.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/memory/store.ts:1)
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:717)

Tests:
- `test/memory/store.test.ts`
- session search tests

Done when:
- memory and recall have clearer ownership boundaries

Dependencies:
- `OC-013`

Priority:
- `P2`

## Epic 5: Delegation

### OC-015 Narrow subagent capabilities

Status:
- Done in `3333de2`; portable MCP exposure is explicit and allowlisted.

Goal:
- stop treating subagents as lightly wrapped clones of the parent.

Current code:
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:1323)

Changes:
- explicitly define per-child:
  - tools
  - permissions
  - skills
  - hooks
- do not rely on inherited parent defaults

Files:
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:1323)
- new `src/sdk/subagents.ts`

Tests:
- `test/gateway-subagents.test.ts`

Done when:
- child capabilities are explicit and auditable

Dependencies:
- `OC-003`
- `OC-004`
- `OC-005`

Priority:
- `P1`

### OC-016 Add delegation guardrails

Status:
- Partially done in `3333de2` and `55975d9`; subagent progress/visibility exists, deeper timeout/stale policies can be a future hardening slice.

Goal:
- bring Hermes-style runtime discipline to subagent use.

Changes:
- add:
  - depth limits
  - task timeout
  - stale detection
  - optional `agentProgressSummaries`

Files:
- new `src/sdk/subagents.ts`
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:1323)

Tests:
- `test/gateway-subagents.test.ts`
- new subagent orchestration tests

Done when:
- delegation is bounded
- long-running children can expose progress

Dependencies:
- `OC-015`

Priority:
- `P1`

## Epic 6: Security Hardening

### OC-017 Wire SSRF guard into `@url`

Status:
- Done in `0f5c74a`.

Goal:
- stop raw URL fetches from bypassing the existing SSRF validator.

Current code:
- [src/references/parser.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/references/parser.ts:181)
- [src/security/ssrf.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/security/ssrf.ts:91)

Changes:
- validate URL before fetch
- return blocked reason clearly into reference resolution

Tests:
- `test/references/parser.test.ts`
- `test/security/ssrf.test.ts`

Done when:
- internal/metadata URLs cannot be fetched via `@url`

Dependencies:
- none

Priority:
- `P2`

### OC-018 Scan injected context for prompt injection

Status:
- Done in `0f5c74a`.

Goal:
- use the existing injection scanner on context references and selected tool outputs.

Changes:
- run `scanForInjection()` on resolved references
- decide whether to:
  - block
  - warn
  - annotate suspicious content

Files:
- [src/references/parser.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/references/parser.ts:210)
- [src/security/injection-scanner.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/security/injection-scanner.ts:81)
- optional SDK `PostToolUse` hook path

Tests:
- `test/references/parser.test.ts`
- `test/security/injection-scanner.test.ts`

Done when:
- untrusted context does not enter prompts completely unscreened

Dependencies:
- `OC-004` preferred

Priority:
- `P2`

### OC-019 Add context budget and allowed-root policy for references

Status:
- Done in `0f5c74a`.

Goal:
- keep context references useful and bounded.

Changes:
- total context budget
- stronger truncation policy
- explicit path-root restrictions for `@file` and `@folder`

Files:
- [src/references/parser.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/references/parser.ts:46)
- [src/security/file-safety.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/security/file-safety.ts:1)

Tests:
- `test/references/parser.test.ts`
- `test/security/file-safety.test.ts`

Done when:
- references cannot dominate the prompt by accident
- reference scope is easier to reason about

Dependencies:
- none

Priority:
- `P2`

## Epic 7: Observability and Cleanup

### OC-020 Persist insights instead of keeping them only in memory

Status:
- Done in `8e4c2a5`; Fleet UI exposure landed in `39c4772`.

Goal:
- turn analytics into a stable operational dataset.

Current code:
- [src/metrics/insights.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/metrics/insights.ts:27)

Changes:
- persist usage events
- track:
  - model
  - tools
  - latency
  - token usage
  - failures
  - session counts

Files:
- [src/metrics/insights.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/metrics/insights.ts:27)
- new `src/metrics/store.ts`
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:63)

Tests:
- `test/metrics/store.test.ts`
- `test/metrics-collector.test.ts`

Done when:
- insights survive restarts
- reporting is based on historical data, not only current process memory

Dependencies:
- `OC-006`

Priority:
- `P2`

### OC-021 Wire or remove dormant runtime layers

Status:
- Closed for stale runtime layers. Do not delete the remaining tested helpers unless their product path is removed too.

Review:
- Removed/not present anymore: `src/session/prompt-cache.ts`, `src/session/branching.ts`
- Still present and tested:
  - [src/session/mirror.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/session/mirror.ts:1)
  - [src/session/title-generator.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/session/title-generator.ts:1)
- `CredentialPool` in [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:61)

Goal:
- reduce architectural noise.

Changes:
- for each module, choose one:
  - integrate with runtime and tests
  - delete

Tests:
- corresponding existing module tests

Done when:
- there are fewer “present but not really used” layers in the repo

Dependencies:
- varies

Priority:
- `P2`

## Recommended PR sequence

1. Done: `OC-001` + `OC-002`
2. Done: `OC-003`
3. Done: `OC-004`
4. Done: `OC-005`
5. Done: `OC-006`
6. Done: `OC-008`
7. Done: `OC-009` + `OC-010`
8. Done: `OC-011`
9. Done: `OC-012` + `OC-013`
10. Mostly done: `OC-015` + `OC-016`
11. Done: `OC-017` + `OC-018` + `OC-019`
12. Done: `OC-020`
13. Done/closed: `OC-021`

## Fastest high-ROI subset

If we only do the first three substantial upgrades, do this:

1. `OC-001` / `OC-002` / `OC-003`
2. `OC-004` / `OC-005`
3. `OC-006` / `OC-012` / `OC-013`

That gives:
- safer runtime
- cleaner SDK integration
- real cross-session recall

## Explicit non-goals for now

Do not schedule yet:
- Hermes TUI parity
- multi-platform gateway parity
- provider zoo expansion
- plugin marketplace work
- large memory redesign before `session_search`

## Owner note

This backlog no longer has a recommended immediate implementation PR. The SDK-native rollout items above are closed. New work should start from a fresh product/runtime scope rather than reopening this historical sequence.
