# Strict-Native Agent SDK Policy

Status: drafted on 2026-04-22
Updated: 2026-04-24
Context:
- personal-use tool only
- LLM access must remain strictly through official Claude Code / Claude Agent SDK
- no third-party resale, no external login delegation, no custom model backend

Related:
- [agent-sdk-hermes-openclaw-audit.md](./agent-sdk-hermes-openclaw-audit.md)
- [agent-sdk-hermes-openclaw-roadmap.md](./agent-sdk-hermes-openclaw-roadmap.md)
- [agent-sdk-hermes-openclaw-backlog.md](./agent-sdk-hermes-openclaw-backlog.md)

## Core rule

The project should treat `Claude Code Agent SDK` as:
- the only LLM runtime,
- the only execution loop,
- the primary abstraction for permissions, sessions, hooks, skills, subagents, and MCP integration.

Anything that starts to recreate those layers outside the SDK should be treated as suspect by default.

## Current compliance status

As of the `feat/openclaw-replica` rollout through commit `39c4772`, the repo is aligned with the strict-native requirement:
- user-facing LLM execution goes through Claude Agent SDK `query()` / Claude Code runtime
- no OpenAI or alternate provider path is used for agent LLM calls
- OpenAI remains allowed only for memory embeddings
- permissions, hooks, sessions, checkpoints, subagents, skills, MCP tools, and sandbox options are routed through Agent SDK extension surfaces
- global user-facing `bypassPermissions` was removed; the remaining `trustedBypass` path is a narrow internal helper for trusted SDK calls such as tool-disabled summarization/title flows
- legacy config blocks such as `credentials.anthropic`, `skills`, and `fallbacks` are ignored by the schema in strict-native mode
- Fleet UI no longer exposes dead storage/experimental controls that imply non-native runtime behavior

The sections below preserve the policy reasoning and historical risks. Treat "Current state" callouts written before this update as historical unless they are repeated in this status block.

## What is allowed under this policy

These are still native and acceptable:
- `query()` / `Claude Code` runtime for all model calls
- built-in Claude Code tools
- `createSdkMcpServer()`
- MCP servers
- SDK hooks
- `.claude/skills`
- SDK subagents
- SDK plugins
- SDK session APIs

These are all official extension surfaces, not "non-native wrappers".

## What should be avoided

### 1. Custom model path

Do not add:
- alternative LLM providers as execution backends
- direct Anthropic Messages API path as a parallel runtime
- fallback model gateways outside the SDK
- custom tool loop that bypasses Claude Code execution

Implication for this repo:
- `fallbacks` in config should not evolve into a non-SDK provider routing layer.

### 2. Parallel abstractions that duplicate native SDK behavior

Avoid growing local systems that compete with SDK-native:
- permissions
- sessions
- skill loading
- hook lifecycle
- subagent orchestration

Thin wrappers are fine.
Parallel runtimes are not.

### 3. Product behavior that depends on non-native skill conventions

Preferred:
- `.claude/skills`

Avoid making core behavior depend on:
- generated `skills-index.md`
- custom skill discovery that replaces SDK discovery

### 4. Local control planes that should really be SDK hooks

If execution needs to be:
- blocked
- modified
- approved
- annotated
- sanitized

then it should happen in SDK hooks or SDK permission callbacks, not in ad hoc outer orchestration where possible.

## Historical assessment of earlier code

## Good fit with strict-native policy

These parts were already aligned in the earlier audit and remain aligned:
- all model execution goes through `query()` in [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:947)
- custom tools are created via `createSdkMcpServer()` in [src/agent/agent.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/agent/agent.ts:129)
- subagents are created through SDK `agents` in [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:1323)

These are not compliance problems by themselves.

## Weak fit items from the earlier audit

### A. Global permission bypass

Earlier state:
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:950)
- [src/gateway.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/gateway.ts:378)

This was the highest-priority thing to change and is now closed.
Reason:
- it uses an SDK option, but in the least native and least disciplined way.

