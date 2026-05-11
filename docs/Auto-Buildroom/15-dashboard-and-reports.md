# Dashboard And Reports

Status: Draft

Purpose: define Markdown, HTML, Telegram, and future web dashboard reporting surfaces for operator visibility.

## Reporting Thesis

Reports are views over receipts.

They should help the operator answer:

- what happened;
- why it happened;
- who approved it;
- what changed;
- what QA confirmed;
- what is still unproven;
- what trust state applies;
- what action is needed next.

Reports must not become a second source of truth.

```text
Artifacts are truth.
Reports explain artifacts.
Dashboards navigate artifacts.
```

If a report disagrees with durable artifacts, the artifacts win and the report should be regenerated.

## v0.1 Scope

v0.1 should not require a full web dashboard.

Required reporting surfaces:

- CLI status and report output;
- Telegram status/report messages;
- Markdown operator summary files;
- durable `operator_summary` artifacts that record what was rendered and from which receipts.

Deferred surfaces:

- live web dashboard;
- multi-room portfolio view;
- charts and historical analytics;
- interactive approval UI;
- team role management;
- enterprise audit console.

The v0.1 goal is simple:

```text
An operator can understand a full Buildroom run without reading raw JSON.
```

## Source Of Truth Boundary

Canonical source of truth:

- durable artifact JSON files;
- transition logs;
- lock records;
- error receipts;
- Buildroom config.

Durable renderings:

- `operator_summary` artifacts;
- Markdown reports;
- HTML reports.

Durable rendering does not mean canonical truth. It means the rendering may be stored for audit and convenience, and can be regenerated or superseded.

Non-canonical renderings:

- Telegram messages;
- CLI text output;
- dashboard cards;
- copied report excerpts.

Rules:

- rendered reports must reference the artifact IDs they summarize;
- rendered reports must include `renderedFromIds`;
- rendered reports must not invent trust state;
- dashboard state must be derived from artifacts or derived indexes;
- indexes may speed up reporting but must be rebuildable.

## Report Types

### Status Report

Purpose: show current room state and next action.

Used by:

```text
anthroclaw buildroom status
/buildroom status
future dashboard header
```

Minimum fields:

- room ID;
- mode;
- room state;
- latest trust state;
- latest completed run;
- paused state;
- kill switch state;
- config validity or config blocker;
- pending approvals;
- approved not built;
- active builds;
- QA pending;
- blocked state and reason;
- next action.

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

Status should describe the highest-priority active or pending workflow. It should also show the latest completed run separately so perpetual collection does not hide the last trusted result.

### Proposal Report

Purpose: let the operator decide whether the Buildroom should receive authority.

Minimum fields:

- idea ID;
- review ID;
- short title;
- problem;
- evidence summary;
- proposed scope;
- allowed paths;
- blocked paths;
- non-goals;
- risks;
- acceptance criteria;
- required approval command.

Example:

```text
Proposal ready

Review:
review_20260511_operator_summary_docs

Idea:
Improve operator summary docs/test/example.

Evidence:
- operator cannot quickly see what happened and what remains unproven
- reporting contract is referenced by artifact model but not specified

Allowed scope:
- docs/Auto-Buildroom/15-dashboard-and-reports.md

Non-goals:
- no web dashboard implementation
- no runtime changes

Next:
anthroclaw buildroom approve review_20260511_operator_summary_docs
```

### Build Report

Purpose: show what Builder claims it changed.

Minimum fields:

- build ID;
- approval ID;
- build plan ID;
- runtime result;
- changed files;
- commands run;
- Builder claims;
- known limitations;
- pre-run policy result;
- post-run policy result;
- QA status or next QA command.

Build reports must clearly say:

```text
Builder claims are not proof.
```

### QA Report

Purpose: show independent verification.

Minimum fields:

- QA report ID;
- build ID;
- files inspected;
- commands run;
- confirmed claims;
- rejected claims;
- missing evidence;
- scope violations;
- risks;
- QA result;
- next trust command.

QA reports should not use marketing language. They should read like an audit note.

### Verification Delta Report

Purpose: compare Builder claims with QA evidence.

Minimum fields:

- delta ID;
- Builder claim;
- QA finding;
- result: `confirmed`, `rejected`, `missing_evidence`, or `not_in_scope`;
- criticality;
- trust impact.

Example:

```text
Verification Delta

Claim:
Added dashboard/reporting spec.

QA:
confirmed

Claim:
Web dashboard is ready.

QA:
missing evidence

Trust impact:
WATCH
```

### Trust Report

Purpose: tell the operator what to believe.

