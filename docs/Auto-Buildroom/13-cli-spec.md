# CLI Spec

Status: Draft

Purpose: define the `anthroclaw buildroom ...` command surface, command behavior, expected output, and JSON output modes.

## CLI Thesis

The CLI is the canonical v0.1 operator surface.

It must make the Buildroom loop explicit:

```text
inspect -> decide -> execute -> verify -> report
```

The CLI should never hide authority boundaries. In particular:

```text
Approval grants authority.
Build consumes authority.
Approval does not execute the build by itself.
```

## Command Group

Primary command group:

```text
anthroclaw buildroom <command>
```

Alias may be added later:

```text
anthroclaw br <command>
```

Do not require an alias for v0.1.

## v0.1 Commands

Required:

```text
anthroclaw buildroom init
anthroclaw buildroom status
anthroclaw buildroom collect
anthroclaw buildroom propose
anthroclaw buildroom review <idea_id>
anthroclaw buildroom show <id>
anthroclaw buildroom approve <review_id>
anthroclaw buildroom reject <id>
anthroclaw buildroom build <approval_id|build_plan_id>
anthroclaw buildroom qa <id>
anthroclaw buildroom trust <id>
anthroclaw buildroom report
anthroclaw buildroom retain <trust_id>
anthroclaw buildroom pause
anthroclaw buildroom resume
```

Recommended but optional for v0.1:

```text
anthroclaw buildroom doctor
anthroclaw buildroom validate
anthroclaw buildroom retry <id>
anthroclaw buildroom list
```

Deferred:

```text
anthroclaw buildroom cron
anthroclaw buildroom dashboard
anthroclaw buildroom archive
```

## Common Options

All commands should support:

```text
--room <roomId>
--root <path>
--json
--quiet
```

`--json` takes precedence over text formatting. `--quiet` suppresses non-error text, but must not suppress JSON output.

Commands that may write files should support:

```text
--dry-run
```

Commands that persist config should require explicit intent:

```text
--write
```

CLI flags must not silently persist config changes unless the command is explicitly a config-writing command.

Commands that start new stages must check mode, pause state, and kill switch before doing work. If execution is blocked by pause or kill switch, exit code should be `8`.

## Exit Codes

Recommended exit codes:

| Code | Meaning |
| --- | --- |
| `0` | success |
| `1` | general failure |
| `2` | invalid usage |
| `3` | invalid config |
| `4` | policy blocked |
| `5` | missing artifact |
| `6` | runtime failed |
| `7` | approval required |
| `8` | paused or kill switch active |

JSON output should include the same failure reason as text output.

## JSON Output Contract

When `--json` is used, command output should be machine-readable and stable.

Base shape:

```json
{
  "ok": true,
  "command": "status",
  "roomId": "anthroclaw-core",
  "state": {},
  "artifacts": [],
  "nextActions": []
}
```

Failure shape:

```json
{
  "ok": false,
  "command": "build",
  "roomId": "anthroclaw-core",
  "error": {
    "code": "approval_required",
    "message": "No approval artifact exists for idea_20260511_operator_summary_docs.",
    "nextActions": [
      "anthroclaw buildroom approve idea_20260511_operator_summary_docs"
    ]
  }
}
```

Never include unredacted secrets in JSON output.

## `init`

Purpose: create project-local Buildroom config and directory structure.

Command:

```text
anthroclaw buildroom init
```

Options:

```text
--room <roomId>
--root <path>
--operator <operatorId>
--yes
--dry-run
```

Default behavior:

- create `.anthroclaw/auto-buildroom/buildroom.yml`;
- create `.anthroclaw/auto-buildroom/rooms/<roomId>/`;
- create required artifact directories;
- create root-level `locks/`;
- create initial `state.json`;
- offer `.gitignore` entry for `.anthroclaw/auto-buildroom/`;
- default session watching to false;
- default external side effects to deny;
- default mode to `manual_approval`.

Operator default:

- interactive init should ask for an operator;
- non-interactive `--yes` should create `cli:user:local-operator`;
- `--operator <operatorId>` should use the explicit operator.

Expected output:

