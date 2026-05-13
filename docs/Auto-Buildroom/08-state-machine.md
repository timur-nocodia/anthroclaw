# State Machine

Status: Draft

Purpose: define artifact states, allowed transitions, forbidden transitions, and how buildroom jobs move through the system.

## State Machine Thesis

The Buildroom state machine protects the boundary between initiative and permission.

It must make these transitions impossible:

```text
idea -> build without review
review -> build without approval
approval -> implicit execution
builder claim -> trust.clean without QA
failure -> silent disappearance
```

State exists at two levels:

1. Room/job lifecycle state: what the operator sees.
2. Artifact state: what each receipt or contract can do next.

The operator-facing state should be simple. The artifact-level state should be strict.

Room state describes the highest-priority active or pending workflow. It should not be the only status shown to the operator. Operator surfaces should also show:

- latest completed run;
- latest trust state;
- pending approval count;
- approved-not-built count;
- active runtime, if any.

Example:

```yaml
roomState: collecting
latestCompletedRun: run_20260511_operator_summary_docs
latestRunTrust: watch
approvedNotBuilt: 0
activeRun: null
```

## v0.1 Room Lifecycle

User-facing lifecycle states:

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

### idle

No active proposal, build, QA, or pending decision.

Allowed next states:

```text
collecting
paused
```

### collecting

Research or signal collection is running.

Allowed next states:

```text
proposal_ready
idle
blocked
paused
```

### proposal_ready

An idea or review exists and can be shown to the operator.

Allowed next states:

```text
awaiting_approval
idle
blocked
paused
```

### awaiting_approval

A bounded proposal exists, but no approval artifact has been granted.

Allowed next states:

```text
approved
idle
blocked
paused
```

### approved

An approval artifact exists, but no build has consumed it yet.

This corresponds to the Operator UX state:

```text
Approved not built
```

Allowed next states:

```text
building
blocked
paused
```

Important:

```text
Approval grants authority.
Build consumes authority.
Approval does not execute the build by itself.
```

Leaving `approved` without starting a build requires a resolution artifact such as `approval.revoked`, `approval.expired`, or `build_plan.cancelled`.

The room must not silently hide approved-but-unbuilt authority.

### building

Builder is running under an approved scope.

Allowed next states:

```text
qa_pending
blocked
paused
```

If Builder fails before producing `coder_receipt`, create `error_receipt` and move to `blocked`.

### qa_pending

A `coder_receipt` exists and requires independent QA.

Allowed next states:

```text
trust_pending
blocked
paused
```

### trust_pending

QA exists and Verification Delta or Trust Report must be generated.

Allowed next states:

```text
complete
blocked
paused
```

### complete

A trust report exists.

`complete` does not mean `clean`.

Possible trust outcomes:

```text
clean
watch
investigate
blocked
```

Allowed next states:

```text
idle
collecting
paused
```

### blocked

The workflow cannot safely proceed.

Common causes:

- missing approval;
- missing parent artifact;
- path violation;
- rejected critical QA claim;
- runtime failure;
- policy violation;
- corrupted artifact hash;
- failed redaction.

Allowed next states:

```text
idle
collecting
paused
```

Leaving `blocked` requires an operator-visible resolution artifact or error receipt.

Blocked state should record `blockScope`.

Allowed values:

```text
job
room
```

`job` means the current chain cannot proceed, but other research may continue.

`room` means no new autonomous stages may run until resolved.

### paused

Buildroom is in read-only or no-new-execution mode.

Allowed while paused:

- status;
- show;
- report;
- artifact inspection.

Blocked while paused:

- new build execution;
- autonomous scheduled stages;
- approval-consuming build runs.

Pause is a soft pause. Pausing while building prevents new stages, but it does not automatically cancel the active native runtime unless the operator explicitly requests cancellation.

If paused while a runtime is active, operator surfaces should show:

```yaml
roomState: paused
activeRun: run_...
activeRunState: building
```

Resume returns to the previous safe state, but must not automatically execute pending builds.

## Room Lifecycle Transitions

Recommended transition table:

| From | To | Required artifact or condition |
| --- | --- | --- |
| `idle` | `collecting` | collect command or scheduled research |
| `collecting` | `proposal_ready` | `research_packet` and `idea_contract` |
| `proposal_ready` | `awaiting_approval` | `main_review` with `decision: approved_for_operator` |
| `awaiting_approval` | `approved` | `approval` artifact |
| `approved` | `building` | `build_plan` plus unconsumed `approval` |
| `building` | `qa_pending` | `coder_receipt` |
| `building` | `blocked` | `error_receipt` or policy violation |
| `qa_pending` | `trust_pending` | `qa_report` |
| `trust_pending` | `complete` | `verification_delta` and `trust_report` |
| any active state | `blocked` | policy violation, runtime failure, missing parent, corrupted artifact |
| any state | `paused` | operator pause |
| `paused` | previous safe state | operator resume |

