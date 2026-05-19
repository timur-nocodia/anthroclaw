# Runtime Migration Rules

Runtime replacement work must make AnthroClaw Pi-native. Build reusable runtime primitives, adapters, gates, and tests that accept agent identity, routes, tools, channels, and safety policy as inputs.

Do not copy Claude Agent SDK internals for their own sake. Claude Agent SDK is a historical baseline and optional legacy fallback; the migration target is AnthroClaw-owned product behavior on Pi, not 1:1 SDK compatibility.

Do not implement new Pi/runtime migration functionality by hardcoding a specific production or lab agent into filenames, package scripts, tool servers, route assumptions, file roots, marker prefixes, metrics sessions, or test-only control flow.

Agent-specific migration artifacts are allowed only as thin evidence fixtures or documentation around a generic primitive. If a live gate or smoke check needs a concrete private/local agent, keep that identity in CLI arguments, test fixtures, expansion packets, or operator docs rather than in the reusable implementation name or behavior.

Before adding any `runtime:pi-*` command, classify it:

- **Generic harness capability:** acceptable when it works for any compatible agent config and maps to the Pi-native Runtime v1 contract.
- **Rollout evidence:** acceptable only when it extends a generic gate or records an expansion-packet result.
- **Temporary agent-specific script:** avoid by default; if unavoidable, mark it migration-only, keep it outside the core runtime path, and include its removal or generalization plan in the same PR.

The migration target is not "make selected lab agents work on Pi". The target is a Pi-native Runtime v1 harness that can create and run arbitrary configured agents through AnthroClaw-owned sessions, tools, policy, memory, learning, plugins, channels, dashboard, and observability.

Do not measure OSS migration completion by private or personal agent rollout state. Expansion packets for concrete agents are rollout evidence, not Runtime v1 requirements. When asked what remains for migration, answer from generic Pi-native Runtime v1 contract coverage: runtime adapter behavior, sessions, tools, side-effect gates, memory, learning, plugins, dashboard/UI, Buildroom, config, observability, rollback, and tests. Mention concrete agents only when the question is explicitly about private production rollout.

Live side-effect evidence must use the [Runtime Side-Effect Gates](runtime-side-effect-gates.md) contract. The gate implementation describes the reusable capability; the concrete agent belongs in arguments, fixtures, expansion packets, and operator evidence.
