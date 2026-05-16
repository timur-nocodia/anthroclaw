# Runtime v1 migration status

Date: 2026-05-17

This is the human-readable phase checklist for replacing the Claude Agent SDK-centered harness with the Runtime v1 contract and Pi canary path. The machine-readable source remains `RUNTIME_CANARY_SCENARIOS` in `src/runtime/contract.ts`; the detailed evidence plan remains `research/runtime-v1-canary-plan.md`; the integration merge strategy memo is `research/runtime-v1-integration-strategy.md`; the first production canary preflight note is `research/runtime-v1-production-canary-preflight.md`.

## Current Snapshot

Overall state: implementation canaries are merged into `main`; local and durable real-auth Runtime v1 evidence is green; the limited `example` Web UI production canary passed and rolled back cleanly; and the final Runtime v1 decision package is `READY`. PR #110 merged the default-runtime flip into `main` as commit `d0f24383503f3e1d0ef22257a4a2d9f347c62cc8`. Post-merge local verification and durable decision run `25971022679` are green. The live runtime checkout was fast-forwarded to `4d0942cbc58d95553aa025e3b5c5a1d74a19fe4e`; post-pull `pi-auth`, `pi-all`, safe Web UI, first monitoring slice, and extended 60-minute monitoring snapshot are green. Ring 1 live channel turn returned exactly `PI_LIVE_CHANNEL_OK`; the immediate post-turn monitor and follow-up manual monitor are green. Ring 1 is closed by operator acceptance, with later monitor alerts treated as escalation triggers. Ring 2 is closed after green scope/preflight, Web UI plus allowlisted Telegram DM usage window, and post-window monitor. Ring 3.1 learning review is closed after propose-only action inspection, a rejected `none` action transition, no apply, and green monitor. Ring 3.2 session continuity is closed after a two-turn same-session Web UI run, no tools, session visibility, and green monitor. Ring 3.3 plugin context is closed after the isolated plugin/context canary and green monitor. Ring 3.4 external MCP proxy is closed after the synthetic MCP/credential/custom-tool canary and green monitor.

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
- Default-runtime flip PR verification passed locally with `runtime.headless.provider=pi`: targeted runtime/config tests, TypeScript, config parsing, `pnpm smoke:pi-auth -- --json --model anthropic/claude-sonnet-4-6`, and `pnpm smoke:pi-all -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000`.
- PR #110 merged the default-runtime flip into `main` on 2026-05-17 local time as commit `d0f24383503f3e1d0ef22257a4a2d9f347c62cc8`.
- Post-merge local verification on `d0f2438` passed: config parsing resolved `provider=pi`, targeted runtime/config tests passed, TypeScript passed, `pnpm smoke:pi-auth -- --json --model anthropic/claude-sonnet-4-6` passed, and `pnpm smoke:pi-all -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` returned workspace text `SMOKE_OK` plus Gateway text `SMOKE_GATEWAY_OK`.
- Post-merge durable **Pi Runtime v1 decision** workflow run `25971022679` on `main` commit `d0f24383503f3e1d0ef22257a4a2d9f347c62cc8` passed build, Pi storage preparation, the full canary map, final decision generation, and artifact upload.
- Live runtime checkout `/Users/tyess/dev/openclaw-agents-sdk-clone` was fast-forwarded to `4d0942cbc58d95553aa025e3b5c5a1d74a19fe4e` on 2026-05-17 local time.
- Post-pull live verification passed: `pnpm install --frozen-lockfile`, config parsing resolved `provider=pi`, TypeScript passed, `pnpm smoke:pi-auth -- --json --model anthropic/claude-sonnet-4-6` passed, and `pnpm smoke:pi-all -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` returned workspace text `SMOKE_OK` plus Gateway text `SMOKE_GATEWAY_OK`.
- Safe no-channel live Gateway Web UI turn against `example` replied exactly `PI_LIVE_WEB_OK` through Pi with no tool calls, a present session id, and `15` total tokens.
- First monitoring slice after the live pull showed zero failed runs in the last hour; diagnostic event types were limited to `run.sdk_started` and `run.completed`.
- Operator monitoring CLI exists as `pnpm runtime:pi-monitor`; it reads `metrics.sqlite`, reports run/diagnostic/tool summaries, and can exit non-zero with `--fail-on-alert` when stop-condition alerts appear.
- Extended live monitoring snapshot at 2026-05-17 01:04 Asia/Almaty passed with `alerts=[]`: seven runs in the last 60 minutes, all succeeded; failed/interrupted/stale running runs were `0`; auth/model alerts were `0`; diagnostic types were only `run.sdk_started` and `run.completed`. The single failed `read` tool warning is the expected historical denied-path canary event, not a stop condition.
- Ring expansion policy exists at `docs/pi-ring-expansion-policy.md`; it defines Rings 0-4, Ring 1 live channel criteria, stop conditions, rollback, and required checks per ring.
- Ring 1 immediate live channel evidence passed on 2026-05-17 at 01:12 Asia/Almaty: controlled `Gateway.dispatch` sent a real Telegram DM response for `example`, the reply was exactly `PI_LIVE_CHANNEL_OK`, no tool events appeared in the 15-minute Ring 1 slice, and the immediate post-turn monitor showed eight succeeded runs with zero failed/interrupted/stale runs and zero auth/model alerts.
- Ring 1 follow-up manual monitor at approximately 2026-05-17 01:21 Asia/Almaty passed for the 60-minute window: three succeeded runs, zero failed/interrupted/stale runs, zero auth/model alerts, no alerts, and no warnings.
- Ring 1 is closed by operator acceptance. The original 30-minute timer is waived for this checkpoint; the operator will escalate if later monitoring detects a stop condition.
- Ring 2 scope is defined: `example` only, Web UI plus allowlisted operator Telegram DM, ordinary operator prompts, learning propose-only, no cron delivery, no proactive notifications, no `send_message` fanout, no `manage_cron`/`manage_skills`/external MCP/Buildroom, no WhatsApp, and no non-operator peers.
- Pre-Ring-2 checks passed on 2026-05-17: `pi-auth` passed with Pi package `0.74.0` and available `anthropic/claude-sonnet-4-6`; `runtime:pi-monitor` passed with three succeeded runs, zero failed/interrupted/stale runs, zero auth/model alerts, no alerts, and no warnings.
- Ring 2 low-risk usage window passed on 2026-05-17: Web UI returned exactly `PI_RING2_WEB_OK` with session id present, `16` total tokens, and zero tool calls; Telegram DM returned exactly `PI_RING2_TELEGRAM_OK` to allowlisted operator peer `48705953` with one sent message and message id present.
- Ring 2 post-window monitor passed with six succeeded runs, zero failed/interrupted/stale runs, diagnostic types `run.completed` and `run.sdk_started`, zero auth/model alerts, no alerts, and no warnings.
- Ring 2 is closed. Ring 3 should target one expanded product surface at a time.
- Ring 3.1 learning review scope is defined and executed: `example` learning review in propose-only mode, operator list/transition only, no approve/apply, no memory/skill writes, no plugin/MCP/Buildroom/cron expansion.
- Ring 3.1 learning review evidence passed on 2026-05-17: `example` had two completed reviews and two proposed `none` actions; one `none` action was rejected with reason `ring3-learning-review-closed-no-action`; target action became `rejected`, reason was present, `applied_at` stayed null, and action counts became one proposed `none` plus one rejected `none`.
- Ring 3.1 post-check monitor passed with six succeeded runs, zero failed/interrupted/stale runs, zero auth/model alerts, no alerts, and no warnings.
- Ring 3.2 session continuity scope is defined and executed: `example` Web UI only, two turns in one continued session, no Telegram/WhatsApp, no memory write, no learning apply, no plugin tools, no external MCP, no Buildroom, no cron/proactive notification, and no `send_message` fanout.
- Ring 3.2 session continuity evidence passed on 2026-05-17: first turn returned exactly `PI_RING3_MEMORY_SEED_OK`, second turn continued the same session and returned exactly `PI_RING3_MEMORY_CONTINUITY_OK`, both turns had zero tool calls, Gateway listed the continued session, and the session had two active keys.
- Ring 3.2 post-check monitor passed with eight succeeded runs, zero failed/interrupted/stale runs, diagnostic types `run.completed` and `run.sdk_started`, zero auth/model alerts, no alerts, and no warnings.
- Ring 3.3 plugin context scope is defined and executed with `pnpm smoke:pi-plugins-context -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` in an isolated temporary Gateway workspace; real production plugin actions, real external MCP credentials, Buildroom, cron delivery, and production `send_message` fanout remained excluded.
- Ring 3.3 plugin context evidence passed on 2026-05-17: synthetic plugin enablement/tool registration/policy hooks passed, disabled-agent tool exclusion held, plugin context assembly/compression and session attribution passed, Pi plugin subagent ran with tools disabled, and bundled `file-transfer`, `lcm`, and `operator-console` checks passed including outside-root denial and delegate denial.
- Ring 3.3 post-check monitor passed with eight succeeded runs, zero failed/interrupted/stale runs, diagnostic types `run.completed` and `run.sdk_started`, zero auth/model alerts, no alerts, and no warnings.
- Ring 3.4 external MCP scope is defined and executed with `pnpm smoke:pi-external-mcp -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000`; real production MCP credentials, real network-backed MCP calls, production agent external MCP configs, live channel delivery, Buildroom, and scheduled automation remained excluded.
- Ring 3.4 external MCP evidence passed on 2026-05-17: agent schema validation, credential header resolution, credential-store audit reason, allowed custom tool exposure, disallowed tool suppression, Pi custom tool definition/execution, Pi policy denial, upstream call path, and redaction all passed.
- Ring 3.4 post-check monitor passed with six succeeded runs, zero failed/interrupted/stale runs, diagnostic types `run.completed` and `run.sdk_started`, zero auth/model alerts, no alerts, and no warnings.

