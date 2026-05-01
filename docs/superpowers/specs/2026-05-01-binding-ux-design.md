# Channel Binding UX — Design Spec

**Status:** Draft for review
**Branch:** `feat/binding-ux`
**Date:** 2026-05-01

## Goal

Make channel binding configuration in the agent-settings UI intuitive enough that an operator can connect an agent to "this Telegram group, in this topic, responding to @-mentions only" entirely with mouse clicks — without knowing the underlying YAML field names (`peers`, `topics`, `mention_only`) or the syntactic formats (`-100…` chat IDs, numeric topic IDs).

## Motivation

Today the `routes:` block in `agent.yml` is the source of truth for routing decisions, but the Web UI surface that displays it (Routes section in the Config tab) is:

- **Discoverable poorly** — buried below "Channel behavior" which is named more prominently and which surfaces unrelated `channel_context` rules
- **Field-by-field, not concept-first** — operator must understand `peers`, `topics`, `scope`, `mention_only` and how they compose
- **Format-fragile** — peer/topic IDs are typed as raw strings with no validation, no examples, no dropdown of known values
- **Disconnected from behavior** — group response behavior (mention-only / open / allowlisted) is split between `routes.mention_only`, `pairing.mode`, and `allowlist.<channel>`, three different blocks the operator has to assemble correctly

A real recent operator (the project owner) lost ~30 minutes binding a new agent because the operator's natural mental model is "this agent listens in *that group*, in *that topic*, when someone @-mentions it." The current UI requires them to translate that mental model into three YAML knobs across two sections.

## Non-goals

- Auto-discovery of all groups/topics a bot is in (Telegram Bot API has no such call; bots only learn about chats from received messages). We may surface chats *known* to the gateway from inbound message history, but that's bonus, not a blocker.
- Replacing the YAML editor surface (Files tab) — power users still edit `agent.yml` directly. The Config tab is the friendly entry point.
- Migrating `pairing.mode` and `allowlist.<channel>` configuration entirely into the binding wizard — the wizard couples them where natural ("Group, mention-only" implies certain defaults) but the standalone Pairing/Allowlist UI stays.
- Changing the underlying `routes:` schema — same YAML, better UI.
- Bulk operations across multiple agents.

## High-level architecture

The Config tab gains a new top-priority section, **"Where this agent listens"**, replacing the existing "Routes" section both visually (more prominent, plain-language summary) and ergonomically (modal-driven add/edit flow).

