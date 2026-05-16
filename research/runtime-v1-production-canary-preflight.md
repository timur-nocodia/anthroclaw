# Runtime v1 production canary evidence

Date: 2026-05-17

This note started as the first real AnthroClaw Pi production canary preflight and now records the limited `example` Web UI production canary evidence. The runbook evidence log remains in `docs/pi-production-canary-runbook.md`.

## Current Evidence Baseline

- PR #95 is merged into `main` as `9b46102f74397b6eee25d8b8d60f7c85843f0ba4`.
- GitHub Actions **Pi Runtime v1 decision** run `25965686443` on `main` passed build, Pi storage preparation, all ten Runtime v1 canary scenarios, and artifact upload.
- The generated decision package is `BLOCKED` only by `production_canary=pending`.
- PR #106 merged on 2026-05-16 and closed the focused Pi Web UI/Gateway canary blockers found during the first `example` attempt.
- A local full Runtime v1 canary run from `main` after PR #106 passed all ten scenarios. The regenerated decision package with `pr_stack=merged` is `BLOCKED` only by `production-canary-window=pending`.
- PR #107 merged on 2026-05-16 and refreshed the decision evidence docs.
- PR #108 merged on 2026-05-16 and made `pi-workspace-smoke` reject duplicated `SMOKE_OKSMOKE_OK` text instead of accepting it as green.
- A local full Runtime v1 canary run from `main` after PR #107 and PR #108 passed all ten scenarios. Both standalone and aggregate workspace smoke results returned exactly `SMOKE_OK`.
- The limited `example` Web UI production canary passed on 2026-05-17 local time, was rolled back with exact backup restore, and produced a local final decision package of `READY`.
- No default-runtime flip has started.

## Candidate Shortlist

| Agent | Initial Verdict | Reason |
| --- | --- | --- |
| `example` | Preferred first canary candidate | Private Telegram DM route with an allowlist, no enabled cron jobs, simple local workspace, and easy rollback by removing a single per-agent runtime override. |
| `project-manager` | Possible later candidate | Small tool surface, but group route and no allowlist make it a worse first canary target. |
| `content_sm_building` | Not first | Group route, broader content/tool surface, and media/search tools increase observation and side-effect risk. |
| `leads_agent` | Not first | Public safety profile and WhatsApp DM lead flow are poor first-canary characteristics. |
| `amina` | Not enough config evidence | Local directory currently has credential storage but no readable `agent.yml` in the checked path. |

## Recommended First Window

Use `example` only if an operator owner is present and accepts the short window. Keep the global default on `claude-agent-sdk` and add only this per-agent override:

```yaml
runtime:
  headless:
    provider: pi
```

Use the guarded CLI rather than editing YAML directly:

```bash
pnpm runtime:pi-canary-agent -- --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents --agent example --enable-pi --json
pnpm runtime:pi-canary-agent -- --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents --agent example --enable-pi --apply --json
```

Observed dry-run before any live change: `example` currently resolves to `claude-agent-sdk`; enabling Pi would change the provider and would not write until `--apply` is present.

Config-only rehearsal evidence from 2026-05-16:

- no AnthroClaw Gateway/channel process was running, so no live messages were dispatched;
- `pnpm runtime:pi-canary-agent -- --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents --agent example --enable-pi --apply --json` created a pre-canary backup and wrote the temporary Pi override;
- `pnpm runtime:pi-canary-agent -- --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents --agent example --restore-backup <backupPath> --apply --json` restored the exact original file;
- final `agent.yml` hash matched the original hash `3740020ff3ba6523c32c1c3ac8053be0ef832a7c56233d777d2280356887b036`;
- rehearsal backup artifacts were removed after verification to avoid accidentally committing local operational files.

This rehearsal proves the local config mutation/restore mechanics only. It does not satisfy the production canary window gate because it did not run real channel turns.

Focused Web UI/Gateway canary evidence from 2026-05-16:

