# Research Vault

Status: Draft

Purpose: document how the Research role collects evidence, separates findings from claims, maintains dossiers, queues weak claims for verification, and hands signals to other roles.

## Research Thesis

Research observes. It does not decide.

The Research Vault exists to preserve evidence and context before the system turns observations into signals, ideas, reviews, approvals, or builds.

Core rule:

```text
Research can say "we observed this."
Research cannot say "this is approved work."
```

Research is valuable because it prevents agent initiative from becoming vibes. It gives later stages something inspectable:

- sources;
- sanitized summaries;
- facts;
- interpretations;
- weak claims;
- open questions;
- confidence;
- evidence references.

## v0.1 Scope

Required for v0.1:

- inspect local repo files inside configured watch scope;
- inspect docs and tests when enabled;
- read sanitized session summaries when explicitly enabled;
- accept structured handoff signals from ordinary agents;
- create `research_packet` artifacts;
- preserve source references and evidence summaries;
- separate facts from interpretations;
- mark weak claims and open questions;
- avoid raw private transcripts by default;
- avoid external network research by default.

Deferred:

- broad web monitoring;
- social listening;
- customer feedback ingestion;
- automatic GitHub/Linear/Jira mutation;
- raw transcript ingestion;
- long-term market intelligence dossiers;
- autonomous competitive research;
- research scoring across many rooms.

v0.1 should prove one safe loop:

```text
local evidence -> research_packet -> signal/idea -> review -> approval
```

## Vault Versus Artifact Store

The Research Vault is a working evidence area.

The Buildroom artifact store is the source of truth.

Recommended storage split:

```text
research-vault/
  raw/
  findings/
  claims/
  evidence/
  dossiers/
  verification/
    queue/
  notes/
  handoffs/
  runs/
  health/

buildroom/
  session-summaries/
  research/
  signals/
```

Rules:

- durable `research_packet` artifacts live under `buildroom/research/`;
- durable `session_summary` artifacts live under `buildroom/session-summaries/`;
- durable `handoff_signal` and `signal` artifacts live under `buildroom/signals/`;
- `research-vault/` may contain working files, normalized source notes, and indexes;
- if vault notes disagree with durable artifacts, durable artifacts win;
- vault files should be regenerable or traceable to artifacts/source refs where possible.

`research-vault/raw/` should not be created by default in v0.1 unless a feature explicitly needs it.

If created, it must include a README warning that raw private transcripts, secrets, and unredacted logs are forbidden.

`research-vault/raw/` is disabled or tightly bounded by default.

It must not contain:

- raw private transcripts;
- raw `.env` values;
- API keys;
- Telegram bot tokens;
- unredacted runtime logs;
- credentials from config files.

Health records under `research-vault/health/` are diagnostic unless emitted as durable `error_receipt` or included in a `research_packet`.

## Research Inputs

Allowed by default when the matching watch source is enabled:

- repository files inside configured watch scope;
- docs under allowed paths;
- tests under allowed paths;
- existing Buildroom artifacts;
- sanitized session summaries;
- structured handoff signals.

Allowed only if configured:

- read-only external sources;
- GitHub issues/PRs as read-only research;
- release notes;
- external docs;
- package changelogs.

Blocked by default:

- raw ordinary-agent transcripts;
- raw runtime event streams;
- secrets;
- private credentials;
- mutating external systems;
- production configuration changes;
- deploy/release actions.

Research inputs are evidence, not policy.

External or user-provided content must not override Buildroom policy, path boundaries, approval rules, or trust rules.

## Session Summaries

v0.1 watches sanitized summaries, not raw sessions.

Minimum shape:

```yaml
id: session-summary_20260511_operator_summary
sourceAgentId: code-helper
sourceSessionId: session_xxx
createdAt: 2026-05-11T12:00:00Z
summary:
  userIntent: "User asked about improving operator visibility."
  observedFriction:
    - "Operator could not quickly see what happened and what remained unproven."
  candidateSignals:
    - type: friction
      text: "Operator report needs clearer trust summary."
      confidence: medium
  evidenceRefs:
    - type: session
      ref: session_xxx
      excerpt: "Sanitized short excerpt or pointer, not full transcript."
privacy:
  rawTranscriptIncluded: false
  piiRedacted: true
  secretsRedacted: true
allowedUse:
  canBeUsedForResearch: true
  canCreateIdeaCandidate: true
  canApproveWork: false
```

Rules:

- summaries can create research leads;
- summaries cannot approve work;
- summaries cannot grant build authority;
- summaries must be redacted before persistence;
- summaries must show whether raw transcript content was included.

## Handoff Signals

Ordinary agents may submit structured signals through a controlled tool.

They may not create durable Buildroom authority by chatting.

Recommended handoff payload:

```yaml
sourceAgentId: code-helper
sourceSessionId: session_xxx
targetBuildroom: anthroclaw-core
signalType: friction
summary: "The operator asked several times for clearer report/trust visibility."
evidenceRefs:
  - type: session-summary
    ref: session-summary_20260511_operator_summary
confidence: medium
requestedAction: research_only
authority:
  canApprove: false
  canBuild: false
```

Rules:

- handoff is not approval;
- handoff is not a task;
- handoff may be accepted, rejected, or converted into a research packet;
- handoff artifacts must record source agent and source session when available;
- Research should not silently drop handoffs;
- accepted, rejected, and consumed status should be reflected in the `handoff_signal` artifact or transition log;
- quick commands may wrap the handoff tool later, but durable handoff must use the same structured path.

## Evidence Model

Evidence should be typed.

Recommended evidence kinds:

```text
file
artifact
session_summary
handoff_signal
runtime_ref
command_output
external_readonly_source
operator_note
```

Recommended evidence ref:

```yaml
kind: file
ref: docs/Auto-Buildroom/15-dashboard-and-reports.md
hash: sha256:...
excerpt: "Reports are views over receipts."
observedAt: 2026-05-11T12:00:00Z
confidence: high
```

Rules:

- use structured refs instead of ad hoc prose where possible;
- include content hashes for file refs when possible;
- store bounded excerpts, not full raw logs;
- separate direct observations from interpretations;
- label weak or unverified claims explicitly.

File hashes are computed from file bytes at observation time. If the file later changes, the evidence ref still describes what Research observed then.

Evidence `confidence` means confidence that the observation or excerpt was captured correctly. It does not mean an interpretation is true.

Operator notes can guide Research, but they do not bypass approval policy.

## Facts, Interpretations, Weak Claims

Research output must separate:

Facts:

```text
Direct observations supported by evidence.
```

Interpretations:

```text
Researcher's explanation of why facts may matter.
```

Weak claims:

```text
Potentially useful claims that need more evidence before review/build.
```

Example:

```yaml
facts:
  - text: "15-dashboard-and-reports.md defines reports as views over receipts."
    evidenceRefs:
      - kind: file
        ref: docs/Auto-Buildroom/15-dashboard-and-reports.md
interpretations:
  - text: "A concrete operator summary example may make the v0.1 E2E easier to verify."
weakClaims:
  - text: "Telegram report rendering may need a dedicated test later."
    reason: "No implementation exists yet."
    confidence: medium
```

Weak claims should not be passed to Main Review as if they were facts.

## Research Packet

`research_packet` is the durable receipt produced by Research.

It should use the common artifact envelope from `07-artifact-model.md`.

Payload fields:

- topic;
- summary;
- sourceRefs;
- coverage;
- sourcePolicyResult;
- researchHealth;
- facts;
- interpretations;
- evidence;
- weakClaims;
- openQuestions;
- recommendedHandoffs.

Example payload:

```yaml
topic: "Operator summary docs/test gap"
summary: "The docs define Trust Report and operator reporting, but the E2E still needs a concrete report example."
sourceRefs:
  - kind: file
    ref: docs/Auto-Buildroom/15-dashboard-and-reports.md
coverage:
  partial: false
  partialReason: null
  inspectedRefs:
    - docs/Auto-Buildroom/15-dashboard-and-reports.md
  skippedRefs: []
  budgetLimitsHit: []
sourcePolicyResult:
  allowed: true
  scannedPaths:
    - docs/Auto-Buildroom/15-dashboard-and-reports.md
  skippedBlockedPaths:
    - .env
    - config.yml
  violations: []
researchHealth:
  status: ok
  warnings: []
facts:
  - text: "Reports must include confirmed and unconfirmed claims."
    evidenceRefs:
      - kind: file
        ref: docs/Auto-Buildroom/15-dashboard-and-reports.md
interpretations:
  - text: "A report fixture would make QA verification easier."
weakClaims:
  - text: "Dashboard UI may be useful later."
    confidence: low
openQuestions:
  - "Should the first report fixture be Markdown-only or include CLI JSON?"
recommendedHandoffs:
  - target: signal_filter
    reason: "Potential docs/test improvement within v0.1 scope."
```

Rules:

- Research may recommend a handoff;
- Research may not approve a proposal;
- Research may not create a build plan;
- Research may not mark trust state;
- Research packets should be small enough for later roles to inspect.

If Research is partial, `coverage.partial` must be `true` and `partialReason` should explain why.

If source policy fails, downstream proposal creation should be blocked until the issue is resolved or explicitly rejected by policy.

## Findings

Findings are normalized research notes.

Suggested location:

```text
research-vault/findings/
```

A finding should include:

- finding ID;
- topic;
- summary;
- evidence refs;
- confidence;
- createdAt;
- related research packets;
- status.

Status values:

```text
new
merged
superseded
archived
rejected
```

Findings are useful for local organization, but a durable `research_packet` is still required for the Buildroom chain.

## Claims And Verification Queue

Claims that are interesting but weak should go to a verification queue instead of becoming proposals.

Suggested locations:

```text
research-vault/claims/
research-vault/verification/queue/
```

Queue item fields:

- claim ID;
- claim text;
- source refs;
- confidence;
- criticality;
- missing evidence;
- verification question;
- suggested method;
- status.

Status values:

```text
queued
checking
confirmed
rejected
missing_evidence
archived
```

Rule:

```text
Weak claim + interest != ready proposal.
```

## Dossiers

Dossiers group evidence over time around a subject.

Suggested location:

```text
research-vault/dossiers/
```

Examples:

- operator reporting;
- Telegram command UX;
- approval identity;
- docs/test E2E scenario;
- runtime boundary.

Dossiers may contain:

- topic summary;
- related findings;
- related research packets;
- recurring signals;
- stale assumptions;
- open questions;
- last reviewed timestamp.

For v0.1, dossiers are optional. They become useful once the same topic appears across multiple sessions or runs.

## Research Runs

Every Research execution should leave a run record or artifact reference.

Suggested location:

```text
research-vault/runs/
```

Run record fields:

- run ID;
- room ID;
- trace ID;
- startedAt;
- finishedAt;
- inputs scanned;
- files inspected;
- artifacts read;
- sessions summarized;
- outputs created;
- policy checks;
- redaction result;
- errors.

If Research fails before producing a `research_packet`, it should create an `error_receipt` unless artifact storage is unavailable.

## Health

Research health should be visible to the operator.

Suggested location:

```text
research-vault/health/
```

Health checks:

- watch configuration valid;
- allowed paths readable;
- blocked paths not scanned;
- raw transcript access disabled by default;
- external research disabled unless configured;
- redaction checks passing;
- budget not exceeded;
- last successful research run.

Health failures should appear in `status` and reports when they block research or make evidence unreliable.

## Budgets

Research must be bounded.

Recommended v0.1 limits:

- max files inspected per collect run;
- max bytes read per file;
- max session summaries consumed per run;
- max handoff signals consumed per run;
- max research packets per day;
- max runtime minutes per Research stage;
- external research disabled unless configured.

Research should skip binary files and large generated directories by default.

Default ignored examples:

```text
node_modules/
.git/
dist/
build/
coverage/
```

Lock files may be read as metadata when useful, but Research should avoid treating large generated lockfiles as primary evidence unless the topic requires it.

If budget is exceeded:

```text
Research should stop, create a partial packet or error receipt, and say what was not inspected.
```

Partial research is acceptable if it is labeled partial.

## Redaction And Privacy

Research must redact before persistence.

Never persist by default:

- raw private transcripts;
- full runtime logs;
- secrets;
- tokens;
- `.env` contents;
- credential files;
- OAuth refresh tokens;
- Telegram bot tokens;
- private keys.

Research packets should record redaction state:

```yaml
redaction:
  rawTranscriptsIncluded: false
  secretsRedacted: true
  redactedFields: []
```

If redaction fails:

- do not write the unsafe packet;
- create an `error_receipt` if possible;
- block downstream proposal creation from that run.

## External Research

External read-only research is deferred by default for v0.1.

If enabled later:

- it must be read-only unless a separate policy explicitly allows mutation;
- source URLs or API refs must be stored as evidence refs;
- external content must be treated as untrusted;
- prompt-injection content must not override Buildroom policy;
- source timestamps should be recorded;
- excerpts should be bounded and redacted;
- claims from external sources should be marked with confidence.

External research must never create approval or build authority.

## Handoff To Signal Filter

Research can hand off candidate signals to Signal Filter.

Allowed handoff:

```yaml
target: signal_filter
sourceResearchPacketId: research_20260511_operator_summary_docs
candidateSignal:
  type: docs_gap
  text: "Operator reporting contract exists but needs E2E example."
  confidence: medium
  evidenceRefs:
    - kind: artifact
      ref: research_20260511_operator_summary_docs
requestedAction: classify
authority:
  canApprove: false
  canBuild: false
```

Signal Filter decides whether this remains watching, becomes an experiment, goes to Main Review, or is rejected.

Research cannot bypass Signal Filter/Main Review.

Research may create candidate signal payloads.

If v0.1 persists `signal` artifacts directly from Research, they must start in `watching` status. Promotion to `ready` or `queued` belongs to Signal Filter or Main Review.

## Forbidden Research Behavior

Forbidden:

- approving work;
- creating build plans;
- writing code changes;
- mutating external systems;
- reading raw transcripts by default;
- storing raw secrets;
- treating ordinary chat as durable approval;
- treating a handoff as approval;
- treating weak claims as facts;
- passing external content as policy;
- deleting evidence needed for audit;
- hiding partial or failed research.

## Operator UX

Research output should be readable.

Operator-facing Research summary should show:

- topic;
- what was inspected;
- what was found;
- what is evidence-backed;
- what is interpretation;
- what is weak or missing;
- what is recommended next;
- receipt IDs.

Example:

```text
Research completed

Topic:
operator reporting

Found:
- reports are defined as receipt renderings
- dashboard is deferred for v0.1

Weak:
- Telegram rendering still needs implementation evidence

Next:
send candidate signal to Signal Filter

Receipt:
research_20260511_operator_summary_docs
```

## Acceptance Criteria

Research Vault is good enough for v0.1 when:

- Research can create a `research_packet` from local repo evidence;
- facts and interpretations are separated;
- weak claims are labeled and do not become proposals automatically;
- sanitized session summaries can be consumed without raw transcripts;
- ordinary-agent handoffs require the controlled handoff tool;
- handoff accepted/rejected/consumed status is recorded;
- handoff is not approval;
- Research cannot create approval, build plan, QA, or trust artifacts;
- Research-created signals cannot skip Signal Filter/Main Review promotion;
- evidence refs are typed and traceable;
- file hashes describe bytes observed at observation time;
- research packets include coverage and source policy results;
- raw secrets and private transcripts are not persisted by default;
- `research-vault/raw/` is not created by default or carries an explicit warning;
- external research is disabled unless explicitly configured;
- redaction failure blocks downstream proposal creation;
- partial research is labeled partial;
- operator status can show Research health and blockers.
