# QA, Verification, And Trust

Status: Draft

Purpose: define how QA checks builder claims, how Verification Delta compares claims against evidence, and how Trust Report assigns `clean`, `watch`, `investigate`, or `blocked`.

## Thesis

Coder does not grade its own homework.

Builder produces claims.

QA produces evidence.

Verification Delta compares claims against evidence.

Trust tells the operator what to believe.

Core rule:

```text
Builder claims are inputs, not proof.
Trust is derived from QA and Verification Delta, not from Builder self-report.
```

## v0.1 Scope

Required for v0.1:

- QA runs after `coder_receipt`;
- QA role/run differs from Builder role/run;
- QA inspects changed files, Builder claims, policy results, and verification commands;
- QA may confirm, reject, or mark missing evidence;
- Verification Delta classifies every Builder claim;
- Trust Report is generated from QA and Delta;
- `trust.clean` is blocked by missing QA, rejected high/critical claims, missing high/critical evidence, unresolved errors, or path policy violations;
- operator report includes confirmed and unconfirmed claims.

Deferred:

- multi-QA consensus;
- formal proof systems;
- production-grade test coverage scoring;
- external audit integrations;
- automatic rollback;
- automatic deployment gates;
- enterprise compliance exports.

v0.1 should prove:

```text
coder_receipt -> qa_report -> verification_delta -> trust_report -> operator_summary
```

## Workflow State Versus Trust State

Trust state is not the same as room/workflow state.

Examples:

- a completed Builder run with no QA yet is workflow state `qa_pending`; trust cannot be `clean`;
- a failed QA run may produce workflow state `blocked` and trust state `blocked`;
- a useful docs-only build with minor missing evidence may produce trust state `watch`.

For a completed Builder run being evaluated for trust, missing QA blocks clean trust assessment. In workflow status, this may appear as `qa_pending` until QA is overdue, failed, or blocked.

Stored trust state values are lowercase:

```text
clean
watch
investigate
blocked
```

Rendered reports may display uppercase labels:

```text
Trust: WATCH
```

## Role Boundaries

### Builder

Builder may produce:

- `coder_receipt`;
- changed files;
- command summaries;
- claims;
- known limitations;
- policy result fields.

Builder must not produce:

- `qa_report`;
- `verification_delta`;
- `trust_report`;
- `operator_summary` as final trust source;
- approval artifacts.

### QA

QA verifies Builder output.

QA may produce:

- `qa_report`;
- confirmed claims;
- rejected claims;
- missing evidence;
- scope violations;
- risks;
- command/test results.

QA must not:

- approve work;
- silently expand scope;
- silently fix Builder output in the same role;
- mark final trust state;
- mutate repo as part of QA unless a separate approved build path exists.

### Verification Delta

Verification Delta compares Builder claims against QA findings.

It may be deterministic.

It may produce:

- `verification_delta`;
- claim-by-claim classifications;
- overall evidence state;
- trust impact hints.

It must not:

- approve work;
- mutate files;
- run Builder;
- invent QA evidence;
- mark trust without Trust role/report.

### Trust

Trust creates the human-readable trust state.

It may produce:

- `trust_report`;
- operator action needed;
- risk summary;
- next recommended step.

It must not:

- change build artifacts;
- edit QA results;
- silently ignore rejected or missing claims;
- mark `clean` without QA and Delta evidence.

## QA Preconditions

Before QA starts:

- `coder_receipt` exists;
- Builder runtime has ended or been cancelled with enough evidence to inspect;
- changed files are available from independent Buildroom diff;
- pre-run and post-run policy results are available;
- QA role/run differs from Builder role/run;
- QA input refs are redacted;
- worktree/sandbox evidence is still available or archived.

QA may run on a path-violating `coder_receipt` to document evidence.

However:

```text
Path violation prevents trust.clean.
```

## QA Inputs

QA should inspect:

- `coder_receipt`;
- `build_plan`;
- `approval`;
- `main_review`;
- independent Buildroom diff;
- changed files;
- commands run;
- Builder claims;
- known limitations;
- pre-run and post-run policy results;
- runtime refs or redacted excerpts;
- verification plan;
- acceptance criteria.

