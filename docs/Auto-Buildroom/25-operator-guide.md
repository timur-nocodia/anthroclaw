# Operator Guide

Status: Draft

Purpose: explain how an operator uses Auto-Buildroom day to day: reading trust states, approving ideas, rejecting work, pausing the system, reviewing receipts, and handling failed builds.

## Operator Thesis

Auto-Buildroom is not another chat agent.

It is the place where agent work becomes:

- proposed;
- scoped;
- approved;
- built;
- checked;
- explained;
- saved as receipts.

The operator's job is not to micromanage every internal role.

The operator's job is to decide:

```text
Is this proposed work worth granting authority?
Do I understand the allowed scope?
Do the receipts prove what the system claims?
What trust state should I act on?
```

Core rule:

```text
Proposal asks for authority.
Approval grants authority.
Build consumes authority.
QA checks the claims.
Trust tells you what to believe.
```

## v0.1 Mental Model

The normal Buildroom loop is:

```text
Notice -> Research -> Proposal -> Review -> Approval -> Build -> QA -> Trust Report
```

In CLI form:

```text
init
status
collect
propose
review
show
approve
build
qa
trust
report
```

Important boundaries:

- a thought is not a task;
- a signal is not approval;
- an idea is not approval;
- a review is not approval;
- approval does not start a build by itself;
- Builder claims are not proof;
- QA pass does not automatically mean `clean`;
- Trust Report is the operator-facing answer.

If there is no receipt, treat the action as if it did not happen.

## Before You Start

Use Auto-Buildroom v0.1 only for local, bounded work.

Good first targets:

- documentation examples;
- test fixtures;
- operator summary examples;
- report wording;
- narrow local repo improvements.

Avoid as first targets:

- `agents/**`;
- `config.yml`;
- secrets;
- production deploy/release files;
- channel adapters;
- external API mutation;
- social/email/issue/PR posting.

Default v0.1 expectation:

```text
manual approval only
local repo only
no raw transcripts by default
no external side effects by default
```

## First Run

In this repository, use the local script form:

```text
pnpm buildroom <command>
```

The installed product-facing form is:

```text
anthroclaw buildroom <command>
```

Initialize a project-local Buildroom:

```text
anthroclaw buildroom init --room anthroclaw-core --operator cli:user:local-operator
```

Expected result:

```text
Buildroom initialized

Room: anthroclaw-core
Mode: manual_approval
Session watching: off
External side effects: denied

Next:
anthroclaw buildroom collect
```

Then check status:

```text
anthroclaw buildroom status
```

You should see:

- room ID;
- mode;
- paused/kill switch state;
- pending approvals;
- approved-not-built work;
- active builds;
- QA pending;
- latest trust state;
- next action.

If status says config is invalid or blocked, fix that before running any build stage.

Init may offer to add this path to `.gitignore`:

```text
.anthroclaw/auto-buildroom/
```

For v0.1, live Buildroom state is usually local project state and should not be committed. Commit only selected docs, examples, and fixtures intentionally.

## Daily Operator Loop

The normal day-to-day loop:

```text
anthroclaw buildroom status
anthroclaw buildroom collect
anthroclaw buildroom propose
anthroclaw buildroom review <idea_id>
anthroclaw buildroom show <review_id>
anthroclaw buildroom approve <review_id>
anthroclaw buildroom build <approval_id>
anthroclaw buildroom qa <build_id>
anthroclaw buildroom trust <build_id>
anthroclaw buildroom report --save
anthroclaw buildroom retain <trust_id>
```

You do not need to run every command every time. `status` should tell you the next action.

## Reading Status

Example:

```text
Buildroom: anthroclaw-core
Mode: manual_approval
State: approved
Latest trust: WATCH

Pending approvals: 0
Approved not built: 1
Active builds: 0
QA pending: 0

Next:
anthroclaw buildroom build approval_20260511_operator_summary_docs
```

How to read it:

- `Mode: manual_approval` means build execution requires explicit approval.
- `State: approved` means authority exists, but build may not have run.
- `Approved not built: 1` means approval has been granted and is waiting to be consumed.
- `Latest trust: WATCH` means the last completed run was useful but not fully proven.
- `Next` is the safest next command.

Status should be readable without opening raw JSON.

## Creating A Proposal