```
┌────────────────────────── Config tab ────────────────────────┐
│                                                                │
│  Identity, Model, Persona, Safety profile  (existing)          │
│                                                                │
│  ▶ Where this agent listens   [+ Add binding]                 │  ← NEW
│    ┌───────────────────────────────────────────────────────┐  │
│    │ 📱 Telegram (clowwy_bot · content_sm)                 │  │
│    │ In group: -1003729315809                              │  │
│    │ In topic: 3                                           │  │
│    │ Behavior: Responds only when @-mentioned              │  │
│    │                            [ Edit ]   [ Remove ]      │  │
│    └───────────────────────────────────────────────────────┘  │
│    ┌───────────────────────────────────────────────────────┐  │
│    │ 💬 WhatsApp (humanrobot)                              │  │
│    │ In: All direct messages                               │  │
│    │ Behavior: Open pairing (anyone can DM)                │  │
│    │                            [ Edit ]   [ Remove ]      │  │
│    └───────────────────────────────────────────────────────┘  │
│                                                                │
│  ▶ Per-chat customization (optional)  ← renamed from           │
│      Channel behavior; collapses by default                    │
│                                                                │
│  ▶ MCP tools, Memory, …  (existing)                            │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## Subsystem 1 — `BindingWizardDialog`

A 5-step modal that runs from "Add binding" or "Edit" actions. Each step is a single conceptual decision with inline explanation.

### Step 1 — Channel

Two cards (Telegram / WhatsApp) with icon + short description. Clicking one selects, then either "Next" or auto-advance.

If only one channel is configured in `config.yml` (e.g. WhatsApp account but no Telegram), the wizard auto-selects it and skips Step 1.

### Step 2 — Account

Dropdown of accounts available in `config.yml` for the selected channel:

- Telegram → `default`, `content_sm`, etc. — labels show bot username when known (`clowwy_personal_bot`, `clowwy_bot`)
- WhatsApp → account names (`humanrobot`, etc.)

If only one account exists, auto-select.

### Step 3 — Where

Radio buttons:

- **Direct messages** — agent listens in 1:1 chats with users
- **Group chat** — agent listens in groups (and supergroups, including forum topics)
- **Both** — DMs + groups

### Step 4 — Specific target (depends on Step 3)

#### If DMs

Two radio sub-options:

- **All users** — open pairing; equivalent to `pairing.mode: open` + no allowlist
- **Allowlisted users only** — input field for user IDs (comma-separated). Hint: "Telegram user IDs are numbers like `48705953`. Find with @userinfobot."

If allowlisted, the wizard offers a **"+ Pair via code"** sub-flow that switches to `pairing.mode: code` and shows the agent's current pairing code (read-only, generated by gateway).

#### If Group

Sub-section A — chat ID:

- Input field with hint: "Group chat ID. Telegram: `-100…` (16 chars). For supergroups, get from chat settings → 'Copy ID'."
- **Bonus** if backend has known chats: dropdown of chats the bot has received messages from, with title + ID. Source: `data/known-peers.json` or query gateway's session/inbound history.

Sub-section B — topic (only if forum group):

- Toggle: "This group has topics (forum mode)" — defaults off; the operator can flip on.
- If on: input topic IDs (comma-separated), hint: "Topic ID is in the topic URL or in message metadata. Operator console exposes `message_thread_id` in 'Show config' command."
- **Bonus**: dropdown of topics seen in known inbound history.

### Step 5 — Behavior

Three radio options (visible only if Step 3 includes Group):

- **Respond only to @-mentions** — sets `mention_only: true`
- **Respond to every message in this scope** — sets `mention_only: false`
- **Respond only when someone replies to my message** — sets `reply_to_mode: incoming_reply_only` on the corresponding `channel_context` peer/topic entry (this is the existing `channel_context.reply_to_mode` field; we wire it from the wizard for symmetry)

For DMs, this step is skipped — DMs are always "respond to all" (pairing controls who can DM).

### Step 6 — Preview & save

Plain-language summary of the resulting binding:

> "Telegram (clowwy_bot, account `content_sm`) — in group `-1003729315809`, topic `3`, **respond only when @-mentioned**."

Plus a YAML diff preview (collapsed by default) showing exactly what fields will be added to `agent.yml`. Operator clicks **Save**, the diff is committed via `AgentConfigWriter.patchSection`. Audit log records `source: 'ui'`.

### Edit flow

"Edit" on an existing binding opens the same wizard pre-populated with that binding's values. Save replaces the binding in place (audit log captures prev/new diff).

### Remove flow

"Remove" shows a confirm dialog: "Stop listening in this scope? The agent will not see new messages here unless re-bound."

## Subsystem 2 — Section reorganization

The Config tab today has these sections (rough order):

1. Identity / Model / Effort
2. Persona (CLAUDE.md preview)
3. Safety profile
4. Channel behavior (the channel_context / per-peer rules section)
5. Routes (the binding section)
6. Allowlist
7. Pairing
8. Auto-compress
9. Iteration budget
10. Queue mode
11. MCP tools
12. … etc.

After this PR:

1. Identity / Model / Effort
2. Persona
3. Safety profile
4. **Where this agent listens** (former Routes — promoted, renamed, wizard-driven, gets binding-specific allowlist/pairing inline)
5. Per-chat customization (optional) — former "Channel behavior", renamed, collapsed by default
6. (everything else as before)

The standalone Allowlist/Pairing sections stay for power users who want fine-grained control beyond what the wizard offers, but the wizard handles 90% of cases.

## Subsystem 3 — Test binding

After save, the binding card shows a **"Test"** button that:

1. Opens a small panel
2. Operator types example payload: peer ID + (optional) topic ID + message text + (checkbox) "this message @-mentions the bot"
3. Click "Run match" → calls `POST /api/agents/[agentId]/route-test` with the payload
4. Backend runs `RouteTable.resolve(...)` + computes mention check + access check, returns:
   - `matched: true | false`
   - `agent_id` (which agent the message would route to)
   - `reason` (if not matched: "topic mismatch", "mention required but not present", "blocked by allowlist", etc.)
5. UI displays: "✓ Routed to **operator_agent**" or "✗ Not matched: \<reason\>"

This closes the feedback loop — operator can verify a binding works without going to Telegram and sending a real message.

## Subsystem 4 — Known peers/topics surface (bonus)

Backend infrastructure (out of scope for v1, mentioned for future):

- New file `data/known-peers.json` updated on every inbound message:
  ```json
  {
    "telegram:content_sm:-1003729315809": {
      "title": "AnthroClaw Workspace",
      "type": "supergroup",
      "isForum": true,
      "topicsSeen": {"3": "Operator", "4": "Drafts"},
      "lastSeen": "2026-05-01T12:00:00Z"
    }
  }
  ```
- New endpoint `GET /api/known-peers?channel=telegram&account=content_sm` returns the entries above, used by Step 4 dropdowns.
- Topic titles are extracted from `message.forum_topic_created.name` events when available, otherwise displayed as "Topic 3".

If we ship without this, Step 4 falls back to manual ID input — still works, just less ergonomic.

**Decision: ship Step 4 with manual input + dropdown of known peers IF backend already has them readily available; defer the new known-peers persistence file to a follow-up PR.**

## Schema impact

No changes to `AgentYmlSchema`. The wizard reads/writes existing fields:

- `routes[].channel`
- `routes[].account`
- `routes[].scope` (`dm` | `group` | `any`)
- `routes[].peers` (array of strings or null)
- `routes[].topics` (array of strings or null)
- `routes[].mention_only` (boolean)
- `pairing.mode` (when binding is DM scope and operator chose "All users" / "Allowlisted")
- `allowlist.<channel>` (when DM scope + Allowlisted)
- `channel_context.<channel>.peers/topics.<id>.reply_to_mode` (only when Step 5 chose "reply-only")

All writes go through `AgentConfigWriter` (already shipped in PR #7) so they're atomic, comment-preserving, schema-validated, audited.

## File layout

```
ui/
  components/binding/                        # NEW
    WhereAgentListensSection.tsx             # the section card itself
    BindingCard.tsx                          # one binding row (with Edit/Remove/Test)
    BindingWizardDialog.tsx                  # the 5-step modal
    steps/
      ChannelStep.tsx
      AccountStep.tsx
      WhereStep.tsx
      TargetStep.tsx                         # DMs vs Group sub-flows
      BehaviorStep.tsx
      PreviewStep.tsx
    BindingTestPanel.tsx                     # post-save Test button panel
    binding-language.ts                      # plain-language summary helper

  app/api/agents/[agentId]/route-test/
    route.ts                                 # POST endpoint for binding test

  app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx
                                             # rewire Config tab section order;
                                             # rename "Channel behavior" to
                                             # "Per-chat customization (optional)"
                                             # and collapse by default