QA should treat Builder-provided changed files as claims unless they match independent Buildroom diff.

## QA Report

`qa_report` should use the common artifact envelope.

Payload fields:

- buildId;
- coderReceiptId;
- commandsRun;
- filesInspected;
- confirmedClaims;
- rejectedClaims;
- missingEvidence;
- scopeViolations;
- risks;
- status.

Payload status values:

```text
pass
pass_with_notes
fail
blocked
```

Example:

```yaml
buildId: build_20260511_operator_summary_docs
coderReceiptId: build_20260511_operator_summary_docs
filesInspected:
  - docs/Auto-Buildroom/18-build-and-sandbox.md
commandsRun:
  - command: "pnpm test"
    status: skipped
    reason: "docs-only change"
confirmedClaims:
  - claimId: claim_001
    evidenceRefs:
      - kind: file
        ref: docs/Auto-Buildroom/18-build-and-sandbox.md
rejectedClaims: []
missingEvidence:
  - claimId: claim_002
    reason: "No live runtime test was run."
scopeViolations: []
risks:
  - "Spec not yet implemented in code."
status: pass_with_notes
```

Rules:

- QA report should read like an audit note, not a success announcement;
- QA must include what was not tested;
- QA must record skipped commands and why;
- QA must record scope violations even if the functional change looks useful;
- QA cannot convert missing evidence into confirmed evidence;
- QA commands should be read-only or write only to approved temporary/cache locations;
- tests that update snapshots, format files, or change repo contents are mutations and require separate approval.

## QA Status To Trust Guidance

QA status does not map directly to trust state.

Guidance:

| QA status | Trust guidance |
| --- | --- |
| `pass` | `clean` possible only if Delta confirms high/critical claims and no policy/errors remain |
| `pass_with_notes` | usually `watch`; `clean` only if notes are low-risk and non-essential |
| `fail` | `investigate` or `blocked` depending on criticality |
| `blocked` | `blocked` |

QA pass does not guarantee `trust.clean`.

## Verification Delta

Verification Delta compares every Builder claim against QA evidence.

`verification_delta` should use the common artifact envelope.

Comparison statuses:

```text
confirmed
rejected
missing_evidence
not_in_scope
```

Payload fields:

- buildId;
- coderReceiptId;
- qaReportId;
- comparisons;
- overall;
- missingEvidence;
- rejectedCriticalClaims;
- scopeViolations;
- policyViolations;
- qaOnlyFindings;
- trustImpact.

Example:

```yaml
comparisons:
  - claimId: claim_001
    builderClaim: "Added build/sandbox safety spec."
    qaFinding: "File exists and contains worktree, approval, diff, and policy sections."
    status: confirmed
    criticality: medium
    evidenceRefs:
      - kind: file
        ref: docs/Auto-Buildroom/18-build-and-sandbox.md
  - claimId: claim_002
    builderClaim: "Runtime behavior is fully tested."
    qaFinding: "No implementation/runtime test was run."
    status: missing_evidence
    criticality: high
overall: watch
missingEvidence:
  - claim_002
rejectedCriticalClaims: []
qaOnlyFindings:
  - type: policy
    finding: "No blocked path was touched."
    criticality: critical
    status: confirmed
trustImpact: watch
```

Rules:

- every Builder claim should be classified;
- unclassified claims count as `missing_evidence`;
- `not_in_scope` means the claim was outside approved scope or QA scope;
- `not_in_scope` on a claim means the claim cannot support trust for the approved work;
- missing high/critical evidence prevents `trust.clean`;
- rejected high/critical claim requires `trust.investigate` or `trust.blocked`;
- rejected critical safety/scope claim requires `trust.blocked`;
- path policy violation prevents `trust.clean`;
- unresolved `error_receipt` prevents `trust.clean`.

If a `not_in_scope` claim reflects an actual change outside approved scope, treat it as a scope violation and block `clean`.

Rejected low/medium claims do not necessarily block `clean` if they are explicitly non-essential and Trust explains why they do not affect acceptance. Otherwise, rejected claims should produce at least `watch`.