Collect evidence:

```text
anthroclaw buildroom collect
```

Ask Buildroom to propose work:

```text
anthroclaw buildroom propose
```

Expected result:

```text
Idea created:
idea_20260511_operator_summary_docs

Next:
anthroclaw buildroom review idea_20260511_operator_summary_docs
```

At this point:

- no approval exists;
- no build plan exists;
- no repository mutation should happen.

## Reviewing Scope

Create a Main Review:

```text
anthroclaw buildroom review idea_20260511_operator_summary_docs
```

Then inspect it:

```text
anthroclaw buildroom show review_20260511_operator_summary_docs
```

Before approving, check:

- what problem is being solved;
- what evidence supports it;
- exact allowed paths;
- blocked paths;
- non-goals;
- acceptance criteria;
- risk level;
- whether human approval is required.

Do not approve if the scope is vague.

## Approval Checklist

Before running `approve`, confirm:

- target ID is a `review_...` artifact;
- scope is narrow and understandable;
- allowed paths match the intended work;
- blocked paths include secrets, config, agents, and external side-effect surfaces;
- non-goals are explicit;
- acceptance criteria are checkable;
- you are comfortable granting Builder authority inside this box.

If any item is unclear, reject or request a narrower proposal.

A good review should make the box visible:

```text
Allowed:
- docs/Auto-Buildroom/examples/**
- tests/fixtures/auto-buildroom/**

Blocked:
- agents/**
- config.yml
- .env*
- data/**

Non-goals:
- no deploy
- no external API mutation
- no agent prompt changes
```

## Approving Work

Approve only a `main_review` ID:

```text
anthroclaw buildroom approve review_20260511_operator_summary_docs
```

Do not approve raw idea IDs.

Expected output:

```text
Approval created:
approval_20260511_operator_summary_docs

Approved by:
cli:user:local-operator

Important:
Approval grants authority.
Build consumes authority.
Approval did not start a build.
```

After approval, status should show:

```text
Approved not built: 1
Active builds: 0
```

There should be no `coder_receipt` yet.

If a build starts immediately from approval, that is a safety bug for v0.1.

## Rejecting Or Parking Work

Reject when the proposed work should not proceed:

```text
anthroclaw buildroom reject <id>
```

Good reasons to reject:

- scope is too broad;
- evidence is weak;
- target files are unsafe;
- proposal belongs outside v0.1;
- work duplicates another active chain;
- operator does not understand why it matters.

Rejecting should create a durable decision or transition. It should not delete the evidence chain.

If the idea is useful but scope or evidence is incomplete, prefer rejecting with a clear reason or requesting a narrower follow-up. Do not approve vague work just to see what happens.

Use rejection language that helps future review:

```text
Rejected: scope includes agents/** and config.yml. Rework as docs-only proposal.
```

## Building

Build consumes approval:

```text
anthroclaw buildroom build approval_20260511_operator_summary_docs
```

Before Builder starts, Buildroom should:

- acquire a lock;
- resolve or create a build plan;
- prepare worktree/sandbox;
- run final pre-run policy checks;
- record baseline;
- cross the execution boundary by attempting native runtime start;
- consume approval atomically with that boundary.

If setup fails before the execution boundary, approval may remain unconsumed. If native runtime start was attempted, retry should be explicit.

During v0.1, repo mutation must go through native AnthroClaw Agent SDK runtime.

Builder should not:

- run outside approved scope;
- write blocked paths;
- call external mutating APIs;
- grant itself native runtime approvals;
- mark itself verified.

After build, expect:

```text
Coder receipt:
build_20260511_operator_summary_docs

Changed files:
- docs/Auto-Buildroom/examples/operator-summary.md
- tests/fixtures/auto-buildroom/operator-summary.fixture.json

Next:
anthroclaw buildroom qa build_20260511_operator_summary_docs
```

Operator-facing build IDs may use the `build_...` prefix even when the artifact type is `coder_receipt`.

Remember:

```text
Builder claims are not proof.
```

## Running QA

Run QA on the coder receipt:

```text
anthroclaw buildroom qa build_20260511_operator_summary_docs
```

QA should check:

- changed files;
- independent diff;
- allowed/blocked path policy;
- acceptance criteria;
- Builder claims;
- commands run or skipped;
- evidence for each claim.

