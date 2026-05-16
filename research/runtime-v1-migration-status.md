# Runtime v1 migration status

Date: 2026-05-16

This is the human-readable phase checklist for replacing the Claude Agent SDK-centered harness with the Runtime v1 contract and Pi canary path. The machine-readable source remains `RUNTIME_CANARY_SCENARIOS` in `src/runtime/contract.ts`; the detailed evidence plan remains `research/runtime-v1-canary-plan.md`; the integration merge strategy memo is `research/runtime-v1-integration-strategy.md`; the first production canary preflight note is `research/runtime-v1-production-canary-preflight.md`.

## Current Snapshot

Overall state: implementation canaries are merged into `main`; local real-auth Runtime v1 evidence is green; and the durable GitHub Actions decision artifact from `main` is captured. The local Gateway path now canonicalizes runtime directories for the Claude baseline path. Default-runtime readiness is still blocked by the first production canary window.

Approximate progress to a default-runtime decision: 94%.

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

What is not done:

- The first production canary window has not been recorded.
- A true Claude baseline turn has not been sent in the live channel yet; the startup blocker is fixed, but the baseline turn still needs operator-safe canary timing.
- Final `READY` migration decision record has not been generated because production evidence is still pending; default-runtime flip is not started.

## Phase Checklist

| Phase | Status | Goal | Exit Criteria |
| --- | --- | --- | --- |
| 0. Frame migration | Done | Stop treating the provider SDK as product contract. | Runtime replacement is framed as a harness contract, not a provider swap. |
| 1. Freeze Runtime v1 contract | Mostly done | Capture 100% feature surfaces that a replacement must preserve. | `src/runtime/contract.ts` covers runtime, Gateway, tools, sessions, memory, plugins, dashboard, Buildroom, config, and ops. |
| 2. Candidate harness research | Done enough for canary work | Compare Pi/OpenAI/OpenCode/opencode-like options against the contract. | Candidate notes identify Pi as primary near-term harness and keep alternatives visible. |
| 3. Build Pi adapter and smoke gates | Done | Prove Pi can run the critical runtime paths without breaking AnthroClaw-owned policy. | Auth, workspace, Gateway, and aggregate Pi smoke commands pass with real auth locally and in the durable decision workflow. |
| 4. Cover deep product surfaces | Mostly done | Prove non-obvious product features survive runtime replacement. | Scripted canaries pass for sessions/memory/learning, plugins/context/tools, external MCP, scheduled Buildroom, and rollback. |
| 5. Dashboard/operator evidence | Mostly done | Prove the operator API contracts expose the same state under Pi-shaped runs. | `/api/gateway/status`, agents, sessions, runs, learning, plugins, MCP, channels, and diagnostics are covered by scripted canary evidence; browser UX evidence is optional. |
| 6. Rollout decision package | Mostly done | Produce the final go/no-go artifact. | Local and durable GitHub Actions decision packages emit Markdown/JSON gates from the full canary JSON; final `READY` package still waits on production canary evidence. |
| 7. Default-runtime rollout | Not started | Flip runtime default safely. | `docs/pi-production-canary-runbook.md` is completed for one real agent, rollback is verified, dashboard confirms state, and post-flip monitoring is defined. |

## Canary Scenario Checklist

| Scenario | Evidence Level | Status | Command or Evidence |
| --- | --- | --- | --- |
| `pi.auth-model-preflight` | smoke | Durable workflow pass on `main` in run `25969043105` | `pnpm smoke:pi-auth -- --json --model anthropic/claude-sonnet-4-6` |
| `pi.workspace-tools-rewind` | smoke | Durable workflow pass on `main` in run `25969043105` | `pnpm smoke:pi-workspace -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` |
| `pi.gateway-channel-approval` | smoke | Durable workflow pass on `main` in run `25969043105` | `pnpm smoke:pi-gateway -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` |
| `pi.aggregate-real-auth` | smoke | Durable workflow pass on `main` in run `25969043105` | `pnpm smoke:pi-all -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` |
| `pi.plugins-context-tools` | scripted canary | Durable workflow pass on `main` in run `25969043105` | `pnpm smoke:pi-plugins-context -- --json` |
| `pi.external-mcp-proxy` | scripted canary | Durable workflow pass on `main` in run `25969043105` | `pnpm smoke:pi-external-mcp -- --json` |
| `pi.sessions-memory-learning` | scripted canary | Durable workflow pass on `main` in run `25969043105` | `pnpm smoke:pi-sessions-memory -- --json` |
| `pi.dashboard-operator` | scripted canary | Durable workflow pass on `main` in run `25969043105` | `pnpm smoke:pi-dashboard-operator -- --json` |
| `pi.scheduled-buildroom` | scripted canary | Durable workflow pass on `main` in run `25969043105` | `pnpm smoke:pi-scheduled-buildroom -- --json` |
| `pi.rollback-mixed-runtime` | scripted canary | Durable workflow pass on `main` in run `25969043105` | `pnpm smoke:pi-rollback-runtime -- --json` |

## Current Blockers

1. The first real Pi production canary window has not been recorded.
2. A final durable Runtime v1 decision package still needs to be regenerated with `production_canary=passed` after that window completes.

## Next Five Tasks

1. Run the operator-safe Claude baseline turn for `example`, then immediately capture the redacted transcript/diagnostics evidence.
2. Apply the guarded `example` Pi override for the first production canary window and capture one text turn plus one same-session follow-up.
3. Exercise one harmless read, one small approved edit, one denied protected-path action, and rollback to the exact backup.
4. Rerun **Pi Runtime v1 decision** on `main` with `production_canary=passed`, `pr_stack=merged`, and `fail_on_blocked=true`.
5. If the final decision package is `READY`, prepare the smallest possible default-runtime flip PR with rollback instructions.

## Default Runtime Gate

Pi must not become the global default until:

- all four smoke scenarios pass in the real-auth environment;
- scripted canaries pass or have written waivers with owners;
- dashboard/operator API evidence is complete;
- rollback has been exercised;
- the first production canary runbook is completed for one real agent;
- the final decision package links evidence, risks, and rollout/rollback steps.