- The first attempt temporarily enabled Pi for `example` and used `Gateway.dispatchWebUI()` with `channel=web`; no Telegram or WhatsApp messages were sent.
- Text, harmless workspace read, and small workspace write succeeded under Pi, but the first attempt exposed three blockers: session follow-up did not preserve conversational context, an outside-workspace read was allowed, and streamed partial text duplicated the final response.
- PR #106 fixed those blockers by returning Pi's `sessionFile` as the resumable reference, denying Pi Gateway `Read`/`Write`/`Edit` paths outside the agent workspace before chat-profile allow, and ignoring Pi `text_end` as a duplicate partial delta.
- The focused post-fix rerun replied exactly `PI_CANARY_TEXT_OK`, the same-session follow-up replied exactly `PI_CANARY_TEXT_OK`, and the outside-workspace read check replied exactly `DENY_OK`.
- The post-fix rollback restored `example/agent.yml` to SHA-256 `3740020ff3ba6523c32c1c3ac8053be0ef832a7c56233d777d2280356887b036`; generated backup artifacts were removed.

This focused rerun satisfies the Web UI/Gateway blocker fix, but it still does not satisfy the full production canary window because it did not cover the duration/turn-count requirement or live channel observation.

Limited Web UI production canary evidence from 2026-05-17:

- The operator accepted an intentionally short first window for the low-risk `example` maintenance/test agent. This is narrower than the default 24-hour or 20-turn recommendation and should not be treated as a broad rollout signal by itself.
- Global runtime stayed on `claude-agent-sdk`; only `example` was temporarily switched to Pi through the guarded CLI.
- Gateway was started with real local `agents`, `data`, and `plugins` paths, but with no Telegram or WhatsApp channel adapters configured for the canary run.
- Five Web UI turns passed in one Pi provider session: text, same-session follow-up, harmless workspace read, small workspace edit, and denied protected-path read.
- Exact replies were `PI_PROD_TEXT_OK`, `PI_PROD_FOLLOWUP_OK`, `PI_PROD_READ_OK`, `PI_PROD_EDIT_OK`, and `PI_PROD_DENY_OK`.
- Tool evidence covered Pi `read`, Pi `edit`, and a denied Pi `read` of `/etc/hosts`; AnthroClaw returned the workspace-boundary denial before any protected-path side effect.
- Diagnostics were exported without logs. The safe summary recorded 16 run rows, 0 failed runs, 20 diagnostic events, and no Telegram or WhatsApp accounts active in this Gateway instance.
- Exact restore returned `example/agent.yml` to SHA-256 `3740020ff3ba6523c32c1c3ac8053be0ef832a7c56233d777d2280356887b036`; temporary canary file and backup artifacts were removed.
- Local `pnpm runtime:pi-decision -- --production-canary passed --pr-stack merged --browser-ux not-required --fail-on-blocked` produced `READY` with no blocking failures.
- Durable GitHub Actions **Pi Runtime v1 decision** run `25970623984` on `main` commit `72766ff850a3dfff757a25e7b232c9002b7fcdac` passed build, Pi storage preparation, the full ten-scenario canary map, final `READY` decision generation with `production_canary=passed`, and artifact upload.

Gateway hot-reload rehearsal evidence from 2026-05-16:

- Gateway started from the current Runtime v1 worktree using real local `config.yml`, `agents`, `data`, and `plugins` paths from `/Users/tyess/dev/openclaw-agents-sdk-clone`;
- Telegram polling started for the configured bot account;
- guarded `example` enable wrote `runtime.headless.provider=pi` while Gateway was running;
- ConfigWatcher detected `example/agent.yml` and completed hot reload after the Pi write;
- exact backup restore returned `example` to `claude-agent-sdk` while Gateway was still running;
- ConfigWatcher detected the restore and completed a second hot reload;
- final `agent.yml` hash again matched `3740020ff3ba6523c32c1c3ac8053be0ef832a7c56233d777d2280356887b036`;
- generated rehearsal backups were removed after verification.

Follow-up fix from 2026-05-16:

- Gateway now installs canonical `OC_AGENTS_DIR` and `OC_DATA_DIR` values from its actual startup arguments while running, then restores the previous process env on stop.
- The underlying issue was a worktree/dev-data mismatch: cutoff resolved the Claude SDK `cwd` from `process.cwd()/agents` when those env vars were unset, even though Gateway had been started with real dev `agentsDir` and `dataDir` arguments.
- Real Gateway startup was rechecked with `OC_AGENTS_DIR`/`OC_DATA_DIR` unset and the same real dev config/agents/data/plugin paths; Gateway started, Telegram polling started, and the prior `Claude Code native binary not found` warning did not recur.
- This clears the startup blocker for a Claude baseline turn. It does not itself satisfy the baseline-turn evidence because no channel message was sent during the verification.