QA can produce:

- `pass`;
- `pass_with_notes`;
- `fail`;
- `blocked`.

QA may inspect a path-violating build to document what happened, but path violation prevents clean trust.

QA should not mutate the repo except approved temp/cache outputs.

QA pass is evidence, not final trust. Trust Report decides the final state.

## Generating Trust

Generate Delta and Trust:

```text
anthroclaw buildroom trust build_20260511_operator_summary_docs
```

This should create:

- `verification_delta`;
- `trust_report`.

Verification Delta answers:

```text
What did Builder claim?
What did QA confirm?
What is rejected?
What is missing evidence?
What was out of scope?
```

Trust Report answers:

```text
What should the operator believe?
What remains risky?
What action is needed next?
```

## Reading Trust States

Stored trust values are lowercase. Reports may render uppercase.

### CLEAN

Meaning:

```text
The approved scope was built, QA confirmed the important claims, policy checks passed, and no critical evidence is missing.
```

Use carefully. `clean` is not allowed if:

- QA is missing;
- Delta is missing;
- high/critical claims lack evidence;
- critical safety/scope evidence is missing;
- path policy failed;
- unresolved error receipts exist;
- Builder is grading itself.

If `CLEAN` appears while QA, Delta, or critical evidence is missing, treat it as a bug. Pause the room and inspect/report the receipt chain before relying on the result.

### WATCH

Meaning:

```text
Useful work happened, but not everything is proven.
```

This is normal for v0.1 docs/test improvements.

Examples:

- docs update verified;
- fixture verified;
- production autonomous mode not tested;
- external side effects not tested.

`watch` is not a failure. It is honest trust.

### INVESTIGATE

Meaning:

```text
Something important is uncertain or rejected, and a human should inspect before relying on the result.
```

Common causes:

- rejected high claim;
- surprising diff;
- skipped important QA command;
- evidence mismatch;
- report looks inconsistent.

### BLOCKED

Meaning:

```text
Policy, safety, runtime, config, or evidence conditions prevent progress or clean trust.
```

Common causes:

- build without approval;
- path violation;
- missing critical safety evidence;
- invalid config;
- kill switch active;
- runtime approval request;
- unresolved error receipt;
- detected secret.

## Saving A Report

Render a report:

```text
anthroclaw buildroom report
```

Save an operator summary:

```text
anthroclaw buildroom report --save
```

The saved summary should include:

- trust state;
- what was proposed;
- who approved;
- what changed;
- what QA confirmed;
- what remains unproven;
- risks;
- next action;
- receipt IDs.

Reports explain artifacts. They are not the source of truth.

If a report disagrees with artifacts, regenerate the report and trust the artifacts.

## Inspecting Receipts

Use:

```text
anthroclaw buildroom show <id>
```

Common IDs:

```text
research_...
signal_...
idea_...
review_...
approval_...
plan_...
build_...
qa_...
delta_...
trust_...
summary_...
retention_...
```

Use receipts to answer:

- where did the task come from?
- what evidence supported it?
- who approved it?
- what scope was allowed?
- what did Builder claim?
- what did QA prove?
- what does Trust say?

If there is no receipt, treat the action as if it did not happen.

## Pausing And Resuming

Pause the room:

```text
anthroclaw buildroom pause
```

Pause should block new stages.

If a native runtime build is already active, pause is a soft stop unless the implementation also supports cancellation. Status should show whether an active run remains.

Resume:

```text
anthroclaw buildroom resume
```

Resume should not auto-start builds.

After resume, run:

```text
anthroclaw buildroom status
```

and decide the next command manually.

## Kill Switch

If configured:

```yaml
killSwitchActive: true
```

the Buildroom should block:

- scheduled stages;
- new builds;
- new autonomous steps;
- any command that starts execution.

Kill switch should not delete artifacts.

After disabling the kill switch, use `status` to decide what to resume. Do not expect builds to auto-start.

## Handling Common Problems

### Approval Required

Meaning:

```text
Build was requested before approval exists.
```

Action:

```text
anthroclaw buildroom show <review_id>
anthroclaw buildroom approve <review_id>
anthroclaw buildroom build <approval_id>
```

Do not approve if you have not inspected the scope.

### Missing Artifact

