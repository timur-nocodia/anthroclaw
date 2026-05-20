# Runtime v1 OSS migration status

This document tracks the open-source Agent SDK replacement work. It measures
Pi-native Runtime v1 harness coverage, not private production-agent rollout
or 1:1 Claude Agent SDK compatibility.

Private or personal agents are not migration exit criteria. Concrete agents may
be used as local evidence fixtures, but public migration status must be stated
in terms of reusable runtime capabilities.

## Current State

The OSS Runtime v1 migration is functionally complete for the Pi-native generic
harness:

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
  legacy Claude auth as the primary path.
- Public OSS examples/docs no longer ship private rollout agent directories,
  named private-agent migration flows, real Telegram peer ids, or local
  operator filesystem paths.

## Latest Acceptance Gate

Last verified: 2026-05-19.

- `pnpm test`: passed, 318 files / 2601 tests.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed.
- `pnpm --dir ui build`: passed.
- Fresh source-copy release smoke without `.git` metadata: passed.
  - `pnpm install --frozen-lockfile`
  - `npm run release:check`
  - `pnpm vitest run src/runtime/__tests__/pi-native-copy.test.ts src/config/__tests__/schema-chat.test.ts src/security/profiles/__tests__/index.test.ts --reporter=dot`
  - `pnpm build`
  - `pnpm --dir ui build`
- Public-surface scan: active OSS docs/examples/source are clean. Remaining
  `chat_like_openclaw` hits are intentional legacy safety-profile aliases for
  old configs.

## Phase Checklist

| Phase | Status | Exit Criteria |
| --- | --- | --- |
| 0. Frame migration | Done | Replacement is defined as a Runtime v1 harness contract, not a provider swap. |
| 1. Freeze Runtime v1 contract | Done | Generic contract scenarios cover the AnthroClaw product feature surface under Pi-native runtime ownership. |
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

No blocking OSS migration work remains for the generic Runtime v1/Pi harness.
Ongoing maintenance rules:

1. Keep only generic `runtime:pi-*` gates in `package.json`; do not add
   named-agent compatibility aliases.
2. Keep expansion packets out of public migration status unless they are generic
   examples. Private production rollout evidence belongs outside OSS acceptance
   criteria.
3. Maintain the repeatable OSS acceptance gate:
   - `pnpm build`
   - `pnpm test`
   - runtime contract tests
   - side-effect gate registry tests
   - UI runtime control-plane tests
   - no named-agent public-surface scan

## Released

Runtime v1/Pi migration shipped in `v1.2.0`.

- GitHub Release: https://github.com/timur-nocodia/anthroclaw/releases/tag/v1.2.0
- Default branch README now presents AnthroClaw as Pi-native.
- No open OSS migration PRs remain.

Future work belongs to product hardening releases, starting with `v1.3.0`.

## Pi-Native Migration Rule

The target is not full Claude Agent SDK compatibility. Claude Agent SDK remains
legacy fallback and historical evidence only. New work should prefer native Pi
integration plus AnthroClaw-owned implementations for sessions, tools, policy,
MCP, memory, learning, plugins, dashboard, and observability.

## Not OSS Migration Criteria

These are deliberately excluded from OSS migration completion:

- 1:1 Claude Agent SDK internal behavior.
- Private operator approvals.
- Live Telegram/WhatsApp delivery for named production agents.
- Personal/lab agent expansion packets.
- Production rollout status for a private fleet.
