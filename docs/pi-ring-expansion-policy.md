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
| 3. Expanded product surfaces | Agents with plugins, learning review, memory-heavy workflows, external MCP, or scheduled Buildroom | Ring 2 exits cleanly; explicit owner approves each surface | Completed across Ring 3.1-3.5. Targeted scenario evidence and monitoring are green. |
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

## Ring 3.3 Plugin Context Scope

The third Ring 3 expanded surface is plugin tool/context compatibility. It uses the scripted `pi.plugins-context-tools` canary in an isolated temporary workspace rather than production agents with real external MCP credentials.

Allowed:

- temporary Gateway workspace;
- synthetic plugin enablement;
- plugin MCP tool registration and policy-gate checks;
- plugin hooks/context engine assembly/compression checks;
- Pi plugin subagent runner with tools disabled;
- bundled plugin checks for `file-transfer`, `lcm`, and `operator-console`;
- file-transfer safe-root and outside-root denial checks;
- post-scenario monitor.

Excluded:

- real production plugin actions against live channels;
- real external MCP credentials or network-backed MCP tools;
- Buildroom execution;
- cron/proactive notification delivery;
- production `send_message` fanout;
- private transcript/provider-log capture in docs.

## Ring 3.3 Plugin Context Evidence

Ring 3.3 plugin context canary was executed on 2026-05-17:

- command: `pnpm smoke:pi-plugins-context -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000`;
- status: passed;
- scenario: `pi.plugins-context-tools`;
- duration: `1832` ms;
- temporary Gateway plugin loaded: `1`;
- plugin tools exposed to enabled agent: `2`;
- disabled agent plugin tools: `0`;
- tool names: `pi-canary-plugin_inspect`, `pi-canary-plugin_policy_gate`;
- read-only tool check: passed;
- policy tool check: passed;
- hooks observed: `1`;
- context engine: `pi-canary-plugin`;
- assemble messages: `2`;
- compress messages: `1`;
- session attribution: true;
- Pi plugin subagent: runtime `pi-canary-headless`, purpose `runSubagent`, tools disabled, model `anthropic/claude-sonnet-4-6`;
- bundled plugins loaded: `file-transfer`, `lcm`, `operator-console`;
- LCM checks: `6` tools, mirror hook true, grep hits `1`, status messages `2`, assemble messages `2`, compression triggered;
- operator-console checks: `5` tools, peer summary authorized, delegate dispatched, delegate denied, escalation true;
- file-transfer checks: `4` tools, directory list entries `1`, file fetch true, file write true, outside denied true.

Post-scenario monitor passed:

- runs: `8` total, `8` succeeded, `0` failed, `0` interrupted, `0` stale running;
- diagnostic event types: `run.completed`, `run.sdk_started`;
- auth/model alerts: `0`;
- alerts: none;
- warnings: none.

Ring 3.3 is closed. Remaining Ring 3 surfaces are external MCP onboarding and scheduled Buildroom; keep them separate.

## Ring 3.4 External MCP Scope

The fourth Ring 3 expanded surface is external MCP proxy/onboarding compatibility. It uses a synthetic canary MCP server and in-memory credential store, not production external MCP credentials.

Allowed:

- agent.yml schema validation for `external_mcp_servers`;
- credential reference resolution into request headers;
- credential-store audit reason check;
- custom tool generation for allowed MCP tools;
- disallowed upstream tool suppression;
- Pi custom tool definition/execution;
- Pi policy denial path;
- credential redaction check;
- post-scenario monitor.

Excluded:

- real production MCP credentials;
- real network-backed MCP calls;
- production agent external MCP configs;
- live channel delivery;
- plugin actions beyond the MCP proxy bridge;
- Buildroom and scheduled automation.

## Ring 3.4 External MCP Evidence

Ring 3.4 external MCP canary was executed on 2026-05-17:

- command: `pnpm smoke:pi-external-mcp -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000`;
- status: passed;
- scenario: `pi.external-mcp-proxy`;
- duration: `3` ms;
- credential headers resolved: true;
- credential store reads: `1`;
- exposed tools: `mcp__canary_mcp__lookup`;
- disallowed tool hidden: true;
- Pi custom tool defined: true;
- Pi custom tool executed: true;
- Pi policy denied path: true;
- upstream calls: `1`;
- redaction: true;
- agent schema validated: true.

Post-scenario monitor passed:

- runs: `6` total, `6` succeeded, `0` failed, `0` interrupted, `0` stale running;
- diagnostic event types: `run.completed`, `run.sdk_started`;
- auth/model alerts: `0`;
- alerts: none;
- warnings: none.

