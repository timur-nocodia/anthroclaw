# Pi production canary runbook

This runbook records the first real AnthroClaw production canary window for the Pi runtime. It is the operational evidence required after Runtime v1 scripted canaries pass and before Pi can become the default runtime.

The canary must keep the global default on `claude-agent-sdk`. Pi is enabled only for one low-risk agent through that agent's config. Rollback must be tested before the canary window is considered complete.

## Required Inputs

- Target branch or commit that includes the Runtime v1 canary stack.
- A low-risk private or trusted agent id.
- A named operator owner.
- Pi auth/model storage available outside the repo.
- A clean `pnpm smoke:pi-v1-canary -- --json ...` artifact.
- A `pnpm runtime:pi-decision` artifact generated from that canary output.

Do not paste provider keys, Pi storage JSON, raw private transcripts, or raw provider logs into this document, a PR body, or a tracked artifact.

## Candidate Agent Criteria

The first canary agent must satisfy all of these:

- low traffic and easy to pause;
- private route or trusted peer set;
- simple workspace with no critical production files;
- limited tool surface;
- no irreversible external side effects;
- active human owner available for rollback;
- current Claude Agent SDK baseline verified before switching to Pi.

Do not use a public, sales, billing, notification, deployment, or Buildroom-heavy agent for the first canary window.

## Preflight

Run from the target branch or staging worktree:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm smoke:pi-v1-canary -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000 > /tmp/pi-v1-canary.json
pnpm runtime:pi-decision -- --input /tmp/pi-v1-canary.json --summary /tmp/runtime-v1-decision.md --json /tmp/runtime-v1-decision.json
```

The decision package may remain `BLOCKED` before the production canary window, but all smoke and scripted canary gates must be passing. If `real-auth-smoke`, `scripted-canaries`, or `rollback-exercised` is blocked, stop here.

If the GitHub Actions **Pi smoke** workflow is used, keep its `pi-smoke-result` artifact as supporting evidence. The workflow currently proves aggregate real-auth smoke; the full Runtime v1 decision package still comes from `smoke:pi-v1-canary`.

Preferred repository-hosted evidence path: run **Actions -> Pi Runtime v1 decision -> Run workflow**. Keep `allow_skip` false for decision evidence. Set `production_canary` to `pending` before the first canary window and to `passed` only after this runbook is complete.

## Enable Pi For One Agent

Keep global runtime config unchanged. Add or update only the canary agent config:

```yaml
runtime:
  headless:
    provider: pi
```

Preferred operator command:

```bash
pnpm runtime:pi-canary-agent -- --agents-dir /path/to/agents --agent <agent-id> --enable-pi --json
pnpm runtime:pi-canary-agent -- --agents-dir /path/to/agents --agent <agent-id> --enable-pi --apply --json
```

The first command is a dry-run and must report `applied: false`. The second command writes only that agent's `runtime` section, validates `agent.yml`, and creates an `agent.yml.bak-*` backup before the atomic write.
Keep the `backupPath` from the applied command. It is the preferred exact rollback input.

If staging must use isolated Pi storage paths, configure them through runtime config that is not committed with secrets:

```yaml
runtime:
  headless:
    provider: pi
    pi:
      auth_path: /secure/pi-auth.json
      models_path: /secure/pi-models.json
