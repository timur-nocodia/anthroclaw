# Pi Expansion Packet: example

Status: closed_default_runtime_canary
Owner: Timur
Rollback path: research/runtime-v1-migration-status.md
Risk: high
Recommended ring: ring4
Agent source: /Users/tyess/dev/openclaw-agents-sdk-clone/agents

## Audit Roots

- /Users/tyess/dev/openclaw-agents-sdk-clone/agents

## Scope

`example` is the tracked default-runtime regression canary. Its tracked config audits as high-risk because it carries controlled admin/tool surfaces such as `send_message`, `manage_cron`, `manage_skills`, `connect_mcp`, and `escalate`, but its Runtime v1/Pi rollout evidence is already closed through the default-runtime canary, Web UI, Telegram DM, cron, proactive notification, recurring cron, controlled `send_message`, escalation policy, rollback, and monitor sequence.

This packet is not approval for broad production use. It records that `example` remains a regression canary and that new live surfaces beyond the closed Runtime v1 rollout still need explicit operator scope.

## Closed Evidence

- default-runtime canary evidence: closed
- Web UI and allowlisted Telegram DM evidence: closed
- Ring 4.1 one-shot live cron delivery: closed
- Ring 4.2 live proactive notification: closed
- Ring 4.3 live recurring cron: closed
- Ring 4.4 controlled `send_message` fanout: closed
- Ring 4.5 public escalation policy regression: closed
- rollback and post-run monitor evidence: closed

## Remaining Constraints

- keep as regression canary
- do not treat closed `example` evidence as approval for unrelated agents, groups, WhatsApp, customer paths, or broad fanout
- rerun monitor before and after any new side-effect class

## Repeatable Checks

- `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`
- `pnpm smoke:pi-public-escalation -- --json`
