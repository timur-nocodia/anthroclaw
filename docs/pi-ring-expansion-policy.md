# Pi ring expansion policy

Date: 2026-05-17

This policy controls expansion after Pi became the tracked global headless runtime default. It separates already-completed default-runtime evidence from higher-risk live channel and agent rollout decisions.

## Current Baseline

Pi is the tracked global default in `config.yml`:

```yaml
runtime:
  headless:
    provider: pi
```

Current evidence is green enough to keep Pi as default:

- pre-flip Runtime v1 decision package: `READY`;
- post-flip durable decision run: `25971022679`;
- live checkout pull to Pi default completed;
- `pi-auth`, `pi-all`, safe no-channel Web UI turn, and extended `runtime:pi-monitor` window passed;
- no failed, interrupted, stale running, auth, or model stop-condition alerts in the monitored window.

The remaining risk is not the default provider selection itself. The remaining risk is live channel behavior and expansion to agents with broader tool, plugin, learning, or cron surfaces.

## Rings

| Ring | Scope | Entry Gate | Exit Gate |
| --- | --- | --- | --- |
| 0. Default runtime baseline | Global default Pi, no-channel/Web UI verification, monitoring only | `main` has Pi default and `runtime:pi-monitor -- --fail-on-alert` passes | Completed. Keep monitoring active. |
| 1. Low-risk live channel turn | One controlled `example` live channel turn in an operator-owned peer | Ring 0 still green; operator confirms target peer and message text | Completed by operator acceptance after exact-answer live channel turn plus green immediate/manual monitor checks. |
| 2. Low-risk normal operation | Low-risk agents/channels without send-message fanout, cron delivery, or broad plugin actions | Ring 1 exits cleanly, no stop conditions | Monitoring remains green through a normal usage window. |
| 3. Expanded product surfaces | Agents with plugins, learning review, memory-heavy workflows, external MCP, or scheduled Buildroom | Ring 2 exits cleanly; explicit owner approves each surface | Targeted scenario evidence plus monitoring remains green. |
| 4. High-risk automation | Agents with cron delivery, proactive notifications, broad `send_message`, or business-critical workflows | Ring 3 exits cleanly; rollback owner is present | Production monitoring confirms no stop conditions for the agreed window. |

Do not advance more than one ring per PR or operational checkpoint.

## Ring 1 Live Channel Turn

Ring 1 should be intentionally small. Use a low-risk agent, known operator-owned peer, and exact-answer prompt.

Recommended turn:

```text
Reply exactly PI_LIVE_CHANNEL_OK. Do not use tools.
```

Expected result:

- the user-visible reply is exactly `PI_LIVE_CHANNEL_OK`;
- no unexpected tool calls;
- session id is recorded;
- no private transcript or provider log is pasted into docs or PRs;
- `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert` still passes after the turn.

If a real live channel turn is deferred, keep the written waiver explicit in `research/runtime-v1-production-canary-preflight.md` and this policy remains at Ring 0.

## Ring 1 Evidence

Ring 1 live channel turn was executed on 2026-05-17 at 01:12 Asia/Almaty:

- agent: `example`;
- channel: Telegram DM;
- target: allowlisted operator peer `48705953`;
- prompt: `Reply exactly PI_LIVE_CHANNEL_OK. Do not use tools.`;
- delivery path: `Gateway.dispatch` with real `TelegramChannel.sendText`, without Telegram long-polling;
- result: exactly `PI_LIVE_CHANNEL_OK`;
- sent messages: `1`;
- message id: present;
- immediate post-turn monitor: passed;
- immediate post-turn runs: `8` total, `8` succeeded, `0` failed, `0` interrupted, `0` stale running;
- auth/model alerts: `0`;
- tool events in the 15-minute Ring 1 slice: none.

Manual operator monitor at approximately 01:21 Asia/Almaty also passed for the 60-minute window:

- runs: `3` total, `3` succeeded, `0` failed, `0` interrupted, `0` stale running;
- auth/model alerts: `0`;
- alerts: none;
- warnings: none.

Ring 1 is closed by operator acceptance. The original 30-minute post-turn monitoring timer is waived for this checkpoint; the operator will escalate if later monitoring detects a stop condition.

## Stop Conditions

Stop rollout and rollback or hold the current ring when any of these occur:

- `runtime:pi-monitor` emits `status=alert`;
- any failed, interrupted, or stale running run appears without an expected explanation;
- provider auth/model diagnostics appear;
- a policy denial regresses into an allowed protected action;
- an exact-answer prompt returns duplicated, empty, or materially wrong text;
- unexpected tool use occurs during a no-tools live turn;
- session continuation breaks across turns;
- interrupt, checkpoint, or rewind behavior fails in a ring that depends on it;
- diagnostics, docs, PRs, or logs expose provider keys, auth JSON, raw private transcripts, or raw provider logs;
- learning, cron, notification, plugin, or MCP errors appear in a ring that exercises those surfaces.

Warnings from expected denied-path canaries are not stop conditions when they are already explained and monitoring has no alerts.

## Rollback

Default rollback is config-only:

```yaml
runtime:
  headless:
    provider: claude-agent-sdk
```

After changing the config:

1. Restart Gateway.
2. Run `pnpm runtime:pi-monitor -- --since-minutes 60 --json`.
3. Run `pnpm runtime:pi-canary-agent -- --agents-dir /Users/tyess/dev/openclaw-agents-sdk-clone/agents --agent example --json`.
4. Confirm agents without per-agent overrides resolve to `claude-agent-sdk`.

For ring-specific rollback, prefer a per-agent override only when the global default should remain Pi for lower rings. Do not leave temporary per-agent overrides undocumented.

## Required Checks Per Ring

Before advancing:

```bash
pnpm smoke:pi-auth -- --json --model anthropic/claude-sonnet-4-6
pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert
```

After the ring action:

```bash
pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert
```

Record only redacted summaries:

- ring number and scope;
- command status;
- total/succeeded/failed/interrupted/stale runs;
- auth/model alert count;
- diagnostic event types;
- expected warnings;
- exact rollback state.
