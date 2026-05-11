# Operator UX

Status: Draft

Purpose: define what the operator sees and does across CLI, Telegram, Markdown reports, daily digests, and future dashboard surfaces.

## UX Thesis

Operator UX is the product surface of trust.

Auto-Buildroom may have many internal artifacts and roles, but the operator should experience a simple loop:

```text
Notice -> Research -> Proposal -> Approval -> Build -> QA -> Trust Report
```

The operator should always know:

- what the Buildroom noticed;
- why it matters;
- what evidence exists;
- what decision is needed;
- what scope is approved;
- what changed;
- what QA confirmed;
- what trust state applies;
- where the receipts are.

The operator should not need to read raw JSON to understand the state of the room.

Core UX formula:

```text
Proposal asks for authority.
Approval grants authority.
Builder consumes authority.
QA tests the claims.
Trust tells the operator what to believe.
```

The operator should not experience Auto-Buildroom as seven agents talking at once. They should experience it as a small set of decisions:

- what was noticed;
- what is being proposed;
- what scope is requested;
- whether to approve;
- what changed;
- what QA proved;
- what trust state applies.

## v0.1 UX Principles

1. Approval must be explicit.
2. Every operator-facing action should point to a receipt or create one.
3. The system should distinguish proposal, approval, build, QA, and trust.
4. Status should be readable in CLI and Telegram without a dashboard.
5. The operator should see scope before approving build execution.
6. The operator should see evidence before trusting a result.
7. A failed or blocked state should say what decision is needed next.
8. Ordinary agent chat should not be cluttered with Buildroom internals.

## Operator Surfaces

### CLI

The CLI is the canonical v0.1 operator surface.

It should support:

```text
anthroclaw buildroom init
anthroclaw buildroom status
anthroclaw buildroom collect
anthroclaw buildroom propose
anthroclaw buildroom show <id>
anthroclaw buildroom approve <id>
anthroclaw buildroom reject <id>
anthroclaw buildroom build <id>
anthroclaw buildroom qa <id>
anthroclaw buildroom trust <id>
anthroclaw buildroom report
anthroclaw buildroom pause
anthroclaw buildroom resume
```

The exact command names may change during implementation, but the UX contract should remain:

```text
inspect -> decide -> execute -> verify -> report
```

### Telegram

Telegram is the first conversational operator surface.

It should support dedicated Buildroom commands only:

```text
/buildroom status
/buildroom ideas
/buildroom show <id>
/buildroom approve <id>
/buildroom reject <id>
/buildroom build <id>
/buildroom qa <id>
/buildroom trust <id>
/buildroom report
```

Approvals must only be accepted through this Buildroom operator surface.

Not allowed in v0.1:

```text
"yes" in ordinary agent chat
"approve it" in unrelated thread
approval from watched session
approval from handoff
```

### Markdown Reports

Markdown reports are the durable human-readable surface for v0.1.

They should live under:

```text
.anthroclaw/auto-buildroom/rooms/<room>/buildroom/operator/
```

The latest report should answer:

- current trust state;
- pending approvals;
- active or latest proposal;
- allowed scope;
- changed files;
- QA evidence;
- unresolved risks;
- next operator action;
- receipt chain links.

### HTML Dashboard

The HTML dashboard is not required for v0.1.

If added early, it should be a static rendered report, not a full product surface:

```text
.anthroclaw/auto-buildroom/rooms/<room>/buildroom/operator/latest.html
```

### Daily Digest

Daily digest is not required for v0.1.

When introduced, it should summarize:

- new signals;
- new proposals;
- pending approvals;
- failed or blocked builds;
- trust state changes;
- recommended operator actions.

It must not imply that unapproved work has been executed.

## First-Run UX

The first-run experience should be deliberately narrow.

Command:

```text
anthroclaw buildroom init
```

Expected output:

```text
Buildroom initialized

Room: anthroclaw-core
Root: .anthroclaw/auto-buildroom/rooms/anthroclaw-core
Mode: manual_approval
Approval routes:
- CLI: anthroclaw buildroom approve <id>
- Telegram: /buildroom approve <id>

Next:
anthroclaw buildroom collect
```

The first-run message should reinforce:

```text
Buildroom can propose work.
Build execution requires explicit approval.
```

## Status UX

`status` should be compact and decision-oriented.

Example:

```text
Buildroom: anthroclaw-core
Mode: manual_approval
Trust: watch

Pending approvals: 0
Approved not built: 1
Active builds: 0
QA pending: 0
Latest proposal: idea_20260511_operator_summary_docs
Latest trust report: trust_20260511_operator_summary_docs

Next action:
Run build for idea_20260511_operator_summary_docs
```

Status should not dump artifact details by default. It should point to `show <id>` or `report`.

User-facing lifecycle states for v0.1:

```text
idle
collecting
proposal_ready
awaiting_approval
approved
building
qa_pending
trust_pending
complete
blocked
paused
```

