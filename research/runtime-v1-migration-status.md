# Runtime v1 OSS migration status

This document tracks the open-source Agent SDK replacement work. It measures
generic Runtime v1 harness coverage, not private production-agent rollout.

Private or personal agents are not migration exit criteria. Concrete agents may
be used as local evidence fixtures, but public migration status must be stated
in terms of reusable runtime capabilities.

## Current State

The OSS Runtime v1 migration is functionally complete for the generic harness:

- Runtime v1 contract exists and covers runtime selection, sessions, tools,
  memory, learning, plugins, dashboard/UI, Buildroom, config, observability,
  rollback, and side-effect control.
- Pi is available behind the Runtime v1 headless/runtime boundary.
- OpenCode remains represented as an alternate provider path.
- Claude Agent SDK is retained only inside the
  `@anthroclaw/legacy-claude-agent-sdk` compatibility package.
- Generic side-effect gates exist for live messaging, media, notifications,
  scheduled work, Buildroom handoff, admin/config, MCP/file-transfer, Honcho
  local integration, learning-propose, and memory-read.
- Runtime UI exposes status, model registry, gate registry, expansion status,
  fleet runtime health, and per-agent effective runtime metadata without using
  Claude subscription auth as the primary path.

## Phase Checklist

| Phase | Status | Exit Criteria |
| --- | --- | --- |
| 0. Frame migration | Done | Replacement is defined as a Runtime v1 harness contract, not a provider swap. |
| 1. Freeze Runtime v1 contract | Done | Generic contract scenarios cover the Agent SDK-equivalent feature surface. |
| 2. Runtime adapter boundary | Done | Provider SDK calls are behind runtime/headless adapter boundaries. |
| 3. Pi adapter path | Done | Pi can satisfy the generic headless/runtime contract in tests and canaries. |
| 4. OpenCode fallback path | Done | OpenCode remains available as an alternate runtime candidate. |
| 5. Memory/session/learning parity | Done | Generic tests cover session continuity, memory read/search/write surfaces, and propose-only learning. |
| 6. Plugins/MCP parity | Done | Plugin context, external MCP proxying/onboarding, and file-transfer gates are represented generically. |
| 7. Side-effect gates | Done | Reusable gates accept agent/route/target as input and do not encode concrete agents. |
| 8. Runtime UI/control plane | Done | UI shows runtime status, models, gates, expansion status, settings, fleet and agent runtime metadata. |
| 9. Legacy quarantine | Done | Claude Agent SDK compatibility lives in `@anthroclaw/legacy-claude-agent-sdk`; root runtime code imports the legacy package, not the provider SDK. |
| 10. OSS cleanup | Done | Public scripts/docs do not expose private named-agent migration flows. |

## Remaining OSS Work

1. Keep only generic `runtime:pi-*` gates in `package.json`; do not add
   named-agent compatibility aliases.
2. Keep expansion packets out of public migration status unless they are generic
   examples. Private production rollout evidence belongs outside OSS acceptance
   criteria.
3. Maintain a repeatable OSS acceptance gate:
   - `pnpm build`
   - `pnpm test`
   - runtime contract tests
   - side-effect gate registry tests
   - UI runtime control-plane tests
   - no named-agent public-surface scan

## Not OSS Migration Criteria

These are deliberately excluded from OSS migration completion:

- Private operator approvals.
- Live Telegram/WhatsApp delivery for named production agents.
- Personal/lab agent expansion packets.
- Production rollout status for a private fleet.
