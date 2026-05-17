# Pi Expansion Packet: leads_agent

Date: 2026-05-17

Status: automated evidence closed; learning evidence closed; customer-facing dry run pending operator closure.

Owner: operator
Rollback path: set `runtime.headless.provider=claude-agent-sdk` or restore the pre-expansion `agent.yml` backup.
Risk: critical
Recommended ring: ring4
Agent source: `/Users/tyess/dev/anthroclaw-vibe-agents/agents`

## Audit Roots

- `/Users/tyess/dev/openclaw-agents-sdk-clone/agents`
- `/Users/tyess/dev/anthroclaw-vibe-agents/agents`

## Blockers

- public safety profile
- WhatsApp route
- whatsapp route without explicit peers
- operator escalation tool

## Automated Evidence

- [x] public-profile policy canary: `pnpm smoke:pi-public-escalation -- --json`
  - Result: passed.
  - Covered: `MCP_META.escalate`, public-profile permission for prefixed/local escalation tool names, denial of unknown plugin MCP tools, isolated JSONL escalation logging for `leads_agent`.
- [x] `smoke:pi-public-escalation`: `pnpm smoke:pi-public-escalation -- --json`
  - Result: passed.
  - Same run as the public-profile policy canary above.
- [x] `smoke:pi-plugins-context`: `pnpm smoke:pi-plugins-context -- --json`
  - Result: passed.
  - Covered: plugin loading/enabling, disabled-agent tool exclusion, plugin tool policy, hooks, context/compression, subagent tool disabling, bundled `file-transfer`, `lcm`, and `operator-console` plugin paths.
- [x] runtime monitor before expansion: `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`
  - Result: passed from live checkout `/Users/tyess/dev/openclaw-agents-sdk-clone`.
  - Window: 60 minutes, 1 succeeded run, 0 failed/interrupted/stale, auth/model alerts 0, alerts `[]`, warnings `[]`.

## Manual Evidence

- [ ] customer-facing dry run with no real customer delivery
- [x] learning review remains propose-only or has operator approval evidence
  - Result: closed by redacted multi-root audit.
  - Evidence: `learningMode` for `leads_agent` is `propose`, so the agent can propose learning actions but does not auto-apply them.
  - Audit status: `coverageGap=false`, `expectedAgentsMissing=[]`, `errors=[]`.

## Reproducible Audit Command

```bash
pnpm runtime:pi-expansion-audit -- \
  --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents \
  --agents-dir /Users/tyess/dev/anthroclaw-vibe-agents/agents \
  --expect-agent leads_agent \
  --agent leads_agent \
  --json
```

## Packet Command

```bash
pnpm runtime:pi-expansion-packet -- \
  --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents \
  --agents-dir /Users/tyess/dev/anthroclaw-vibe-agents/agents \
  --agent leads_agent \
  --owner operator \
  --rollback 'set runtime.headless.provider=claude-agent-sdk or restore the pre-expansion agent.yml backup'
```

## Notes

- Monitor evidence must be collected from the live checkout because isolated worktrees do not have the live `data/metrics.sqlite`.
- This packet is not approval for a live customer-facing expansion until the customer-facing dry run item is closed.
