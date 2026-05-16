# Pi default runtime rollout

Date: 2026-05-17

This document records the first default-runtime flip from `claude-agent-sdk` to Pi. It is intentionally small: the tracked global `config.yml` selects Pi, while agent-specific runtime overrides remain untouched.

Ring expansion after this default flip is controlled by `docs/pi-ring-expansion-policy.md`.

## Evidence

- Runtime v1 production canary evidence is recorded in `docs/pi-production-canary-runbook.md`.
- Runtime v1 migration status is recorded in `research/runtime-v1-migration-status.md`.
- Final durable GitHub Actions **Pi Runtime v1 decision** run `25970623984` passed on `main` commit `72766ff850a3dfff757a25e7b232c9002b7fcdac`.
- The final decision package was `READY` with `production_canary=passed`, `pr_stack=merged`, and `browser_ux=not-required`.
- The limited `example` Web UI production canary passed five Pi turns in one provider session, then exact rollback restored `example/agent.yml` to SHA-256 `3740020ff3ba6523c32c1c3ac8053be0ef832a7c56233d777d2280356887b036`.
- Default-flip local verification passed with `runtime.headless.provider=pi`: targeted runtime/config tests, TypeScript, config parsing, `pi-auth`, and `pi-all`.
- PR #110 merged the default flip into `main` as commit `d0f24383503f3e1d0ef22257a4a2d9f347c62cc8`.
- Post-merge local verification on `d0f2438` passed: config parsing resolved `provider=pi`, targeted runtime/config tests passed, TypeScript passed, `pi-auth` passed, and `pi-all` returned workspace text `SMOKE_OK` plus Gateway text `SMOKE_GATEWAY_OK`.
- Post-merge durable GitHub Actions **Pi Runtime v1 decision** run `25971022679` passed on `main` commit `d0f24383503f3e1d0ef22257a4a2d9f347c62cc8`.
- The live runtime checkout `/Users/tyess/dev/openclaw-agents-sdk-clone` was fast-forwarded to `4d0942cbc58d95553aa025e3b5c5a1d74a19fe4e` on 2026-05-17 local time.
- Post-pull live verification passed: `pnpm install --frozen-lockfile`, config parsing resolved `provider=pi`, TypeScript passed, `pi-auth` passed, and `pi-all` returned workspace text `SMOKE_OK` plus Gateway text `SMOKE_GATEWAY_OK`.
- A no-channel live Gateway Web UI turn against `example` replied exactly `PI_LIVE_WEB_OK` via Pi with no tool calls; the first monitoring slice showed zero failed runs in the last hour and only `run.sdk_started`/`run.completed` diagnostic event types.
- Extended live monitoring snapshot at 2026-05-17 01:04 Asia/Almaty passed with `alerts=[]`: seven runs in the last 60 minutes, all succeeded; failed/interrupted/stale running runs were `0`; auth/model alerts were `0`; diagnostic types were only `run.sdk_started` and `run.completed`. The single failed `read` tool warning is the expected historical denied-path canary event, not a stop condition.

## Change

`config.yml` now sets:

```yaml
runtime:
  headless:
    provider: pi
```

This makes Pi the global headless/Gateway runtime for agents that do not set their own `runtime.headless.provider`.

The PR also normalizes the workspace smoke file-content assertion to accept Pi's requested edit with or without a final newline. The prompt asks Pi for `after AnthroClaw Pi smoke`; the old harness assertion required `after AnthroClaw Pi smoke\n`, which made a correct Pi edit fail the default-flip `pi-all` verification.

## Rollback

Rollback is config-only:

```yaml
runtime:
  headless:
    provider: claude-agent-sdk
```

Then restart Gateway and verify:

```bash
pnpm smoke:pi-auth -- --json --model anthropic/claude-sonnet-4-6
pnpm runtime:pi-canary-agent -- --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents --agent example --json
```

Expected rollback state:

- Gateway starts without Pi-specific startup failures.
- Agents without per-agent Pi overrides resolve to `claude-agent-sdk`.
- Any agent explicitly pinned to Pi still resolves to Pi until its own override is changed.
- No provider keys, Pi auth JSON, private transcripts, or raw provider logs are pasted into PRs or docs.

## Post-Flip Checks

Run immediately after deployment or after pulling the merged `main` into the runtime environment:

```bash
pnpm smoke:pi-auth -- --json --model anthropic/claude-sonnet-4-6
pnpm smoke:pi-all -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000
pnpm runtime:pi-monitor -- --json --fail-on-alert
```

Then start Gateway and verify one safe Web UI turn against a low-risk agent. Record only redacted summaries:

- total Pi turns;
- failed Pi turns;
- provider auth/model errors;
- policy denials;
- approval requests and timeouts;
- interrupt failures;
- session continuation issues;
- diagnostics redaction failures;
- learning queue errors.

Keep rollout ring expansion separate from this default flip. Do not expand to higher-risk agents until the first post-flip monitoring window is green.

Use `docs/pi-ring-expansion-policy.md` for the next live channel turn, stop conditions, and ring advancement gates.

## Live Pull Evidence

Live pull/deploy checkpoint completed on 2026-05-17:

- checkout: `/Users/tyess/dev/openclaw-agents-sdk-clone`;
- commit: `4d0942cbc58d95553aa025e3b5c5a1d74a19fe4e`;
- tracked global provider: `runtime.headless.provider=pi`;
- `pnpm smoke:pi-auth -- --json --model anthropic/claude-sonnet-4-6`: passed;
- `pnpm smoke:pi-all -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000`: passed;
- safe Web UI turn: `example` returned `PI_LIVE_WEB_OK`, no tools, session id present, total tokens `15`;
- monitoring slice: failed runs in the last hour `0`;
- checkout state after verification: clean.

Extended monitoring snapshot at 2026-05-17 01:04 Asia/Almaty:

- command: `pnpm runtime:pi-monitor -- --json --fail-on-alert`;
- status: `passed`;
- window: 60 minutes;
- runs: `7` total, `7` succeeded, `0` failed, `0` interrupted, `0` stale running;
- auth/model alerts: `0`;
- diagnostic event types: `run.sdk_started`, `run.completed`;
- warnings: one failed `read` tool event from the expected denied-path canary.

## Monitoring Command

Use the operator monitor during the first live window and before any ring expansion:

```bash
pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert
```

The command reads `data/metrics.sqlite` by default and reports:

- run totals by status;
- failed/interrupted/stale running runs;
- auth/model diagnostic alerts;
- diagnostic event counts;
- failed tool events as warnings.

For live checkout verification from another worktree, point it at the live data directory:

```bash
pnpm runtime:pi-monitor -- --data-dir /Users/tyess/dev/openclaw-agents-sdk-clone/data --since-minutes 60 --json --fail-on-alert
```
