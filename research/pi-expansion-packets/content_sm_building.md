# Pi Expansion Packet: content_sm_building

Date: 2026-05-17

Status: pre-live-turn gate passed; controlled live group turn and post-expansion monitor pending.

Owner: operator
Rollback path: set `runtime.headless.provider=claude-agent-sdk` or restore the pre-expansion `agent.yml` backup.
Risk: high
Recommended ring: ring4
Agent source: `/Users/tyess/dev/anthroclaw-vibe-agents/agents`

## Audit Roots

- `/Users/tyess/dev/openclaw-agents-sdk-clone/agents`
- `/Users/tyess/dev/anthroclaw-vibe-agents/agents`

## Blockers

- telegram group route
- high-risk tools: manage_cron, send_media, send_message
- external MCP servers: 3

## Automated Evidence

- [x] `smoke:pi-plugins-context`: `pnpm smoke:pi-plugins-context -- --json`
  - Result: passed.
  - Covered: plugin loading/enabling, disabled-agent tool exclusion, plugin tool policy, hooks, context/compression, subagent tool disabling, bundled `file-transfer`, `lcm`, and `operator-console` plugin paths.
- [x] `smoke:pi-external-mcp`: `pnpm smoke:pi-external-mcp -- --json`
  - Result: passed.
  - Covered: credential header resolution, credential store reads, exposed allowed proxy tool, disallowed hidden tool, Pi custom tool definition/execution, policy denial, upstream calls, redaction, and agent schema validation.
- [x] runtime monitor before expansion: `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`
  - Result: passed from live checkout `/Users/tyess/dev/openclaw-agents-sdk-clone`.
  - Window: 60 minutes, 0 failed/interrupted/stale, auth/model alerts 0, alerts `[]`, warnings `[]`.
  - Note: run count was 0, so this is a no-alert baseline only.
- [x] pre-live-turn gate: `pnpm runtime:pi-content-sm-preflight -- --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents --agents-dir /Users/tyess/dev/anthroclaw-vibe-agents/agents --data-dir /Users/tyess/dev/openclaw-agents-sdk-clone/data --confirm-peer <operator-confirmed-peer> --confirm-topic <operator-confirmed-topic> --json`
  - Purpose: combine multi-root audit, explicit operator peer/topic confirmation, safe fake-delivery dry-run, and live runtime monitor before any controlled live group turn.
  - Result: passed.
  - Checks: expansion audit passed with `coverageGap=false`, `risk=high`, `recommendedRing=ring4`; route confirmation passed for the mention-only `content_sm` Telegram group route and configured topics; safe dry-run passed with fake delivery only and temp cron cleanup; runtime monitor passed with alerts `[]` and warnings `[]`.
- [ ] runtime monitor after expansion: `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`

## Manual Evidence

- [x] allowlisted peer/thread confirmation
  - Evidence: pre-live-turn gate required explicit `--confirm-peer` plus repeated `--confirm-topic`; the configured mention-only Telegram group route matched those operator-supplied values.
- [ ] controlled live group turn approved by operator
- [x] tool-specific controlled fanout or scheduled-work evidence
  - Result: closed by deterministic safe dry-run.
  - Command: `pnpm runtime:pi-content-sm-dry-run -- --json`
  - Evidence: `send_message`, `send_media`, and `manage_cron` policy paths allowed under `chat_like_openclaw`; `send_message` and `send_media` executed only against a fake Telegram adapter; temp cron was bound to dispatch context, ignored model-supplied `deliver_to`, and was deleted before exit.

## Reproducible Audit Command

```bash
pnpm runtime:pi-expansion-audit -- \
  --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents \
  --agents-dir /Users/tyess/dev/anthroclaw-vibe-agents/agents \
  --expect-agent content_sm_building \
  --agent content_sm_building \
  --json
```

## Packet Command

```bash
pnpm runtime:pi-expansion-packet -- \
  --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents \
  --agents-dir /Users/tyess/dev/anthroclaw-vibe-agents/agents \
  --agent content_sm_building \
  --owner operator \
  --rollback 'set runtime.headless.provider=claude-agent-sdk or restore the pre-expansion agent.yml backup'
```

## Notes

- This packet is not approval for live group/channel expansion.
- The remaining allowlist evidence is intentionally manual because the actual group/thread identifiers stay out of redacted artifacts.