```

The existing flat-row Routes editor is not deleted — it's hidden behind an "Advanced (raw routes table)" expandable for power users who want to edit fields directly.

## Backend

### `POST /api/agents/[agentId]/route-test`

Behind `withAuth()`. Body:

```json
{
  "channel": "telegram",
  "account_id": "content_sm",
  "chat_type": "group",
  "peer_id": "-1003729315809",
  "thread_id": "3",
  "sender_id": "48705953",
  "text": "@clowwy_bot покажи show_config",
  "mentioned_bot": true
}
```

Response:

```json
{
  "matched": true,
  "agent_id": "operator_agent",
  "session_key": "operator_agent:telegram:group:-1003729315809:thread:3",
  "would_dispatch": true,
  "blockers": []
}
```

Or:

```json
{
  "matched": false,
  "agent_id": null,
  "blockers": [
    { "stage": "route", "reason": "no route matched topic_id=99 in this peer" }
  ]
}
```

Implementation reuses `Gateway.routeTable.resolve(...)` plus the existing access-control check (mention + pairing + allowlist). No real dispatch — pure read.

## Testing strategy

### Unit tests
- `binding-language.ts` — plain-language summary covers all combinations (DM / group / topic / mention-only / open / allowlisted)
- `BindingWizardDialog` — each step's validation, default values, "Back" preserves state
- `BindingCard` — Edit pre-populates wizard correctly; Remove confirms before delete

### Integration tests
- Wizard save calls `PATCH /api/agents/[id]/config` with `section: 'routes'` (or whatever the routes section is named in `AgentConfigWriter` — extend writer's section enum if needed)
- Audit log records `source: 'ui'` after wizard save
- Test binding endpoint: each blocker reason category produces correct response
- Section reorder doesn't break existing tests on the Config tab

### Acceptance scenarios

1. Operator opens fresh agent, clicks "Add binding" → wizard → picks Telegram → picks `content_sm` account → picks Group → enters chat ID `-1003729315809` → enables forum mode → enters topic `3` → picks "@-mentions only" → previews → saves → Telegram message in topic 3 with `@clowwy_bot` mention triggers the agent.

2. Operator clicks Edit on existing binding → wizard pre-fills → operator changes "mentions only" → "respond to all" → saves → next message in topic 3 (no mention required) triggers the agent.

3. Operator clicks Test → enters fake payload → sees "Routed to operator_agent" or specific blocker reason. Verifies binding without leaving the UI.

## Migration / backward compatibility

- All existing `routes:` configs work unchanged — wizard reads them and renders cards. Operator does not need to "migrate."
- Power users editing YAML directly continue to work; chokidar reload still picks up changes.
- The "Advanced (raw routes table)" expandable preserves the old flat-row UI for anyone who needs to set unusual route shapes (e.g., wildcard `peers: null` for "all peers in account").

## Rollout

Single PR, two commit groups:

1. **Stage 1: Backend route-test endpoint + section reorganization** (~3 tasks)
   New `route-test` API endpoint + tests; rename "Channel behavior" → "Per-chat customization", collapse by default; introduce empty placeholder section "Where this agent listens" above it. Standalone — UI shows the new section heading even before the wizard ships.

2. **Stage 2: BindingWizardDialog + BindingCard + section content** (~7 tasks)
   Build the wizard step-by-step, plain-language summary helper, BindingCard with Edit/Remove/Test, integration with `AgentConfigWriter`, full UI on existing routes config. After Stage 2, operators can mouse-drive bindings end-to-end.

3. **Stage 3: Bonus polish** (~2 tasks)
   Test panel, dropdown of known peers (if cheap to surface from existing inbound history), final review + CHANGELOG.

Total ~12 tasks. Estimated 2 hours of subagent-driven work.

## Open questions

1. **Should the wizard offer a "Quick: paste agent.yml route YAML" import?** *Spec: no. Power users have the Files tab + Advanced expandable. The wizard targets first-time operators.*

2. **Known-peers persistence** — implement the `data/known-peers.json` file in this PR, or defer? *Spec: defer. Stage 4 in this rollout already cuts the persistence work; the dropdown can read from existing session-history if cheap, otherwise the manual input is the v1 reality.*

3. **`channel_context.reply_to_mode = incoming_reply_only` mapping** — the wizard sets this when "reply-only" is chosen. But channel_context lives in a different YAML block than routes. Should we offer the third behavior radio at all, or only "mentions / all"? *Spec: include it for parity with current `content_sm_building` behavior, but mark with a small "(advanced)" note. Both content_sm_building's existing setup and the operator's mental model — "respond only when someone replies to my last post" — are real cases.*

4. **What happens if the operator removes ALL bindings?** *Spec: agent loads but receives no inbound. Show a warning banner on the agent header: "This agent has no bindings — it will not receive any messages."*

5. **Does the wizard support multi-binding agents (e.g., one agent listening in DMs AND in a group AND in a different group)?** *Spec: yes. "Add binding" button always creates a new route entry; existing bindings render as separate cards. The wizard handles one binding at a time.*

## Self-review

### Spec coverage
- Wizard fully specified across 6 steps + edit/remove flows
- Section reorganization documented
- Test binding endpoint specified end-to-end (request, response, blocker categorization)
- Schema impact accurate (no changes; only existing fields are touched)
- Acceptance scenarios cover the three primary use cases (add, edit, test)

### Placeholder scan
None. Each subsystem has concrete file paths, response shapes, and acceptance criteria.

### Internal consistency
- Section names match between architecture diagram, subsystem descriptions, and file layout
- All `routes:` field names referenced match the actual `AgentYml` schema (`peers`, `topics`, `scope`, `mention_only`, `account`)
- AgentConfigWriter integration consistent with PR #7 (writes go through it, audit log captures source)

### Ambiguity check
- Step 5 behavior choices explicitly mapped to YAML (`mention_only`, `channel_context.reply_to_mode`)
- Migration path explicit: existing configs work unchanged, wizard reads them as cards
- Known-peers infrastructure deferred with explicit fallback (manual input)
- Open questions section captures remaining design discretion items
