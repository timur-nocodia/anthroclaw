# Artifact Model

Status: Draft

Purpose: define every receipt and contract artifact used by Auto-Buildroom, including research packets, idea contracts, reviews, plans, coder receipts, QA reports, verification deltas, trust reports, and retention reviews.

## Artifact Thesis

Artifacts are the source of truth for Auto-Buildroom.

Chat messages, Markdown summaries, Telegram briefs, and dashboard cards are renderings. They may help the operator understand the state of the room, but they are not the durable record.

Hard rule:

```text
If there is no receipt, the Buildroom should behave as if the action did not happen.
```

This is what separates Buildroom from an ordinary agent conversation. A Buildroom run is not "done" because an agent said so. It is inspectable because each stage produces a structured receipt with parents, producer, claims, evidence, status, and traceability.

## Artifact Principles

1. Every important stage creates an artifact.
2. Every artifact has a producer role and run ID.
3. Every non-root artifact points to parent artifacts.
4. Artifacts are append-only for audit purposes.
5. Updates create new artifacts or transitions, not silent mutation.
6. Markdown/Telegram/HTML reports render artifacts; they do not replace them.
7. Secrets and PII must be redacted before persistence.
8. Trust state is derived from evidence, not from Builder claims.
9. Missing artifacts block later stages.
10. Artifact IDs must be stable, readable, and filesystem-safe.

## v0.1 Artifact Chain

The minimum useful v0.1 chain is:

```text
research_packet
-> idea_contract
-> main_review
-> approval
-> build_plan
-> coder_receipt
-> qa_report
-> verification_delta
-> trust_report
-> operator_summary
```

If any stage fails before its expected artifact can be produced, the stage must create an `error_receipt`.

Optional in v0.1:

```text
session_summary
signal
handoff_signal
retention_review
error_receipt
```

Deferred beyond v0.1:

```text
subconscious_walk
build_intent_marker
signal_board_snapshot
daily_digest
dashboard_snapshot
```

The v0.1 implementation may use deterministic fixtures for some artifacts before real role runners exist, but the artifact chain should remain the same.

## Common Envelope

All durable artifacts should use a common envelope.

Example:

```json
{
  "id": "idea_20260511_operator_summary_docs",
  "type": "idea_contract",
  "version": "1.0",
  "supersedesId": null,
  "status": "proposed",
  "createdAt": "2026-05-11T12:00:00Z",
  "producer": {
    "role": "dreamer",
    "runId": "run_20260511_001",
    "agentId": "buildroom-internal"
  },
  "room": {
    "id": "anthroclaw-core",
    "root": ".anthroclaw/auto-buildroom/rooms/anthroclaw-core"
  },
  "parentIds": [
    "research_20260511_operator_summary"
  ],
  "inputRefs": [
    {
      "kind": "artifact",
      "ref": "research_20260511_operator_summary",
      "hash": "sha256:..."
    }
  ],
  "outputRefs": [],
  "runtimeRefs": [],
  "traceId": "trace_20260511_operator_summary_docs",
  "redaction": {
    "piiRedacted": true,
    "secretsRedacted": true,
    "redactedFields": []
  },
  "contentHash": "sha256:...",
  "payload": {}
}
```

### Required Envelope Fields

Minimum required fields:

- `id`;
- `type`;
- `version`;
- `supersedesId`;
- `status`;
- `createdAt`;
- `producer`;
- `producer.role`;
- `producer.runId`;
- `room.id`;
- `parentIds`;
- `inputRefs`;
- `outputRefs`;
- `runtimeRefs`;
- `traceId`;
- `redaction`;
- `contentHash`;
- `payload`.

`version` means the artifact schema version, not the Buildroom product version.

`supersedesId` is nullable. Use `null` when the artifact does not supersede another artifact. Durable receipt artifacts should not be mutated in place. If a receipt needs correction, create a new artifact with `supersedesId` pointing to the old artifact.

`updatedAt` should be used for index records, rendered summaries, or transition records, not as a reason to silently mutate durable receipt artifacts.

## Hashing And Canonicalization

`contentHash` must be deterministic.

Rule:

```text
contentHash is computed over the canonical JSON representation of the artifact excluding contentHash itself and excluding filesystem metadata.
```

Canonicalization requirements:

- stable key ordering;
- UTF-8 encoding;
- no insignificant whitespace;
- normalized timestamps;
- no absolute filesystem metadata unless explicitly part of payload;
- no inclusion of `contentHash` in its own hash input.