### B. Parallel skill system

Current state:
- [src/agent/agent.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/agent/agent.ts:137)
- [src/agent/tools/list-skills.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/agent/tools/list-skills.ts:1)

This was the biggest architectural mismatch with a strict-native strategy.
Current state:
- `.claude/skills` is canonical for attached project skills.
- `list_skills` remains only a thin compatibility/admin view.

### C. Local hooks too far outside SDK lifecycle

Current state:
- [src/hooks/emitter.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/hooks/emitter.ts:5)

This is fine for outbound notifications, but not as the main behavior-control mechanism.
Current state:
- SDK hooks are now the execution-control surface.
- local hooks remain external notification integrations.

### D. Session layer too detached from SDK session primitives

Current state:
- [src/agent/agent.ts](/Users/tyess/dev/openclaw-agents-sdk-clone/src/agent/agent.ts:33)

This was not a violation, but it was weaker than a truly SDK-native design.
Current state:
- `SdkSessionService` and `FileSessionStore` provide the SDK-backed session substrate.
- lightweight agent maps remain only routing glue.

## Revised roadmap priorities

### Mandatory

1. Replace global `bypassPermissions` with proper SDK permission control.
2. Move execution control into SDK hooks and `canUseTool`.
3. Make `settingSources` and skill loading explicit.
4. Migrate toward `.claude/skills`.
5. Rebuild session features around SDK session APIs.

### Still valuable and still native-compatible

1. `session_search`
2. transcript-backed insights
3. stronger subagent guardrails
4. SSRF and injection hardening

These remain valid because they can be built on top of the SDK rather than instead of it.

### Lower priority or should be constrained

1. custom skill-management tooling
2. local branch/title/mirror abstractions
3. any fallback/provider logic that drifts toward non-SDK execution

These should only survive if they remain thin helpers around SDK-native behavior.

## Concrete changes to prior recommendations

## Keep

Keep from the earlier plan:
- `session_search`
- permission hardening
- hook bridge
- session-service refactor
- subagent hardening
- security hardening
- persisted insights

## Reframe

Reframe these:

### Skill management

Old framing:
- build a stronger skill system

New framing:
- first migrate to native `.claude/skills`
- only then add a thin management layer if needed

### Session architecture

Old framing:
- improve local session architecture

New framing:
- minimize local session architecture and wrap SDK sessions instead

### Hooks

Old framing:
- improve hooks

New framing:
- use SDK hooks for control
- keep local hooks only for external notifications/integration

## De-emphasize

De-emphasize these until they have a clear SDK-native justification:
- `skills-index.md`
- local-only branching model
- local title generation if SDK session titles are enough
- any future custom fallback routing layer

## Historical first three PRs under strict-native policy

These PRs are complete in the current branch.

### PR 1

`feat(sdk): remove global bypass permissions and add explicit SDK permission policy`

Scope:
- config schema
- `buildPermissionOptions()`
- `canUseTool`
- gateway query options
- tests

Status:
- Done in `3333de2`.

### PR 2

`feat(sdk): add SDK hook bridge and move execution control into native hooks`

Scope:
- SDK hooks
- permission and sanitation integration
- preserve existing outbound webhook/script hooks

Status:
- Done in `3333de2`.

### PR 3

`refactor(skills): migrate toward .claude/skills and explicit settingSources`

Scope:
- explicit `settingSources`
- reduce dependency on `skills-index.md`
- begin converging `list_skills` toward native skill discovery or deprecate it

Status:
- Done across `3333de2`, `c6aee46`, and `e8741e6`.

## Bottom line

Under a personal-use, strict-native policy, the main correction is not "we must avoid custom tools".

The real rule is:
- customizations are fine if they go through official Agent SDK extension surfaces,
- non-native parallel runtimes and duplicated control planes are what we should avoid.

So yes, some of the previous plan should be tightened:
- less "build our own layer",
- more "wrap, configure, and extend the SDK natively".
