# Telegram Operator Spec

Status: Draft

Purpose: define Telegram commands, approval flows, identity enforcement, message rendering, and operator interactions.

## Telegram Thesis

Telegram is an operator surface, not an approval shortcut.

It should mirror the CLI workflow while enforcing stricter identity and ambiguity rules.

Core rule:

```text
Only dedicated /buildroom commands can create Buildroom authority.
```

Not allowed:

```text
"yes" in ordinary chat
"ok build it" in a normal agent thread
message reactions
forwarded messages
handoff signals
watched sessions
approval by chat ID alone
```

## Identity Model

Operator identity and Telegram route are different.

Operator identity:

```text
telegram_user:123456789
```

Route evidence:

```text
telegram_chat:-1001234567890
telegram_thread:-1001234567890:2
```

Rules:

- Telegram user ID is the approval identity when available.
- Chat ID is route evidence, not identity.
- Thread ID is route evidence, not identity.
- Group membership is not approval authority.
- Forwarded messages cannot approve.
- Bot messages cannot approve.
- Unknown users cannot approve even inside an allowed chat.

Config example:

```yaml
operators:
  - id: telegram_user:123456789
    commandRoutes:
      - telegram_chat:-1001234567890
    approvalRoutes:
      - telegram_chat:-1001234567890
notifications:
  routes:
    - telegram_thread:-1001234567890:2
```

Approval artifact should record:

```yaml
approvedBy: telegram_user:123456789
approvalRoute: telegram
sourceChat: telegram_chat:-1001234567890
sourceThread: null
```

For Telegram General/no-topic messages, `sourceThread` should be `null` or omitted. It must not be inferred as another topic.

## Command Routes And Notification Routes

Telegram routes have separate purposes.

Recommended v0.1 setup:

```yaml
operators:
  - id: telegram_user:123456789
    commandRoutes:
      - telegram_chat:-1001234567890
    approvalRoutes:
      - telegram_chat:-1001234567890

notifications:
  routes:
    - telegram_thread:-1001234567890:2
```

Rules:

- command routes allow manual `/buildroom` commands;
- approval routes allow authority-bearing approval, build, pause, and resume commands;
- notification routes receive automatic Buildroom reports;
- notification routes do not grant approval authority by themselves;
- authority-bearing commands require both configured operator identity and allowed approval route;
- General/no-topic route may be used for manual operator commands;
- topic routes may be enabled for commands only if explicitly configured.

This preserves the intended Telegram setup:

```text
General = manual operator conversation and commands
Topic 2 = automatic Buildroom notifications
```

## Command Permission Levels

Read-only commands:

```text
/buildroom status
/buildroom show <id>
/buildroom report
```

Artifact-writing but non-executing commands:

```text
/buildroom collect
/buildroom propose
/buildroom review <idea_id>
/buildroom reject <id>
/buildroom qa <build_id>
/buildroom trust <build_id>
/buildroom retain <trust_id>
```

Authority-bearing commands:

```text
/buildroom approve <review_id>
/buildroom build <approval_id|build_plan_id>
/buildroom pause
/buildroom resume
```

v0.1 rule:

```text
All /buildroom commands except status, show, and report require configured operator identity.
Authority-bearing commands also require an allowed approval route.
```

## Supported Commands

Required v0.1 commands:

```text
/buildroom status
/buildroom collect
/buildroom propose
/buildroom review <idea_id>
/buildroom show <id>
/buildroom approve <review_id>
/buildroom reject <id>
/buildroom build <approval_id|build_plan_id>
/buildroom qa <build_id>
/buildroom trust <build_id>
/buildroom report
/buildroom retain <trust_id>
/buildroom pause
/buildroom resume
```

Recommended aliases:

```text
/br status
/br show <id>
```

Aliases are optional for v0.1.

Deferred:

```text
/buildroom retry <error_receipt_id>
/buildroom validate
/buildroom doctor
/buildroom dashboard
```

## Command Parity With CLI

Telegram should preserve the CLI authority model:

```text
propose != review
review != approval
approval != build
build != QA
QA != trust.clean automatically
```

Telegram commands should map to CLI concepts:

| Telegram | CLI equivalent |
| --- | --- |
| `/buildroom status` | `anthroclaw buildroom status` |
| `/buildroom collect` | `anthroclaw buildroom collect` |
| `/buildroom propose` | `anthroclaw buildroom propose` |
| `/buildroom review <idea_id>` | `anthroclaw buildroom review <idea_id>` |
| `/buildroom show <id>` | `anthroclaw buildroom show <id>` |
| `/buildroom approve <review_id>` | `anthroclaw buildroom approve <review_id>` |
| `/buildroom build <approval_id>` | `anthroclaw buildroom build <approval_id>` |

## Approval Command

Approval command:

```text
/buildroom approve <review_id>
```

Requirements:

- sender is configured operator;
- sender user ID is available;
- chat/thread route is an allowed approval route;
- message is not forwarded;
- target is `main_review`;
- review decision is `approved_for_operator`;
- scope is locked;
- Buildroom is not paused/killed.

Expected response:

```text
Approved

Review:
review_20260511_operator_summary_docs

Approval:
approval_20260511_operator_summary_docs

Approved by:
telegram_user:123456789

Scope:
- docs/**
- tests/**

Important:
Approval does not execute the build.

Next:
/buildroom build approval_20260511_operator_summary_docs
```

Do not accept raw idea IDs for approval in v0.1.

If a future UX accepts idea IDs, it must resolve to exactly one `main_review` and echo the resolved review ID before approval.

## Build Command

Build command:

```text
/buildroom build <approval_id|build_plan_id>
```

Requirements:

- sender is configured operator;
- sender user ID is available;
- chat/thread route is an allowed approval route;
- approval exists;
- approval is unexpired and unrevoked;
- approval has not been consumed by another build plan;
- lock acquired;
- Buildroom is not paused/killed;
- pre-run policy passes.

Expected response:

```text
Build started

Build:
build_20260511_operator_summary_docs

Approval:
approval_20260511_operator_summary_docs

Scope:
- docs/**
- tests/**

Next:
/buildroom status
```

Do not accept raw idea IDs for build in v0.1.

If command is ambiguous, do not guess. Ask the operator to use the exact approval or build plan ID.

Optional later hardening:

```text
/buildroom confirm-build <id>
```

Not required for v0.1 if exact ID and valid approval are provided.

## Status Message

Status should be compact.

v0.1 may assume one default Buildroom. If multiple rooms exist, Telegram commands must not guess the room. They should require an explicit room ID or return an ambiguity message.

Example:

```text
Buildroom: anthroclaw-core
State: approved
Trust: WATCH

Pending approvals: 0
Approved not built: 1
Active builds: 0
QA pending: 0

Next:
/buildroom build approval_20260511_operator_summary_docs
```

Rules:

- trust state should be visible near the top;
- next action should be explicit;
- IDs should be copyable;
- no Markdown tables.

## Show Message

`show` should auto-detect artifact type.

Command:

```text
/buildroom show <id>
```

Example proposal/review message:

```text
Review ready

ID:
review_20260511_operator_summary_docs

Proposal:
Improve operator summary docs/test/example

Risk:
low

Allowed:
- docs/**
- tests/**

Blocked:
- .env
- config.yml
- agents/**

Non-goals:
- no production config changes
- no Telegram implementation

Action:
/buildroom approve review_20260511_operator_summary_docs
```

If output is too long, split into multiple messages:

```text
1/3 Scope
2/3 Evidence
3/3 Action
```

## Report Message

Report should summarize, not dump.

Command:

```text
/buildroom report
```

Minimum sections:

- room;
- state;
- trust;
- pending decisions;
- latest work;
- QA result;
- operator action;
- receipt chain pointer.

Example:

```text
Buildroom report

Room: anthroclaw-core
Trust: WATCH

Latest:
Improve operator summary docs/test/example

QA:
pass_with_notes

Missing:
- Telegram rendering not tested

Next:
Leave as docs-only or create follow-up Telegram spec.

Receipts:
/buildroom show trust_20260511_operator_summary_docs
```

## Pause And Resume

Pause:

```text
/buildroom pause
```

Requirements:

- sender is configured operator;
- route is an allowed command route;
- route is an allowed approval route.

Response:

```text
Buildroom paused

New builds and scheduled stages are blocked.
Status and reports remain available.
Active runtime is not cancelled automatically.
```

Resume:

```text
/buildroom resume
```

Requirements:

- sender is configured operator;
- route is an allowed command route;
- route is an allowed approval route.

Response:

```text
Buildroom resumed

No pending build was started automatically.

Next:
/buildroom status
```

## Rejection

Reject:

```text
/buildroom reject <id> <reason>
```

Requirements:

- sender is configured operator;
- route is an allowed command route;
- target exists.

Response:

```text
Rejected

Target:
idea_20260511_operator_summary_docs

Reason:
Not the right v0.1 scope.
```

Rejecting must not delete the artifact.

## Ambiguity Handling

Telegram must not guess for authority-bearing commands.

Ambiguous:

```text
/buildroom approve operator summary
/buildroom build latest
/buildroom approve idea_...
```

Replies to bot messages do not create authority unless the reply contains a complete `/buildroom ...` command with an exact artifact ID.

Rejected replies:

```text
approve
yes
ok build it
```

Response:

```text
Ambiguous command

Use exact review ID:
/buildroom approve review_20260511_operator_summary_docs
```

Read-only commands may support softer resolution later, but v0.1 should prefer exact IDs.

## Unauthorized Messages

Unauthorized approval attempt:

```text
Approval rejected

Reason:
sender is not a configured Buildroom operator
```

Forbidden forwarded approval:

```text
Approval rejected

Reason:
forwarded messages cannot approve Buildroom work
```