Ring 3.4 is closed. The remaining Ring 3 surface is scheduled Buildroom; keep it separate from high-risk live cron/proactive delivery.

## Ring 3.5 Scheduled Buildroom Scope

The fifth Ring 3 expanded surface is scheduled Buildroom compatibility. It uses the scripted Buildroom/heartbeat/cron canary in an isolated temporary workspace, not live production cron delivery.

Allowed:

- dynamic cron store/tool lifecycle;
- heartbeat scheduler and runner;
- Buildroom init/status/pause/resume/kill-switch;
- Buildroom handoff and session-summary tools;
- trust notification formatting through a synthetic route;
- artifact persistence/content hashes;
- path policy and lock/idempotency checks;
- post-scenario monitor.

Excluded:

- live production cron delivery;
- live proactive notifications;
- production channel delivery;
- broad `send_message` fanout;
- real external MCP calls;
- production Buildroom rooms or worktrees.

## Ring 3.5 Scheduled Buildroom Evidence

Ring 3.5 scheduled Buildroom canary was executed on 2026-05-17:

- command: `pnpm smoke:pi-scheduled-buildroom -- --json --timeout-ms 120000`;
- status: passed;
- scenario: `pi.scheduled-buildroom`;
- duration: `86` ms;
- manage-cron checks: created, listed, toggled, deliver-to bound, updates `2`;
- heartbeat checks: completed, delivered, state recorded, scheduler triggered, request count `2`;
- Buildroom checks: initialized, status OK, paused, resumed, kill-switch on/off, notification routes `1`;
- Buildroom tools: session-summary artifacts `1`, handoff artifacts `1`, source session bound true;
- notifications: delivered `1`, routes `1`, trust artifacts `1`, safety notice present;
- artifacts: total `7`, content hashes verified;
- artifact types: `coder_receipt`, `handoff_signal`, `handoff_signal`, `qa_report`, `session_summary`, `trust_report`, `verification_delta`;
- path policy: allowed path accepted, blocked path rejected, escape rejected;
- locks: acquired, duplicate rejected, released.

Post-scenario monitor passed:

- runs: `6` total, `6` succeeded, `0` failed, `0` interrupted, `0` stale running;
- diagnostic event types: `run.completed`, `run.sdk_started`;
- auth/model alerts: `0`;
- alerts: none;
- warnings: none.

Ring 3.5 is closed. Ring 3 expanded product-surface rollout is complete. The next ring is Ring 4 high-risk automation and must require explicit owner presence before live cron/proactive notification or broad fanout.

## Ring 4.1 Live Cron Delivery Scope

The first Ring 4 high-risk automation surface is a single live cron-delivery path to the operator-owned Telegram peer. It exercises Gateway cron delivery with Pi and real channel send, but avoids persistent scheduling and fanout.

Allowed:

- agent: `example`;
- channel: Telegram DM;
- target: allowlisted operator peer `48705953`;
- execution path: Gateway cron delivery handler with a one-shot job object;
- prompt: exact-answer no-tools prompt;
- real `TelegramChannel.sendText`;
- post-run monitor;
- dynamic cron store check.

Excluded:

- persisted dynamic cron creation;
- recurring cron;
- broad `send_message` fanout;
- non-operator peers;
- production group channels;
- Buildroom production rooms/worktrees;
- external MCP calls;
- private transcript/provider-log capture in docs.

## Ring 4.1 Live Cron Delivery Evidence

Ring 4.1 live cron delivery was executed on 2026-05-17:

- agent: `example`;
- channel: Telegram DM;
- target: allowlisted operator peer `48705953`;
- delivery path: Gateway cron handler with real `TelegramChannel.sendText`, without Telegram long-polling;
- persisted cron: false;
- prompt: `Reply exactly PI_RING4_CRON_OK. Do not use tools.`;
- result: exactly `PI_RING4_CRON_OK`;
- sent messages: `1`;
- message id: present;
- dynamic cron store: absent/empty for Ring 4 canary jobs.

Post-run monitor passed:

- runs: `1` total, `1` succeeded, `0` failed, `0` interrupted, `0` stale running;
- diagnostic event types: `run.completed`, `run.sdk_started`;
- auth/model alerts: `0`;
- alerts: none;
- warnings: none;
- tool events: none.

Ring 4.1 is closed. Remaining Ring 4 surfaces are live recurring cron, live proactive notifications, broad `send_message` fanout, and business-critical workflows; do not combine them in one checkpoint.

## Ring 4.2 Live Proactive Notification Scope

