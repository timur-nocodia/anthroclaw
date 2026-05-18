# Pi Expansion Packet: project-manager

Status: generic group-route preflight passed; live tool evidence pending.
Owner: Timur
Rollback path: research/runtime-v1-migration-status.md
Risk: high
Recommended ring: ring4
Agent source: /Users/tyess/dev/anthroclaw-vibe-agents/agents

## Audit Roots

- /Users/tyess/dev/openclaw-agents-sdk-clone/agents
- /Users/tyess/dev/anthroclaw-vibe-agents/agents

## Scope

`project-manager` is a high-risk Telegram group agent. It is not approved for live Pi expansion by this packet alone. The packet records the concrete audit roots, blockers, automated checks, and manual evidence required before any controlled group turn or tool side effect.

## Blockers

- telegram group route
- high-risk tools: connect_mcp, manage_cron
- external MCP servers: 2

## Automated Evidence

- [x] runtime:pi-monitor before expansion: `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`
  - Result: passed from live checkout `/Users/tyess/dev/openclaw-agents-sdk-clone`.
  - Window: 60 minutes, 0 failed/interrupted/stale, auth/model alerts 0, alerts `[]`, warnings `[]`.
  - Note: run count was 0, so this is a no-alert baseline only.
- [x] smoke:pi-external-mcp: `pnpm smoke:pi-external-mcp -- --json`
  - Result: passed.
  - Covered: credential header resolution, credential store reads, allowed proxy tool exposure, hidden disallowed tool, Pi custom tool definition/execution, Pi policy denial, upstream call path, redaction, and agent schema validation.
- [x] smoke:pi-plugins-context: `pnpm smoke:pi-plugins-context -- --json`
  - Result: passed.
  - Covered: plugin loading/enabling, disabled-agent tool exclusion, plugin tool policy, hooks, context/compression, subagent tool disabling, bundled `file-transfer`, `lcm`, and `operator-console` plugin paths.
- [x] generic Telegram group-route preflight: `pnpm runtime:pi-telegram-group-preflight -- --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents --agents-dir /Users/tyess/dev/anthroclaw-vibe-agents/agents --data-dir /Users/tyess/dev/openclaw-agents-sdk-clone/data --agent-id project-manager --confirm-account content_sm --confirm-peer -1003729315809 --confirm-topic 8 --json`
  - Result: passed.
  - Covered: multi-root audit with `coverageGap=false`, configured Telegram group route, explicit account/peer/topic confirmation, `mention_only=true`, and live runtime monitor with alerts `[]` and warnings `[]`.
- [ ] runtime:pi-monitor after expansion: `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`

## Manual Evidence

- [x] allowlisted peer/thread confirmation
  - Evidence: generic Telegram group-route preflight required explicit `--confirm-account`, `--confirm-peer`, and `--confirm-topic`; the configured `content_sm` mention-only Telegram group route matched those operator-supplied values.
- [x] learning review remains propose-only or has operator approval evidence
  - Result: closed by config audit.
  - Evidence: tracked `agent.yml` has `learning.enabled=true` and `learning.mode=propose`; `runtime:pi-expansion-audit` reports `learningMode="propose"` for `project-manager`.
- [ ] tool-specific controlled fanout or scheduled-work evidence

## Audit Command

`pnpm runtime:pi-expansion-audit -- --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents --agents-dir /Users/tyess/dev/anthroclaw-vibe-agents/agents --expect-agent project-manager --agent project-manager --json`
