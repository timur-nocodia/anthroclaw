# Runtime Migration Rules

Runtime replacement work must preserve 1:1 Agent SDK harness parity. Build reusable runtime primitives, adapters, gates, and tests that accept agent identity, routes, tools, channels, and safety policy as inputs.

Do not implement new Pi/runtime migration functionality by hardcoding a specific production or lab agent into filenames, package scripts, tool servers, route assumptions, file roots, marker prefixes, metrics sessions, or test-only control flow.

Agent-specific migration artifacts are allowed only as thin evidence fixtures or documentation around a generic primitive. If a live gate or smoke check needs `timur_agent`, `pi_telegram_lab`, `leads_agent`, `content_sm_building`, or any other concrete agent, keep that identity in CLI arguments, test fixtures, expansion packets, or operator docs rather than in the reusable implementation name or behavior.

Before adding any `runtime:pi-*` command, classify it:

- **Generic harness capability:** acceptable when it works for any compatible agent config and maps to the Agent SDK replacement contract.
- **Rollout evidence:** acceptable only when it extends a generic gate or records an expansion-packet result.
- **Temporary agent-specific script:** avoid by default; if unavoidable, mark it migration-only, keep it outside the core runtime path, and include its removal or generalization plan in the same PR.

The migration target is not "make selected lab agents work on Pi". The target is a provider-neutral Runtime v1 harness that can create and run arbitrary configured agents with Agent SDK-equivalent semantics.
