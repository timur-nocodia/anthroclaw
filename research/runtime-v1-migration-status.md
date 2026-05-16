# Runtime v1 migration status

Date: 2026-05-16

This is the human-readable phase checklist for replacing the Claude Agent SDK-centered harness with the Runtime v1 contract and Pi canary path. The machine-readable source remains `RUNTIME_CANARY_SCENARIOS` in `src/runtime/contract.ts`; the detailed evidence plan remains `research/runtime-v1-canary-plan.md`.

## Current Snapshot

Overall state: implementation canaries are mostly in place; local real-auth Runtime v1 canary evidence is green, but default-runtime readiness is still blocked by a durable workflow artifact, merged PR-stack evidence, and the first production canary window.

Approximate progress to a default-runtime decision: 85%.

What is done:

- Runtime v1 feature atlas and canary map exist.
- Pi auth/workspace/Gateway smoke entrypoints exist.
- Scripted canaries exist for sessions/memory/learning, plugins/context/tools, external MCP, rollback/mixed runtime, and scheduled Buildroom.
- Production canary runbook exists at `docs/pi-production-canary-runbook.md`.
- Manual Runtime v1 decision workflow exists at `.github/workflows/pi-runtime-v1-decision.yml`.
- Stacked PRs are open for rollback, scheduled Buildroom, and dashboard/operator coverage.
- Local full `pnpm smoke:pi-v1-canary -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` passed on 2026-05-16 with existing local Pi auth storage; the generated decision package is blocked only by PR-stack and production-canary operational gates.

What is not done:

- Durable GitHub Actions Runtime v1 decision artifact has not been captured from the target branch.
- Final migration decision record generation is in progress; default-runtime flip is not started.

## Phase Checklist

| Phase | Status | Goal | Exit Criteria |
| --- | --- | --- | --- |
| 0. Frame migration | Done | Stop treating the provider SDK as product contract. | Runtime replacement is framed as a harness contract, not a provider swap. |
| 1. Freeze Runtime v1 contract | Mostly done | Capture 100% feature surfaces that a replacement must preserve. | `src/runtime/contract.ts` covers runtime, Gateway, tools, sessions, memory, plugins, dashboard, Buildroom, config, and ops. |
| 2. Candidate harness research | Done enough for canary work | Compare Pi/OpenAI/OpenCode/opencode-like options against the contract. | Candidate notes identify Pi as primary near-term harness and keep alternatives visible. |
| 3. Build Pi adapter and smoke gates | Mostly done | Prove Pi can run the critical runtime paths without breaking AnthroClaw-owned policy. | Auth, workspace, Gateway, and aggregate Pi smoke commands pass with real auth; durable artifact still pending. |
| 4. Cover deep product surfaces | Mostly done | Prove non-obvious product features survive runtime replacement. | Scripted canaries pass for sessions/memory/learning, plugins/context/tools, external MCP, scheduled Buildroom, and rollback. |
| 5. Dashboard/operator evidence | In progress | Prove the operator API contracts expose the same state under Pi-shaped runs. | `/api/gateway/status`, agents, sessions, runs, learning, plugins, MCP, channels, and diagnostics are captured without secrets; browser UX evidence is optional. |
| 6. Rollout decision package | In progress | Produce the final go/no-go artifact. | `pnpm runtime:pi-decision` or the manual **Pi Runtime v1 decision** workflow emits Markdown/JSON gates from the full canary JSON; all residual blockers have owners. |
| 7. Default-runtime rollout | Not started | Flip runtime default safely. | `docs/pi-production-canary-runbook.md` is completed for one real agent, rollback is verified, dashboard confirms state, and post-flip monitoring is defined. |

## Canary Scenario Checklist

| Scenario | Evidence Level | Status | Command or Evidence |
| --- | --- | --- | --- |
| `pi.auth-model-preflight` | smoke | Local real-auth pass, durable artifact pending | `pnpm smoke:pi-auth -- --json --model anthropic/claude-sonnet-4-6` |
| `pi.workspace-tools-rewind` | smoke | Local real-auth pass, durable artifact pending | `pnpm smoke:pi-workspace -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` |
| `pi.gateway-channel-approval` | smoke | Local real-auth pass, durable artifact pending | `pnpm smoke:pi-gateway -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` |
| `pi.aggregate-real-auth` | smoke | Local real-auth pass, durable artifact pending | `pnpm smoke:pi-all -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` |
| `pi.plugins-context-tools` | scripted canary | Implemented | `pnpm smoke:pi-plugins-context -- --json` |
| `pi.external-mcp-proxy` | scripted canary | Implemented | `pnpm smoke:pi-external-mcp -- --json` |
| `pi.sessions-memory-learning` | scripted canary | Implemented | `pnpm smoke:pi-sessions-memory -- --json` |
| `pi.dashboard-operator` | scripted canary | Implemented in PR #89 | `pnpm smoke:pi-dashboard-operator -- --json` |
| `pi.scheduled-buildroom` | scripted canary | Implemented in PR #87 | `pnpm smoke:pi-scheduled-buildroom -- --json` |
| `pi.rollback-mixed-runtime` | scripted canary | Implemented in PR #86 | `pnpm smoke:pi-rollback-runtime -- --json` |

## Current Blockers

1. Durable Runtime v1 decision artifact still needs to be captured from the target branch.
2. The PR stack must merge before the status can be treated as baseline.
3. The first real Pi production canary window has not been recorded.

## Next Five Tasks

1. Capture the durable Runtime v1 decision artifact via **Pi Runtime v1 decision** from the target branch.
2. Attach the local 2026-05-16 full canary decision output only as supporting evidence, not the baseline artifact.
3. Execute `docs/pi-production-canary-runbook.md` for one low-risk real agent.
4. Decide whether a browser screenshot pass is required as non-blocking operator UX evidence.
5. Merge the PR stack and rerun the canary map from the target branch.

## Default Runtime Gate

Pi must not become the global default until:

- all four smoke scenarios pass in the real-auth environment;
- scripted canaries pass or have written waivers with owners;
- dashboard/operator API evidence is complete;
- rollback has been exercised;
- the first production canary runbook is completed for one real agent;
- the final decision package links evidence, risks, and rollout/rollback steps.
