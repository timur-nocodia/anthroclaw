# Operator Control Plane — Design Spec

**Status:** Draft for review
**Branch:** `feat/operator-control-plane`
**Date:** 2026-05-01

## Goal

Add a generic, opt-in mechanism for operators to detect human takeover and remotely manage agent behavior across channels — packaged as three independent, off-by-default subsystems composed via configuration. No agent-specific or single-tenant assumptions in the code; everything works through declarative YAML.

## Motivation

Concrete problem (one of many that this pattern solves): operator writes to a WhatsApp client from their phone; the agent does not see that outbound message; client receives duplicate replies (one from operator, one from agent). Today `src/channels/whatsapp.ts:421` silently drops `msg.key.fromMe` messages, so the gateway has zero visibility into operator activity.

Generalized: the gateway has no concept of "human is in the conversation" and no native control plane for an operator to pause, resume, delegate, or summarize on behalf of an agent from a different channel.

## Non-goals

- Per-user pause inside group chats (group-level pause is fine for v1)
- Replaying messages buffered during a pause when it ends (skipped messages stay skipped; operator handles missed context manually if needed)
- Detecting operator takeover on Telegram via business-connected accounts (deferred — current target is WhatsApp `fromMe`)
- Cross-tenant authorization model (single-config trust boundary is sufficient for OSS use)
- Replacing existing webhooks/script hooks — notifications are an additional emitter, not a replacement

## High-level architecture

Three orthogonal subsystems. Each is independently useful, has its own enable flag, and ships disabled by default.

```
                              ┌─────────────────────────────────┐
                              │  Gateway core                    │
                              │  ┌───────────────────────────┐  │
   WhatsApp / Telegram   ──▶ │  │  Channel adapters         │  │
   (clients)                  │  │   ├ fromMe → operator-out │  │
                              │  └───────────┬───────────────┘  │
                              │              │ event             │
                              │  ┌───────────▼───────────────┐  │
                              │  │  PeerPauseStore           │◀─┐
                              │  │  data/peer-pauses.json    │  │
                              │  └───────────┬───────────────┘  │
                              │              │ check             │
                              │  ┌───────────▼───────────────┐  │
                              │  │  Gateway.dispatch         │  │
                              │  │   (skip if paused)        │  │
                              │  └───────────┬───────────────┘  │
                              │              │                   │
                              │  ┌───────────▼───────────────┐  │
                              │  │  NotificationsEmitter     │  │
                              │  │   ├ peer_pause_started    │  │
                              │  │   ├ peer_pause_summary_*  │  │
                              │  │   ├ agent_error           │  │
                              │  │   └ escalation_needed     │  │
                              │  └───────────┬───────────────┘  │
                              │              │ send_message      │
                              └──────────────┼───────────────────┘
                                             │
                              ┌──────────────▼─────────────────┐
                              │  Operator route                 │
                              │  (e.g. Telegram peer)           │
                              └──────────────▲─────────────────┘
                                             │
                                             │ MCP tool calls
                                             │
                              ┌──────────────┴─────────────────┐
                              │  operator-console plugin       │
                              │   ├ peer_pause                  │
                              │   ├ delegate_to_peer            │
                              │   ├ list_active_peers           │
                              │   ├ peer_summary                │
                              │   └ escalate                    │
                              └────────────────────────────────┘
```

## Subsystem 1 — `human_takeover` (core)

### Schema (`src/config/schema.ts`)

```ts
human_takeover: z.object({
  enabled: z.boolean().default(false),
  pause_ttl_minutes: z.number().int().positive().default(30),
  channels: z.array(z.enum(['whatsapp', 'telegram'])).default(['whatsapp']),
  ignore: z.array(z.enum(['reactions', 'receipts', 'typing', 'protocol']))
    .default(['reactions', 'receipts', 'typing', 'protocol']),
  notification_throttle_minutes: z.number().int().nonnegative().default(5),
}).optional()
```

### Detection

Modify `src/channels/whatsapp.ts:421`. Replace silent `continue` with classifier:

```ts
if (msg.key.fromMe) {
  if (isReaction(msg) || isReceipt(msg) || isTyping(msg) || isProtocol(msg)) {
    continue;  // mechanical events not considered takeover
  }
  this.emit('operator_outbound', {
    accountId, peerKey, messageId: msg.key.id,
    timestamp: msg.messageTimestamp,
    hasMedia: hasMedia(msg),
    textPreview: extractText(msg).slice(0, 80),
  });
  continue;
}
```

