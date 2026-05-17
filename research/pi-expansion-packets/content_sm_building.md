# Pi Expansion Packet: content_sm_building

Date: 2026-05-17

Status: preflight automated evidence partially closed; manual evidence and post-expansion monitor pending.

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
- [ ] runtime monitor after expansion: `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`

## Manual Evidence

- [ ] allowlisted peer/thread confirmation
- [ ] tool-specific controlled fanout or scheduled-work evidence

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
- The remaining evidence is intentionally manual because this agent has group route and high-risk fanout tools.