The second Ring 4 high-risk automation surface is a single live proactive notification to the operator-owned Telegram peer. It exercises the AnthroClaw notification emitter, formatter, route resolution, and real channel send path without creating a Pi agent run or enabling recurring delivery.

Allowed:

- agent: `example`;
- event: `escalation_needed`;
- route: temporary in-process notification subscription;
- channel: Telegram DM;
- target: allowlisted operator peer `48705953`;
- real `TelegramChannel.sendText`;
- marker check in formatted notification text;
- post-run monitor;
- dynamic cron store check.

Excluded:

- persisted notification config changes;
- notification scheduler registration;
- live recurring notifications;
- broad notification fanout;
- non-operator peers;
- production group channels;
- agent query/model turn;
- cron delivery;
- `send_message` fanout.

## Ring 4.2 Live Proactive Notification Evidence

Ring 4.2 live proactive notification was executed on 2026-05-17:

- agent: `example`;
- event: `escalation_needed`;
- channel: Telegram DM;
- target: allowlisted operator peer `48705953`;
- delivery path: `NotificationsEmitter.emit` -> Telegram formatter -> real `TelegramChannel.sendText`, without Telegram long-polling;
- subscription: temporary in-process route, not persisted to agent config;
- marker: `PI_RING4_PROACTIVE_NOTIFICATION_OK`;
- marker present: true;
- sent messages: `1`;
- message id: present;
- parse mode: `markdown`;
- dynamic cron store: absent/empty for Ring 4 canary jobs.

Post-run monitor passed:

- runs: `1` total, `1` succeeded, `0` failed, `0` interrupted, `0` stale running;
- diagnostic event types: `run.completed`, `run.sdk_started`;
- auth/model alerts: `0`;
- alerts: none;
- warnings: none;

Ring 4.2 is closed. Remaining Ring 4 surfaces are live recurring cron, broad `send_message` fanout, and business-critical workflows; do not combine them in one checkpoint.

## Ring 4.3 Live Recurring Cron Scope

The third Ring 4 high-risk automation surface is a short-lived live recurring cron delivery to the operator-owned Telegram peer. It exercises persisted dynamic cron registration, scheduler reload, multiple scheduler ticks, Pi query execution, real channel delivery, and explicit teardown.

Allowed:

- agent: `example`;
- dynamic cron id prefixed with `ring4-recurring-cron-`;
- schedule: `*/15 * * * * *`;
- `runOnce=false`;
- short `expiresAt`;
- channel: Telegram DM;
- target: allowlisted operator peer `48705953`;
- exactly two live delivery ticks;
- real `TelegramChannel.sendText`;
- dynamic cron disable/delete cleanup;
- scheduler reload after cleanup;
- post-run monitor;
- dynamic cron store check.

Excluded:

- long-lived recurring jobs;
- production static agent cron config changes;
- broad cron fanout;
- non-operator peers;
- production group channels;
- proactive notifications;
- `send_message` fanout;
- business-critical workflow execution;
- private transcript/provider-log capture in docs or PRs.

## Ring 4.3 Live Recurring Cron Evidence

Ring 4.3 live recurring cron was executed on 2026-05-17:

- agent: `example`;
- channel: Telegram DM;
- target: allowlisted operator peer `48705953`;
- delivery path: `DynamicCronStore.create` -> `Gateway.reloadDynamicCron` -> `CronScheduler` tick -> Pi query -> real `TelegramChannel.sendText`, without Telegram long-polling;
- schedule: `*/15 * * * * *`;
- `runOnce`: false;
- short `expiresAt`: configured;
- scheduler registration: dynamic job present during the window and absent after cleanup;
- prompt: `Reply exactly PI_RING4_RECURRING_CRON_OK. Do not use tools.`;
- results: two ticks, both exactly `PI_RING4_RECURRING_CRON_OK`;
- sent messages: `2`;
- message ids: present for both deliveries;
- cleanup: job disabled/deleted, scheduler reloaded, dynamic cron store empty with no Ring 4 jobs remaining.

Post-run monitor passed:

- runs: `3` total, `3` succeeded, `0` failed, `0` interrupted, `0` stale running;
- diagnostic event types: `run.completed`, `run.sdk_started`;
- auth/model alerts: `0`;
- alerts: none;
- warnings: none.

Ring 4.3 is closed. Remaining Ring 4 surfaces are broad `send_message` fanout and business-critical workflows; do not combine them in one checkpoint.

## Ring 4.4 Controlled Send Message Fanout Scope

The fourth Ring 4 high-risk automation surface is a controlled `send_message` tool delivery. It exercises Pi tool-call planning, AnthroClaw per-dispatch tool binding, peer/account argument handling, pause-store path availability, real Telegram channel delivery, and monitor-visible tool diagnostics.