No-channel Claude baseline attempt from 2026-05-16:

- `headless:runtime` was run against `claude-agent-sdk` with the real dev `config.yml`, `data`, and `agents/example` cwd.
- The runtime reached the Claude provider path but returned `Invalid authentication credentials` from the configured local Claude auth.
- The headless runtime was hardened afterward so text-shaped Claude auth failures fail the smoke command instead of being recorded as successful model text.
- Remaining choice before the first Pi production canary: refresh/replace Claude auth and capture the baseline turn, or explicitly waive the Claude baseline for a Pi-first window and record that waiver with an owner.

## Claude Baseline Waiver

Status: **waived for the first Pi-only production canary window**.

Owner: AnthroClaw migration owner in the current operator thread.

Reason:

- the remaining Claude baseline blocker is provider auth (`Invalid authentication credentials`), not AnthroClaw runtime startup or Gateway routing;
- the migration goal is to move the harness contract away from Claude Agent SDK dependence, so repairing Claude auth only to prove the deprecated provider path would not reduce Pi rollout risk enough to justify delaying the first Pi-only window;
- Claude baseline startup/routing evidence is still partially covered by the 2026-05-16 Gateway startup verification: Gateway started from the Runtime v1 worktree with real dev config/agents/data/plugin paths, Telegram polling started, and the previous native-binary/cwd blocker did not recur.

Scope:

- this waiver covers only the **pre-Pi Claude text baseline** and **post-rollback Claude text prompt** rows for the first `example` Pi-only production canary window;
- it does not waive Pi real-auth smoke, scripted Runtime v1 canaries, live Pi text/follow-up turns, safe tool read/edit/deny evidence, rollback config restore, diagnostics redaction, or the final Runtime v1 decision package;
- if the first Pi window fails for a reason that needs direct Claude comparison, refresh Claude auth before expanding the canary ring.

Minimum window:

- baseline one Claude text turn before the override, or the waiver above linked in the evidence record;
- one Pi text turn;
- one Pi follow-up turn in the same AnthroClaw session;
- one harmless read;
- one small approved edit inside the agent workspace;
- one denied unsafe/protected-path action;
- interrupt check if a long-running prompt can be triggered safely;
- diagnostics export with secrets and private transcripts excluded;
- rollback to `claude-agent-sdk`;
- one post-rollback text turn, unless covered by the waiver above.

The default 24-hour or 20-turn window from the runbook is still the stronger evidence. A shorter window should be recorded as intentionally limited and should not be treated as a broad rollout signal.

## Do Not Start Unless

- the operator owner is named;
- the target channel/peer is confirmed safe for canary output;
- the agent workspace and protected paths are known;
- rollback can be applied immediately;
- diagnostics exports are reviewed for redaction before linking anywhere;
- no provider keys, Pi auth JSON, raw private transcripts, or raw provider logs are pasted into docs, PRs, or tracked artifacts.

## Exact Rollback

Rollback is required evidence. For the canary agent, remove the per-agent Pi override or set:

```yaml
runtime:
  headless:
    provider: claude-agent-sdk
```

After rollback, verify the operator API/dashboard resolves the agent back to `claude-agent-sdk`, a text prompt succeeds, the session remains visible, and there are no active Pi runs left open.

Guarded rollback command:

```bash
pnpm runtime:pi-canary-agent -- --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents --agent example --restore-backup <backupPath-from-enable-pi> --json
pnpm runtime:pi-canary-agent -- --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents --agent example --restore-backup <backupPath-from-enable-pi> --apply --json
```

Use `--rollback --apply` only as a fallback when the original `agent.yml.bak-*` path is unavailable; exact backup restore should be the first choice for the `example` canary because it currently has no explicit runtime override.

## Final Decision Step

After the production window is recorded, rerun **Pi Runtime v1 decision** from `main` with:

- `production_canary=passed`;
- `pr_stack=merged`;
- `browser_ux=not-required` unless browser evidence is explicitly required;
- `fail_on_blocked=true`.

Only a `READY` decision package should unlock a default-runtime flip PR.