Telegram detection stays unimplemented in v1 (out of scope per non-goals). Channel array exists in schema for forward compatibility.

### Storage (`src/routing/peer-pause.ts`)

```ts
interface PauseEntry {
  pausedAt: string;        // ISO
  expiresAt: string | null; // null = indefinite
  reason: 'operator_takeover' | 'manual' | 'manual_indefinite';
  source: string;          // 'whatsapp:fromMe' | 'mcp:operator-console' | etc.
  extendedCount: number;
  lastOperatorMessageAt: string | null;
}

interface PeerPauseStore {
  pause(agentId, peerKey, opts: { ttlMinutes?: number, reason, source }): PauseEntry;
  extend(agentId, peerKey): PauseEntry | null;
  unpause(agentId, peerKey, reason: string): PauseEntry | null;
  isPaused(agentId, peerKey): { paused: boolean; entry?: PauseEntry; expired?: boolean };
  list(agentId?): PauseEntry[];
  // persistence
  load(): void;   // on startup
  save(): void;   // debounced 250ms
}
```

Persisted to `data/peer-pauses.json`. Same persistence pattern as `dynamic-cron.json`. Keyed by agent + peerKey (`${channel}:${accountId}:${peerId}` matching session-key format).

### Dispatch integration (`src/gateway.ts`)

Two checkpoints:

1. **Pre-dispatch** (after access control + rate limiter, before `queryAgent`):

```ts
const paused = peerPauseStore.isPaused(agent.id, peerKey);
if (paused.paused) {
  if (paused.expired) {
    peerPauseStore.unpause(agent.id, peerKey, 'ttl_expired');
    notificationsEmitter.emit('peer_pause_ended', { ... });
    // continue normally
  } else {
    metrics.recordPauseSkip(agent.id, peerKey);
    logger.info({ agentId, peerKey }, 'paused — skipping dispatch');
    return;
  }
}
```

2. **Pre-send** (inside `send_message` tool execution path): re-check `isPaused`. If paused mid-generation, suppress send + notify operator (`peer_pause_intervened_during_generation`).

### Operator-outbound handler

Gateway listens to `operator_outbound` events from channel adapters. Each event:
- Calls `peerPauseStore.pause(...)` or `extend(...)`
- Emits `peer_pause_started` notification (throttled per peer per `notification_throttle_minutes`)

## Subsystem 2 — `notifications` (core)

### Schema

```ts
notifications: z.object({
  enabled: z.boolean().default(false),
  routes: z.record(z.string(), z.object({
    channel: z.enum(['telegram', 'whatsapp']),
    account_id: z.string(),
    peer_id: z.string(),
  })),
  subscriptions: z.array(z.object({
    event: z.enum([
      'peer_pause_started',
      'peer_pause_ended',
      'peer_pause_intervened_during_generation',
      'peer_pause_summary_daily',
      'agent_error',
      'iteration_budget_exhausted',
      'escalation_needed',
    ]),
    route: z.string(),
    schedule: z.string().optional(),  // cron expression for periodic events
    throttle: z.string().optional(),  // e.g. '5m' for rate limiting
    filter: z.record(z.string(), z.any()).optional(),
  })).default([]),
}).optional()
```

### Emitter (`src/notifications/emitter.ts`)

```ts
class NotificationsEmitter {
  emit(event: NotificationEvent, payload: Record<string, unknown>): void;
  // dispatches to subscribed routes via existing send_message infrastructure
  // applies throttle, formats message per event type
}
```

Event-to-message formatting lives in `src/notifications/formatters.ts` — one formatter per event. Telegram-formatted by default (bold/italic/code), plain text fallback for WhatsApp.

Periodic events (e.g. `peer_pause_summary_daily`) registered with the gateway's `CronScheduler` at startup; subscription `schedule` field is the cron expression.

Throttle uses an in-memory LRU keyed by `(event, route, dedupe_key_from_payload)`. Reset across restarts (acceptable — at worst one duplicate after restart).

## Subsystem 3 — `operator-console` plugin

A new built-in plugin under `plugins/operator-console/`, modeled after `plugins/lcm/` (manifest, src/index.ts, tools/, tests/).

### Manifest (`plugins/operator-console/.claude-plugin/plugin.json`)

```json
{
  "name": "operator-console",
  "version": "0.1.0",
  "description": "Cross-agent admin tools — pause/unpause/delegate/summarize peers from another channel.",
  "entry": "dist/index.js",
  "configSchema": "dist/config.js",
  "requires": { "anthroclaw": ">=0.5.0" }
}
```

