# Pi Expansion Packet: timur_agent

Date: 2026-05-18

Status: tracked config points at the connected default Telegram bot; live operator command suite passed; controlled side-effect smoke gates are closed; operator-approved live `send_message`, `send_media`, and proactive notification actions passed against the allowlisted operator DM.
Owner: operator
Rollback path: move `agents/timur_agent` off account `default`, restore `pi_telegram_lab` to account `default`, or set `config.yml` `runtime.headless.provider=claude-agent-sdk`.
Risk: high
Recommended ring: ring4
Agent source: `agents/timur_agent`

## Purpose

`timur_agent` is the full-featured operator parity lab. It is intentionally broader than `pi_telegram_lab`: the point is to let the operator test the full Runtime v1/Pi harness through one private assistant before promoting more obscure production agents.

The tracked route uses the connected Telegram account `default`. The previous `pi_telegram_lab` route is kept valid but moved to account `pi_telegram_lab_archive` so it no longer claims the operator DM on the connected bot.

## Audit Roots
- `agents`

## Enabled Feature Groups

- Runtime: per-agent Pi runtime override.
- Channel: allowlisted Telegram DM route on account `default`.
- Memory: `memory_search`, `memory_write`, `memory_wiki`, `session_search`, `local_note_search`, `local_note_propose`.
- Learning: propose-only learning with admin approval route.
- Delivery/tools: `send_message`, `send_media`, `manage_cron`, `manage_notifications`, `manage_human_takeover`.
- Admin/config: `access_control`, `show_config`, `manage_operator_console`, `list_skills`, `manage_skills`.
- MCP: managed `connect_mcp` onboarding is enabled; no hardcoded external MCP servers are committed.
- Plugins: LCM, operator-console, and file-transfer enabled; Honcho config present but disabled until a local Honcho service is intentionally started.
- Buildroom: handoff signal and session-summary tools are available.
- Notifications: agent error, iteration-budget, and escalation notifications route to the operator route.
- Cron: one silent-check job exists but is disabled by default.

## Blockers
- operator escalation tool
- high-risk tools: buildroom_submit_session_summary, buildroom_submit_signal, connect_mcp, manage_cron, manage_skills, send_media, send_message
- proactive notifications

## Activation Guard

- `timur_agent` now owns `telegram/default/dm/48705953`.
- `pi_telegram_lab` is archived on account `pi_telegram_lab_archive` and should not receive traffic from the connected default bot.
- Keep the first live turn text-only and use `/smoke`; do not start with `send_message`, `send_media`, cron, MCP, or plugin delegation.

## Automated Evidence
- [x] config parse and route isolation
  - Result: passed.
  - Command: `pnpm exec vitest run test/routing/live-agents-routing.test.ts test/config/loader.test.ts src/config/__tests__/schema.test.ts`
  - Evidence: `timur_agent` resolves the connected default Telegram operator DM; `pi_telegram_lab` resolves only on account `pi_telegram_lab_archive`.
- [x] expansion audit
  - Result: passed with `status=attention`, `coverageGap=false`, `risk=high`, `recommendedRing=ring4`.
  - Command: `pnpm runtime:pi-expansion-audit -- --agents-dir agents --agent timur_agent --expect-agent timur_agent --json`
- [x] runtime monitor after expansion: `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`
  - Result: passed after the `timur_agent` default-route switch and operator-readiness smoke, with failed/interrupted/stale runs `0`, auth/model alerts `0`, alerts `[]`, and warnings `[]`.
- [x] smoke:pi-plugins-context: `pnpm smoke:pi-plugins-context -- --json`
  - Result: passed.
  - Covered: plugin lifecycle, plugin tools/policy, context engine assemble/compress, plugin subagent runner, LCM, operator-console, and file-transfer.
- [x] smoke:pi-public-escalation: `pnpm smoke:pi-public-escalation -- --json`
  - Result: passed.
  - Covered: public-safe escalation metadata, prefixed MCP permission, unknown plugin MCP denial, isolated escalation logging, and no real customer delivery.
- [x] operator command smoke: `pnpm runtime:pi-timur-agent-operator-smoke -- --json --allow-skip`
  - Purpose: verify `/smoke`, `/help`, `/status`, `/scope`, `/tools`, `/memory`, `/learning`, `/plugins`, `/cron`, `/mcp`, and `/handoff` through fake Telegram DM dispatch before or alongside manual live Telegram use.
  - Result: passed. Covered the Pi `/smoke` runtime canary and deterministic Telegram operator readiness commands on the `default` account route.
