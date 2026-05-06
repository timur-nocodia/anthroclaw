# Operator-Safe Continuous Learning - Design Spec

**Status:** Draft for review
**Date:** 2026-05-06
**Scope type:** Multi-phase runtime + admin UX design

## Goal

Implement a Hermes-inspired continuous self-learning loop for AnthroClaw without
making end users responsible for global agent behavior and without assuming every
messaging channel supports Telegram-style buttons.

The target v1 posture is **operator-safe continuous loop**:

- user-scoped memory can be approved by the originating user inside the
  messenger where the learning happened
- explicit user-scoped memory can auto-apply only under a narrow private-agent
  policy with undo
- skill, system, and curator proposals require operator/admin approval
- dashboard remains the canonical admin surface
- admin-chat approvals use the same durable decision primitive as dashboard
- channel rendering is capability-based, not Telegram-specific

## Motivation

The current `learning` subsystem can already run background reviews and create
learning actions. The production confusion is that an empty dashboard
`Proposals` list does not prove learning is disabled; it only means no current
`proposed` actions match the UI filter. The larger product gap is that learning
approval has no clear role model:

- ordinary users work in Telegram, WhatsApp, and future channels
- ordinary users usually cannot access the dashboard
- the dashboard is for admins/operators
- WhatsApp through Baileys does not provide a reliable button/callback UX
- future channels such as Discord or Facebook Messenger should not force
  learning code changes

Hermes provides two useful reference ideas:

- continuous memory/context loop via Honcho-style turn sync and dialectic recall
- background self-improvement and curator workflows

AnthroClaw should copy the shape, not the stack. The v1 design should upgrade
existing AnthroClaw seams while preserving local-first operation, operator
visibility, and the Claude Agent SDK query path.

## Non-goals

- No direct Honcho dependency in v1.
- No full autonomous Hermes Curator port in v1.
- No custom LLM orchestration loop outside the Claude Agent SDK path.
- No requirement that WhatsApp support inline buttons.
- No assumption that end users can access the dashboard.
- No auto-apply of skill, system prompt, routing, or curator changes in v1.
- No replacement of the existing synchronous `ApprovalBroker` for SDK tool
  calls in the first phase.

## Current Anchors

Existing code seams:

- `src/learning/queue.ts` - learning trigger detection and queue coalescing
- `src/learning/runner.ts` - artifact export, headless review, action persistence
- `src/learning/store.ts` - `learning.sqlite`
- `src/gateway.ts` - post-response learning enqueue and callback handling
- `src/channels/types.ts` - channel send options, callback events, approval shape
- `src/channels/telegram.ts` - inline callback rendering already exists
- `src/channels/whatsapp.ts` - text send exists, callbacks do not
- `src/security/approval-broker.ts` - in-memory synchronous tool approval
- `ui/app/api/agents/[agentId]/learning/route.ts` - dashboard learning API

Important existing constraints:

- `ApprovalBroker` is intentionally synchronous and in-memory; it is suitable for
  a tool call waiting 60 seconds, not for learning approvals that may arrive
  minutes or days later.
- `SendOptions.buttons` is useful but Telegram-shaped; learning should depend on
  a higher-level decision primitive, not raw button rows.
- Current learning actions already have statuses, but they do not model delivery,
  actor authorization, channel fallback, expiry, or user/admin split.

## Recommended Architecture

Add a durable **Decision Center** layer between learning/curator/tool requests
and channel rendering.

```
Learning Review / Curator / Tool Approval
                 |
                 v
          DecisionCenter
       /        |        \
DecisionStore DecisionPolicy DecisionRouter
       |        |        |
       v        v        v
 learning.sqlite / decision-center.sqlite
                ChannelDecisionRenderer
              /          |          \
         Telegram     WhatsApp     Future channels
        callbacks    text fallback components/buttons
```

Learning code creates a structured `Decision`. Channels render it according to
capabilities. Responses from buttons, commands, or plain text become the same
`DecisionEvent`.

## Core Model

### Decision