If canonicalization cannot be performed, tamper detection is not trustworthy and the artifact should not be considered valid.

## Typed References

`inputRefs`, `outputRefs`, and `runtimeRefs` should use typed references rather than plain strings.

Minimum reference shape:

```yaml
kind: artifact | file | command | runtime_event | session | url | external
ref: "docs/Auto-Buildroom/04-operator-ux.md"
hash: "sha256:..."
description: "Optional human-readable note."
```

Examples:

```yaml
inputRefs:
  - kind: artifact
    ref: idea_20260511_operator_summary_docs
    hash: sha256:...
  - kind: file
    ref: docs/Auto-Buildroom/04-operator-ux.md
    hash: sha256:...
outputRefs:
  - kind: file
    ref: docs/Auto-Buildroom/15-dashboard-and-reports.md
    hash: sha256:...
runtimeRefs:
  - kind: runtime_event
    ref: events/run_20260511_operator_summary.jsonl
    hash: sha256:...
    description: "Redacted native runtime event log reference."
```

Every output file reference should include a content hash when possible.

## Artifact IDs

Artifact IDs should be readable and filesystem-safe.

Recommended format:

```text
<prefix>_<YYYYMMDD>_<short_slug>
```

Examples:

```text
research_20260511_operator_summary
idea_20260511_operator_summary_docs
review_20260511_operator_summary_docs
approval_20260511_operator_summary_docs
plan_20260511_operator_summary_docs
build_20260511_operator_summary_docs
qa_20260511_operator_summary_docs
delta_20260511_operator_summary_docs
trust_20260511_operator_summary_docs
summary_20260511_operator_summary_docs
```

If collisions are possible, append a short suffix:

```text
idea_20260511_operator_summary_docs_a3f9
```

IDs should not contain secrets, user messages, raw URLs, or private data.

## Artifact Type Summary

| Artifact | Purpose | Producer | Consumed by |
| --- | --- | --- | --- |
| `session_summary` | Sanitized summary of ordinary-agent session signal | summary extractor | Research |
| `handoff_signal` | Explicit ordinary-agent signal handoff | ordinary agent via controlled tool | Research |
| `research_packet` | Evidence-backed research summary | Research | Dreamer / Main Review |
| `signal` | Structured observation or repeated pattern | Research / Signal Filter | Dreamer / Main Review |
| `idea_contract` | Proposed work with why, non-goals, and risk | Dreamer | Main Review |
| `main_review` | Decision and bounded scope | Main Review | Approval / Build Plan |
| `approval` | Operator authority grant | Operator | Builder |
| `operator_decision` | Operator rejection or non-approval decision | Operator | Status / Approval policy |
| `build_plan` | Executable plan under approved scope | Planner / Main Review | Builder |
| `coder_receipt` | Builder claims, changed files, commands, limitations | Builder | QA |
| `qa_report` | Independent verification result | QA | Verification Delta |
| `verification_delta` | Builder claims vs QA evidence | Delta role | Trust |
| `trust_report` | Human-readable trust state | Trust | Operator Summary |
| `retention_review` | Keep/improve/park/prune/ghost/reopen recommendation | Retention | Future planning |
| `error_receipt` | Failed stage execution when expected artifact could not be produced | Orchestrator / runtime adapter | Operator / Trust |
| `operator_summary` | Rendered operator-facing report | Reporter | Human |

## session_summary

Purpose: allow Buildroom to watch ordinary agents without ingesting raw transcripts by default.

Producer: session summarizer or controlled gateway process.

Status values:

```text
created
redacted
consumed
rejected
```

Payload shape:

```yaml
sourceAgentId: code-helper
sourceSessionId: session_xxx
summary:
  userIntent: "Short sanitized description of what the user wanted."
  observedFriction:
    - "Concrete friction observed in the session."
  candidateSignals:
    - type: friction
      text: "Potential signal for Buildroom Research."
      confidence: medium
  evidenceRefs:
    - type: session
      ref: session_xxx
      excerpt: "Short sanitized excerpt or pointer, not full transcript."
privacy:
  rawTranscriptIncluded: false
  piiRedacted: true
  secretsRedacted: true
allowedUse:
  canBeUsedForResearch: true
  canCreateIdeaCandidate: true
  canApproveWork: false
```

Rule:

```text
Session summaries can create research signals.
They cannot approve work.
```

## handoff_signal

Purpose: let an ordinary agent explicitly hand a structured signal to Buildroom.

