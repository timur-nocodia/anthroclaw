# Pi Expansion Packet: pi_telegram_lab

Date: 2026-05-17

Status: live Telegram DM evidence closed; ready for ordinary operator use.

Owner: operator
Rollback path: disable `agents/pi_telegram_lab` route or remove `agents/pi_telegram_lab/agent.yml`; runtime fallback is `config.yml` `runtime.headless.provider=claude-agent-sdk`.
Risk: low
Recommended ring: ring2
Agent source: `agents/pi_telegram_lab`

## Scope

- Telegram DM only.
- Route is bound to the allowlisted operator peer.
- No group route.
- No `send_message`, `send_media`, `manage_cron`, `manage_skills`, `escalate`, plugins, external MCP, notifications, or cron jobs.
- MCP onboarding is disabled; `connect_mcp` is not part of the runtime tool surface.
- Learning is propose-only.
- Telegram DM operator commands are explicitly defined in `agents/pi_telegram_lab/CLAUDE.md`: `/help`, `/status`, `/scope`, `/memory`, `/smoke`, `/handoff`.

## Automated Evidence

- [x] config audit: `pnpm runtime:pi-expansion-audit -- --agents-dir agents --agent pi_telegram_lab --expect-agent pi_telegram_lab --json`
  - Result: passed.
  - Risk: low.
  - Coverage: `coverageGap=false`, `expectedAgentsMissing=[]`, `errors=[]`.
- [x] route-table build
  - Result: passed.
  - Agents included: `example`, `pi_telegram_lab`.
  - Purpose: prove the new Telegram route does not break tracked route table construction.
- [x] direct Gateway/Pi lab smoke: `pnpm runtime:pi-telegram-lab-smoke -- --json --allow-skip`
  - Purpose: run the tracked `pi_telegram_lab` through Gateway dispatch with a fake Telegram DM channel before or alongside a manual Telegram turn.
  - Result: passed.
  - Response: `PI_TELEGRAM_LAB_OK`.
  - Approvals: `0`.
- [x] operator command smoke: `pnpm runtime:pi-telegram-lab-operator-smoke -- --json --allow-skip`
  - Purpose: verify the Telegram lab command contract for `/smoke`, `/help`, `/status`, `/scope`, `/memory`, and `/handoff` through fake Telegram DM dispatch.
  - Result: passed.
  - Expected: `/smoke` returns exactly `PI_TELEGRAM_LAB_OK`; informational commands include their required operator contract lines.
- [x] operator readiness gate: `pnpm runtime:pi-telegram-lab-readiness -- --json --allow-skip`
  - Purpose: combine config audit, route proof, direct Pi smoke, and live monitor into one pre-manual-turn verdict.
  - Result: passed against live agents/data/plugins roots.
  - Checks: config audit passed, route proof passed, monitor-before passed, direct Pi smoke passed, monitor-after passed.
- [x] runtime monitor before turn: `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`
  - Result: passed from live checkout `/Users/tyess/dev/openclaw-agents-sdk-clone`.
  - Window: 60 minutes, 0 failed/interrupted/stale, auth/model alerts 0, alerts `[]`, warnings `[]`.
  - Note: run count was 0, so this is a no-alert baseline only.
- [x] runtime monitor after controlled Telegram DM turn: `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`
  - Result: passed via post-turn gate.
  - Window: 60 minutes, 1 succeeded run, failed/interrupted/stale `0`, diagnostic events `run.sdk_started=1`, `run.completed=1`, auth/model alerts `0`, alerts `[]`, warnings `[]`.
- [x] live Telegram turn check after controlled DM: `pnpm runtime:pi-telegram-lab-live-check -- --json --fail-on-pending`
  - Purpose: prove the live metrics database contains a recent successful `source=channel`, `channel=telegram`, `peer_id=48705953` run for `pi_telegram_lab`.
  - Result: passed.
  - Run: `3afa6dbe-e1d6-453d-a675-e772fec70236`, started `2026-05-17T08:30:12.524Z`, message id `144`, source `channel`, channel `telegram`, peer `48705953`, status `succeeded`.
