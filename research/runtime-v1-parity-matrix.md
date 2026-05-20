# Runtime v1 OSS coverage matrix

This matrix tracks generic Pi-native Runtime v1 coverage for AnthroClaw. It
intentionally does not use private agents or 1:1 Claude Agent SDK compatibility
as acceptance criteria.

## Coverage Levels

- `L0`: contract only.
- `L1`: unit-tested generic implementation.
- `L2`: integration-tested generic implementation.
- `L3`: local canary or CLI smoke without live external side effects.
- `L4`: optional live rollout evidence, never required for OSS acceptance.

## Generic Coverage Matrix

| Contract Surface | Area | Current Level | Evidence | Remaining OSS Work |
| --- | --- | ---: | --- | --- |
| Runtime selection | runtime | L3 | `HeadlessRuntime`, `headless-registry`, Runtime v1 contract tests | Keep provider additions behind the same registry. |
| Pi headless runtime | runtime | L3 | `pi-headless` tests and generic canaries | None for OSS harness. |
| OpenCode headless runtime | runtime | L2 | `opencode-headless` tests | Optional deeper runtime acceptance. |
| Legacy Claude fallback | runtime | L3 | `@anthroclaw/legacy-claude-agent-sdk`, adapter tests, and import-boundary tests | Keep it legacy-only; do not use it as the implementation target. |
| Session continuation | sessions | L3 | runtime/session tests and Pi session mapping | Session label/export polish is non-blocking. |
| Interrupt/control registry | runtime_control | L2 | active-run/interrupt tests | None for generic harness. |
| Checkpoint/rewind fallback | runtime_control | L2 | workspace snapshot and rewind tests | Prefer AnthroClaw-owned snapshot semantics over provider-native parity. |
| Tool policy | tools | L3 | security profile and tool gate tests | Keep new tools declarative and policy-backed. |
| Side-effect gates | side_effects | L3 | registry, plan, validate, focused gate tests | Remove named-agent aliases from public surface. |
| Messaging/media gates | side_effects | L3 | generic live-send-message/media gate tests | Live rollout is private evidence, not OSS blocker. |
| Notifications gates | side_effects | L3 | generic notification gate tests | Live rollout is private evidence, not OSS blocker. |
| Scheduled work | scheduling | L3 | scheduled-work, cron-notification gates, and `manage_cron` v2 durable store tests | None for generic harness. |
| Memory read/search/write | memory | L3 | memory-read gate, peer-isolated public memory tests, and memory/session tests | Quality tuning only. |
| Learning propose-only | learning | L3 | learning-propose gate and learning tests | Auto-apply remains intentionally gated. |
| Plugins | plugins | L3 | plugin startup/context/admin tests | None for generic harness. |
| MCP onboarding/proxy | integrations | L3 | external MCP, managed MCP, file-transfer tests | None for generic harness. |
| Honcho/LCM | memory | L2 | Honcho local gate and plugin-context tests | Deeper semantic quality is follow-up. |
| Buildroom handoff | workspace | L3 | Buildroom handoff gate and UI/API tests | None for generic harness. |
| Runtime UI/control plane | dashboard | L3 | runtime status/models/gates/expansion API and UI tests | Continue legacy-copy scans. |
| Fleet/agent runtime metadata | dashboard | L3 | fleet/agent runtime UI tests | None for generic harness. |
| Rollback/fallback | ops | L3 | mixed-runtime rollback canary tests | Keep rollback provider-neutral. |
| Observability/monitoring | ops | L3 | runtime monitor, runtime health, diagnostics, metrics, and deploy/fleet tests | None for generic harness. |

## OSS Decision

Runtime v1 + Pi is strong enough to be the default OSS migration path. The
remaining work is maintenance discipline, not a blocking migration gap:

- keep migration docs focused on Pi-native harness coverage;
- keep private production rollout evidence outside OSS acceptance criteria.
- preserve the public-surface guard so private rollout identifiers and
  legacy-provider primary-runtime wording cannot re-enter OSS docs/examples.