Producer: ordinary agent through controlled handoff tool.

Status values:

```text
submitted
accepted
rejected
consumed
```

Payload shape:

```yaml
sourceAgentId: code-helper
sourceSessionId: session_xxx
targetBuildroom: anthroclaw-core
signalType: friction
summary: "What the agent noticed."
evidenceRefs:
  - type: session-summary
    ref: session-summary_20260511_operator_summary
confidence: medium
requestedAction: research_only
authority:
  canApprove: false
  canBuild: false
```

Rule:

```text
Handoff is not approval.
```

## research_packet

Purpose: preserve evidence and separate facts from interpretation.

Producer: Research.

Status values:

```text
collected
summarized
consumed
archived
rejected
```

Payload fields:

- topic;
- summary;
- sourceRefs;
- facts;
- interpretations;
- evidence;
- weakClaims;
- openQuestions;
- recommendedHandoffs.

Example:

```yaml
topic: "Operator summary docs/test gap"
summary: "The docs define Operator View and Trust Report, but there is no dedicated operator summary example."
facts:
  - "03-user-mental-model.md defines Trust Report as honest status."
  - "04-operator-ux.md requires report sections and receipt chain links."
interpretations:
  - "A docs/test example would make the v0.1 E2E scenario easier to verify."
weakClaims:
  - "Telegram rendering may need a separate future test."
openQuestions:
  - "Should the first example be Markdown-only or CLI JSON plus Markdown?"
```

Rule:

```text
Research observes and preserves evidence.
Research does not approve builds.
```

## signal

Purpose: represent a structured observation or repeated pattern.

Producer: Research, Subconscious / pattern watcher, or Signal Filter.

Status values:

```text
watching
ready
queued
rejected
parked
consumed
```

Payload fields:

- signalType;
- target;
- summary;
- evidenceRefs;
- confidence;
- heat;
- suggestedLane;
- reasonNotTaskYet.

Rule:

```text
A signal is not a task.
```

## idea_contract

Purpose: propose bounded work before approval.

Producer: Dreamer / idea generator.

Status values:

```text
proposed
ready_for_review
rejected
needs_more_research
parked
approved_by_review
```

Payload fields:

- title;
- problem;
- whyNow;
- beneficiary;
- proposedSolution;
- evidenceRefs;
- nonGoals;
- risk;
- expectedEffort;
- successCriteria;
- suggestedScope;
- verificationIdea.

Rule:

```text
An idea contract can ask for review.
It cannot approve itself.
```

## main_review

Purpose: convert an idea into an approved/rejected bounded proposal.

Producer: Main Review.

Status values:

```text
approved_for_operator
rejected
needs_more_research
parked
```

Payload fields:

- ideaId;
- decision;
- reason;
- allowedPaths;
- blockedPaths;
- nonGoals;
- acceptanceCriteria;
- risk;
- approvalRequired;
- externalSideEffectsAllowed;
- verificationCommands;
- buildBudget.

Rule:

```text
Main Review locks scope.
Main Review does not execute the build.
```

## approval

Purpose: record explicit operator authority.

Producer: Operator through Buildroom operator surface.

Status values:

```text
granted
revoked
expired
consumed
```

Payload fields:

- targetReviewId;
- sourceIdeaId;
- approvedBy;
- approvalRoute;
- approvedAt;
- reason;
- approvedScope;
- allowedPaths;
- blockedPaths;
- expiresAt;
- constraints;
- identityEvidence.

Example:

```yaml
targetReviewId: review_20260511_operator_summary_docs
sourceIdeaId: idea_20260511_operator_summary_docs
approvedBy: telegram:48705953
approvalRoute: telegram
approvedAt: 2026-05-11T12:00:00Z
reason: "Safe docs/test MVP improvement."
approvedScope:
  - docs/**
  - tests/**
constraints:
  externalSideEffectsAllowed: false
  autoBuildAllowed: false
```

Rules:

```text
Approval grants authority.
Approval does not execute the build by itself.
Approval must come through the Buildroom operator surface.
Approval must target a `main_review` artifact with decision `approved_for_operator`.
```

## build_plan

Purpose: translate approved scope into executable steps.

Producer: Planner or Main Review role.

Status values:

```text
drafted
ready
superseded
blocked
cancelled
```

Payload fields:

- approvalId;
- ideaId;
- objective;
- steps;
- allowedPaths;
- blockedPaths;
- commands;
- expectedChangedFiles;
- verificationPlan;
- rollbackPlan;
- timeout;

