# Audit: Agent SDK vs Hermes vs OpenClaw

Status: completed on 2026-04-22

Scope:
- `reference-projects/hermes-agent`
- our code in `src/`
- installed SDK `@anthropic-ai/claude-agent-sdk@0.2.116`
- official Anthropic docs:
  - https://code.claude.com/docs/en/agent-sdk/overview
  - https://code.claude.com/docs/en/agent-sdk/permissions
  - https://code.claude.com/docs/en/agent-sdk/sessions
  - https://code.claude.com/docs/en/agent-sdk/skills
  - https://code.claude.com/docs/en/agent-sdk/user-input
  - https://code.claude.com/docs/en/agent-sdk/observability
  - https://code.claude.com/docs/en/agent-sdk/plugins

## Executive summary

The main correction to the previous analysis is this: a large part of the capability gap is not "OpenClaw lacks features that Hermes built", but "OpenClaw uses the Anthropic Agent SDK in a narrow mode and bypasses many built-in mechanisms".

Today our integration is centered around `query()` with:
- `cwd`
- `model`
- `resume`
- `mcpServers`
- `agents`
- `permissionMode: 'bypassPermissions'`
- `allowDangerouslySkipPermissions: true`

Evidence: `src/gateway.ts:947-966` and `src/gateway.ts:375-393`.

That means the highest-ROI work is not to immediately reimplement Hermes internals. It is:
1. use the SDK features we already ship with but currently bypass,
2. remove or simplify duplicate local layers,
3. then selectively port the Hermes product layers that are actually above the SDK.

## What the SDK already provides

