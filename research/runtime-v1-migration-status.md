# Runtime v1 migration status

Date: 2026-05-17

This is the human-readable phase checklist for replacing the Claude Agent SDK-centered harness with the Runtime v1 contract and Pi canary path. The machine-readable source remains `RUNTIME_CANARY_SCENARIOS` in `src/runtime/contract.ts`; the detailed evidence plan remains `research/runtime-v1-canary-plan.md`; the integration merge strategy memo is `research/runtime-v1-integration-strategy.md`; the first production canary preflight note is `research/runtime-v1-production-canary-preflight.md`.

## Current Snapshot

Overall state: implementation canaries are merged into `main`; local and durable real-auth Runtime v1 evidence is green; the limited `example` Web UI production canary passed and rolled back cleanly; and the final Runtime v1 decision package is `READY`. Default-runtime readiness is no longer blocked by Runtime v1 evidence. The default-runtime flip itself has not started.

Approximate progress to a default-runtime decision: 100%.

What is done:

- Runtime v1 feature atlas and canary map exist.
- Pi auth/workspace/Gateway smoke entrypoints exist.
- Scripted canaries exist for sessions/memory/learning, plugins/context/tools, external MCP, rollback/mixed runtime, and scheduled Buildroom.
- Production canary runbook exists at `docs/pi-production-canary-runbook.md`.
- Manual Runtime v1 decision workflow exists at `.github/workflows/pi-runtime-v1-decision.yml`.
- Local full `pnpm smoke:pi-v1-canary -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` passed on 2026-05-16 with existing local Pi auth storage; the generated decision package is blocked only by PR-stack and production-canary operational gates.
- PR #95 merged into `main` on 2026-05-16 as `9b46102f74397b6eee25d8b8d60f7c85843f0ba4`; `pnpm build`, `pnpm test`, and the full local Runtime v1 canary passed on the rebased integration branch before merge.
- Repository secret `PI_AUTH_JSON_B64` is configured for the manual Runtime v1 decision workflow without storing Pi auth material in the repository.
- Post-merge **Pi Runtime v1 decision** workflow run `25965686443` on `main` passed build, Pi storage preparation, the full ten-scenario canary map, and artifact upload. The generated decision package is `BLOCKED` only by `production-canary-window=pending`.
- Production canary preflight identified `example` as the preferred first canary candidate, subject to operator-owner confirmation before any live runtime override.
- Guarded per-agent runtime switch CLI exists as `pnpm runtime:pi-canary-agent`; it dry-runs by default and requires `--apply` before writing a validated `agent.yml` backup/update.
- The guarded switch CLI supports exact rollback with `--restore-backup <agent.yml.bak-...>` so the canary agent can return to its original config, not merely an explicit Claude provider override.
- Latest **Pi Runtime v1 decision** workflow run `25969043105` on `main` after the exact rollback restore merge passed all ten scenarios and remains `BLOCKED` only by `production-canary-window=pending`.
- Config-only rehearsal against local real `example` agent config completed on 2026-05-16 with no Gateway running: guarded enable wrote Pi override, exact backup restore returned `agent.yml` to its original hash `3740020ff3ba6523c32c1c3ac8053be0ef832a7c56233d777d2280356887b036`, and generated rehearsal backups were removed afterward.
- Gateway hot-reload rehearsal completed on 2026-05-16 against the real local config/agents/data paths: Gateway started on current Runtime v1 code with Telegram polling, `example` was switched to Pi and restored while Gateway was running, ConfigWatcher hot-reloaded after both writes, and `agent.yml` again returned to the original hash. No test messages were sent.
- Gateway now sets `OC_AGENTS_DIR` and `OC_DATA_DIR` from its actual startup arguments while running, then restores the previous process env on stop. This closes the local worktree/dev-data mismatch that made the Claude SDK surface a misleading native-binary warning.
- Real Gateway startup was rechecked on 2026-05-16 with `OC_AGENTS_DIR`/`OC_DATA_DIR` unset and real dev config/agents/data/plugin paths; Gateway started, Telegram polling started, and the prior `Claude Code native binary not found` warning did not recur. No test messages were sent.
- A no-channel Claude headless baseline probe was attempted after the startup fix; it reached the provider path but returned `Invalid authentication credentials` from the configured local Claude auth. The headless runtime now treats that text-shaped auth failure as an error instead of a successful smoke result.
- The pre-Pi Claude text baseline and post-rollback Claude text prompt are explicitly waived for the first `example` Pi-only production canary window in `research/runtime-v1-production-canary-preflight.md`; Pi live-turn, tool, rollback, diagnostics, and final decision evidence remain required.
- PR #106 merged on 2026-05-16 and closed the focused Pi Web UI/Gateway blockers found on the first `example` canary attempt: Pi Web UI now resumes through Pi's session-file reference, outside-workspace filesystem tool calls are denied before the chat-profile allow shortcut, and Pi `text_end` events no longer duplicate streamed partial text.
- Focused local Web UI/Gateway verification after PR #106 passed on 2026-05-16: text replied exactly `PI_CANARY_TEXT_OK`, same-session follow-up replied exactly `PI_CANARY_TEXT_OK`, outside-workspace read check replied exactly `DENY_OK`, and exact rollback restored `example/agent.yml` to hash `3740020ff3ba6523c32c1c3ac8053be0ef832a7c56233d777d2280356887b036`.
- Local full `pnpm smoke:pi-v1-canary -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` passed all ten scenarios again from `main` after PR #106. The regenerated decision package with `pr_stack=merged` is `BLOCKED` only by `production-canary-window=pending`.
- PR #107 merged on 2026-05-16 and refreshed the post-PR #106 decision evidence docs.
- PR #108 merged on 2026-05-16 and made `pi-workspace-smoke` require exact `SMOKE_OK`, closing the gap where duplicated `SMOKE_OKSMOKE_OK` could still appear in raw evidence while the smoke stayed green.
- Local full `pnpm smoke:pi-v1-canary -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` passed all ten scenarios again from `main` after PR #107 and PR #108. Both standalone and aggregate workspace smoke replies were exactly `SMOKE_OK`.
- Limited `example` Web UI production canary passed on 2026-05-17 local time: five Pi turns covered text, same-session follow-up, harmless workspace read, small workspace edit, and denied protected-path read; exact rollback restored `example/agent.yml` to hash `3740020ff3ba6523c32c1c3ac8053be0ef832a7c56233d777d2280356887b036`, and the real dev repo returned clean.
- Local final `pnpm runtime:pi-decision -- --production-canary passed --pr-stack merged --browser-ux not-required --fail-on-blocked` produced `READY` with no blocking failures.
- Durable **Pi Runtime v1 decision** workflow run `25970623984` on `main` commit `72766ff850a3dfff757a25e7b232c9002b7fcdac` passed build, Pi storage preparation, the full ten-scenario canary map, final `READY` decision generation with `production_canary=passed`, and artifact upload.