- [x] post-turn gate after controlled DM: `pnpm runtime:pi-telegram-lab-post-turn -- --json --fail-on-pending`
  - Purpose: combine the live Telegram turn check and runtime monitor into one final post-turn verdict.
  - Result: passed.
- [x] post-turn gate after live operator command suite: `pnpm runtime:pi-telegram-lab-post-turn -- --json --fail-on-pending`
  - Purpose: prove the live Telegram command turns are recorded as successful Pi channel runs and did not leave monitoring alerts.
  - Result: passed.
  - Window: 60 minutes, 5 succeeded `pi_telegram_lab` Telegram runs, failed/interrupted/stale `0`, diagnostic events `run.sdk_started=5`, `run.completed=5`, auth/model alerts `0`, alerts `[]`, warnings `[]`.

## Manual Evidence

- [x] learning review remains propose-only
  - Evidence: redacted audit reports `learningMode=propose`.
- [x] controlled Telegram DM turn returns expected Pi response.
  - Evidence: operator sent `привет как дела` in Telegram DM at 2026-05-17 13:30 local time; the bot replied in Russian.
  - Metrics: live run `3afa6dbe-e1d6-453d-a675-e772fec70236` recorded `agentId=pi_telegram_lab`, `source=channel`, `channel=telegram`, `peerId=48705953`, `status=succeeded`.
- [x] live Telegram operator command suite returns expected command responses.
  - Evidence: operator sent `/help`, `/status`, `/scope`, and `/smoke` in Telegram DM at 2026-05-17 13:51 local time; the bot listed commands, reported Pi/runtime/tool/scope status, reported allowed/blocked scope, and returned `PI_TELEGRAM_LAB_OK`.
  - Metrics: live runs `a16f7a32-7155-41e4-be07-cdb14289ec36`, `135b58e1-0e89-406b-a58f-468357429a5c`, `6c1a8e4f-b220-4c1b-a06e-f41b2182e4ff`, and `08829eab-4035-418f-88f2-f4db0034e793` recorded `agentId=pi_telegram_lab`, `source=channel`, `channel=telegram`, `peerId=48705953`, message ids `146`, `148`, `150`, and `152`, all `status=succeeded`.

## Reproducible Audit Command

```bash
pnpm runtime:pi-expansion-audit -- \
  --agents-dir agents \
  --agent pi_telegram_lab \
  --expect-agent pi_telegram_lab \
  --json
```

## Suggested Live Turn

Send a Telegram DM to the lab bot with a harmless marker prompt:

```text
Ответь ровно: PI_TELEGRAM_LAB_OK
```

Expected result: the agent replies exactly `PI_TELEGRAM_LAB_OK`, then the post-turn monitor remains green.

The first live manual evidence used a natural greeting instead of the marker prompt. The marker prompt remains the recommended repeatable smoke text.

The first live operator command evidence used `/help`, `/status`, `/scope`, and `/smoke`. `/memory` and `/handoff` remain covered by the fake Telegram command smoke and can be exercised manually when needed.

## Operator Commands

- `/help`: list `/status`, `/scope`, `/memory`, `/smoke`, `/handoff`.
- `/status`: report `pi_telegram_lab: ok`, `runtime: pi`, the allowlisted Telegram DM scope, available tools, and propose-only learning.
- `/scope`: report allowed Telegram DM/memory/list-skills actions and blocked fanout, media, cron, external MCP, and MCP onboarding.
- `/memory`: explain when durable memory search/write may be used.
- `/smoke`: reply exactly plain text `PI_TELEGRAM_LAB_OK`, with no backticks, quotes, bullet, or extra text.
- `/handoff`: summarize scope and provide the readiness/post-turn commands.

## Notes

- This is the first intended hands-on Telegram test agent after Runtime v1 rollout.
- It is deliberately narrower than `example` so ordinary manual testing does not exercise fanout, cron, plugin, external MCP, or admin-tool surfaces.
