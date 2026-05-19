# AnthroClaw Runtime Migration Instructions

## OSS Migration Scope

When discussing or implementing the Agent SDK replacement, measure progress by
the open-source AnthroClaw runtime contract, not by any private or personal
agent rollout.

The migration target is a Pi-native AnthroClaw Runtime v1 harness that can
create and run arbitrary configured agents through AnthroClaw-owned product
semantics.

Do not treat Claude Agent SDK as the compatibility target. It is historical
baseline and optional legacy fallback only. Runtime work should preserve
AnthroClaw product behavior, not reproduce Claude SDK internals 1:1.

Do not answer OSS migration status with named private/local production or lab
agents. Those agents are private rollout evidence, not migration acceptance
criteria.

Concrete agents may appear only in:

- CLI arguments.
- Test fixtures.
- Expansion packets.
- Operator evidence.
- Private rollout notes.

They must not define:

- Product requirements.
- Runtime completion.
- OSS migration exit criteria.
- Generic harness behavior.
- Public UI copy.

If asked "what remains for migration?", first answer from the Pi-native Runtime
v1 contract, adapter, gates, UI, dashboard, plugin, memory, session, learning,
Buildroom, config, and operations coverage. Do not answer from Agent SDK 1:1
compatibility. Mention private rollout packets only if explicitly asked about
live production rollout.