```text
Buildroom initialized

Room: anthroclaw-core
Root: .anthroclaw/auto-buildroom/rooms/anthroclaw-core
Mode: manual_approval
Session watching: off
External side effects: denied

Next:
anthroclaw buildroom collect
```

If config already exists, `init` should not overwrite without explicit confirmation.

## `status`

Purpose: show current room state.

Command:

```text
anthroclaw buildroom status
```

Expected output:

```text
Buildroom: anthroclaw-core
Mode: manual_approval
Room state: approved
Latest trust: watch

Pending approvals: 0
Approved not built: 1
Active builds: 0
QA pending: 0

Next action:
Run build for idea_20260511_operator_summary_docs
```

Status should include config validation blockers:

```text
Buildroom blocked

Reason:
invalid_config

Details:
manual_approval requires at least one operator
```

## `collect`

Purpose: create research inputs and/or research packet from configured sources.

Command:

```text
anthroclaw buildroom collect
```

Allowed in modes:

```text
observe_only
manual_approval
```

Outputs:

- `session_summary` artifacts if session watching is enabled;
- `research_packet` artifact;
- `error_receipt` on failure.

Expected output:

```text
Collected signals

Research packet:
research_20260511_operator_summary

Sources:
- repo
- docs
- tests

Next:
anthroclaw buildroom propose
```

Raw transcripts must not be collected by default.

## `propose`

Purpose: produce one or more idea contracts from research.

Command:

```text
anthroclaw buildroom propose
```

Options:

```text
--from <research_id>
--limit <n>
```

Outputs:

- `idea_contract`.

Expected output:

```text
Proposal ready

Idea:
idea_20260511_operator_summary_docs

Title:
Improve operator summary docs/test/example

Risk: low

Next:
anthroclaw buildroom review idea_20260511_operator_summary_docs
```

`propose` must not hide review or approval. It may recommend review as the next action, but `main_review` should be created by `review`.

## `review <idea_id>`

Purpose: convert an idea into a bounded Main Review.

Command:

```text
anthroclaw buildroom review <idea_id>
```

Requirements:

- target is an `idea_contract`;
- idea has required parents;
- Main Review role/run differs from Dreamer where applicable;
- review defines allowed paths, blocked paths, non-goals, risk, and acceptance criteria.

Outputs:

- `main_review`.

Expected output:

```text
Review completed

Idea:
idea_20260511_operator_summary_docs

Main review:
review_20260511_operator_summary_docs

Decision:
approved_for_operator

Scope:
- docs/**
- tests/**

Next:
anthroclaw buildroom show review_20260511_operator_summary_docs
anthroclaw buildroom approve review_20260511_operator_summary_docs
```

## `show <id>`

Purpose: render an artifact by ID.

Command:

```text
anthroclaw buildroom show <id>
```

Behavior:

```text
show idea_*      -> proposal view
show approval_*  -> approval receipt
show build_*     -> build result and changed files
show qa_*        -> QA evidence
show delta_*     -> verification delta
show trust_*     -> final trust report
```

If artifact is missing:

```text
Receipt not found

ID:
idea_20260511_operator_summary_docs

Next:
anthroclaw buildroom status
anthroclaw buildroom report
```

Exit code: `5`.

## `approve <review_id>`

Purpose: create approval artifact for a reviewed proposal.

Command:

```text
anthroclaw buildroom approve <review_id>
```

Options:

```text
--reason <text>
--operator <operatorId>
--yes
```

Requirements:

- target resolves to `main_review` with `decision: approved_for_operator`;
- operator identity is configured;
- approval route is CLI;
- allowed/blocked paths are present;
- Buildroom is not paused/killed.

Expected output:

```text
Approved

Review: review_20260511_operator_summary_docs
Approval: approval_20260511_operator_summary_docs
Approved by: cli:user:local-operator
Approval route: cli:local
Approved scope:
- docs/**
- tests/**

Important:
Approval does not execute the build.

Next:
anthroclaw buildroom build approval_20260511_operator_summary_docs
```

`approve` must not start Builder.