Allowed:

- agent: `example`;
- source surface: Web UI;
- tool: `send_message` exactly once;
- channel: Telegram DM;
- account: `default`;
- target: allowlisted operator peer `48705953`;
- marker check in delivered tool text;
- final Web UI exact-answer check;
- post-run monitor;
- dynamic cron store check.

Excluded:

- non-operator peers;
- production group channels;
- WhatsApp;
- media sends;
- repeated sends;
- unmanaged fanout lists;
- cron/proactive notification delivery;
- business-critical workflow execution;
- private transcript/provider-log capture in docs or PRs.

## Ring 4.4 Controlled Send Message Fanout Evidence

Ring 4.4 controlled `send_message` fanout was executed on 2026-05-17:

- agent: `example`;
- source: Web UI;
- delivery path: Web UI Pi query -> `send_message` tool -> real `TelegramChannel.sendText`, without Telegram long-polling;
- channel: Telegram DM;
- account: `default`;
- target: allowlisted operator peer `48705953`;
- tool call count: `1`;
- tool name: `send_message`;
- marker: `PI_RING4_SEND_MESSAGE_TOOL_OK`;
- marker present in Telegram delivery: true;
- sent messages: `1`;
- message id: present;
- final Web UI response: exactly `PI_RING4_SEND_MESSAGE_DONE`;
- dynamic cron store: empty with no Ring 4 jobs remaining.

Post-run monitor passed:

- runs: `4` total, `4` succeeded, `0` failed, `0` interrupted, `0` stale running;
- diagnostic event types: `run.completed`, `run.sdk_started`;
- tool events: `send_message` started/completed once, failed tools none;
- auth/model alerts: `0`;
- alerts: none;
- warnings: none.

Ring 4.4 is closed. Remaining Ring 4 surface is one business-critical workflow; do not combine it with new fanout or scheduler expansion.

## Ring 4.5 Business-Critical Leads Escalation Scope

The final Ring 4 high-risk surface is one business-critical customer-facing workflow for the live-only `leads_agent`: a customer asks for an Excel export of all leads. This path exercises public-profile tool policy, customer-facing refusal behavior, the `escalate` MCP tool, and the operator escalation JSONL queue without sending a WhatsApp message to a real customer.

Allowed:

- agent: `leads_agent`;
- source surface: Web UI simulated customer turn;
- customer request: all-leads Excel export;
- tool: `escalate` exactly once;
- escalation marker check;
- final response marker check;
- forbidden internal-term check;
- escalation log rollback after verification;
- post-run monitor;
- dynamic cron store check.

Excluded:

- real WhatsApp customer delivery;
- real customer peer;
- export generation;
- lead data access;
- external MCP calls;
- `send_message` or `send_media`;
- production cron/proactive notification delivery;
- lingering escalation queue entry;
- private transcript/provider-log capture in docs or PRs.

## Ring 4.5 Business-Critical Leads Escalation Evidence

Ring 4.5 initially exposed a real permission-policy defect:

- `leads_agent` uses `safety_profile=public` and declares `escalate`;
- `escalate` declares `META.safe_in_public=true`;
- `escalate` was missing from `MCP_META`;
- the prefixed runtime tool `mcp__leads_agent-tools__escalate` was therefore treated as a plugin tool without metadata and denied under the public profile.

The defect was fixed by registering `escalate` in `MCP_META` and adding regression coverage for public-profile prefixed escalation.

Post-fix Ring 4.5 was executed on 2026-05-17:

- agent: `leads_agent`;
- source: Web UI simulated customer turn;
- workflow: customer asks for all leads Excel export;
- delivery path: Web UI Pi query -> `escalate` tool -> `data/escalations/leads_agent.jsonl`;
- tool call count: `1`;
- tool name: `escalate`;
- escalation rows added during verification: `1`;
- escalation agent id: `leads_agent`;
- escalation marker present: true;
- final response marker present: true;
- forbidden internal terms present: false;
- rollback: escalation log restored to its previous state after verification;
- dynamic cron store: empty with no Ring 4 jobs remaining.

Post-fix short monitor passed:

- runs: `1` total, `1` succeeded, `0` failed, `0` interrupted, `0` stale running;
- diagnostic event types: `run.completed`, `run.sdk_started`;
- tool events: `escalate` started/completed once, failed tools none;
- auth/model alerts: `0`;
- alerts: none;
- warnings: none.

Ring 4.5 is closed. Ring 4 high-risk rollout is complete; future expansion should start a new policy section rather than appending more surfaces to this rollout.

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