What is not done:

- A true Claude baseline turn has not been sent in the live channel; this remains a written waiver for the first Pi-only window, not an unresolved startup blocker.
- Remaining Ring 3 expanded product surfaces have not started: scheduled Buildroom and broader plugin/MCP/cron combinations.

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
| 7. Default-runtime rollout | In progress | Flip runtime default safely. | Default flip is merged into `main`; post-merge local, durable, live pull, safe Web UI, extended monitoring, Ring 1, Ring 2, Ring 3.1 learning review, Ring 3.2 session continuity, Ring 3.3 plugin context, and Ring 3.4 external MCP are green; remaining Ring 3+ expansion remains. |

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

1. Execute the scheduled Buildroom Ring 3 surface without enabling live cron/proactive delivery.
2. Define that Ring 3 scope narrowly with explicit excluded surfaces and rollback owner.
3. Run pre-surface `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`.
4. Execute one targeted scenario and record redacted evidence.
5. Keep the config-only rollback path ready by setting `runtime.headless.provider=claude-agent-sdk` if any stop condition appears.

## Default Runtime Gate

The evidence gate for making Pi the tracked global default is satisfied and the flip is merged. Durable run `25970623984` established the pre-flip `READY` decision, PR #110 carried rollout/rollback instructions, and durable run `25971022679` revalidated the decision package after the default flip landed on `main`.

Ring 1 is closed by operator acceptance after green live-channel and monitor evidence. Ring 2 is closed after the low-risk normal-operation window and post-window monitor. Ring 3.1 learning review, Ring 3.2 session continuity, Ring 3.3 plugin context, and Ring 3.4 external MCP are closed. Default Pi is no longer evidence-blocked; the next gate is scheduled Buildroom evidence.
