# Runtime v1 migration status

Date: 2026-05-16

This is the human-readable phase checklist for replacing the Claude Agent SDK-centered harness with the Runtime v1 contract and Pi canary path. The machine-readable source remains `RUNTIME_CANARY_SCENARIOS` in `src/runtime/contract.ts`; the detailed evidence plan remains `research/runtime-v1-canary-plan.md`.

## Current Snapshot

Overall state: implementation canaries are mostly in place; default-runtime readiness is still blocked by dashboard/operator evidence and real-auth smoke evidence.

Approximate progress to a default-runtime decision: 70%.

What is done:

- Runtime v1 feature atlas and canary map exist.
- Pi auth/workspace/Gateway smoke entrypoints exist.
- Scripted canaries exist for sessions/memory/learning, plugins/context/tools, external MCP, rollback/mixed runtime, and scheduled Buildroom.
- Stacked PRs are open for rollback and scheduled Buildroom coverage.

What is not done:

- Dashboard/operator evidence loop is still manual/planned.
- Full real-auth smoke evidence has not been captured as the final decision artifact in this branch.
- Final migration decision record and default-runtime flip are not started.

## Phase Checklist

| Phase | Status | Goal | Exit Criteria |
| --- | --- | --- | --- |
| 0. Frame migration | Done | Stop treating the provider SDK as product contract. | Runtime replacement is framed as a harness contract, not a provider swap. |
| 1. Freeze Runtime v1 contract | Mostly done | Capture 100% feature surfaces that a replacement must preserve. | `src/runtime/contract.ts` covers runtime, Gateway, tools, sessions, memory, plugins, dashboard, Buildroom, config, and ops. |
| 2. Candidate harness research | Done enough for canary work | Compare Pi/OpenAI/OpenCode/opencode-like options against the contract. | Candidate notes identify Pi as primary near-term harness and keep alternatives visible. |
| 3. Build Pi adapter and smoke gates | In progress | Prove Pi can run the critical runtime paths without breaking AnthroClaw-owned policy. | Auth, workspace, Gateway, and aggregate Pi smoke commands pass with real auth. |
| 4. Cover deep product surfaces | Mostly done | Prove non-obvious product features survive runtime replacement. | Scripted canaries pass for sessions/memory/learning, plugins/context/tools, external MCP, scheduled Buildroom, and rollback. |
| 5. Dashboard/operator evidence | Not done | Prove the operator UI/API sees the same state under Pi. | `/api/gateway/status`, agents, sessions, runs, learning, plugins, MCP, channels, and diagnostics are captured without secrets. |
| 6. Rollout decision package | Not started | Produce the final go/no-go artifact. | All required smoke/scripted/manual evidence is linked; residual risks have owners. |
| 7. Default-runtime rollout | Not started | Flip runtime default safely. | Canary agents pass, rollback path is rehearsed, dashboard confirms state, and post-flip monitoring is defined. |

## Canary Scenario Checklist

| Scenario | Evidence Level | Status | Command or Evidence |
| --- | --- | --- | --- |
| `pi.auth-model-preflight` | smoke | Implemented, needs real-auth evidence | `pnpm smoke:pi-auth -- --json --model anthropic/claude-sonnet-4-6` |
| `pi.workspace-tools-rewind` | smoke | Implemented, needs real-auth evidence | `pnpm smoke:pi-workspace -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` |
| `pi.gateway-channel-approval` | smoke | Implemented, needs real-auth evidence | `pnpm smoke:pi-gateway -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` |
| `pi.aggregate-real-auth` | smoke | Implemented, needs final artifact | `pnpm smoke:pi-all -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` |
| `pi.plugins-context-tools` | scripted canary | Implemented | `pnpm smoke:pi-plugins-context -- --json` |
| `pi.external-mcp-proxy` | scripted canary | Implemented | `pnpm smoke:pi-external-mcp -- --json` |
| `pi.sessions-memory-learning` | scripted canary | Implemented | `pnpm smoke:pi-sessions-memory -- --json` |
| `pi.dashboard-operator` | manual operator check | Not done | Manual/API evidence checklist pending |
| `pi.scheduled-buildroom` | scripted canary | Implemented in PR #87 | `pnpm smoke:pi-scheduled-buildroom -- --json` |
| `pi.rollback-mixed-runtime` | scripted canary | Implemented in PR #86 | `pnpm smoke:pi-rollback-runtime -- --json` |

## Current Blockers

1. Dashboard/operator evidence is the only explicitly planned canary gap.
2. Real-auth smoke evidence still needs to be captured in the final decision environment.
3. The PR stack must merge before the status can be treated as baseline.
4. The final decision package does not exist yet.

## Next Five Tasks

1. Turn `pi.dashboard-operator` from manual placeholder into a repeatable API-first canary or checklist artifact.
2. Add dashboard/operator evidence output to the migration status file.
3. Run the full `pnpm smoke:pi-v1-canary -- --json ...` matrix in the real-auth environment.
4. Update the canary plan and this status file with evidence links and residual risks.
5. Prepare the default-runtime rollout plan: staged agents, rollback command, monitoring checks, and owner sign-off.

## Default Runtime Gate

Pi must not become the global default until:

- all four smoke scenarios pass in the real-auth environment;
- scripted canaries pass or have written waivers with owners;
- dashboard/operator evidence is complete;
- rollback has been exercised;
- the final decision package links evidence, risks, and rollout/rollback steps.