- [x] memory/session read smoke: `pnpm runtime:pi-timur-agent-memory-read-smoke -- --json --allow-skip`
  - Purpose: verify `memory_search`, `session_search`, and `local_note_search` through Pi Gateway dispatch against a seeded temp `timur_agent` workspace.
  - Result: passed. Required read-only tools each had one started and one completed event, forbidden write/delivery/cron/admin/escalation/Buildroom/MCP tools had zero events, approval requests were `0`, and the response included `TIMUR_AGENT_MEMORY_READ_OK`.
- [x] learning propose-only gate: `pnpm runtime:pi-learning-propose-gate -- --agent-id timur_agent --peer-id 48705953 --sender-id 48705953 --run-id timur-agent-learning-propose-smoke-run --json --allow-skip`; compatibility alias: `pnpm runtime:pi-timur-agent-learning-propose-smoke -- --json --allow-skip`
  - Purpose: verify a Pi-backed learning review for `timur_agent` persists proposed actions and artifacts without applying memory or skill changes before operator approval.
  - Result: passed. The review completed in `mode=propose`, produced one `memory_candidate` action with `status=proposed`, created one pending operator decision, persisted artifacts, and left `memoryWrites=0` plus `skillSnapshots=0`.
- [x] cron/notification smoke: `pnpm runtime:pi-timur-agent-cron-notification-smoke -- --json`
  - Purpose: verify the disabled-by-default cron contract and proactive notification route without live channel delivery.
  - Result: passed. The static `timur-agent-lab-silent-check` cron existed with `enabled=false`; a temp dynamic cron was created, listed, toggled disabled, deleted with `remaining=0`, and bound delivery to the operator dispatch context while ignoring a model-supplied target. The notification tool test dispatched once through an injected fake dispatcher, and `NotificationsEmitter` produced exactly one fake `escalation_needed` send to the operator route with the canary marker.
- [x] messaging/media smoke: `pnpm runtime:pi-timur-agent-messaging-media-smoke -- --json`
  - Purpose: verify controlled `send_message` and `send_media` fanout through the `timur_agent` private operator route without live channel delivery.
  - Result: passed. `send_message` was allowed, `send_media` requested and received explicit approval, fake text/media sends each fired exactly once to `telegram/default/48705953`, account and thread context were preserved, media path traversal was blocked, and a paused peer suppressed an attempted `send_message` with no extra fake send.
- [x] operator-approved live `send_message` gate: `pnpm runtime:pi-timur-agent-live-send-message -- --confirm-live-send --json --marker "TIMUR_AGENT_LIVE_SEND_MESSAGE_OK 2026-05-18T09:19:55Z"`
  - Purpose: verify one real `send_message` delivery through the same tool path, constrained to `timur_agent` private Telegram DM `default/48705953`, after explicit operator approval.
  - Result: passed. The gate validated the private allowlist, DM route, MCP tool exposure, and `createCanUseTool()` permission; real Telegram delivery returned `messageId=181`; metrics recorded run `pi-live-send-c3bfa9af-d756-4501-856f-cb7044621bbe` with `send_message` started/completed and no failed tool events. Post-run monitor passed with alerts `[]` and warnings `[]`.
- [x] operator-approved live `send_media` gate: `pnpm runtime:pi-timur-agent-live-send-media -- --confirm-live-send-media --json --caption "TIMUR_AGENT_LIVE_SEND_MEDIA_OK 2026-05-18T09:30:06Z"`
  - Purpose: verify one real document delivery through the same `send_media` tool path, constrained to `timur_agent` private Telegram DM `default/48705953`, after explicit operator approval.
  - Result: passed. The gate validated the private allowlist, DM route, MCP tool exposure, auto-resolved operator approval, and committed lab-file root binding under `agents/timur_agent/lab-files`; real Telegram document delivery returned `messageId=182`; metrics recorded run `pi-live-media-ebb4abe5-754e-4871-8b70-e3f114642406` with `send_media` started/completed and no failed tool events. Post-run monitor passed with alerts `[]` and warnings `[]`.
- [x] operator-approved live proactive notification gate: `pnpm runtime:pi-timur-agent-live-notification -- --confirm-live-notification --json --note "TIMUR_AGENT_LIVE_NOTIFICATION_MARKDOWN_OK 2026-05-18T09:45:57Z"`
  - Purpose: verify one real proactive notification through `NotificationsEmitter`, constrained to `timur_agent` private Telegram DM `default/48705953`, after explicit operator approval and without cron/config mutation.
  - Result: passed after a formatter hardening pass. The first delivery returned Telegram `messageId=183` and metrics run `pi-live-notification-da91ab06-9860-43b5-9917-f424e051cf09`, but operator observation showed Telegram Markdown stripped underscores from the italicized marker. The escalation note formatter now renders notes as Telegram code text; the repeat delivery returned `messageId=184`, metrics recorded run `pi-live-notification-d2e2dd95-f8bd-4457-868b-5f0776238519`, `notifications.emit` started/completed cleanly, and the post-run monitor passed with alerts `[]` and warnings `[]`.