Rule:

```text
A build plan cannot run without an approval artifact.
A build plan describes intended work; execution outcome belongs in `coder_receipt` or `error_receipt`.
```

## coder_receipt

Purpose: record what Builder did and claimed.

Producer: Builder.

Status values:

```text
submitted
qa_pending
qa_checked
rejected
```

Payload fields:

- buildPlanId;
- approvalId;
- changedFiles;
- commandsRun;
- claims;
- evidenceRefs;
- knownLimitations;
- runtimeStatus;
- diffSummary;
- preRunPolicyResult;
- postRunPolicyResult.

Example claim:

```yaml
claims:
  - id: claim_001
    text: "Added operator summary field definitions."
    evidenceRefs:
      - docs/Auto-Buildroom/15-dashboard-and-reports.md
    criticality: medium
preRunPolicyResult:
  allowed: true
  checkedPaths:
    - docs/**
    - tests/**
  blockedPaths:
    - .env
    - config.yml
postRunPolicyResult:
  allowed: true
  changedFiles:
    - docs/Auto-Buildroom/15-dashboard-and-reports.md
  violations: []
```

Rule:

```text
Builder claims are not proof.
```

## qa_report

Purpose: independently verify Builder's work.

Producer: QA.

Status values:

```text
submitted
delta_pending
consumed
blocked
```

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
- status;

Status values inside payload:

```text
pass
pass_with_notes
fail
blocked
```

Rule:

```text
QA checks Builder.
Builder cannot write QA report.
```

## verification_delta

Purpose: compare Builder claims against QA evidence.

Producer: Verification Delta role or deterministic comparison.

Status values:

```text
generated
trust_pending
consumed
```

Payload fields:

- buildId;
- coderReceiptId;
- qaReportId;
- comparisons;
- overall;
- missingEvidence;
- rejectedCriticalClaims;

Comparison statuses:

```text
confirmed
rejected
missing_evidence
not_in_scope
```

Overall statuses:

```text
clean
watch
investigate
blocked
```

Rule:

```text
Missing critical evidence prevents clean trust.
```

## Claim Criticality

Claims should use a shared criticality scale:

```text
low
medium
high
critical
```

Rules:

```text
missing high/critical evidence prevents trust.clean
rejected high/critical claims require trust.investigate or trust.blocked
rejected critical safety or scope claims require trust.blocked
```

## trust_report

Purpose: give the operator an evidence-backed trust state.

Producer: Trust role.

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
- nextRecommendedStep;

Rule:

```text
Trust is derived from QA and delta evidence.
Trust cannot be clean if critical claims are rejected or missing evidence.
```

## retention_review

Purpose: decide what happens to completed work or stale ideas.

Producer: Retention.

Status values:

```text
keep
improve
park
prune_recommended
ghost
reopen
```

Payload fields:

- targetArtifactId;
- recommendation;
- reason;
- usageEvidence;
- followUpNeeded;
- archiveAllowed;

Rule:

```text
Retention recommends.
Deletion or destructive cleanup requires explicit policy.
```

## error_receipt

Purpose: record failed stage execution when the expected artifact could not be produced.

Producer: Orchestrator or runtime adapter.

Status values:

```text
recorded
retry_pending
resolved
archived
```

Payload fields:

- stage;
- targetArtifactId;
- expectedArtifactType;
- errorType;
- message;
- recoverable;
- retryAllowed;
- runtimeRefs;
- policyRefs;
- redactedDiagnostics;

Example:

```yaml
stage: builder
targetArtifactId: plan_20260511_operator_summary_docs
expectedArtifactType: coder_receipt
errorType: timeout
message: "Builder timed out before producing a coder receipt."
recoverable: true
retryAllowed: true
runtimeRefs: []
```

Rule:

```text
A failed stage must leave an error receipt unless the failure happened before artifact storage was available.
```

## operator_summary

Purpose: render the artifact chain for humans.

Producer: Reporter / Operator View renderer.

Status values:

```text
generated
superseded
archived
```

Payload fields:

- roomId;
- currentState;
- pendingApprovals;
- approvedNotBuilt;
- activeBuilds;
- latestTrustState;
- evidenceSummary;
- changedFiles;
- qaSummary;
- verificationSummary;
- operatorActionNeeded;
- receiptChain;
- renderedFromIds;
- renderedPaths;

Rule:

```text
Operator summaries explain receipts.
They are not the source of truth.
```

## Parent/Child Rules

Minimum parent requirements:

| Artifact | Required parents |
| --- | --- |
| `session_summary` | none or source session ref |
| `handoff_signal` | session summary or source ref |
| `research_packet` | source refs, session summaries, or handoff signals |
| `signal` | research packet or handoff signal |
| `idea_contract` | research packet or signal |
| `main_review` | idea contract |
| `approval` | main review with `decision: approved_for_operator` |
| `operator_decision` | target artifact |
| `build_plan` | approval and main review |
| `coder_receipt` | build plan and approval |
| `qa_report` | coder receipt |
| `verification_delta` | coder receipt and QA report |
| `trust_report` | verification delta |
| `retention_review` | trust report or stale idea/signal |
| `error_receipt` | target artifact or run reference |
| `operator_summary` | current receipt chain |

If a required parent is missing, the stage must fail closed.

## Producer Separation Rules

Forbidden:

- Dreamer approves its own idea.
- Builder writes QA report.
- Builder writes verification delta.
- Builder writes trust report.
- QA silently expands build scope.
- Trust alters build artifacts.
- Retention deletes artifacts without explicit policy.

Required:

- each artifact records `producer.role`;
- each artifact records `producer.runId`;
- policy checks compare producer/run identity before transitions;
- operator approvals record identity and route.

## Status And Trust Interaction

Artifact status and trust state are related but not identical.

Example:

```text
coder_receipt.status = submitted
qa_report.status = submitted
verification_delta.payload.overall = watch
trust_report.status = watch
```

Trust state should be calculated from QA and verification delta, not from Coder's self-report.

## Redaction And Privacy

Every artifact must be redacted before persistence.

Redaction metadata must say whether:

- PII was scanned;
- secrets were scanned;
- fields were redacted;
- raw transcripts were included;
- raw environment values were included.

Default:

```text
raw transcripts: not included
env values: not included
secrets: redacted or fail closed
```

If a required field contains a high-confidence secret, artifact creation should fail closed rather than store the secret.

## Filesystem Mapping

Recommended v0.1 storage:

```text
.anthroclaw/
  auto-buildroom/
    buildroom.yml
    rooms/
      anthroclaw-core/
        buildroom/
          session-summaries/
          research/
          signals/
          ideas/
          reviews/
          approvals/
          plans/
          builds/
          qa/
          deltas/
          trust/
          retention/
          errors/
          operator/
```

Recommended mapping:

| Type | Directory |
| --- | --- |
| `session_summary` | `session-summaries/` |
| `research_packet` | `research/` |
| `signal`, `handoff_signal` | `signals/` |
| `idea_contract` | `ideas/` |
| `main_review` | `reviews/` |
| `approval` | `approvals/` |
| `operator_decision` | `operator/decisions/` |
| `build_plan` | `plans/` |
| `coder_receipt` | `builds/` |
| `qa_report` | `qa/` |
| `verification_delta` | `deltas/` |
| `trust_report` | `trust/` |
| `retention_review` | `retention/` |
| `error_receipt` | `errors/` or stage-local `errors/` |
| `operator_summary` | `operator/` |

## v0.1 Required Schemas

v0.1 should define machine-checkable schemas for:

- common envelope;
- session summary;
- handoff signal;
- research packet;
- idea contract;
- main review;
- approval;
- build plan;
- coder receipt;
- QA report;
- verification delta;
- trust report;
- error receipt;
- operator summary.

`retention_review` may be schema-defined in v0.1 even if not required in the first E2E run.

## Acceptance Criteria

The artifact model is good enough for v0.1 when:

- every stage in the real-world E2E test creates a durable artifact;
- `show <id>` can render artifacts by type;
- missing parent artifacts block later stages;
- approval is represented as an artifact, not a chat message;
- approvals require a prior `main_review` with locked scope and `decision: approved_for_operator`;
- Builder claims can be compared against QA evidence;
- missing critical evidence prevents `trust.clean`;
- rejected high/critical claims prevent `trust.clean`;
- failed role runs create an `error_receipt`;
- build plans do not record execution success; execution outcome is recorded by coder receipts or error receipts;
- operator summary can render the full receipt chain;
- operator summaries include `renderedFromIds`;
- secrets are redacted before artifacts are saved;
- artifact hashes are computed from canonical serialized content excluding `contentHash`;
- every output file ref includes a content hash when possible;
- artifact hashes can detect tampering.