Meaning:

```text
The ID does not exist or the artifact chain is incomplete.
```

Action:

```text
anthroclaw buildroom status
anthroclaw buildroom show <known_parent_id>
```

If an expected receipt is missing, do not treat the stage as complete.

### Policy Blocked

Meaning:

```text
Requested or completed work violated policy.
```

Action:

- inspect the error receipt;
- inspect changed files;
- check allowed/blocked paths;
- decide whether to reject, revise scope, or create a new proposal.

Do not force clean trust through a policy block.

### Runtime Failed

Meaning:

```text
Native runtime could not complete the Builder or role run.
```

Action:

- inspect `error_receipt`;
- check whether approval was consumed;
- check whether retry requires explicit command;
- do not retry by changing scope silently.

Retries should reference prior approval and error receipt, or require new approval if scope changes.

### QA Failed

Meaning:

```text
The build did not satisfy QA, or QA could not verify important claims.
```

Action:

- read the QA report;
- read Verification Delta;
- check rejected or missing evidence;
- choose improve, reject, or investigate.

Do not interpret Builder's “done” as stronger than QA evidence.

### Trust Is WATCH

Meaning:

```text
Some useful result is proven, but not everything.
```

Action:

- read unproven items;
- decide if the result is enough for current use;
- create follow-up if important evidence is missing.

This is normal for v0.1.

### Trust Is BLOCKED

Meaning:

```text
There is a policy, safety, runtime, or evidence blocker.
```

Action:

- do not rely on the build as complete;
- inspect the blocker;
- fix config/policy/scope/runtime issue;
- run a new approved loop if needed.

## Telegram Operator Surface

Telegram is optional for CLI-only v0.1.

If enabled, use dedicated commands:

```text
/buildroom status
/buildroom show <id>
/buildroom approve <review_id>
/buildroom build <approval_id>
/buildroom report
```

Important:

- only configured operator users can approve;
- Telegram user ID is operator identity;
- chat/thread is route evidence, not identity;
- notification routes do not grant approval authority;
- replies like `yes`, `ok`, or `approve` do not create authority;
- forwarded approvals should be rejected.

If in doubt, use CLI. CLI is canonical for v0.1.

## What Not To Do

Do not:

- approve raw idea IDs;
- build raw review IDs;
- build ambiguous targets like `latest`;
- treat ordinary chat as approval;
- treat handoff as approval;
- grant broad scope because the idea sounds useful;
- let Builder verify itself;
- treat runtime success as trust;
- ignore missing QA;
- ignore path policy violations;
- delete receipts to clean up history;
- use Buildroom to mutate secrets, config, agents, deploys, or external systems in v0.1.

## Good Operator Habits

Use `status` often.

Read review scope before approval.

Prefer narrow scopes.

Reject vague proposals.

Treat `watch` as useful honesty.

Treat false `clean` as a bug.

Keep receipts.

Run the real-world E2E before trusting a new release.

## Quick Reference

First setup:

```text
anthroclaw buildroom init --room anthroclaw-core --operator cli:user:local-operator
anthroclaw buildroom status
```

Normal loop:

```text
anthroclaw buildroom collect
anthroclaw buildroom propose
anthroclaw buildroom review <idea_id>
anthroclaw buildroom show <review_id>
anthroclaw buildroom approve <review_id>
anthroclaw buildroom build <approval_id>
anthroclaw buildroom qa <build_id>
anthroclaw buildroom trust <build_id>
anthroclaw buildroom report --save
```

Safety:

```text
anthroclaw buildroom pause
anthroclaw buildroom resume
anthroclaw buildroom status
```

Inspect:

```text
anthroclaw buildroom show <id>
anthroclaw buildroom report
```

Decision commands:

```text
anthroclaw buildroom approve <review_id>
anthroclaw buildroom reject <id>
```

## Acceptance Criteria

This guide is good enough for v0.1 when an operator can use it to:

- initialize a Buildroom;
- understand status;
- create and inspect a proposal;
- approve only a reviewed scope;
- verify approval did not auto-build;
- run a scoped build;
- run QA;
- read Trust Report;
- save operator summary;
- inspect receipts;
- pause/resume safely;
- handle common blocked/error states;
- explain why Auto-Buildroom is not just another agent.