- [x] admin/config smoke: `pnpm runtime:pi-timur-agent-admin-config-smoke -- --json`
  - Purpose: verify operator-admin/config tools on a temp `timur_agent` copy without mutating live config or ACL state.
  - Result: passed. `show_config` read current sections with defaults, `manage_operator_console` and `manage_human_takeover` applied controlled self-target patches with two audit entries and two config backups, unauthorized cross-agent management was denied, and `access_control` listed pending, approved, listed approved, and revoked a temp sender with no live ACL changes.
- [x] Buildroom handoff smoke: `pnpm runtime:pi-timur-agent-buildroom-handoff-smoke -- --json`
  - Purpose: verify sanitized Buildroom session-summary and handoff-signal tools on temp Buildroom storage without creating live Buildroom artifacts or granting execution authority.
  - Result: passed. The temp room failed closed when uninitialized, then accepted one sanitized `session_summary` and one parent-linked `handoff_signal`; both used the dispatch-bound `sourceSessionId`, raw transcript inclusion stayed false, the summary could not approve work, the handoff requested `research_only`, and `authority.canApprove=false` plus `authority.canBuild=false`.
- [x] MCP/file-transfer smoke: `pnpm runtime:pi-timur-agent-mcp-file-transfer-smoke -- --json`
  - Purpose: verify managed `connect_mcp` onboarding and bundled file-transfer root policy without external MCP calls or live file writes.
  - Result: passed. Private Telegram DM attribution was forwarded into `connect_mcp`, group chat onboarding was rejected with `mcp_onboarding_requires_dm`, check/cancel lifecycle calls returned expected statuses, no hardcoded external MCP servers were configured, bundled file-transfer exposed list/fetch/write tools for temp roots derived from `agents/timur_agent/lab-files` and `research`, and an outside-root fetch was denied.
- [x] Honcho local smoke: `pnpm runtime:pi-timur-agent-honcho-local-smoke -- --json`
  - Purpose: verify the configured-but-disabled local Honcho contract without starting a local Honcho service, requiring an API key, or making network calls.
  - Result: passed. The tracked config stayed `enabled=false`, `mode=tools`, `environment=local`, `base_url=http://localhost:8000`, `workspace_id=anthroclaw-timur-agent-lab`, and `max_retries=0`; startup planning skipped Honcho while disabled; no Honcho tools or context engine were exposed; a temp activation candidate registered the bundled Honcho engine, observe hook, and six tool names; `honcho_status` reported the local tools-mode config; session-scoped tools required a dispatch session key; tools-mode context assembly did not auto-inject context.

## Manual Evidence
- [x] controlled proactive notification canary
  - Evidence: `pnpm runtime:pi-timur-agent-cron-notification-smoke -- --json` passed with fake-only `manage_notifications` test dispatch and one fake `NotificationsEmitter` proactive send to `telegram/default/48705953`. No real Telegram delivery was performed.
- [x] learning review remains propose-only or has operator approval evidence
  - Evidence: `pnpm runtime:pi-learning-propose-gate -- --agent-id timur_agent --peer-id 48705953 --sender-id 48705953 --run-id timur-agent-learning-propose-smoke-run --json --allow-skip` and `pnpm runtime:pi-timur-agent-learning-propose-smoke -- --json --allow-skip` passed with proposed-only action status, pending decision status, and no memory/skill application.
- [x] tool-specific controlled fanout or scheduled-work evidence
  - Evidence: `pnpm runtime:pi-timur-agent-cron-notification-smoke -- --json` passed with static cron disabled, temp dynamic cron cleanup, operator-context delivery binding, and fake-only notification fanout.
- [x] controlled messaging/media canary
  - Evidence: `pnpm runtime:pi-timur-agent-messaging-media-smoke -- --json` passed with fake-only `send_message` and `send_media` delivery, explicit `send_media` approval, operator peer/account/thread binding, path traversal denial, and paused-peer suppression. No real Telegram delivery was performed.
- [x] controlled live `send_message` canary
  - Evidence: operator approved a live action on 2026-05-18. `pnpm runtime:pi-timur-agent-live-send-message -- --confirm-live-send --json --marker "TIMUR_AGENT_LIVE_SEND_MESSAGE_OK 2026-05-18T09:19:55Z"` delivered one real Telegram DM via `send_message` to `telegram/default/48705953`; Telegram returned `messageId=181`; `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert` passed with one succeeded run, diagnostics `run.sdk_started`, `run.tool_started`, `run.tool_completed`, `run.completed`, one started/completed tool pair, and no alerts or warnings.
