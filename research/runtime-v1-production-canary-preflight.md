# Runtime v1 production canary preflight

Date: 2026-05-16

This note prepares the first real AnthroClaw Pi production canary window. It is not the canary evidence record; the evidence template remains in `docs/pi-production-canary-runbook.md`.

## Current Evidence Baseline

- PR #95 is merged into `main` as `9b46102f74397b6eee25d8b8d60f7c85843f0ba4`.
- GitHub Actions **Pi Runtime v1 decision** run `25965686443` on `main` passed build, Pi storage preparation, all ten Runtime v1 canary scenarios, and artifact upload.
- The generated decision package is `BLOCKED` only by `production_canary=pending`.
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

Minimum window:

- baseline one Claude text turn before the override;
- one Pi text turn;
- one Pi follow-up turn in the same AnthroClaw session;
- one harmless read;
- one small approved edit inside the agent workspace;
- one denied unsafe/protected-path action;
- interrupt check if a long-running prompt can be triggered safely;
- diagnostics export with secrets and private transcripts excluded;
- rollback to `claude-agent-sdk`;
- one post-rollback text turn.

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
pnpm runtime:pi-canary-agent -- --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents --agent example --rollback --apply --json
```

## Final Decision Step

After the production window is recorded, rerun **Pi Runtime v1 decision** from `main` with:

- `production_canary=passed`;
- `pr_stack=merged`;
- `browser_ux=not-required` unless browser evidence is explicitly required;
- `fail_on_blocked=true`.

Only a `READY` decision package should unlock a default-runtime flip PR.
