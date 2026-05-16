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
| 2. Low-risk normal operation | Low-risk agents/channels without send-message fanout, cron delivery, or broad plugin actions | Ring 1 exits cleanly, no stop conditions | Completed. Web UI plus Telegram DM usage window passed; post-window monitor remained green. |
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

## Ring 2 Scope

Ring 2 is the first low-risk normal-operation window. It intentionally proves day-to-day routing without enabling the surfaces that can amplify a runtime defect.

Allowed:

- agent: `example`;
- routes: Web UI and Telegram DM only;
- Telegram peer: allowlisted operator peer `48705953`;
- prompts: ordinary operator messages and exact-answer sanity prompts;
- memory/learning: learning may remain `mode: propose`; no auto-apply;
- tools: no forced broad tool exercise; incidental safe reads are acceptable only inside the agent workspace.

Excluded:

- cron delivery and scheduled Buildroom;
- proactive notifications;
- `send_message` fanout beyond the originating operator peer;
- `manage_cron`, `manage_skills`, `connect_mcp`, external MCP onboarding, and Buildroom handoff tools;
- WhatsApp and non-operator Telegram peers;
- private transcript/provider-log capture in docs or PRs.

Pre-Ring-2 checks passed on 2026-05-17:

- `pnpm smoke:pi-auth -- --json --model anthropic/claude-sonnet-4-6`: passed with Pi package `0.74.0` and available `anthropic/claude-sonnet-4-6`;
- `pnpm runtime:pi-monitor -- --since-minutes 60 --json --fail-on-alert`: passed with `3` succeeded runs, `0` failed/interrupted/stale runs, auth/model alerts `0`, alerts none, warnings none.

## Ring 2 Evidence

Ring 2 low-risk usage window was executed on 2026-05-17:

- agent: `example`;
- Web UI result: exactly `PI_RING2_WEB_OK`;
- Web UI session id: present;
- Web UI total tokens: `16`;
- Web UI tool calls: `0`;
- Telegram result: exactly `PI_RING2_TELEGRAM_OK`;
- Telegram channel: DM to allowlisted operator peer `48705953`;
- Telegram sent messages: `1`;
- Telegram message id: present;
- learning side effect: propose-only review created with action type `none`;
- excluded surfaces remained excluded: no cron delivery, no `send_message` fanout, no Buildroom, no external MCP, no WhatsApp.

Post-window monitor passed:

- runs: `6` total, `6` succeeded, `0` failed, `0` interrupted, `0` stale running;
- diagnostic event types: `run.completed`, `run.sdk_started`;
- auth/model alerts: `0`;
- alerts: none;
- warnings: none.

Ring 2 is closed. The next ring must choose one targeted expanded product surface instead of broadening all plugin, learning, memory, MCP, and scheduled paths at once.

## Ring 3.1 Learning Review Scope

The first Ring 3 expanded product surface is learning review in propose-only mode. This surface is intentionally narrower than memory or skill application: it validates that Pi-shaped runs can create inspectable learning reviews/actions and that an operator can close a proposed action without applying memory or skill changes.

Allowed:

- agent: `example`;
- source evidence: learning review/action generated by the Ring 2 Pi usage window;
- operator actions: `pnpm learning list` and one `pnpm learning reject` transition for an action with `action_type=none`;
- persistence checks: review/action counts and target action state in `data/learning.sqlite`;
- monitoring: `runtime:pi-monitor` after the transition.

Excluded:

- `pnpm learning approve`;
- `pnpm learning apply`;
- memory writes from learning actions;
- skill create/update/patch application;
- plugin, external MCP, Buildroom, cron, notification, and `send_message` fanout surfaces.

## Ring 3.1 Learning Review Evidence

Ring 3.1 learning review was executed on 2026-05-17:

- pre-check monitor: passed with `6` succeeded runs, `0` failed/interrupted/stale runs, auth/model alerts `0`, alerts none, warnings none;
- learning reviews for `example`: `2` completed;
- learning actions before transition: `2` proposed `none` actions;
- operator command: `pnpm learning reject <actionId> --reason ring3-learning-review-closed-no-action`;
- target transition: `proposed` -> `rejected`;
- target action type: `none`;
- rejection reason: present;
- `applied_at`: null;
- actions after transition: `1` proposed `none`, `1` rejected `none`;
- post-check monitor: passed with `6` succeeded runs, `0` failed/interrupted/stale runs, auth/model alerts `0`, alerts none, warnings none.

Ring 3.1 is closed. Ring 3 remains open for the next expanded surface; do not jump directly to broad plugin/MCP/Buildroom or scheduled automation coverage.

## Ring 3.2 Session Continuity Scope

The second Ring 3 expanded surface is memory-heavy session continuity through the Gateway Web UI path. It validates that Pi can preserve conversational facts across a continued AnthroClaw session while the product session mapping remains visible to Gateway.

Allowed:

- agent: `example`;
- route: Web UI only;
- two-turn same-session continuation;
- exact-answer prompts with several harmless session facts;
- session visibility checks through Gateway session listing/details;
- post-scenario monitor.

Excluded:

- Telegram/WhatsApp delivery;
- `memory_write` and learning apply;
- plugin tool calls;
- external MCP;
- Buildroom;
- cron delivery and proactive notifications;
- `send_message` fanout.

## Ring 3.2 Session Continuity Evidence

Ring 3.2 session continuity was executed on 2026-05-17:

- first Web UI turn: exactly `PI_RING3_MEMORY_SEED_OK`;
- first turn session id: present;
- first turn total tokens: `19`;
- first turn tool calls: `0`;
- second Web UI turn continued the first session id;
- second Web UI turn: exactly `PI_RING3_MEMORY_CONTINUITY_OK`;
- second turn same session: true;
- second turn total tokens: `20`;
- second turn tool calls: `0`;
- Gateway session list contained the continued session;
- Gateway active session keys for the session: `2`;
- no private transcript or provider log was recorded in docs.

Post-scenario monitor passed:

- runs: `8` total, `8` succeeded, `0` failed, `0` interrupted, `0` stale running;
- diagnostic event types: `run.completed`, `run.sdk_started`;
- auth/model alerts: `0`;
- alerts: none;
- warnings: none.

Ring 3.2 is closed. The next Ring 3 surface should move to plugin tool context, external MCP onboarding, or scheduled Buildroom, still one surface at a time.

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