What is not done:

- A true Claude baseline turn has not been sent in the live channel; this is now a written waiver for the first Pi-only window, not an unresolved startup blocker.
- The default-runtime flip is not started.
- Post-flip monitoring and rollback instructions still need to be attached to the default-runtime flip PR.

## Phase Checklist

| Phase | Status | Goal | Exit Criteria |
| --- | --- | --- | --- |
| 0. Frame migration | Done | Stop treating the provider SDK as product contract. | Runtime replacement is framed as a harness contract, not a provider swap. |
| 1. Freeze Runtime v1 contract | Mostly done | Capture 100% feature surfaces that a replacement must preserve. | `src/runtime/contract.ts` covers runtime, Gateway, tools, sessions, memory, plugins, dashboard, Buildroom, config, and ops. |
| 2. Candidate harness research | Done enough for canary work | Compare Pi/OpenAI/OpenCode/opencode-like options against the contract. | Candidate notes identify Pi as primary near-term harness and keep alternatives visible. |
| 3. Build Pi adapter and smoke gates | Done | Prove Pi can run the critical runtime paths without breaking AnthroClaw-owned policy. | Auth, workspace, Gateway, and aggregate Pi smoke commands pass with real auth locally and in the durable decision workflow. |
| 4. Cover deep product surfaces | Mostly done | Prove non-obvious product features survive runtime replacement. | Scripted canaries pass for sessions/memory/learning, plugins/context/tools, external MCP, scheduled Buildroom, and rollback. |
| 5. Dashboard/operator evidence | Done enough for default flip PR | Prove the operator API contracts expose the same state under Pi-shaped runs. | `/api/gateway/status`, agents, sessions, runs, learning, plugins, MCP, channels, and diagnostics are covered by scripted canary and limited production evidence; browser UX evidence is optional. |
| 6. Rollout decision package | Done | Produce the final go/no-go artifact. | Local and durable GitHub Actions decision packages emit `READY` with production canary passed and PR stack merged. |
| 7. Default-runtime rollout | Not started | Flip runtime default safely. | Prepare the smallest default-runtime flip PR with rollback instructions and post-flip monitoring. |