```ts
type DecisionKind =
  | 'learning_memory'
  | 'learning_skill'
  | 'curator_action'
  | 'tool_approval';

type DecisionScope = 'user' | 'agent' | 'system';
type DecisionActor = 'originating_user' | 'admin' | 'operator';
type DecisionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'edit_requested'
  | 'expired'
  | 'applied'
  | 'failed';

interface DecisionRecord {
  id: string;
  shortCode: string;
  kind: DecisionKind;
  scope: DecisionScope;
  actor: DecisionActor;
  status: DecisionStatus;

  agentId: string;
  learningActionId?: string;
  reviewId?: string;

  subject: string;
  body: string;
  risk: 'low' | 'medium' | 'high';
  payloadJson: string;

  originChannel?: 'telegram' | 'whatsapp';
  originAccountId?: string;
  originPeerId?: string;
  originSenderId?: string;
  originThreadId?: string;
  originMessageId?: string;

  deliveryJson: string;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
  decidedAt?: number;
  decidedBy?: string;
  appliedAt?: number;
  error?: string;
}
```

### Decision Event

```ts
interface DecisionEvent {
  decisionId?: string;
  shortCode?: string;
  selected: 'approve' | 'reject' | 'edit' | 'undo';
  channel: 'telegram' | 'whatsapp';
  accountId: string;
  peerId: string;
  senderId: string;
  threadId?: string;
  messageId?: string;
  rawText?: string;
  callbackQueryId?: string;
}
```

### Audit Event

Every state transition writes an append-only event:

```ts
interface DecisionAuditEvent {
  id: string;
  decisionId: string;
  fromStatus?: DecisionStatus;
  toStatus: DecisionStatus;
  actorSenderId?: string;
  channel?: string;
  reason?: string;
  createdAt: number;
  metadataJson: string;
}
```

Audit events must be inspectable without replaying raw chat history.

## Storage

Use SQLite for v1.

Recommended file:

- `data/decision-center.sqlite`

Alternative:

- add tables to `data/learning.sqlite`

Recommendation: keep `decision-center.sqlite` separate in v1. Decisions are a
cross-subsystem primitive that will eventually serve learning, curator, tool
approval, and operator workflows. Keeping it separate avoids coupling all future
decision records to learning-specific migrations.

Tables:

- `decisions`
- `decision_events`
- `decision_deliveries`

`decision_deliveries` records prompt attempts:

```ts
interface DecisionDelivery {
  id: string;
  decisionId: string;
  channel: string;
  accountId: string;
  peerId: string;
  threadId?: string;
  messageId?: string;
  renderMode: 'callbacks' | 'text';
  status: 'sent' | 'failed';
  error?: string;
  createdAt: number;
}
```

Idempotency:

- `learningActionId` should have a unique partial index for active learning
  decisions so one learning action does not spam the same user/admin.
- callback/text events must be safe to deliver twice.
- applying an approved action must check whether the underlying learning action
  is already `applied`.

## Channel Capabilities

Add channel-level capability metadata above the current `SendOptions.buttons`.

```ts
interface ChannelCapabilities {
  callbacks: boolean;
  textReplies: boolean;
  editMessage: boolean;
  threads: boolean;
  reactions: boolean;
}
```

Initial mapping:

```ts
telegram: {
  callbacks: true,
  textReplies: true,
  editMessage: true,
  threads: true,
  reactions: true,
}

whatsapp: {
  callbacks: false,
  textReplies: true,
  editMessage: false,
  threads: false,
  reactions: false,
}
```

The channel adapter should not decide policy. It only renders a given prompt.

```ts
interface DecisionPrompt {
  id: string;
  shortCode: string;
  kind: DecisionKind;
  title: string;
  body: string;
  options: Array<{
    key: 'approve' | 'reject' | 'edit' | 'undo';
    label: string;
    style: 'primary' | 'danger' | 'secondary';
  }>;
  expiresAt?: number;
  fallbackCommands: string[];
}
```

## Channel Rendering

### Telegram

Render with inline buttons when `callbacks=true`.

Callback payload:

```text
decision:<shortCode>:approve
decision:<shortCode>:reject
decision:<shortCode>:edit
decision:<shortCode>:undo
```

Payloads use `shortCode`, not full UUIDs, to keep callback payloads small and
human-debuggable.

If the message can be edited, update the prompt after decision:

```text
Saved.
Decision: ABC123
```

### WhatsApp

Render as plain text:

```text
Save this preference?

[ABC123] For reports, start with a short conclusion, then details.

Reply:
1 - save
2 - skip
3 - edit wording

Commands:
/learn approve ABC123
/learn reject ABC123
/learn edit ABC123
```

WhatsApp parser accepts:

- `1`, `yes`, `да`, `save`, `сохранить`
- `2`, `no`, `нет`, `skip`, `reject`
- `3`, `edit`, `изменить`
- `/learn approve ABC123`
- `/learn reject ABC123`
- `/learn edit ABC123`

Bare numeric replies should only resolve the most recent pending decision for
that sender in the same channel/account/peer/thread. If there is more than one
active pending decision, ask for the explicit command with `shortCode`.

### Future Channels

Discord, Facebook Messenger, and similar adapters implement the same renderer
contract:

- if components/buttons exist, render callbacks
- otherwise render text fallback
- incoming interaction becomes `DecisionEvent`

No learning code changes should be needed for a new channel.

## Actor And Scope Policy

Decision authorization is policy-driven.

### User-scoped Memory

The originating user can approve only when all conditions hold:

- `kind='learning_memory'`
- `scope='user'`
- event sender matches `originSenderId`
- event channel/account/peer match the origin route
- payload passes redaction/secret checks
- payload does not change shared agent behavior

### Agent/System Changes

Only admin/operator can approve when:

- `scope='agent'` or `scope='system'`
- `kind='learning_skill'` or `kind='curator_action'`

Admin identity comes from config, not chat claims.

```yaml
learning:
  approvals:
    admin_routes:
      - channel: telegram
        account_id: main
        peer_id: "123456789"
    admin_senders:
      telegram:
        main:
          - "123456789"
    notify_admin_for:
      - learning_skill
      - curator_action
```

Dashboard approval uses the authenticated dashboard session and records
`decidedBy='dashboard:<userId>'`.

Admin-chat approval records `decidedBy='<channel>:<accountId>:<senderId>'`.

### Auto-apply

Auto-apply is allowed only for explicit user-scoped memory.

Required conditions:

- `kind='learning_memory'`
- `scope='user'`
- `agent.config.safety_profile === 'private'`
- `agent.config.learning.mode === 'auto_private'`
- confidence is above configured threshold
- trigger includes explicit memory intent, not only inference
- payload passes secret redaction checks

Auto-apply produces a receipt and undo decision:

```text
Saved:
"For reports, start with a short conclusion, then details."

Undo: /learn undo ABC123
```

Undo is time-limited in v1, for example 24 hours.

## Learning Integration

### Memory Candidate Flow

Current:

```text
learning review -> learning_actions(status=proposed)
```

Target:

```text
learning review
  -> learning_action proposed
  -> DecisionCenter.createFromLearningAction()
  -> DecisionRouter.deliver()
  -> user/admin event
  -> learning action approved/rejected/edit_requested
  -> apply
```

For `memory_candidate`:

- if explicit auto-apply policy passes: apply immediately, create receipt/undo
- if user-scoped but not explicit: ask originating user
- if uncertain or cross-user/group-scoped: ask admin

For group chats:

- default v1: user memory proposals require the individual `senderId`, not the
  whole group
- group-level memory requires admin approval

### Skill Proposal Flow

For `skill_patch`, `skill_create`, `skill_update_full`:

- always create admin decision
- deliver to dashboard and configured admin routes
- apply only after admin approval
- keep existing skill snapshot behavior before applying

The ordinary user may receive a short acknowledgement:

```text
I captured this as a proposed agent improvement and sent it for admin review.
```

Do not expose patch details to ordinary users by default.

## Curator Integration

Curator v1 is policy-safe and admin-gated.

Curator should initially produce proposals, not perform writes:

- mark stale proposal
- archive proposal
- consolidate proposal
- skill patch proposal

Each proposal becomes `kind='curator_action'`, `scope='agent'`, actor `admin`.

Curator must record:

- candidate skill names
- reason
- proposed action
- risk
- reversible path
- snapshot path when applicable

Pinned skills are never proposed for archive/consolidation.

## Tool Approval Relationship

The existing SDK `ApprovalBroker` remains for synchronous tool approvals in v1.

Decision Center is not a drop-in replacement yet because:

- SDK tool calls expect an immediate `PermissionResult`
- current approval timeout is short
- learning/curator approvals are durable async workflows

Future unification path:

- make tool approval create a short-lived decision
- `ApprovalBroker` waits on that decision
- Telegram/WhatsApp rendering becomes identical for tools and learning

This should not block learning v1.

## Gateway Entrypoints

Add callback handling:

```text
decision:<shortCode>:<selected>
```

Add command handling before normal agent dispatch:

```text
/learn approve ABC123
/learn reject ABC123
/learn edit ABC123
/learn undo ABC123
```

Add numeric text fallback handling before normal dispatch only when:

- sender has exactly one active pending text decision in that peer
- message is one of the accepted short replies

If the numeric reply is ambiguous, send:

```text
I have more than one pending decision. Use /learn approve CODE or /learn reject CODE.
```

If a command references an unknown/expired decision, send a short explanation and
do not route the command into the agent.

## Dashboard UX

Dashboard should read the same decision records used by admin chat.

Learning tab changes:

- show pending decisions separately from raw learning actions
- show last review separately from pending proposals
- show delivery state: sent to user, sent to admin, failed, expired
- show actor required: user/admin/operator
- show audit timeline for a decision
- show "open action payload" and "open artifact manifest"

Dashboard actions:

- approve
- reject
- apply
- request edit
- expire
- resend notification

Dashboard remains canonical for admin review. Admin-chat actions are convenience
entrypoints into the same state machine.

## State Machine

```text
created
  -> pending
  -> approved
  -> applied

pending
  -> rejected
  -> edit_requested
  -> expired
  -> failed

approved
  -> failed
```

Rules:

- `approved -> applied` can be automatic for memory if policy allows.
- `approved -> applied` for skills/curator happens only through admin apply or
  an explicit "approve and apply" action.
- `edit_requested` is terminal in v1; it creates a note for admin/manual follow-up
  rather than launching a free-form user edit workflow.
- expired decisions do not delete learning actions; they mark approval stale.

## Observability

Metrics:

- `decisions_created`
- `decisions_delivered`
- `decisions_delivery_failed`
- `decisions_approved`
- `decisions_rejected`
- `decisions_expired`
- `decisions_applied`
- `decisions_apply_failed`

Logs should include:

- decision id and short code
- agent id
- kind/scope/actor
- channel/account/peer hash
- delivery status
- authorization denials
- apply result

Doctor checks:

- decision database exists and can migrate
- configured admin routes are valid
- admin sender allowlist is not empty when admin-chat approvals are enabled
- channels advertise capabilities
- pending decision count by age

## Configuration

Suggested per-agent config:

```yaml
learning:
  enabled: true
  mode: propose
  review_interval_turns: 10
  skill_review_min_tool_calls: 8
  approvals:
    user_memory:
      ask_on_inferred: true
      auto_apply_explicit_private: true
      undo_window_minutes: 1440
    admin:
      notify: true
      routes:
        - channel: telegram
          account_id: main
          peer_id: "123456789"
      senders:
        telegram:
          main:
            - "123456789"
    expiry:
      user_minutes: 1440
      admin_minutes: 10080
```

Global defaults can later live under `defaults.learning.approvals`, but v1 should
start per-agent to avoid surprising all agents at once.

## MVP Boundary

V1 must include:

- `DecisionStore` with migrations and audit events
- `DecisionCenter` create/resolve/apply APIs
- channel capabilities on Telegram and WhatsApp
- Telegram callback renderer for decisions
- WhatsApp/plain text fallback renderer
- `/learn approve|reject|edit|undo CODE`
- numeric fallback for exactly one pending decision
- memory candidate decision flow
- admin decision notification for skill proposals
- dashboard reads/writes the same decision records
- tests for authorization, duplicate events, expiry, and channel fallback

V1 can defer:

- full free-form edit workflow
- curator write execution
- synchronous tool approval unification
- Discord/Facebook adapters
- Honcho-compatible external memory provider
- mobile-deep-link dashboard handoff

## Phased Implementation Plan

### Phase 1 - Decision Core

- Add `src/decisions/types.ts`
- Add `src/decisions/store.ts`
- Add migrations for `data/decision-center.sqlite`
- Add audit events and idempotency checks
- Add unit tests for state transitions and duplicate resolution