### Plugin config schema

```ts
operator_console: z.object({
  enabled: z.boolean().default(false),
  manages: z.union([z.array(z.string()), z.literal('*')]).default([]),
  capabilities: z.array(z.enum([
    'peer_pause', 'delegate', 'list_peers', 'peer_summary', 'escalate',
  ])).default(['peer_pause', 'delegate', 'list_peers', 'peer_summary', 'escalate']),
}).optional()
```

### Tools

Namespaced as `operator_console.<tool>`:

```
peer_pause(target_agent_id, peer: { channel, account_id?, peer_id }, action: 'pause'|'unpause'|'list'|'status', ttl_minutes?)
delegate_to_peer(target_agent_id, peer, instruction)
list_active_peers(target_agent_id, since?, limit?)
peer_summary(target_agent_id, peer, since?)
escalate(message, priority?: 'low'|'medium'|'high')
```

`escalate` is the one tool that does NOT take a target — it emits a `notifications.escalation_needed` event from the calling agent's own context (operator notifies themselves).

### `delegate_to_peer` mechanics

The right native primitive is **synthesized inbound**, same path as `CronScheduler` synthetic messages:

1. Operator agent (e.g. Klavdia) calls `delegate_to_peer({ target: 'amina', peer: {...}, instruction: '...' })`.
2. Tool builds a synthetic `InboundMessage` for the target's session, with body wrapped as: `[Operator delegation] Find out from this peer: <instruction>`.
3. Gateway dispatches it through the target agent's normal flow (target's persona, target's memory, target's tools).
4. Target agent composes a real outbound message via `send_message` to the original peer.
5. Tool returns `{ ok, dispatched_message_id, target_session_id }` to caller; operator agent confirms back to operator.

This preserves session continuity. Operator-mode prompt is never leaked into client conversation. Cron path (`src/cron/scheduler.ts`) already does exactly this — we extract the synthetic-dispatch helper.

### Permission model (Variant 1 — manager-side declaration)

- Manager agent declares `manages: [...]` in its plugin config.
- On plugin registration, tool factory binds the `manages` whitelist; every `target_agent_id` argument is validated against it.
- No declaration on the target side. Config IS the trust boundary; OSS single-tenant model.
- `manages: '*'` opts into super-admin (manage any agent). Used carefully.

### Optional Variant 2 (defer to future)

Per-target consent via `admin_access.allowed_managers` + `admin_access.require_explicit_consent`. Schema reserved but not enforced in v1. Can be added without breaking changes.

## Persona switching (deferred)

Originally proposed but deferred to a follow-up PR. The current `channel_context.prompt` (additive) is sufficient for v1 — operator-mode prompt sits alongside the default CLAUDE.md. Cleaner persona replacement (`personas: { default, operator }` block + `channel_context.peers.X.persona: operator`) lands in a separate PR.

Reason for deferral: persona infra touches `src/sdk/options.ts` system prompt resolution, file-include resolver, schema validation. Pulling it into this PR would balloon scope. Without it, all three subsystems still ship and work.

## UI design

### New tab: "Handoff" in agent settings

Adds tab in `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx` between **Routines** and **Skills**. Icon: `HandMetal` or `UserCheck` from lucide-react.

```
┌─ Config | Files | Runs | Memory | Learning | Routines | Handoff | Skills | Plugins | ...
└────────────────────────────────────────────────────────────────────────────────────
```

Tab content sections:

1. **Auto-pause on human takeover** — collapsible card
   - Toggle: `enabled`
   - Number input: `pause_ttl_minutes` (with help tooltip explaining sliding window)
   - Multi-select: `channels` (WA / TG)
   - Multi-select: `ignore` (reactions, receipts, typing, protocol)
   - Number input: `notification_throttle_minutes`
   - Help text: "When you reply to a client from your phone, the agent will pause for this long. Each new reply extends the timer."

2. **Notifications** — collapsible card
   - Toggle: `enabled`
   - Subsection: **Routes** — array UI (add/remove rows). Each row: name + channel dropdown + account_id input + peer_id input. Validation: account_id must exist in config.yml.
   - Subsection: **Subscriptions** — array UI. Each row: event dropdown + route dropdown + optional schedule + optional throttle.
   - "Test" button per route → sends a test notification.

3. **Active pauses** — live table
   - Columns: Peer | Channel | Started | Expires (or "permanent") | Source | Actions
   - Actions: "Unpause now" (red button)
   - Refreshes every 10s
   - Empty state: "No paused conversations."