## Canary Scenario Checklist

| Scenario | Evidence Level | Status | Command or Evidence |
| --- | --- | --- | --- |
| `pi.auth-model-preflight` | smoke | Durable workflow pass on `main` in final run `25970623984` | `pnpm smoke:pi-auth -- --json --model anthropic/claude-sonnet-4-6` |
| `pi.workspace-tools-rewind` | smoke | Durable workflow pass on `main` in final run `25970623984`; local exact reply `SMOKE_OK` after PR #108 | `pnpm smoke:pi-workspace -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` |
| `pi.gateway-channel-approval` | smoke | Durable workflow pass on `main` in final run `25970623984` | `pnpm smoke:pi-gateway -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` |
| `pi.aggregate-real-auth` | smoke | Durable workflow pass on `main` in final run `25970623984`; local nested workspace exact reply `SMOKE_OK` after PR #108 | `pnpm smoke:pi-all -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` |
| `pi.plugins-context-tools` | scripted canary | Durable workflow pass on `main` in final run `25970623984` | `pnpm smoke:pi-plugins-context -- --json` |
| `pi.external-mcp-proxy` | scripted canary | Durable workflow pass on `main` in final run `25970623984` | `pnpm smoke:pi-external-mcp -- --json` |
| `pi.sessions-memory-learning` | scripted canary | Durable workflow pass on `main` in final run `25970623984` | `pnpm smoke:pi-sessions-memory -- --json` |
| `pi.dashboard-operator` | scripted canary | Durable workflow pass on `main` in final run `25970623984` | `pnpm smoke:pi-dashboard-operator -- --json` |
| `pi.scheduled-buildroom` | scripted canary | Durable workflow pass on `main` in final run `25970623984` | `pnpm smoke:pi-scheduled-buildroom -- --json` |
| `pi.rollback-mixed-runtime` | scripted canary | Durable workflow pass on `main` in final run `25970623984` | `pnpm smoke:pi-rollback-runtime -- --json` |

## Current Blockers

No Runtime v1 decision blockers remain. The remaining work is rollout execution, not evidence collection.

## Next Five Tasks

1. Open a small default-runtime flip PR that changes the global headless provider to Pi without touching agent-specific overrides.
2. Attach the final durable decision run `25970623984`, limited production canary evidence, and rollback command to the PR.
3. Add a post-flip smoke checklist that includes `pi-auth`, `pi-all`, Gateway startup, one Web UI text turn, and exact rollback to `claude-agent-sdk`.
4. Define the first monitoring window: failed turns, provider auth errors, policy denials, interrupt failures, session continuation, diagnostics redaction, and learning queue errors.
5. Keep rollout ring expansion separate from the default flip PR; do not expand to higher-risk agents until post-flip monitoring is green.

## Default Runtime Gate

The evidence gate for making Pi the global default is now satisfied by durable run `25970623984` plus the limited `example` production canary. The default-runtime flip PR still needs to carry these links and a rollback checklist.

Pi must not become the global default until:

- all four smoke scenarios pass in the real-auth environment;
- scripted canaries pass or have written waivers with owners;
- dashboard/operator API evidence is complete;
- rollback has been exercised;
- the first production canary runbook is completed for one real agent;
- the final decision package links evidence, risks, and rollout/rollback steps.