Minimum fields:

- trust report ID;
- trust state;
- what is confirmed;
- what is not confirmed;
- unresolved risks;
- human action needed;
- receipts;
- retention suggestion if available.

Trust states:

```text
CLEAN
WATCH
INVESTIGATE
BLOCKED
```

Rules:

- `CLEAN` requires QA evidence and no high/critical unresolved issues;
- `WATCH` means useful but not fully proven;
- `INVESTIGATE` means claims or behavior need deeper review;
- `BLOCKED` means policy, scope, runtime, or safety prevents progress.

Trust report example:

```text
Trust: WATCH

Confirmed:
- artifact chain is complete
- QA confirmed the docs-only scope
- no path policy violation found

Not confirmed:
- no live dashboard tested

Risks:
- Telegram rendering still needs implementation test

Action:
approve next phase or leave as docs-only

Receipts:
- trust_20260511_operator_summary_docs
- delta_20260511_operator_summary_docs
- qa_20260511_operator_summary_docs
```

## Operator Summary Artifact

`operator_summary` is a durable rendering record.

It should include:

- summary ID;
- report type;
- room ID;
- trace ID;
- rendered format;
- rendered path if saved;
- renderedFromIds;
- generatedAt;
- generatedBy;
- trust state at render time;
- content hash;
- redaction status.

Example using the common artifact envelope:

```yaml
id: summary_20260511_operator_summary_docs
type: operator_summary
schemaVersion: auto-buildroom/v1
status: generated
createdAt: 2026-05-11T12:00:00Z
producer:
  role: reporter
  runId: run_20260511_reporter
room:
  id: anthroclaw-core
parentIds:
  - trust_20260511_operator_summary_docs
inputRefs:
  - kind: artifact
    ref: trust_20260511_operator_summary_docs
outputRefs:
  - kind: file
    ref: .anthroclaw/auto-buildroom/rooms/anthroclaw-core/buildroom/operator/reports/summary_20260511_operator_summary_docs.md
traceId: trace_20260511_operator_summary_docs
redaction:
  rawTranscriptsIncluded: false
  secretsRedacted: true
  redactedFields: []
contentHash: sha256:...
payload:
  reportType: trust
  format: markdown
  renderedPath: .anthroclaw/auto-buildroom/rooms/anthroclaw-core/buildroom/operator/reports/summary_20260511_operator_summary_docs.md
  renderedFromIds:
    - trust_20260511_operator_summary_docs
    - delta_20260511_operator_summary_docs
    - qa_20260511_operator_summary_docs
  generatedBy: reporter
  rendererVersion: auto-buildroom-reporter/v1
  templateVersion: operator-summary/v1
  trustStateAtRenderTime: watch
```

The Markdown file is a rendering. The `operator_summary` artifact records that the rendering happened.

## Markdown Reports

Markdown is the canonical saved human-readable format for v0.1.

Recommended location:

```text
.anthroclaw/auto-buildroom/rooms/<roomId>/buildroom/operator/reports/
```

Recommended filename:

```text
summary_<YYYYMMDD>_<slug>.md
```

Recommended operator layout:

```text
buildroom/operator/
  artifacts/
    summary_<YYYYMMDD>_<slug>.json
  reports/
    summary_<YYYYMMDD>_<slug>.md
```

If an implementation keeps JSON and Markdown in one directory, it must use distinct extensions and preserve the source-of-truth boundary.

Required sections:

```text
# Buildroom Report

Status
Decision Needed
What Happened
Evidence
Scope
Build Result
QA Result
Verification Delta
Trust
Risks
Receipts
Next Action
```

Rules:

- put trust state near the top;
- include exact artifact IDs;
- include approval identity and route;
- include changed files when a build occurred;
- include rejected or missing claims, not only confirmed claims;
- avoid raw JSON unless the operator explicitly requests it;
- do not include secrets, raw private transcripts, or unredacted runtime logs.

## Telegram Reports

Telegram reports are compact renderings of the same artifact chain.

Rules:

- no Markdown tables;
- trust state near the top;
- one message should stay under roughly 3000 characters;
- split long reports into numbered parts;
- include copyable artifact IDs;
- include one clear next command;
- notification messages are not receipts;
- notification routes do not grant authority;
- next actions must use exact `/buildroom ...` commands and artifact IDs;
- reports must not imply that replying `yes` is sufficient.

Telegram report shape:

```text
Trust: WATCH
Room: anthroclaw-core

What happened:
Docs-only reporting spec was updated.

Confirmed:
- QA confirmed expected file changed
- no blocked path touched

Missing:
- no dashboard implementation exists

Next:
/buildroom show trust_20260511_operator_summary_docs
```