The UI does not need to show the enum in every message, but CLI, Telegram, reports, and future dashboard surfaces should all derive from the same lifecycle state.

## Show UX

`show <id>` should auto-detect artifact type and render the right human view.

Expected behavior:

```text
show idea_*      -> proposal view
show approval_*  -> approval receipt
show build_*     -> build result and changed files
show qa_*        -> QA evidence
show delta_*     -> verification delta
show trust_*     -> final trust report
```

If the artifact is unknown, the command should fail with a helpful next action rather than scanning unrelated state.

## Proposal UX

A proposal is the main approval object.

Before approval, the operator must see:

- title;
- why this matters;
- evidence summary;
- proposed scope;
- allowed paths;
- blocked paths;
- non-goals;
- risk;
- acceptance criteria;
- expected verification;
- receipt ID.

Example CLI/Telegram rendering:

```text
Proposal: Improve operator summary docs/test/example
ID: idea_20260511_operator_summary_docs
Risk: low

Why:
Recent operator work shows confusion around what the summary should explain.

Evidence:
- docs/Auto-Buildroom/03-user-mental-model.md defines Trust Report and Operator View
- product decision requires operator-readable receipts
- no dedicated operator summary example exists yet

Allowed paths:
- docs/**
- tests/**

Blocked paths:
- .env
- config.yml
- agents/**
- src/gateway.ts

Non-goals:
- no production config changes
- no Telegram command implementation
- no autonomous cron

Acceptance:
- docs explain operator summary fields
- example report exists
- test or fixture validates summary shape

Action:
anthroclaw buildroom approve idea_20260511_operator_summary_docs
```

## Approval UX

Approval is an authority boundary.

Important v0.1 rule:

```text
Approving a proposal does not execute it by itself.
Approval creates authority.
Build consumes authority.
```

This should be explicit in CLI and Telegram so the operator does not avoid approval out of fear that it immediately starts mutation.

Approval should require:

- operator identity;
- target artifact ID;
- decision;
- timestamp;
- approved scope;
- approval route;
- optional reason.

CLI example:

```text
anthroclaw buildroom approve idea_20260511_operator_summary_docs \
  --reason "Safe docs/test MVP improvement"
```

Expected output:

```text
Approved

Proposal: idea_20260511_operator_summary_docs
Approval: approval_20260511_operator_summary_docs
Approved by: cli:local-operator
Approval route: cli
Approved at: 2026-05-11T12:00:00Z
Approved scope:
- docs/**
- tests/**

Next:
anthroclaw buildroom build idea_20260511_operator_summary_docs
```

Telegram example:

```text
/buildroom approve idea_20260511_operator_summary_docs
```

Telegram should confirm the exact target before running build if the command is ambiguous.

Approval must not be inferred from:

- "ok";
- "yes";
- "ship it";
- ordinary chat replies;
- reactions;
- forwarded messages;
- messages from non-operator IDs.

## Build UX

Build UX should show that Builder is constrained.

Before build starts:

```text
Builder will run with approved scope:
- docs/**
- tests/**

Blocked:
- .env
- config.yml
- agents/**
- src/gateway.ts

Mode: manual_approval
Worktree/sandbox: required for code mutation
```

During build, v0.1 does not need rich streaming. It needs clear state:

```text
Build started: build_20260511_operator_summary_docs
Stage: running
```

After build:

```text
Build completed

Changed files:
- docs/Auto-Buildroom/15-dashboard-and-reports.md
- tests/auto-buildroom/operator-summary.fixture.test.ts

Builder claims:
- Added operator summary field definitions
- Added example report
- Added fixture test

Next:
anthroclaw buildroom qa build_20260511_operator_summary_docs
```

Build execution should require an existing approval artifact. If a proposal is approved but not built, it should remain visible as `Approved not built` in status.

Telegram build behavior:

- exact build command with a valid approved ID may run;
- ambiguous build command must ask for clarification;
- destructive or scope-expanding build must be blocked;
- optional later hardening may require `/buildroom confirm-build <id>` before mutation.

## QA UX

QA should sound skeptical and evidence-based.

Example:

```text
QA Report: qa_20260511_operator_summary_docs
Status: pass_with_notes

Confirmed:
- changed files stayed within approved paths
- operator summary fields are documented
- fixture test passes

Missing evidence:
- Telegram rendering was not tested

Rejected:
- none

Next:
anthroclaw buildroom trust build_20260511_operator_summary_docs
```

QA should never say "done" without explaining evidence.

## Verification Delta UX

Verification Delta should show the gap between Builder claims and QA evidence.

Example:

```text
Verification Delta

Builder claim: Added operator summary field definitions
QA status: confirmed

Builder claim: Added Telegram-ready rendering
QA status: missing_evidence

Overall: watch
```

The operator should immediately understand why a result is not `clean`.

## Trust Report UX

Trust Report is the final human-readable state.

Example:

