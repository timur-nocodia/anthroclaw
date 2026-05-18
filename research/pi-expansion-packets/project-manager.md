# Pi Expansion Packet: project-manager

Status: ready_for_execution
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

- [ ] runtime:pi-monitor before and after expansion: `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`
- [ ] smoke:pi-external-mcp: `pnpm smoke:pi-external-mcp -- --json`
- [ ] smoke:pi-plugins-context: `pnpm smoke:pi-plugins-context -- --json`

## Manual Evidence

- [ ] allowlisted peer/thread confirmation
- [ ] learning review remains propose-only or has operator approval evidence
- [ ] tool-specific controlled fanout or scheduled-work evidence

## Audit Command

`pnpm runtime:pi-expansion-audit -- --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents --agents-dir /Users/tyess/dev/anthroclaw-vibe-agents/agents --expect-agent project-manager --agent project-manager --json`