## Artifact State Machines

### session_summary

```text
created -> redacted -> consumed
created -> rejected
redacted -> rejected
```

Rules:

- raw transcripts are not included by default;
- session summary cannot approve work;
- rejected summaries cannot become research inputs.

### handoff_signal

```text
submitted -> accepted -> consumed
submitted -> rejected
accepted -> rejected
```

Rules:

- handoff is not approval;
- handoff must come through controlled tool path;
- handoff cannot grant build authority.

### research_packet

```text
collected -> summarized -> consumed
collected -> rejected
summarized -> archived
```

Rules:

- Research may create evidence and claims;
- Research cannot approve, build, QA, or trust its own findings.

### signal

```text
watching -> ready -> queued -> consumed
watching -> parked
ready -> rejected
queued -> rejected
```

Rules:

- signal is not a task;
- queued signal still requires review and approval before build.

### idea_contract

```text
proposed -> ready_for_review
ready_for_review -> approved_by_review
ready_for_review -> rejected
ready_for_review -> needs_more_research
ready_for_review -> parked
```

Rules:

- idea cannot become approval directly;
- Dreamer cannot approve its own idea;
- approved_by_review means ready for operator approval path, not build authority.

### main_review

```text
drafted -> approved_for_operator
drafted -> rejected
drafted -> needs_more_research
drafted -> parked
```

Rules:

- approved review must lock scope;
- approved review must include allowed paths and blocked paths;
- approved review is required before approval artifact.

### approval

```text
granted -> consumed
granted -> revoked
granted -> expired
```

Rules:

- approval must target `main_review` with `decision: approved_for_operator`;
- approval must record operator identity and route;
- consumed approval cannot be reused for a different scope;
- revoked or expired approval cannot start a build.

### build_plan

```text
drafted -> ready
ready -> superseded
ready -> blocked
ready -> cancelled
```

Rules:

- build plan describes intended work only;
- execution state belongs to `coder_receipt` or `error_receipt`;
- build plan cannot be ready without approval and locked scope.

### coder_receipt

```text
submitted -> qa_pending -> qa_checked
submitted -> rejected
qa_pending -> rejected
```

Rules:

- Builder claims are not proof;
- receipt must include pre-run and post-run policy results;
- path violations block trust progression;
- Builder cannot write QA, Delta, or Trust artifacts.

### qa_report

```text
submitted -> delta_pending -> consumed
submitted -> blocked
```

Rules:

- QA must be produced by a different role/run than Builder;
- QA may confirm, reject, or mark missing evidence;
- QA cannot silently expand scope or approve new work.

For room lifecycle, creating `qa_report` moves the workflow from `qa_pending` to `trust_pending`. Verification Delta is produced inside `trust_pending`.

### verification_delta

```text
generated -> trust_pending -> consumed
```

Rules:

- every Builder claim should be classified;
- allowed classifications:

```text
confirmed
rejected
missing_evidence
not_in_scope
```

- missing high/critical evidence prevents `trust.clean`;
- rejected high/critical claim requires `trust.investigate` or `trust.blocked`.

### trust_report

Terminal trust states:

```text
clean
watch
investigate
blocked
```

Rules:

- trust is derived from QA and Verification Delta;
- Trust cannot mark `clean` if critical evidence is missing;
- Trust cannot alter build artifacts;
- Trust must explain operator action needed when not `clean`.

### retention_review

```text
keep
improve
park
prune_recommended
ghost
reopen
```

Rules:

- Retention recommends;
- destructive cleanup requires explicit policy;
- retention cannot erase audit receipts.

### error_receipt

```text
recorded -> retry_pending
recorded -> resolved
recorded -> archived
retry_pending -> resolved
retry_pending -> archived
```

Rules:

- failed stage must leave an error receipt unless artifact storage is unavailable;
- error message must be redacted;
- retry must not bypass missing approval or policy failures.

### operator_summary

```text
generated -> superseded
generated -> archived
```

Rules:

- operator summary renders artifacts;
- it is not source of truth;
- it must include `renderedFromIds`.

## Forbidden Transitions

These transitions must fail closed:

```text
idea_contract.proposed -> approval.granted
idea_contract.proposed -> build_plan.ready
main_review.approved_for_operator -> build_plan.ready without approval
approval.granted -> building without build_plan
approval.revoked -> building
approval.expired -> building
build_plan.ready -> trust_report.clean
coder_receipt.submitted -> trust_report.clean
coder_receipt.submitted -> qa_report.submitted by Builder
qa_report.submitted -> trust_report.clean with rejected high/critical claim
verification_delta with missing high/critical evidence -> trust_report.clean
verification_delta with scope violation -> trust_report.clean
coder_receipt with postRunPolicyResult.violations -> trust_report.clean
verification_delta.overall=watch -> trust_report.clean
error_receipt.recorded -> trust_report.clean without resolution
unresolved error_receipt -> complete.clean
operator_summary.generated -> approval.granted
paused -> building without explicit resume and start command
```

## Authority Consumption

Approval creates authority; build consumes it.

For v0.1:

- approval does not automatically execute build;
- build must reference one approval artifact;
- approval is consumed when the first build attempt starts;
- a consumed approval cannot authorize a different build plan;
- if scope changes, a new review and approval are required.

Recommended strict default:

```text
one approval -> one build plan -> one build attempt
```

Retries after runtime failure may reuse authority only if:

- the scope is unchanged;
- the approval has not expired or been revoked;
- the retry is recorded;
- the retry does not bypass policy checks.

For v0.1, a retry must reference the consumed approval and the previous `error_receipt`, and must be triggered through an explicit operator retry command unless a narrower retry policy is later approved.

## Policy Gates

Policy gates run before transitions.

Required gates:

| Transition | Required checks |
| --- | --- |
| review -> approved_for_operator | scope, risk, allowed paths, blocked paths |
| awaiting_approval -> approved | operator identity and approval route |
| approved -> building | approval exists, build plan exists, scope unchanged |
| building -> qa_pending | post-run path policy, coder receipt exists |
| qa_pending -> trust_pending | QA producer differs from Builder and `qa_report` exists |
| trust_pending -> complete | `verification_delta` exists and supports `trust_report` state |
| any -> blocked | hash failure, redaction failure, policy violation |

## Pause Semantics

Pause is not cancellation.

When paused:

- active runtime should be cancelled only if operator requests cancellation;
- new builds cannot start;
- new scheduled autonomous stages cannot start;
- existing artifacts remain readable;
- status/report/show still work.

Resume:

- does not automatically run queued builds;
- returns the room to a safe decision state;
- should show the next required operator action.

## Error Handling Semantics

Failures should be represented as artifacts when possible.

Examples:

- runtime timeout -> `error_receipt`;
- permission denied -> `error_receipt`;
- path violation -> `error_receipt` or blocked `coder_receipt`;
- QA crash -> `error_receipt`;
- hash mismatch -> blocked state and error receipt;
- redaction failure -> blocked state and no unsafe artifact persistence.

If a failure happens before artifact storage is available, the CLI/Telegram output must still say no durable receipt was created.

## State Derivation For UI

Operator surfaces should derive state from artifacts.

Examples:

```text
no active artifacts -> idle
research running -> collecting
main_review approved_for_operator and no approval -> awaiting_approval
approval granted and no coder_receipt -> approved
coder_receipt submitted and no qa_report -> qa_pending
qa_report submitted and no trust_report -> trust_pending
trust_report exists -> complete
error_receipt unresolved -> blocked
pause flag active -> paused
```

Room state should describe the active or pending workflow, not replace historical status. `latestTrustState` and `latestCompletedRun` should be shown separately when useful.

If multiple conditions apply, precedence should be:

```text
paused > blocked > building > qa_pending > trust_pending > approved > awaiting_approval > proposal_ready > collecting > complete > idle
```

## Acceptance Criteria

The state machine is good enough for v0.1 when:

- approval cannot be created without prior `main_review`;
- build cannot start without unrevoked, unexpired approval;
- approval does not automatically start build;
- approval is consumed when the first build attempt starts;
- approved-not-built is visible in status;
- approved-not-built cannot disappear without build start, revoke, expire, cancel, or park resolution;
- Builder cannot produce QA, Delta, or Trust artifacts;
- missing QA prevents `trust.clean`;
- rejected high/critical claims prevent `trust.clean`;
- missing high/critical evidence prevents `trust.clean`;
- unresolved error receipts prevent `trust.clean`;
- path violations transition to `blocked`;
- blocked state records `blockScope: job | room`;
- failed role runs create `error_receipt`;
- pause prevents new build execution;
- pause while building is shown as paused with active runtime state unless cancelled;
- resume does not auto-run pending builds;
- UI state can be derived from artifacts and policy flags.