```text
Trust: WATCH

Summary:
The docs/test improvement is useful and stayed within approved scope.
Core documentation claims were confirmed. Telegram rendering was not verified.

Confirmed:
- approved paths respected
- operator summary fields documented
- fixture test passed

Unconfirmed:
- Telegram rendering behavior

Risks:
- future Telegram report spec still needs implementation detail

Operator action needed:
- approve follow-up Telegram renderer spec, or leave as docs-only
```

Trust states:

```text
CLEAN       Evidence supports the result.
WATCH       Mostly okay, but something remains unproven.
INVESTIGATE Significant uncertainty or rejected claims.
BLOCKED     Unsafe, policy-violating, or not ready to proceed.
```

Trust state should be visible in every report and status view.

## Report UX

`report` should generate or show the latest operator report.

Minimum report sections:

```text
Buildroom
Current state
Pending approvals
Active/latest work
Evidence
Approved scope
Changed files
QA result
Verification delta
Trust state
Operator action needed
Receipt chain
```

Example receipt chain:

```text
research_20260511_operator_summary
-> idea_20260511_operator_summary_docs
-> review_20260511_operator_summary_docs
-> approval_20260511_operator_summary_docs
-> build_20260511_operator_summary_docs
-> qa_20260511_operator_summary_docs
-> delta_20260511_operator_summary_docs
-> trust_20260511_operator_summary_docs
```

Approval identity should be visible in reports:

```text
Approved by: telegram:48705953
Approval route: telegram
Approved at: 2026-05-11T12:00:00Z
Approval receipt: approval_20260511_operator_summary_docs
```

## Pause And Resume UX

Pause is a safety feature.

Command:

```text
anthroclaw buildroom pause
```

Expected behavior:

- no new builds;
- no scheduled autonomous stages;
- status/report still works;
- artifacts are not deleted;
- pending approvals remain visible.

Output:

```text
Buildroom paused

New build execution is disabled.
Read-only status and reports remain available.
```

Resume:

```text
anthroclaw buildroom resume
```

Resume should not automatically execute old pending builds. It should return to a state where the operator can decide next action.

## Failure UX

Failure messages should be direct and actionable.

### Missing Approval

```text
Build blocked

Reason:
No approval artifact exists for idea_20260511_operator_summary_docs.

Next:
anthroclaw buildroom approve idea_20260511_operator_summary_docs
```

### Path Violation

```text
Build blocked

Reason:
Builder changed files outside approved scope.

Rejected paths:
- src/gateway.ts

Approved paths:
- docs/**
- tests/**

Trust: BLOCKED
```

### Missing QA Evidence

```text
Trust: WATCH

Reason:
Builder claimed Telegram rendering was ready, but QA did not verify Telegram output.

Next:
Run targeted QA or create follow-up proposal.
```

### Runtime Blocked

```text
Run blocked by native runtime approval

Reason:
The Agent SDK runtime required approval that was not available.

Buildroom state:
blocked

Next:
Review runtime approval settings or rerun from operator surface.
```

### Receipt Not Found

```text
Receipt not found

ID:
idea_20260511_operator_summary_docs

Next:
anthroclaw buildroom status
anthroclaw buildroom report
```

Telegram:

```text
I could not find receipt idea_20260511_operator_summary_docs.

Use:
/buildroom ideas
/buildroom status
```

## Telegram Message Constraints

Telegram messages should be concise.

Rules:

- no Markdown tables;
- include copyable IDs;
- split long reports;
- never hide trust state;
- put required operator action near the top;
- do not include raw secrets, env values, or long transcripts;
- do not treat button/reply text as approval unless routed through the approval handler.

Example Telegram status:

```text
Buildroom: anthroclaw-core
Trust: WATCH
Pending approvals: 1

Next:
Review idea_20260511_operator_summary_docs

/buildroom show idea_20260511_operator_summary_docs
```

## v0.1 Real-World Operator Flow

The first real-world user flow should be:

```text
anthroclaw buildroom init
anthroclaw buildroom collect
anthroclaw buildroom propose
anthroclaw buildroom show <idea_id>
anthroclaw buildroom approve <idea_id>
anthroclaw buildroom build <idea_id>
anthroclaw buildroom qa <build_id>
anthroclaw buildroom trust <build_id>
anthroclaw buildroom report
```

The same flow may later be available through Telegram:

```text
/buildroom status
/buildroom show <idea_id>
/buildroom approve <idea_id>
/buildroom build <idea_id>
/buildroom report
```

## Success Criteria

Operator UX is good enough for v0.1 when:

- the operator can tell whether the room is idle, waiting, building, QA pending, or blocked;
- approval cannot happen accidentally;
- proposal scope is visible before approval;
- build changes are summarized after execution;
- QA evidence is visible before trust;
- `clean`, `watch`, `investigate`, and `blocked` are understandable;
- the latest report points to the full receipt chain;
- ordinary agent chat stays ordinary.
