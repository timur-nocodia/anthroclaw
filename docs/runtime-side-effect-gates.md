# Runtime Side-Effect Gates

Runtime side-effect gates are the provider-neutral replacement for one-off Pi live evidence scripts.

The gate contract lives in `src/runtime/side-effect-gate.ts`. It is intentionally small: a gate describes the agent identity, target route, side-effect action, policy assertions, expected effects, cleanup checks, and metrics expectations. The implementation name must describe the reusable capability, not a lab or production agent.

## Required Shape

Every live side-effect gate must declare:

- `gateId`: reusable capability name, for example `live-send-message` or `live-cron-delivery`.
- `agentId`: concrete agent under test, supplied as input.
- `runtime`: selected runtime, for example `pi`.
- `action`: side-effect kind, for example `message.send`, `media.send`, `notification.emit`, or `cron.fire`.
- `target`: channel/account/peer/thread destination.
- `dryRunSupported`: true before any live action can be accepted.
- `approvalRequired`: true for every non-read-only side effect.
- `policyAssertions`: permission, route, allowlist, scope, file-root, or trust checks.
- `expectedEffects`: the exact external or durable effects allowed to happen.
- `cleanupChecks`: assertions that temporary state was removed or intentionally left unchanged.
- `metrics`: run/tool/diagnostic expectations that make the gate monitorable.

## Refactor Direction

`live-send-message`, `live-send-media`, `live-notification`, `cron-notification`, `buildroom-handoff`, `admin-config`, `mcp-file-transfer`, `honcho-local`, `learning-propose`, and `memory-read` are the first extracted gates. The machine-readable gate list lives in `src/runtime/side-effect-gates/registry.ts`; add or rename gates there first, then wire the focused CLI and docs. The reusable implementations live under `src/runtime/side-effect-gates/` and are runnable through:

```sh
pnpm runtime:pi-live-send-message-gate -- --agent-id <id> --peer-id <peer> --dry-run --json
pnpm runtime:pi-live-send-media-gate -- --agent-id <id> --peer-id <peer> --file-path <path> --allowed-file-root <root> --dry-run --json
pnpm runtime:pi-live-notification-gate -- --agent-id <id> --peer-id <peer> --dry-run --json
pnpm runtime:pi-cron-notification-gate -- --agent-id <id> --peer-id <peer> --sender-id <sender> --static-cron-id <id> --dynamic-cron-id <id> --json
pnpm runtime:pi-buildroom-handoff-gate -- --agent-id <id> --peer-id <peer> --sender-id <sender> --json
pnpm runtime:pi-admin-config-gate -- --agent-id <id> --peer-id <peer> --session-key <key> --json
pnpm runtime:pi-mcp-file-transfer-gate -- --agent-id <id> --peer-id <peer> --sender-id <sender> --json
pnpm runtime:pi-honcho-local-gate -- --agent-id <id> --peer-id <peer> --expected-workspace-id <workspace> --json
pnpm runtime:pi-learning-propose-gate -- --agent-id <id> --peer-id <peer> --sender-id <sender> --json --allow-skip
pnpm runtime:pi-memory-read-gate -- --agent-id <id> --peer-id <peer> --sender-id <sender> --json --allow-skip
```

The old `pi-timur-agent-live-send-message`, `pi-timur-agent-live-send-media`, `pi-timur-agent-live-notification`, `pi-timur-agent-cron-notification-smoke`, `pi-timur-agent-buildroom-handoff-smoke`, `pi-timur-agent-admin-config-smoke`, `pi-timur-agent-mcp-file-transfer-smoke`, `pi-timur-agent-honcho-local-smoke`, `pi-timur-agent-learning-propose-smoke`, and `pi-timur-agent-memory-read-smoke` commands remain only as compatibility/evidence aliases with `timur_agent` defaults. New work should create or extend generic gates first, then bind a concrete agent through CLI args or expansion-packet fixtures.

The aggregate dispatcher is available as:

```sh
pnpm runtime:pi-live-gate -- --list
pnpm runtime:pi-live-gate -- --list --json
pnpm runtime:pi-live-gate -- --gate live-send-message --agent-id <id> --peer-id <peer> --dry-run --json
pnpm runtime:pi-live-gate -- --gate memory-read --agent-id <id> --peer-id <peer> --sender-id <sender> --json --allow-skip
```

The JSON list is the automation contract for dashboards and runners. Each gate entry includes `risk`, `action`, focused/compatibility commands, `execution.requiredFlags`, `execution.optionalFlags`, `execution.supportsDryRun`, `execution.safetyMode`, `execution.approval`, and generic `execution.exampleArgs`. It must not include concrete agent ids, peer ids, or operator secrets.

The desired end state is:

1. `runtime:pi-live-gate -- --gate <gate-id> --agent-id <id> ...`; focused commands such as `runtime:pi-live-send-message-gate`, `runtime:pi-live-send-media-gate`, `runtime:pi-live-notification-gate`, `runtime:pi-cron-notification-gate`, `runtime:pi-buildroom-handoff-gate`, `runtime:pi-admin-config-gate`, `runtime:pi-mcp-file-transfer-gate`, `runtime:pi-honcho-local-gate`, `runtime:pi-learning-propose-gate`, and `runtime:pi-memory-read-gate` remain as direct entrypoints and compatibility with existing evidence
2. expansion packets record the concrete command and operator approval
3. agent-specific CLI names are gradually removed or reduced to thin aliases

This keeps Agent SDK parity at the harness boundary: any configured agent can use the same gate contract when its route, tools, and safety policy allow the action.