The installed SDK surface in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` already exposes the following:

### Permissions and approvals

Available in the SDK:
- `allowedTools` and `disallowedTools` (`sdk.d.ts:1136-1160`)
- `canUseTool` (`sdk.d.ts:1142-1145`)
- permission modes `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk`, `auto` (`sdk.d.ts:1409-1422`, `1694-1697`)
- `PermissionRequest` and `PermissionDenied` hook types (`sdk.d.ts:1699-1731`)
- permission updates at runtime, including add/replace/remove rules and `setMode` (`sdk.d.ts:1738-1765`)
- `permissionPromptToolName` (`sdk.d.ts:1423-1427`)

Docs confirm the same model and explicitly warn that `bypassPermissions` approves everything that reaches the mode check:
- https://code.claude.com/docs/en/agent-sdk/permissions

### Sessions and transcript persistence

Available in the SDK:
- `continue`, `resume`, `sessionId`, `resumeSessionAt`, `forkSession` (`sdk.d.ts:1147-1150`, `1226-1229`, `1470-1484`)
- `persistSession` and `sessionStore` (`sdk.d.ts:1273-1291`)
- `enableFileCheckpointing` (`sdk.d.ts:1206-1213`)
- session APIs: `forkSession`, `getSessionMessages`, `listSessions`, `renameSession`, `tagSession` (`sdk.d.ts:571`, `630`, `831`, `2088`, `4974`)

Docs confirm that sessions persist to disk, can be resumed and forked, and can be enumerated:
- https://code.claude.com/docs/en/agent-sdk/sessions
- https://code.claude.com/docs/en/agent-sdk/session-storage

### Hooks

Available in the SDK:
- `hooks` option (`sdk.d.ts:1238-1250`)
- `includeHookEvents` (`sdk.d.ts:1303-1311`)
- `includePartialMessages` (`sdk.d.ts:1313-1316`)

Docs confirm hook coverage far beyond our local hook emitter:
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `PermissionRequest`
- `PermissionDenied`
- `SessionStart`
- `SessionEnd`
- `PreCompact`
- `PostCompact`
- `SubagentStart`
- `SubagentStop`
- `TaskCreated`
- `TaskCompleted`
- `UserPromptSubmit`

Docs:
- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/hooks

### Skills, CLAUDE.md, plugins, settings

Available in the SDK:
- `skills?: string[]` on session initialization (`sdk.d.ts:2416-2418`)
- `plugins?: SdkPluginConfig[]` (`sdk.d.ts:1429-1442`)
- `settingSources?: SettingSource[]` (`sdk.d.ts:1546-1554`)

Docs confirm SDK-native filesystem features:
- `.claude/skills/*/SKILL.md`
- `.claude/commands/*.md`
- `CLAUDE.md` or `.claude/CLAUDE.md`
- plugins via `plugins`

Docs:
- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/agent-sdk/skills
- https://code.claude.com/docs/en/agent-sdk/plugins

Important nuance:
- the docs overview says filesystem features load with default options,
- but the installed `sdk.d.ts` comment says omitted or empty `settingSources` means "no filesystem settings are loaded" (`sdk.d.ts:1551-1554`).

Because of that mismatch, our integration should be explicit rather than rely on implicit defaults.

### Subagents and orchestration helpers

Available in the SDK:
- `agents?: Record<string, AgentDefinition>` (`sdk.d.ts:2410`)
- `agentProgressSummaries?: boolean` (`sdk.d.ts:1460-1468`, `2419-2420`)
- prompt suggestions (`sdk.d.ts:1448-1458`)

Docs also expose built-in `Agent`/subagent capability:
- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/agent-sdk/typescript

### Observability

Available in the SDK:
- stream-level usage data in the message stream
- OpenTelemetry integration
- hook execution visibility
- session-level trace correlation

Docs:
- https://code.claude.com/docs/en/agent-sdk/observability

## What we actually use today

### The integration path is narrow

In `src/gateway.ts:947-966` and `src/gateway.ts:375-393`, we pass:
- `model`
- `cwd`
- `permissionMode: 'bypassPermissions'`
- `allowDangerouslySkipPermissions: true`
- `mcpServers`
- model options
- `agents`
- `resume`

We do not pass:
- `allowedTools`
- `disallowedTools`
- `canUseTool`
- `hooks`
- `tools`
- `continue`
- `forkSession`
- `enableFileCheckpointing`
- `persistSession`
- `sessionStore`
- `includeHookEvents`
- `includePartialMessages`
- `plugins`
- `settingSources`
- `promptSuggestions`
- `agentProgressSummaries`

### Sessions: we use only resume, and maintain our own lightweight map

Our agent session layer stores:
- `sessionKey -> sessionId`
- timestamps
- message counters

Evidence: `src/agent/agent.ts:33-56`, `185-236`.

This is much thinner than the SDK session feature set. We are not using:
- `continue`
- `forkSession`
- transcript enumeration
- transcript reads
- external `sessionStore`
- checkpointing
- title/tag/session metadata APIs

### Skills: we use a parallel custom skill system, not the SDK-native one

Our current approach:
- tools are created from `mcp_tools` in `src/agent/agent.ts:76-125`
- `list_skills` is a custom MCP tool in `src/agent/tools/list-skills.ts`
- a generated `skills-index.md` is written in `src/agent/agent.ts:137-182`

This is not the SDK-native skills path described in the docs. The SDK-native path is `.claude/skills/*/SKILL.md` plus session skill loading. Right now we have a separate local convention under `skills/`.

### Hooks: we use only app-level fire-and-forget hooks

Our hook system in `src/hooks/emitter.ts:5-117` supports only:
- `on_message_received`
- `on_before_query`
- `on_after_query`
- `on_session_reset`
- `on_cron_fire`

It can:
- call a webhook
- execute a script

It cannot:
- intercept tool calls
- modify inputs
- deny execution
- add context back into the agent loop
- observe SDK lifecycle events

That is materially weaker than SDK hooks.

### References and security hardening are local, but not fully wired

`src/references/parser.ts` adds custom `@diff`, `@staged`, `@file`, `@folder`, `@git`, `@url` references.

Current gaps:
- `@url` uses raw `fetch` without `validateUrl()` (`src/references/parser.ts:181-191`, `src/security/ssrf.ts:91-136`)
- injected content is appended directly as `<context-references>` without injection scanning (`src/references/parser.ts:210-218`, `src/security/injection-scanner.ts:81-94`)
- no budget-aware reference compaction
- no stronger allowed-root policy around all context sources

### Metrics and analytics are much thinner than what the SDK and Hermes can support

`src/metrics/insights.ts:27-82` is:
- in-memory
- capped at 10k records
- aggregate-only
- not transcript-backed

Also, `InsightsEngine` is instantiated in `src/gateway.ts:63` but there is no evidence of `record()` or `report()` usage in the runtime.

## Duplicate or underused local layers

These are the clearest places where we either duplicate the SDK or have unfinished local layers:

### 1. Global bypass of permissions

Current state:
- `permissionMode: 'bypassPermissions'`
- `allowDangerouslySkipPermissions: true`

Evidence:
- `src/gateway.ts:950-951`
- `src/gateway.ts:378-379`

Impact:
- we bypass the SDK approval model instead of integrating it,
- we also give subagents the same unconstrained mode by inheritance unless we explicitly restrict them.

### 2. Custom skills path instead of SDK-native skills

Current state:
- custom `skills/`
- custom `list_skills`
- generated `skills-index.md`

Evidence:
- `src/agent/agent.ts:116-118`
- `src/agent/agent.ts:137-182`
- `src/agent/tools/list-skills.ts`

Impact:
- we miss native SDK skill discovery/loading behavior,
- we keep a parallel concept that the SDK already knows how to represent.

### 3. Local session layer is thinner than SDK sessions

Current state:
- lightweight in-memory session registry in `Agent`
- manual `resume`

Impact:
- we do not leverage native session introspection,
- we cannot build transcript-aware features cleanly on top of the SDK yet,
- we have no native fork/checkpoint workflow in product UX.

### 4. Custom hooks do not substitute SDK hooks

Current state:
- app-level notifications only

Impact:
- cannot act as a control plane for safety or context transformation,
- cannot replace `PreToolUse`/`PostToolUse`/permission hooks.

### 5. Several local modules appear present but not wired

Likely dead or currently dormant:
- `src/session/prompt-cache.ts`
- `src/session/branching.ts`
- `src/session/title-generator.ts`
- `src/security/ssrf.ts`
- `src/security/injection-scanner.ts`
- `SessionMirror` field in `src/gateway.ts:62`
- `CredentialPool` beyond initialization in `src/gateway.ts:61`, `79-87`
- `InsightsEngine` beyond initialization in `src/gateway.ts:63`

This does not mean they are bad ideas. It means they should either be integrated fully or removed to reduce architectural noise.

## What Hermes adds beyond the SDK

These are the Hermes features that still matter after discounting what the SDK already provides.

### 1. Cross-session recall via `session_search`

Hermes value:
- searches historical transcripts via SQLite FTS5
- ranks matches
- loads matching sessions
- returns compact summaries instead of raw transcripts

Evidence:
- `reference-projects/hermes-agent/tools/session_search_tool.py:1-260`

Why this still matters:
- the SDK persists sessions and exposes transcript APIs,
- but it does not ship a product-level "search past conversations and summarize them" feature.

This remains a real feature gap.

### 2. Agent-managed skill lifecycle

Hermes value:
- `create`
- `edit`
- `patch`
- `delete`
- `write_file`
- `remove_file`
- validation
- path safety
- atomic writes
- security scanning

Evidence:
- `reference-projects/hermes-agent/tools/skill_manager_tool.py:1-320`

Why this still matters:
- the SDK provides skill loading and execution,
- it does not provide a full self-improving skill management product layer.

### 3. Stronger delegation policy

Hermes value:
- isolated child context
- stripped dangerous/shared tools
- configurable depth cap
- timeout handling
- stale child detection
- progress event model

Evidence:
- `reference-projects/hermes-agent/tools/delegate_tool.py:1-320`

Why this still matters:
- the SDK gives subagents,
- Hermes adds operational guardrails and orchestration semantics around them.

### 4. Product-level dangerous-command policy and approval UX

Hermes value:
- regex/policy layer around dangerous commands
- session/permanent approval memory
- gateway/UI integrations for approvals

Evidence:
- `reference-projects/hermes-agent/tools/approval.py`
- multiple references in `tui_gateway/server.py`

Why this still matters:
- the SDK provides the approval framework,
- Hermes adds concrete policy, persistence, and UX.

### 5. Context hardening around injected references and memory sanitization

Hermes value:
- stronger context preprocessing and safety around context references
- sanitization around injected memory/context blocks

Evidence:
- `reference-projects/hermes-agent/agent/context_references.py`
- `reference-projects/hermes-agent/agent/memory_manager.py`

This is still valuable, but it should be built on top of SDK hooks and permissions, not instead of them.

### 6. Transcript-backed insights

Hermes value:
- persistent DB-backed analytics
- tool/model/session usage patterns
- cost reporting

Evidence:
- `reference-projects/hermes-agent/agent/insights.py`

This is still product value. The SDK gives observability plumbing, not a complete product report surface.

## Priority recommendations

### P0: Stop bypassing the SDK safety model

Do first:
- replace global `bypassPermissions` with a deliberate model:
  - `default` or `dontAsk` as baseline depending on channel
  - `allowedTools` / `disallowedTools`
  - `canUseTool` for interactive approvals
  - SDK hooks for pre/post checks
- make subagent permissions explicit instead of inheriting unsafe defaults

Why first:
- every later capability becomes safer and easier to reason about.

### P1: Normalize on SDK-native session primitives

Do next:
- explicitly adopt `continue` / `resume` / `forkSession`
- decide on `persistSession` and `sessionStore`
- expose transcript reads through SDK APIs
- add checkpointing if we want rewindable edits

Then build on top:
- `session_search`
- transcript-backed summaries
- session titles/tags

### P1: Replace the parallel custom skill system with SDK-native skills plus a thin management layer

Do next:
- move toward `.claude/skills`
- explicitly configure `settingSources`
- use SDK-native skill loading
- keep a thin OpenClaw-specific management layer only if needed

Then selectively port from Hermes:
- `skill_manage`
- validation
- atomic writes
- security scan

### P1: Move hook logic into SDK hooks where behavior control is required

Keep local webhooks/scripts only for product notifications.

Move safety/control logic to SDK hooks:
- `PreToolUse`
- `PostToolUse`
- `PermissionRequest`
- `SessionStart`
- `SessionEnd`
- `PreCompact`

### P1: Build `session_search` on top of SDK session persistence

Best candidate to import conceptually from Hermes.

Suggested implementation shape:
- use SDK transcript persistence as the source of truth,
- index transcripts in SQLite FTS,
- return summaries, not raw transcripts,
- expose as an MCP tool or internal retrieval layer.

### P2: Upgrade delegation after SDK alignment

After permissions and sessions are fixed:
- tighten child tool surfaces
- add depth caps
- add stale detection and timeouts
- enable `agentProgressSummaries` where useful

### P2: Wire the security modules that already exist

Specifically:
- apply `validateUrl()` to `@url`
- scan injected reference content with `scanForInjection()`
- add token/content budgets to context injection

### P2: Either wire or delete dormant modules

Decision required for:
- `prompt-cache`
- `branching`
- `title-generator`
- `sessionMirror`
- `CredentialPool`
- `InsightsEngine`

The repo will stay easier to evolve if these are either part of runtime or explicitly removed.

## Concrete before/after framing

### What I would not do

I would not start by porting Hermes wholesale:
- not the TUI
- not the multi-platform gateway complexity
- not the full provider zoo
- not the entire plugin/runtime stack

### What I would do

Phase 1:
- permissions
- hooks
- settings/skills/session alignment with the SDK

Phase 2:
- `session_search`
- skill lifecycle
- delegation hardening

Phase 3:
- transcript-backed insights
- richer context hardening

## Final conclusion

The corrected conclusion is:

OpenClaw is not missing the fundamentals because the Anthropic Agent SDK lacks them. OpenClaw is missing them because our current integration only uses a narrow subset of the SDK and bypasses several of its most important control surfaces.

So the right roadmap is not:
- "copy Hermes into OpenClaw"

The right roadmap is:
1. align OpenClaw with the SDK features we already have,
2. delete or simplify duplicate local layers,
3. port only the Hermes layers that are genuinely above the SDK:
   `session_search`, `skill_manage`, stronger delegation policy, approval UX/policy, and transcript-backed insights.