Acceptance:

- decisions survive process restart
- duplicate approve events do not double-apply
- expired decisions cannot be approved

### Phase 2 - Channel Rendering

- Add `ChannelCapabilities`
- Add `renderDecisionPrompt()` helper
- Add Telegram callback payload support
- Add WhatsApp/text fallback rendering
- Add `/learn` command parser in gateway
- Add numeric reply parser for unambiguous pending decisions

Acceptance:

- Telegram renders buttons
- WhatsApp renders numbered text
- both produce identical `DecisionEvent`
- mismatched sender cannot approve

### Phase 3 - Learning Memory Flow

- Convert `memory_candidate` actions into decisions
- Add explicit-intent auto-apply + undo for private agents
- Add inferred-memory ask flow to originating user
- Add secret redaction and payload validation before delivery
- Update learning dashboard to show decision status

Acceptance:

- "zapomni" style messages can auto-save under private policy
- inferred preferences prompt the user
- user approval applies memory exactly once
- user rejection marks learning action rejected

### Phase 4 - Admin Skill Flow

- Convert skill actions into admin decisions
- Add admin route delivery
- Add dashboard/admin-chat approve/reject/apply
- Preserve skill snapshots before apply

Acceptance:

- ordinary user cannot approve skill changes
- configured admin can approve from dashboard or admin chat
- apply path reuses existing skill applier and snapshots

### Phase 5 - Curator Proposal Flow

- Add curator proposal records
- Gate archive/consolidation/patch behind admin decisions
- Add report links and pinned-skill safety

Acceptance:

- curator can propose but not mutate without admin approval
- pinned skills never appear as mutation candidates
- reports explain what was proposed and why

## Risks

### Ambiguous WhatsApp Replies

Risk: user replies `1` but multiple prompts are pending.

Mitigation: numeric replies resolve only when exactly one pending decision exists
for that sender and route. Otherwise require explicit code.

### Approval For Stale Payload

Risk: admin approves a skill patch after the skill changed.

Mitigation: skill payload includes content hash/snapshot id. Apply fails with a
clear stale-payload error and asks for regeneration.

### User Approves Global Behavior Accidentally

Risk: user-facing prompt asks ordinary user to approve a skill/system behavior.

Mitigation: policy layer rejects `originating_user` actor for `scope=agent` and
`scope=system` regardless of channel rendering.

### Notification Spam

Risk: active learning generates too many prompts.

Mitigation: coalesce decisions by `learningActionId`, throttle admin
notifications, and allow per-agent `notify_admin_for` filters.

### Dashboard/Data Divergence

Risk: dashboard and admin chat update different records.

Mitigation: both call `DecisionCenter.resolve()` and write the same audit log.

## Evaluation Plan

Unit tests:

- decision state transitions
- actor/scope authorization matrix
- duplicate callback/text event idempotency
- expiry behavior
- short code lookup
- delivery recording

Gateway tests:

- Telegram callback resolves user memory decision
- WhatsApp `/learn approve CODE` resolves user memory decision
- WhatsApp bare `1` resolves only unambiguous pending decision
- mismatched sender cannot approve
- ordinary user cannot approve skill decision
- admin route sender can approve skill decision

Learning tests:

- explicit private memory auto-applies and creates undo
- inferred memory creates user decision
- skill action creates admin decision
- rejected decision updates learning action status

Operational checks:

- doctor reports missing admin sender allowlist
- dashboard summary separates reviews, raw actions, and decisions
- stale pending decisions are visible by age

## Open Questions

- Should admin approvals default to "approve only" or "approve and apply" for
  skill actions?
- Should user memory decisions in groups DM the user privately when possible, or
  ask in the group thread?
- Should decision records live in `decision-center.sqlite` from day one, or be
  colocated with `learning.sqlite` until non-learning users exist?
- What is the default user decision expiry: 24 hours or 7 days?

Recommended defaults:

- admin skill decisions: approve and apply as two separate actions in dashboard,
  but admin-chat can offer "Approve" only in v1
- group user memory: ask in same thread for v1, add DM handoff later
- storage: separate `decision-center.sqlite`
- user expiry: 24 hours