`approve` should not accept raw `idea_contract` IDs in v0.1. If a future UX accepts an idea ID, it must resolve to exactly one `main_review` and print the resolved review ID before confirmation.

## `reject <id>`

Purpose: reject or park a proposal.

Command:

```text
anthroclaw buildroom reject <id>
```

Options:

```text
--reason <text>
--park
```

Requirements:

- operator identity is configured;
- command route is allowed;
- target is a proposal, review, or pending approval;

Expected output:

```text
Rejected

Target: idea_20260511_operator_summary_docs
Reason: Not the right v0.1 scope.

Next:
anthroclaw buildroom status
```

Rejecting should create an `operator_decision` artifact with:

- decision: `reject`;
- target artifact ID and type;
- operator identity;
- decision route;
- timestamp.

It must not delete the proposal.

A rejected `main_review` must not be approved later unless a new review supersedes it through the normal artifact chain.

## `build <approval_id|build_plan_id>`

Purpose: start Builder using an approval/build plan.

Command:

```text
anthroclaw buildroom build <approval_id|build_plan_id>
```

Accepted IDs:

- approval ID;
- build plan ID.

Do not accept raw idea IDs for build in v0.1. Build should make authority consumption explicit.

Requirements:

- approval exists;
- approval is unexpired and unrevoked;
- approval has not already been consumed by a different build plan;
- build plan exists or can be created from approved review;
- lock acquired for `roomId + approvalId + buildPlanId`;
- Buildroom is not paused/killed;
- pre-run policy passes.

Expected output:

```text
Build started

Build: build_20260511_operator_summary_docs
Approval: approval_20260511_operator_summary_docs
Runtime: run_20260511_operator_summary_docs

Scope:
- docs/**
- tests/**

Blocked:
- .env
- config.yml
- agents/**

Next:
anthroclaw buildroom status
```

If approval is missing:

```text
Build blocked

Reason:
No approval artifact exists for idea_20260511_operator_summary_docs.

Next:
anthroclaw buildroom approve idea_20260511_operator_summary_docs
```

Exit code: `7`.

If duplicate start:

```text
Build already running

Existing run:
run_20260511_operator_summary_docs
```

Do not create a second Builder run.

## `qa <id>`

Purpose: run independent QA for a build/coder receipt.

Command:

```text
anthroclaw buildroom qa <id>
```

Accepted IDs:

- build ID;
- coder receipt ID.

Requirements:

- `coder_receipt` exists;
- QA role/run differs from Builder;
- changed files and claims are available.

Expected output:

```text
QA completed

QA report:
qa_20260511_operator_summary_docs

Status:
pass_with_notes

Confirmed:
- approved paths respected
- operator summary docs updated

Missing evidence:
- Telegram rendering not tested

Next:
anthroclaw buildroom trust build_20260511_operator_summary_docs
```

QA may run on a path-violating `coder_receipt` to document evidence, but trust cannot become `clean` until the violation is resolved.

## `trust <id>`

Purpose: generate Verification Delta and Trust Report.

Command:

```text
anthroclaw buildroom trust <id>
```

Accepted IDs:

- build ID;
- coder receipt ID;
- QA report ID.

Outputs:

- `verification_delta`;
- `trust_report`.

If a matching `verification_delta` already exists for the same coder receipt and QA report, `trust` should reuse it or supersede deterministically. It must not create duplicate conflicting trust reports.

Expected output:

```text
Trust: WATCH

Trust report:
trust_20260511_operator_summary_docs

Confirmed:
- approved paths respected
- docs updated

Unconfirmed:
- Telegram rendering behavior

Next:
anthroclaw buildroom report
```

`trust.clean` must be blocked if QA is missing, critical evidence is missing, critical claims are rejected, or unresolved errors exist.

## `report`

Purpose: render latest operator report.

Command:

```text
anthroclaw buildroom report
```

Options:

```text
--format markdown|json|html
--output <path>
--save
```

Default: render from existing artifacts without creating a new artifact.

`--save` writes an `operator_summary` artifact/rendering.

Expected sections:

- Buildroom;
- current state;
- pending approvals;
- approved not built;
- latest work;
- evidence;
- approved scope;
- changed files;
- QA result;
- Verification Delta;
- Trust state;
- operator action needed;
- receipt chain.

## `pause`

Purpose: prevent new execution.

Command:

```text
anthroclaw buildroom pause
```

Requirements:

- operator identity is configured;
- command route is allowed.

Expected output:

```text
Buildroom paused

New build execution is disabled.
Status, show, and report remain available.
Active runtime is not cancelled automatically.
```

Pause should not delete artifacts or auto-cancel runtime.

## `resume`

Purpose: leave paused state.

Command:

```text
anthroclaw buildroom resume
```

Requirements:

- operator identity is configured;
- command route is allowed.

Expected output:

```text
Buildroom resumed

No pending build was started automatically.

Next:
anthroclaw buildroom status
```

Resume must not auto-run approved-not-built items.

## `retry <id>` Optional

Purpose: retry a failed stage with explicit operator action.

Command:

```text
anthroclaw buildroom retry <error_receipt_id>
```

Requirements:

- target is recoverable `error_receipt`;
- scope unchanged;
- approval not expired/revoked;
- retry policy allows;
- operator command is explicit.

If not implemented in v0.1, retry should be documented as manual re-run with new approval or explicit command later.

## `validate` Optional

Purpose: validate config and artifact store.

Command:

```text
anthroclaw buildroom validate
```

Checks:

- config schema;
- directory structure;
- artifact schema validation;
- content hashes;
- missing parents;
- invalid approvals;
- unresolved errors.

## `doctor` Optional

Purpose: diagnose room problems and suggest repairs.

Command:

```text
anthroclaw buildroom doctor
```

`doctor` must be read-only by default.

## Command Safety Matrix

| Command | Writes artifacts | Can mutate repo | Requires approval |
| --- | --- | --- | --- |
| `init` | yes | no | no |
| `status` | no | no | no |
| `collect` | yes | no | no |
| `propose` | yes | no | no |
| `review` | yes | no | no |
| `show` | no | no | no |
| `approve` | yes | no | operator identity |
| `reject` | yes | no | operator identity |
| `build` | yes | yes | approval artifact |
| `qa` | yes | no | build/coder receipt |
| `trust` | yes | no | QA report |
| `report` | no by default; yes with `--save` | no | no |
| `retain` | yes | no | trust report |
| `pause` | yes | no | operator identity |
| `resume` | yes | no | operator identity |
| `validate` | no | no | no |
| `doctor` | no | no | no |

## v0.1 Real-World Flow

Canonical CLI flow:

```text
anthroclaw buildroom init
anthroclaw buildroom collect
anthroclaw buildroom propose
anthroclaw buildroom show <idea_id>
anthroclaw buildroom review <idea_id>
anthroclaw buildroom show <review_id>
anthroclaw buildroom approve <review_id>
anthroclaw buildroom build <approval_id>
anthroclaw buildroom qa <build_id>
anthroclaw buildroom trust <build_id>
anthroclaw buildroom report
anthroclaw buildroom retain <trust_id>
```

The safe demo target:

```text
Improve AnthroClaw operator summary documentation/test/example.
```

## Acceptance Criteria

CLI spec is good enough for v0.1 when:

- `init` creates config and required storage;
- `status` shows room state, trust, pending approvals, approved-not-built;
- `show <id>` auto-detects artifact type;
- `review <idea_id>` creates a visible `main_review`;
- `approve` creates approval but does not build;
- `approve` targets `main_review`, not raw idea, in v0.1;
- `build` is blocked without approval;
- `build` does not accept raw idea IDs in v0.1;
- `build` uses idempotency lock and avoids duplicate Builder runs;
- `qa` cannot run without coder receipt;
- `trust.clean` cannot be produced without QA evidence;
- `report` renders receipt chain;
- `report` is read-only by default and writes only with `--save`;
- `retain` creates a `retention_review` recommendation and does not delete audit receipts;
- `pause` prevents new build execution;
- `resume` does not auto-run pending work;
- all failure outputs include reason and next action;
- `--json` output is available for status/show/report and failures.
