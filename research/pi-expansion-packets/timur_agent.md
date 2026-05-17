# Pi Expansion Packet: timur_agent

Date: 2026-05-17

Status: tracked config added; live activation pending.
Owner: operator
Rollback path: disable agents/timur_agent route account or keep timur_agent_lab account unconfigured; runtime fallback is config.yml runtime.headless.provider=claude-agent-sdk
Risk: high
Recommended ring: ring4
Agent source: `agents/timur_agent`

## Purpose

`timur_agent` is the full-featured operator parity lab. It is intentionally broader than `pi_telegram_lab`: the point is to let the operator test the full Runtime v1/Pi harness through one private assistant before promoting more obscure production agents.

The tracked route uses Telegram account `timur_agent_lab` so it does not conflict with the current `default` Telegram account routes for `example` or `pi_telegram_lab`. Live activation requires either configuring a dedicated `timur_agent_lab` Telegram bot account or intentionally moving the route to an existing account after disabling conflicting routes.

## Audit Roots
- `agents`

## Enabled Feature Groups

- Runtime: per-agent Pi runtime override.
- Channel: allowlisted Telegram DM route on account `timur_agent_lab`.
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

- The route account `timur_agent_lab` is deliberate. Do not change it to `default` while `pi_telegram_lab` still claims the same Telegram DM peer.
- If a dedicated bot token is used, add a `telegram.accounts.timur_agent_lab` entry in local config and keep the tracked route as-is.
- If the existing default bot is used, first remove or disable the conflicting `pi_telegram_lab` route and then run the routing test before starting Gateway.
- Keep the first live turn text-only and use `/smoke`; do not start with `send_message`, `send_media`, cron, MCP, or plugin delegation.

## Automated Evidence
- [x] config parse and route isolation
  - Result: passed.
  - Command: `pnpm exec vitest run test/routing/live-agents-routing.test.ts test/config/loader.test.ts src/config/__tests__/schema.test.ts`
  - Evidence: `timur_agent` resolves only on Telegram account `timur_agent_lab`; the existing default-account route still resolves operator DM to `pi_telegram_lab`.
- [x] expansion audit
  - Result: passed with `status=attention`, `coverageGap=false`, `risk=high`, `recommendedRing=ring4`.
  - Command: `pnpm runtime:pi-expansion-audit -- --agents-dir agents --agent timur_agent --expect-agent timur_agent --json`
- [ ] runtime monitor before and after expansion: `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`
- [x] smoke:pi-plugins-context: `pnpm smoke:pi-plugins-context -- --json`
  - Result: passed.
  - Covered: plugin lifecycle, plugin tools/policy, context engine assemble/compress, plugin subagent runner, LCM, operator-console, and file-transfer.
- [x] smoke:pi-public-escalation: `pnpm smoke:pi-public-escalation -- --json`
  - Result: passed.
  - Covered: public-safe escalation metadata, prefixed MCP permission, unknown plugin MCP denial, isolated escalation logging, and no real customer delivery.

## Manual Evidence
- [ ] controlled proactive notification canary
- [ ] learning review remains propose-only or has operator approval evidence
- [ ] tool-specific controlled fanout or scheduled-work evidence
- [ ] live Telegram account `timur_agent_lab` is configured or an explicit route switch to `default` is approved
- [ ] first controlled live text turn returns expected behavior
- [ ] `/smoke` returns exactly `TIMUR_AGENT_LAB_OK`
- [ ] `/status`, `/scope`, `/tools`, `/memory`, `/plugins`, `/cron`, `/mcp`, and `/handoff` are exercised by the operator

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
