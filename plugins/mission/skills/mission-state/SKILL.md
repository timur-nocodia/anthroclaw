---
name: mission-state
description: Use when an AnthroClaw agent has an active long-running mission and should preserve operational state, objectives, decisions, rejected scope, and session handoffs across chats.
version: 0.1.0
metadata:
  anthroclaw:
    plugin: mission
---

# Mission State

Mission State is durable operational state for long-running work. It is separate from memory: memory stores stable facts and preferences; mission state stores what is currently being pursued, why, where it paused, what is out of scope, and what should happen next.

## Core Loop

When a mission is active:

1. Read the injected `<mission_state>` block before acting.
2. Stay within the active objectives, constraints, and current phase.
3. Do not revive rejected or out-of-scope objectives unless the user explicitly asks.
4. Record meaningful decisions with `mission_add_decision` when they affect future work.
5. Update objectives when they become proven or rejected.
6. Use `mission_wrap_session` after substantial progress, before ending a long exchange, or when the user pauses the work.

## Scope Discipline

If new work appears that is useful but outside the active objective, do not silently absorb it. Either ask the user whether to expand the mission or record it as a new objective with a clear rationale.

If a path failed or was rejected, mark it with `mission_reject_objective` and include the reason so future sessions do not repeat it.

## Handoff Shape

Good `mission_wrap_session` summaries are short and concrete:

```text
Implemented composable ContextEngine assembly; LCM and future Mission State can now both inject context. Tests and build pass.
```

Good metadata is machine-readable:

```json
{
  "changed_files": ["src/gateway.ts", "src/plugins/registry.ts"],
  "tests": ["npx vitest run ...", "npm run build"],
  "decisions": ["compose assemble hooks sequentially; keep compression single-engine for now"]
}
```

Do not put secrets, raw PII, or private tokens in mission summaries or metadata. Mission rows are durable.