```

Verify the operator API/dashboard reports:

- configured provider is `pi` for the canary agent;
- non-canary agents still resolve to `claude-agent-sdk`;
- Pi auth/model paths are redacted;
- active runs, sessions, route decisions, interrupts, learning, MCP, plugins, and diagnostics remain visible.

## Canary Script

Run these prompts through the real channel or Web UI used by the target agent. Record only redacted summaries, run ids, and links to safe artifacts.

| Step | Prompt or Action | Expected Evidence |
| --- | --- | --- |
| Baseline | Send a simple text-only prompt before enabling Pi. | Claude baseline response, session key, run id. |
| Text | Send a simple text-only prompt after enabling Pi. | Pi run succeeds, final response delivered, runtime visible. |
| Session | Send a follow-up that depends on the prior turn. | Same AnthroClaw session continues; provider session mapping is visible. |
| Read | Ask the agent to read a harmless workspace file. | Read is policy-allowed and visible in tool/runtime evidence. |
| Edit | Ask for a small approved file edit in the canary workspace. | Approval is requested/resolved; file diff matches request. |
| Deny | Ask for a protected-path or unsafe action. | AnthroClaw policy denies before side effect; model-visible denial is returned. |
| External MCP | If the agent has external MCP tools, call a harmless read-only tool. | MCP proxy path is used; credentials stay redacted. |
| Interrupt | Start a long or looping task, then interrupt it. | Active run appears, interrupt is recorded, resources close. |
| Learning | Let post-run learning execute if enabled. | Review/action/artifact/decision state remains inspectable and redacted. |
| Diagnostics | Export diagnostics without logs unless explicitly required. | Runtime, route, run, interrupt, learning, plugin, MCP evidence present without secrets. |

## Observation Window

Default first window: 24 hours or at least 20 successful real turns, whichever gives better coverage. A shorter window is acceptable only if the canary is intentionally limited to a maintenance/test agent and the rollout owner records that limitation.

Track:

- total Pi turns;
- failed Pi turns;
- policy denials;
- approval requests and timeouts;
- interrupt latency;
- session continuation issues;
- provider auth/model errors;
- tool execution errors;
- learning queue errors;
- operator-visible UI/API gaps.

## Stop Conditions

Stop the canary and roll back immediately if any of these occur:

- provider key, auth storage, private transcript, or MCP credential appears in output, logs, diagnostics, or artifacts;
- a denied or ask-gated tool executes without AnthroClaw approval;
- a protected path is modified;
- a public or unintended channel receives canary output;
- active run cannot be interrupted;
- session mapping crosses peers, routes, or agents;
- diagnostics or dashboard state is misleading enough for an operator to make the wrong decision;
- repeated provider/runtime failures exceed the agreed error budget.

## Rollback

Rollback is required evidence, not only an emergency action.

For the canary agent, restore the exact `agent.yml` backup emitted by the enablement command:

```bash
pnpm runtime:pi-canary-agent -- --agents-dir /path/to/agents --agent <agent-id> --restore-backup /path/to/agents/<agent-id>/agent.yml.bak-... --json
pnpm runtime:pi-canary-agent -- --agents-dir /path/to/agents --agent <agent-id> --restore-backup /path/to/agents/<agent-id>/agent.yml.bak-... --apply --json
```

The first command is a dry-run and must report `applied: false`. The second command validates the backup, backs up the current Pi config, and restores the original file atomically.

If the original backup is unavailable, either remove the per-agent runtime override manually or explicitly set:

```yaml
runtime:
  headless:
    provider: claude-agent-sdk
```

Preferred rollback command:

```bash
pnpm runtime:pi-canary-agent -- --agents-dir /path/to/agents --agent <agent-id> --rollback --json
pnpm runtime:pi-canary-agent -- --agents-dir /path/to/agents --agent <agent-id> --rollback --apply --json
```

The fallback dry-run should show `desiredProvider: "claude-agent-sdk"` before the applied command is used. Prefer exact backup restore when possible because it returns comment/order/runtime fields to their original state.

Then verify:

- the operator API/dashboard resolves the canary agent back to `claude-agent-sdk`;
- a text prompt succeeds;
- the previous AnthroClaw session view remains readable;
- active runs are empty or intentionally closed;
- no Pi-specific failures continue after rollback.

## Evidence Template

Copy this template into the migration tracker or PR comment after the canary window. Keep the values redacted and link only safe artifacts.

```markdown
## Pi production canary evidence

Date:
Branch or commit:
Operator owner:
Agent id:
Routes covered:
Window start:
Window end:
Total Pi turns:
Failed Pi turns:
Rollback verified: yes/no

Artifacts:
- Runtime v1 canary JSON:
- Runtime v1 decision Markdown:
- Diagnostics export:
- Relevant run ids:

Gate results:
- Real-auth smoke:
- Scripted canaries:
- Dashboard/operator API:
- Production canary window:
- Rollback:
- Browser UX evidence: not-required/passed/waived

Observed gaps:
- None, or list issue links with severity and owner.

Decision:
- Continue canary / expand to next ring / block rollout.
```

## Recording The Decision

After the window, regenerate the decision package with the operational gates:

```bash
pnpm runtime:pi-decision -- \
  --input /tmp/pi-v1-canary.json \
  --summary /tmp/runtime-v1-decision.md \
  --json /tmp/runtime-v1-decision.json \
  --production-canary passed \
  --pr-stack merged \
  --browser-ux not-required
```

Use `--browser-ux passed` if a screenshot/browser pass was required and completed. Use `--browser-ux waived` only with an owner and written reason.

Pi can move to the next rollout ring only when the generated decision package is `READY` or when every blocking failure has a named owner and an explicit written waiver.

If using GitHub Actions, rerun **Pi Runtime v1 decision** with `production_canary=passed`, `pr_stack=merged`, and the correct `browser_ux` state instead of running the local command above.