Wrong route:

```text
Approval rejected

Reason:
this chat/thread is not an allowed Buildroom approval route
```

Unauthorized failures should not reveal sensitive room details.

For unauthorized users, do not reveal whether artifact IDs exist.

## Failure Messages

Failure messages should include:

- what failed;
- why;
- next action;
- receipt ID if created.

Missing approval:

```text
Build blocked

Reason:
No approval artifact exists.

Next:
/buildroom approve review_20260511_operator_summary_docs
```

Paused:

```text
Buildroom paused

New build execution is disabled.

Next:
/buildroom resume
```

Receipt not found:

```text
Receipt not found

ID:
idea_20260511_operator_summary_docs

Use:
/buildroom status
/buildroom report
```

## Long-Running Commands

Long-running commands should acknowledge immediately and complete asynchronously.

Applies to:

```text
/buildroom collect
/buildroom propose
/buildroom review <idea_id>
/buildroom build <approval_id|build_plan_id>
/buildroom qa <build_id>
/buildroom trust <build_id>
```

Initial acknowledgement:

```text
Collection started

Run:
run_20260511_research_collect

Next:
/buildroom status
```

Completion notification:

```text
Collection completed

Research packet:
research_20260511_operator_summary_docs

Next:
/buildroom propose
```

The acknowledgement is not a receipt. The durable artifact is the receipt created by the completed stage.

## Notification Routing

Automatic Buildroom notifications should go to configured notification routes, not necessarily to approval routes.

Notification examples:

- build completed;
- QA completed;
- trust report generated;
- retention review created;
- room blocked;
- runtime failed.

Implemented v0.1 lifecycle notifications:

- `coder_receipt`;
- `error_receipt`;
- `qa_report`;
- `trust_report`;
- `retention_review`.

Future lifecycle notifications may add collection completion, proposal readiness, approval creation, and build-start acknowledgements.

Rules:

- notifications are not receipts by themselves;
- notifications should include artifact IDs and next explicit command;
- notification routes do not grant approval authority;
- notification routes may be Telegram topics used for automatic Buildroom updates;
- approval from a notification route is rejected unless that route is also explicitly configured as an approval route.

Recommended setup:

```text
General = manual operator conversation and commands
Topic 2 = automatic Buildroom notifications
```

## Message Rendering Rules

Telegram rendering constraints:

- no Markdown tables;
- keep messages short;
- split long reports;
- trust state near top;
- next action near top or bottom, never buried;
- copyable artifact IDs;
- no raw JSON unless requested;
- no raw secrets;
- no raw transcripts;
- no huge command output;
- avoid formatting that breaks Telegram Markdown.

Recommended maximum:

```text
one message <= 3000 characters
```

Long reports should split with numbered headers:

```text
Report 1/3: Summary
Report 2/3: Evidence
Report 3/3: Receipts
```

## Artifact Creation

Telegram commands that create artifacts:

| Command | Artifact |
| --- | --- |
| `/buildroom collect` | `research_packet`, maybe `session_summary` |
| `/buildroom propose` | `idea_contract` |
| `/buildroom review` | `main_review` |
| `/buildroom approve` | `approval` |
| `/buildroom reject` | transition/rejection artifact |
| `/buildroom build` | `build_plan`, `coder_receipt`, or `error_receipt` |
| `/buildroom qa` | `qa_report` |
| `/buildroom trust` | `verification_delta`, `trust_report` |
| `/buildroom retain` | `retention_review` |
| `/buildroom pause` | transition/state update |
| `/buildroom resume` | transition/state update |

Telegram messages are not receipts by themselves. They render or trigger artifacts.

## Security Tests

v0.1 Telegram tests must prove:

- approval by unconfigured user is rejected;
- approval by allowed chat but wrong user is rejected;
- approval by configured user from wrong approval route is rejected;
- approval by forwarded message is rejected;
- approval from ordinary chat text is ignored;
- reply text like `approve` or `yes` does not approve;
- `/buildroom approve <idea_id>` is rejected;
- `/buildroom build <idea_id>` is rejected;
- `/buildroom build <approval_id>` requires valid unconsumed approval;
- notification route does not grant approval authority by itself;
- paused room rejects build;
- duplicate build command does not start duplicate Builder run;
- long report splits safely;
- secrets are not rendered.

## v0.1 Acceptance Criteria

Telegram operator surface is good enough for v0.1 when:

- all authority-bearing commands require configured operator identity;
- all artifact-writing commands except status/show/report require configured operator identity;
- chat/thread route is recorded but not treated as identity;
- command, approval, and notification routes are distinct in config and behavior;
- approvals only work through `/buildroom approve <review_id>`;
- build only works through `/buildroom build <approval_id|build_plan_id>`;
- ambiguous commands do not execute;
- approval does not execute build;
- failure messages include reason and next action;
- trust state is visible in reports/status;
- ordinary agent messages cannot approve or build;
- Telegram output can be understood without reading JSON.