## Claim Criticality

Shared criticality scale:

```text
low
medium
high
critical
```

Recommended meanings:

| Criticality | Meaning |
| --- | --- |
| `low` | minor supporting claim |
| `medium` | meaningful claim about local scope |
| `high` | important behavior, safety, or acceptance claim |
| `critical` | safety, scope, authority, or data integrity claim |

Rules:

- criticality is attached to Builder claims and Delta comparisons;
- QA may recommend criticality adjustment if Builder understated risk;
- Trust should use the higher criticality when Builder and QA disagree;
- rejected critical safety/scope claims require `blocked`.

## Trust Report

`trust_report` gives the operator a concise state.

Status values:

```text
clean
watch
investigate
blocked
```

Payload fields:

- buildId;
- verificationDeltaId;
- state;
- summary;
- confirmed;
- unconfirmed;
- rejected;
- risks;
- operatorActionNeeded;
- nextRecommendedStep.

Example:

```yaml
state: watch
summary: "Docs-only build completed and core claims were confirmed, but runtime behavior was not tested."
confirmed:
  - "Build/sandbox spec includes approval, worktree, diff, and path policy rules."
unconfirmed:
  - "No implementation/runtime test was run."
rejected: []
risks:
  - "Spec is not yet implemented."
operatorActionNeeded: "Approve next implementation phase or leave as documentation."
nextRecommendedStep: "Run implementation planning for build/sandbox module."
```

## Trust State Rules

### clean

Use `clean` only when:

- QA exists;
- Verification Delta exists;
- all high/critical claims are confirmed or not applicable with rationale;
- no unresolved high/critical missing evidence;
- no rejected high/critical claims;
- no unresolved `error_receipt`;
- no path policy violation;
- no scope violation;
- no missing critical safety/scope evidence;
- no unresolved native runtime failure;
- Trust can explain why evidence is enough.

### watch

Use `watch` when:

- the work appears useful;
- major local claims are confirmed;
- some non-critical evidence is missing;
- there are known limitations;
- operator should not treat the result as fully proven.

### investigate

Use `investigate` when:

- high/critical evidence is missing;
- a high claim is rejected but not clearly a policy/safety block;
- QA found suspicious behavior;
- runtime output and file diff disagree;
- source evidence is inconsistent;
- operator review is needed before continuation.

### blocked

Use `blocked` when:

- policy violation exists;
- path violation exists and unresolved;
- critical safety/scope claim is rejected;
- critical safety/scope evidence is missing;
- approval/scope chain is invalid;
- required artifacts are missing or corrupted;
- unresolved error receipt blocks progression;
- redaction failure occurred;
- native runtime failure prevents reliable inspection.

## Trust State Matrix

| Condition | Minimum trust state |
| --- | --- |
| Missing QA report | `blocked` |
| Missing Verification Delta | `blocked` |
| Missing high/critical evidence | `investigate` |
| Missing critical safety/scope evidence | `blocked` |
| Rejected high claim | `investigate` |
| Rejected critical safety/scope claim | `blocked` |
| Path policy violation | `blocked` |
| Scope violation | `blocked` |
| Unresolved error receipt | `blocked` |
| Runtime success but QA missing | `blocked` |
| Runtime success and all claims confirmed | `clean` possible |
| Docs-only change with untested implementation claims | `watch` |

`clean possible` means Trust may mark clean only if all other gates also pass.

## Policy And Scope Violations

QA must surface:

- changed files outside approved paths;
- blocked paths touched;
- symlink escape;
- path traversal;
- unexpected deletion;
- unapproved network/external side effect;
- changed Buildroom config or approval policy;
- Builder-created QA/Delta/Trust artifacts;
- scope expansion beyond Main Review.

Any policy or scope violation blocks `trust.clean`.

Severe violation may set:

```yaml
blockScope: room
```

Otherwise:

```yaml
blockScope: job
```

## Missing Evidence

Missing evidence is not failure by itself.

It is a classification that affects trust.

Examples:

- test not run;
- runtime logs unavailable;
- changed file not inspected;
- claim has no evidence ref;
- external behavior claimed but not checked;
- performance/security claim made without measurement.

Rules:

- missing low/medium evidence may produce `watch`;
- missing high/critical evidence prevents `clean`;
- missing critical safety/scope evidence should produce `blocked`;
- Trust report must list missing evidence clearly.

## QA Runtime Requirements

QA may be runtime-backed or deterministic.

Requirements:

- QA role/run differs from Builder role/run;
- QA prompt/context differs from Builder prompt/context;
- QA sees Builder claims and computed diff;
- QA receives redacted and bounded runtime refs only;
- QA must not receive hidden instruction to agree with Builder;
- QA should have enough artifacts to inspect scope;
- QA output is persisted as `qa_report`.

For v0.1, role separation is logical and artifact-enforced. It is not cryptographic independence if the same model/provider is used for Builder and QA.

## Verification Delta Generation

Verification Delta should be deterministic when possible.

Inputs:

- `coder_receipt`;
- `qa_report`;
- independent diff;
- policy results.

Rules:

- if matching delta already exists for the same coder receipt and QA report, reuse or supersede deterministically;
- do not create duplicate conflicting deltas;
- if QA report is missing, do not generate clean delta;
- if claim lacks ID, generate stable comparison ID and mark evidence quality lower;
- Delta must not invent claims that Builder did not make, but may include QA-only policy findings.

`qaOnlyFindings` should capture important findings not tied to a Builder claim, such as policy violations, unexpected changed files, or missing safety evidence.

## Report Rendering

Operator-facing trust report should include:

- trust state near top;
- what was confirmed;
- what was not confirmed;
- what was rejected;
- risks;
- path/scope policy result;
- pre-run and post-run policy result refs;
- QA commands run or skipped;
- receipts;
- next action.

Example:

```text
Trust: WATCH

Confirmed:
- docs-only safety spec was updated
- QA inspected changed file
- no blocked path was touched

Unconfirmed:
- runtime implementation was not tested

Risks:
- spec not implemented yet

Next:
approve implementation phase or leave as docs-only

Receipts:
- qa_20260511_build_sandbox
- delta_20260511_build_sandbox
- trust_20260511_build_sandbox
```

## Failure Handling

Create or reference `error_receipt` when:

- QA crashes;
- QA cannot access changed files;
- QA cannot read required artifacts;
- Verification Delta fails;
- Trust generation fails;
- redaction fails;
- artifact corruption is detected.

If QA cannot complete:

```text
trust.clean is impossible.
```

If Trust report cannot be generated, operator status should show `blocked` or `investigate` with reason.

## Forbidden Behavior

Forbidden:

- Builder writes QA report;
- Builder writes Verification Delta;
- Builder writes Trust Report;
- QA approves build work;
- QA silently modifies files;
- QA expands scope;
- Delta invents evidence;
- Trust ignores rejected high/critical claims;
- Trust marks clean without QA;
- Trust marks clean with path violation;
- Trust marks clean with unresolved error receipt;
- operator summary creates approval or trust by itself.

## Acceptance Criteria

QA, Verification, and Trust are good enough for v0.1 when:

- QA requires `coder_receipt`;
- QA role/run differs from Builder role/run;
- QA inspects independent diff, policy results, and Builder claims;
- QA records confirmed, rejected, and missing-evidence claims;
- QA can document path-violating builds without making them clean;
- Verification Delta classifies every Builder claim;
- unclassified claims count as missing evidence;
- Delta statuses are `confirmed`, `rejected`, `missing_evidence`, `not_in_scope`;
- Trust Report derives state from QA and Delta, not Builder claims;
- missing QA prevents `trust.clean`;
- missing high/critical evidence prevents `trust.clean`;
- rejected high/critical claims prevent `trust.clean`;
- unresolved `error_receipt` prevents `trust.clean`;
- path/scope policy violation prevents `trust.clean`;
- reports show confirmed and unconfirmed claims;
- no Builder-produced QA/Delta/Trust artifact is accepted.