4. **Activity log** (last 7 days)
   - Filterable timeline of pause-related events: started / ended / suppressed / unpaused
   - Useful for audit + debugging

### Plugins tab — operator-console panel

The existing `PluginsPanel` (`ui/components/plugins/PluginsPanel.tsx`) renders config via `JsonSchemaForm`. The plugin config schema (`operator_console`) drives form generation automatically:

- Toggle: `enabled`
- Multi-input: `manages` (with autocomplete from existing agents; "*" for super-admin)
- Checkboxes: `capabilities`

No new component needed — existing panel handles it via schema.

### Server-level cross-agent dashboard (bonus, optional)

`ui/app/(dashboard)/fleet/[serverId]/handoff/page.tsx` — shows all paused conversations across all agents on the server, with unpause buttons. Useful for users running 5+ agents with multiple operator-managed bots. Not blocker; ship if cheap.

### API endpoints

```
GET    /api/agents/[agentId]/pauses                    → list active pauses for agent
DELETE /api/agents/[agentId]/pauses/[peerKey]          → unpause specific peer
POST   /api/agents/[agentId]/pauses                    → manually pause peer (body: { peer, ttl_minutes? })
GET    /api/agents/[agentId]/pause-events              → activity log (last N events)
GET    /api/notifications/test                         → test notification dispatch
GET    /api/fleet/[serverId]/pauses                    → cross-agent (bonus surface)
```

All under `withAuth()` per existing pattern in `lib/route-handler.ts`.

## File layout

```
src/
  routing/
    peer-pause.ts              # store + persistence
    peer-pause.test.ts         (or src/routing/__tests__/peer-pause.test.ts per project convention)
  channels/
    whatsapp.ts                # modified fromMe handler — emits operator_outbound
  notifications/               # NEW directory
    emitter.ts                 # event bus + dispatch
    formatters.ts              # event → message text
    types.ts                   # event payload schemas
    __tests__/emitter.test.ts
  gateway.ts                   # wires subscriber + check in dispatch
  config/schema.ts             # adds human_takeover, notifications blocks

plugins/
  operator-console/            # NEW plugin (mirrors plugins/lcm/ layout)
    .claude-plugin/plugin.json
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      index.ts                 # plugin entry, register()
      config.ts                # plugin config schema + defaults
      permissions.ts           # manages whitelist enforcement
      tools/
        peer-pause.ts
        delegate-to-peer.ts
        list-active-peers.ts
        peer-summary.ts
        escalate.ts
      types-shim.d.ts          # re-export plugin types
    tests/
      peer-pause.test.ts
      delegate-to-peer.test.ts
      permissions.test.ts

ui/
  app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx   # adds Handoff tab
  components/handoff/          # NEW
    HandoffTab.tsx             # tab root
    HumanTakeoverCard.tsx
    NotificationsCard.tsx
    ActivePausesTable.tsx
    ActivityLogPanel.tsx
  app/api/agents/[agentId]/pauses/...   # endpoints
  app/api/agents/[agentId]/pause-events/route.ts
  app/api/notifications/test/route.ts
  __tests__/api/pauses.test.ts
  __tests__/api/notifications.test.ts
```

## Wire-up — full example config

```yaml
# agents/klavdia/agent.yml — operator side
id: klavdia
safety_profile: chat_like_openclaw
routes:
  - { channel: telegram, account_id: control, scope: dm }
allowlist:
  telegram: ["48705953"]

plugins:
  operator-console:
    enabled: true
    manages: [amina]
    capabilities: [peer_pause, delegate, list_peers, peer_summary]

mcp_tools:
  - operator_console.peer_pause
  - operator_console.delegate_to_peer
  - operator_console.list_active_peers
  - operator_console.peer_summary
```

```yaml
# agents/amina/agent.yml — managed side
id: amina
safety_profile: chat_like_openclaw
routes:
  - { channel: whatsapp, account_id: business, scope: dm }
allowlist:
  whatsapp: ["*"]

human_takeover:
  enabled: true
  pause_ttl_minutes: 30
  channels: [whatsapp]

notifications:
  enabled: true
  routes:
    operator: { channel: telegram, account_id: control, peer_id: "48705953" }
  subscriptions:
    - { event: peer_pause_started, route: operator }
    - { event: peer_pause_summary_daily, route: operator, schedule: "0 9 * * *" }
    - { event: peer_pause_intervened_during_generation, route: operator }
```

No code knows about specific agent IDs. Pure config composition.

## Testing strategy