- [x] controlled live `send_media` canary
  - Evidence: operator approved the next live media action on 2026-05-18. `pnpm runtime:pi-timur-agent-live-send-media -- --confirm-live-send-media --json --caption "TIMUR_AGENT_LIVE_SEND_MEDIA_OK 2026-05-18T09:30:06Z"` delivered one real Telegram document via `send_media` to `telegram/default/48705953`; Telegram returned `messageId=182`; `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert` passed with two succeeded runs in the window, diagnostics `run.sdk_started`, `run.tool_started`, `run.tool_completed`, `run.completed`, two started/completed tool pairs, and no alerts or warnings.
- [x] controlled live proactive notification canary
  - Evidence: operator approved the next live notification action on 2026-05-18. `pnpm runtime:pi-timur-agent-live-notification -- --confirm-live-notification --json --note "TIMUR_AGENT_LIVE_NOTIFICATION_OK 2026-05-18T09:41:40Z"` delivered one real Telegram notification via `NotificationsEmitter` to `telegram/default/48705953`; Telegram returned `messageId=183`, but operator observation showed the italic Markdown marker rendered without underscores. After the formatter was hardened to render escalation notes as Telegram code text, `pnpm runtime:pi-timur-agent-live-notification -- --confirm-live-notification --json --note "TIMUR_AGENT_LIVE_NOTIFICATION_MARKDOWN_OK 2026-05-18T09:45:57Z"` delivered the repeat notification; Telegram returned `messageId=184`; `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert` passed with four succeeded runs in the window, diagnostics `run.sdk_started`, `run.tool_started`, `run.tool_completed`, `run.completed`, four started/completed tool pairs, and no alerts or warnings.
- [x] controlled admin/config canary
  - Evidence: `pnpm runtime:pi-timur-agent-admin-config-smoke -- --json` passed against a temp `timur_agent` copy with `show_config`, `manage_operator_console`, `manage_human_takeover`, config audit/backups, cross-agent denial, and temp-only `access_control` approve/revoke.
- [x] controlled Buildroom handoff canary
  - Evidence: `pnpm runtime:pi-timur-agent-buildroom-handoff-smoke -- --json` passed against temp Buildroom storage with sanitized session summary, parent-linked handoff signal, fail-closed uninitialized storage, and explicit no-approval/no-build authority.
- [x] controlled MCP/file-transfer canary
  - Evidence: `pnpm runtime:pi-timur-agent-mcp-file-transfer-smoke -- --json` passed with managed onboarding attribution, DM-only rejection, no committed external MCP server config, temp-only file-transfer read/list/write, and outside-root denial.
- [x] controlled Honcho local canary
  - Evidence: `pnpm runtime:pi-timur-agent-honcho-local-smoke -- --json` passed with disabled-state startup gating, temp-only activation surface proof, local keyless config validation, dispatch-session requirement, no auto context injection in tools mode, and no network call.
- [x] live Telegram account switch to `default` is approved by operator
- [x] first controlled live text turn returns expected behavior
  - Evidence: operator sent `/smoke` in Telegram DM at 2026-05-17 14:41 Asia/Almaty; the bot replied exactly `TIMUR_AGENT_LAB_OK`.
- [x] `/smoke` returns exactly `TIMUR_AGENT_LAB_OK`
- [x] `/status`, `/tools`, `/memory`, `/plugins`, and `/handoff` are exercised by the operator
  - Evidence: operator sent these commands in Telegram DM at 2026-05-17 14:41 Asia/Almaty. The bot reported `timur_agent: ok`, `runtime: pi`, `scope: dedicated operator parity lab`, `learning: propose-only`, `route_account: default`, listed enabled tool groups, memory/LCM/Honcho state, plugin state, and the repeatable smoke command.
- [x] `/scope`, `/learning`, `/cron`, and `/mcp` are exercised by the operator
  - Evidence: operator sent these commands in Telegram DM at 2026-05-17 14:45 Asia/Almaty. The bot reported allowlisted Telegram DM scope, guarded real side effects with explicit target confirmation, propose-only learning with operator review, disabled-by-default lab cron, managed MCP onboarding, and no hardcoded secrets.

## Audit Command
```bash
pnpm runtime:pi-expansion-audit -- \
  --agents-dir agents \
  --expect-agent timur_agent \
  --agent timur_agent \
  --json
```

## Notes

- This packet replaces the near-term focus on obscure low-usage agents. `content_sm_building`, `project-manager`, and other production-specific agents should wait until the operator has exercised `timur_agent` end to end.
- The agent is feature-rich by design, so live rollout should be treated as Ring 4 even though it is operator-owned and private.