## HTML Reports

HTML reports are optional in v0.1.

If generated, they should be static files derived from artifacts.

Allowed:

- static local HTML report;
- links to local Markdown/operator summary files;
- receipt IDs and artifact paths;
- collapsible evidence sections.

Not allowed in v0.1:

- HTML report as approval surface;
- HTML report mutating Buildroom state;
- external network calls by default;
- embedding raw runtime logs;
- embedding raw private transcripts.

HTML reports should be treated as durable renderings, not canonical truth.

## Future Dashboard

The future dashboard should be a cockpit, not a chat replacement.

Primary dashboard views:

1. Room Overview
2. Signals And Proposals
3. Pending Approvals
4. Approved Not Built
5. Active Builds
6. QA And Verification
7. Trust Reports
8. Receipts
9. Retention
10. Settings And Safety

The first screen should answer:

```text
What needs my decision?
What is running?
What can I trust?
What is blocked?
```

Dashboard cards should be derived from artifacts:

| Card | Source |
| --- | --- |
| Pending approvals | `main_review`, `approval` |
| Approved not built | `approval`, `build_plan` |
| Active builds | `build_plan`, runtime refs, locks |
| QA pending | `coder_receipt`, `qa_report` |
| Trust state | `verification_delta`, `trust_report` |
| Blocked state | `error_receipt`, transitions |

## Dashboard Authority Rules

The dashboard may become an operator surface later, but v0.1 does not require it.

If a dashboard is added:

- approval must still create an `approval` artifact;
- build must still consume an approval;
- operator identity must be verified;
- route/session identity must not be treated as authority;
- every write action must match CLI/Telegram policy;
- read-only dashboard access must not imply approval rights;
- dashboard buttons must show exact target artifact IDs before mutation.

For v0.1:

```text
Dashboard is read-only or deferred.
CLI remains canonical.
Telegram is the first remote operator surface.
```

## Report Regeneration

Reports should be regenerable from artifacts.

Regeneration should:

- read canonical artifact files;
- verify content hashes where available;
- rebuild derived indexes if needed;
- produce semantically equivalent report content for the same artifact chain, though formatting may change with renderer versions;
- mark regenerated reports as regenerated renderings, not new decisions.

If an old report cannot be regenerated because artifacts are missing:

```text
Status: INVESTIGATE
Reason: report references missing artifacts
```

## Redaction Rules

Reports must be redacted before persistence or delivery.

Do not render:

- API keys;
- Telegram bot tokens;
- OAuth refresh tokens;
- raw private chat transcripts;
- raw runtime event streams;
- `.env` contents;
- credentials from config files;
- personal data beyond configured operator identity.

Reports may render:

- sanitized excerpts;
- artifact IDs;
- file paths inside allowed scope;
- redacted error summaries;
- content hashes;
- command names without secret arguments.

If redaction fails, report generation should create an `error_receipt` and fail closed.

## Failure Reporting

Failures should be visible and actionable.

Failure reports should include:

- failed stage;
- target artifact;
- error receipt ID;
- whether a durable error receipt exists;
- block scope: `job` or `room`;
- recoverability;
- retry policy;
- next action.

Example:

```text
Status: BLOCKED

Stage:
Builder

Reason:
post-run path policy violation

Error receipt:
error_20260511_path_policy

Block scope:
job

Next:
inspect changed files and reject, revert, or create a narrower follow-up
```

## Daily And Weekly Digests

Digests are optional for v0.1.

If added, they should summarize:

- new signals;
- proposals created;
- approvals granted;
- builds completed;
- QA failures;
- trust states;
- blocked items;
- retention suggestions.

Digest rules:

- no new authority from digest text;
- include exact commands for next action;
- include links or IDs for receipts;
- show `WATCH`, `INVESTIGATE`, and `BLOCKED` items before `CLEAN` items;
- do not bury pending approvals.

## Acceptance Criteria

Dashboard and reports are good enough for v0.1 when:

- CLI and Telegram can show status without raw JSON;
- `report` can render a complete operator summary from artifacts;
- saved reports include `renderedFromIds`;
- trust state is derived from QA and delta, not Builder claims;
- reports include both confirmed and unconfirmed claims;
- approval identity and route appear in build/trust reports;
- changed files appear when a build occurred;
- missing artifacts produce `INVESTIGATE`, not silent success;
- redaction failure blocks report generation;
- Telegram reports fit within message constraints;
- future dashboard is clearly read-only/deferred unless implemented with the same authority rules.