### Unit tests

- `peer-pause.ts` — pause/unpause/extend/expiry/persist/load roundtrip
- `whatsapp.ts` — fromMe classifier (reaction/receipt/typing/protocol → ignored; text/media → emitted)
- `notifications/emitter.ts` — subscribe/emit/throttle/cron-scheduled
- `operator-console/tools/*` — each tool with valid/invalid targets, permission checks
- `permissions.ts` — manages whitelist; `*` super-admin; missing target rejection

### Integration tests

- End-to-end: WA fromMe → pause set → next inbound dispatch skipped → TTL expire → next inbound dispatched
- Notifications: pause_started subscription → outbound on the operator route
- delegate_to_peer: synthetic inbound dispatched to target → target's send_message called → tool returns dispatched_message_id
- Mid-generation pause: pause set during query → send_message suppressed → suppression notification emitted

### UI tests

- HandoffTab renders all four sections with current config values
- Toggling enabled persists to backend (mock fetch)
- ActivePausesTable renders entries + unpause button hits DELETE endpoint
- API route auth + validation tests under `ui/__tests__/api/`

### Contract tests (preserve invariants)

- No `@anthropic-ai/sdk` import anywhere new
- No Messages API usage in operator-console tools (must go through SDK `query()`)

## Migration / backward compatibility

- All three blocks are optional in schema; missing block = subsystem disabled. No migration needed for existing configs.
- `peer-pauses.json` created on first pause; missing file = empty store.
- `operator-console` plugin only loads if listed in `plugins:` section. No default load.
- `migrate-safety-profile` script unchanged. Update `MigrationResult` type if needed (no — operator-console doesn't affect safety profile).

## Rollout

Three stages mapped to PR sub-stages (single PR, three commit groups):

1. **Stage 1: `human_takeover` + persistence**
   - Schema, store, channel detection, dispatch checks, basic tests
   - Acceptance: turn on `human_takeover.enabled` in agent.yml → operator outbound triggers pause → next inbound is skipped → TTL expires → resumes
   - **Production unblocker**: lead bots stop double-replying immediately after this stage merges, even before notifications/console land

2. **Stage 2: `notifications`**
   - Emitter, formatters, schema, subscriptions, cron-scheduled events
   - Wire `peer_pause_*` events from Stage 1
   - Acceptance: pause triggers Telegram notification on configured route; daily summary fires at 9:00; mid-generation suppression notifies

3. **Stage 3: `operator-console` plugin + UI**
   - Plugin scaffold, 5 tools, permissions, plugin manifest
   - Handoff tab in agent settings, API endpoints
   - Acceptance: operator agent on TG can call `peer_pause` / `delegate_to_peer` / `list_active_peers` against managed agent; UI renders + edits configs end-to-end

Each stage commits independently within the same branch / PR. Reviewer can read commits in order.

## Open questions

1. **Buffered messages during pause** — current decision: drop. Should we offer an opt-in `replay_on_unpause` flag that re-dispatches the last client message after manual unpause? *(Spec says drop; revisit if user feedback demands it.)*

2. **Pause source granularity** — should `manage_peer_pause(action: pause)` from operator-console set `source: 'mcp:operator-console'` and treat that differently from `source: 'whatsapp:fromMe'`? *(Spec: track source for observability/dedup; behavior identical.)*

3. **`escalate` semantics** — operator-console exposes it, but it really belongs to "notifications" (any agent should be able to escalate). Move to a built-in MCP tool independent of operator-console? *(Spec: keep in operator-console for v1; move out if pattern repeats.)*

4. **Server-level cross-agent pauses dashboard** — bonus or blocker? *(Spec: bonus; ship if Stage 3 has time, otherwise next PR.)*

## Self-review

### Spec coverage
- All three subsystems specified end-to-end (schema, code surfaces, behavior, integration points)
- UI section covers tab placement, sections, API endpoints
- Permission model documented with explicit defer for Variant 2
- Testing strategy covers unit/integration/UI/contract layers

### Placeholder scan
None. Every code surface lists specific file path. No "TBD" or "implement later."

### Internal consistency
- Schema field names match between spec sections and example configs
- `manages` / `capabilities` consistent across plugin manifest, schema, UI section
- Event names match between subscription schema, emitter, and UI dropdown lists

### Ambiguity check
- Telegram detection explicitly out of scope (non-goals)
- Persona switching explicitly deferred (own section)
- Permission model picks Variant 1 explicitly, Variant 2 reserved for future
- Open questions section captures the remaining design discretion items
