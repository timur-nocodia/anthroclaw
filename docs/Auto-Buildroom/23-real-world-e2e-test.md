# Real-World E2E Test

Status: Draft

Purpose: define the complete user-facing end-to-end test that proves Auto-Buildroom can find useful work, request approval, build within scope, pass QA, produce a trust report, and show operator receipts.

## E2E Thesis

The real-world E2E test should prove the product promise, not just command plumbing.

The promise is:

```text
agent work becomes structured, inspectable, approvable, verifiable, and reportable
```

The E2E must show that Auto-Buildroom can:

1. observe a local AnthroClaw repository;
2. identify one safe useful improvement;
3. turn it into a bounded proposal;
4. wait for explicit operator approval;
5. build only inside approved scope;
6. run independent QA;
7. compare Builder claims with QA evidence;
8. produce a Trust Report;
9. save a receipt chain the operator can inspect later.

It must also show the negative boundary:

```text
initiative does not become authority
approval does not auto-execute
runtime success does not equal trust
```

## What This Test Is Not

This E2E is not:

- a full dashboard test;
- a multi-tenant enterprise test;
- a raw transcript watching test;
- an autonomous build mode test;
- a deploy/release test;
- a social/email/external side-effect test;
- a test that grants build authority to ordinary agents.

v0.1 should pass this test before any broader autonomous behavior is considered.

## Code-Awareness Requirement

This document defines the required E2E behavior.

Exact command names, binary names, test harness paths, and fixture paths must be confirmed during Milestone 0.

If the implementation exposes a different CLI entrypoint, keep the same operator flow and authority boundaries:

```text
init -> collect -> propose -> review -> approve -> build -> qa -> trust -> report
```

The E2E must run against the real AnthroClaw codebase, not only against mocked schemas.

## Canonical Scenario

Scenario name:

```text
operator-summary-docs-improvement
```

User-facing story:

```text
As an AnthroClaw operator,
I want Auto-Buildroom to notice that operator summary docs/examples can be improved,
ask me for approval,
make the improvement inside a narrow docs/test scope,
verify the result independently,
and show me a receipt-backed Trust Report.
```

Recommended target:

```text
Improve AnthroClaw operator summary documentation/test/example.
```

Preferred implementation target files should be examples or fixtures, not core product specs:

```text
docs/Auto-Buildroom/examples/operator-summary.md
tests/fixtures/auto-buildroom/operator-summary.fixture.json
```

If those paths do not exist yet, the E2E may create them only if they are explicitly inside the approved scope.

Avoid using the main Auto-Buildroom spec documents themselves as the mutation target. The E2E should prove the product loop, not rewrite its own foundational requirements.

## Required Run Modes

The E2E should support two modes.

### Mode A: Deterministic Non-Mutating Proof

Purpose: prove artifact chain, approvals, reports, and trust gating without changing repository files.

Allowed:

- deterministic Research fixture;
- deterministic Idea/Dreamer fixture;
- deterministic Main Review fixture;
- deterministic non-mutating Builder fixture;
- deterministic QA/Delta/Trust fixture.

Required:

- approval still required;
- fixture Builder cannot mutate repository files;
- artifacts are marked as fixture/test data;
- report states that no real repository mutation was performed.

Mode A is useful during early implementation, but it is not enough for final v0.1 release.

### Mode B: Real Worktree Mutation

Purpose: prove the full real-world loop.

Required:

- Builder mutation goes through native AnthroClaw Agent SDK runtime;
- mutation target is a worktree or approved sandbox;
- Buildroom records baseline before runtime start;
- Buildroom computes diff independently after runtime completion;
- QA checks actual output;
- Trust Report is derived from QA and Verification Delta.

Mode B is the v0.1 release gate.

## Preconditions

Before running the E2E:

- Node version satisfies repository requirements;
- dependencies are installed;
- the AnthroClaw repository is available locally;
- Milestone 0 has confirmed the CLI entrypoint and test commands;
- Buildroom config is project-local;
- external side effects are disabled;
- raw transcript watching is disabled;
- Builder network access is denied by default;
- one local operator identity is configured;
- worktree/sandbox support is available or the test explicitly runs in non-mutating fixture mode.

Recommended local operator identity:

```text
cli:user:local-operator
```

Recommended room:

```text
anthroclaw-core
```

## Repository State Requirement

Preferred starting state:

```text
clean git working tree
```

If the repository is dirty, the E2E may still run only if:

- the dirty baseline is recorded;
- approved-path file hashes are captured before build;
- untracked approved inputs are explicitly included or blocked;
- Trust Report explains that the baseline was dirty.

The E2E must never silently mix pre-existing user edits with Builder output.

## v0.1 Config For The Test

Recommended E2E config shape:

```yaml
schemaVersion: auto-buildroom/v1
roomId: anthroclaw-core
mode: manual_approval
killSwitchActive: false

operators:
  - id: cli:user:local-operator
    approvalRoutes:
      - cli:local
    commandRoutes:
      - cli:local

watch:
  repo:
    enabled: true
  docs:
    enabled: true
  tests:
    enabled: true
  sessions:
    enabled: false
  rawTranscripts:
    enabled: false
  external:
    enabled: false

paths:
  allowed:
    - docs/Auto-Buildroom/examples/**
    - tests/fixtures/auto-buildroom/**
  blocked:
    - .env
    - .env.*
    - config.yml
    - config.yaml
    - agents/**
    - data/**
    - .anthroclaw/auto-buildroom/**/buildroom.yml

execution:
  mutationTarget: worktree
  allowInPlaceDocsTests: false
  requireApprovalForBuild: true
  consumeApprovalOnBuildStart: true
  retryRequiresOperatorCommand: true

external:
  readOnlyResearch:
    enabled: false
  sideEffects:
    default: deny

budgets:
  maxIdeasPerDay: 5
  maxBuildsPerDay: 1
  maxActiveBuilds: 1
  maxRuntimeMinutesPerStage: 20
```

Path policy applies to repository filesystem paths, not Markdown code blocks inside documentation.

## Expected Artifact Chain

The E2E must produce a traceable chain:

```text
research_packet
-> signal
-> idea_contract
-> main_review
-> approval
-> build_plan
-> coder_receipt
-> qa_report
-> verification_delta
-> trust_report
-> operator_summary
-> optional retention_review
```

Each artifact must include:

- common envelope;
- `room.id`;
- `traceId`;
- `producer`;
- `parentIds`;
- typed `inputRefs`;
- typed `outputRefs`;
- redaction status;
- `contentHash`;
- timestamp;
- schema version.

The operator must be able to inspect any artifact with:

```text
anthroclaw buildroom show <id>
```

Exact command may change after Milestone 0, but the inspectability requirement must remain.

## Step-By-Step CLI Flow

The CLI is the canonical v0.1 operator surface.

### 1. Initialize Buildroom

Command:

```text
anthroclaw buildroom init --room anthroclaw-core --operator cli:user:local-operator
```

Expected:

- `.anthroclaw/auto-buildroom/` exists;
- room config exists;
- room directories exist;
- root-level `locks/` exists;
- config validates;
- raw session watching is disabled;
- external side effects are denied.

Status command:

```text
anthroclaw buildroom status
```

Expected status:

```text
Mode: manual_approval
Room state: idle
Trust: none
Pending approvals: 0
Approved not built: 0
Active builds: 0
Kill switch: inactive
```

### 2. Collect Local Evidence

Command:

```text
anthroclaw buildroom collect
```

Expected:

- `research_packet` created;
- local docs/tests/repo evidence inspected;
- no raw private transcripts included;
- no external network used by default;
- `coverage` recorded;
- `sourcePolicyResult` recorded.

Example output:

```text
Research packet created:
research_20260511_operator_summary_docs

Coverage:
partial: false

Next:
anthroclaw buildroom propose
```

### 3. Propose An Idea

Command:

```text
anthroclaw buildroom propose
```

Expected:

- safe signal or idea candidate created;
- no approval created;
- no build plan created;
- no repository mutation.

Example output:

```text
Idea created:
idea_20260511_operator_summary_docs

Summary:
Improve operator summary docs/example so receipts, QA evidence, and trust state are easier to understand.

Next:
anthroclaw buildroom review idea_20260511_operator_summary_docs
```

### 4. Main Review Locks Scope

Command:

```text
anthroclaw buildroom review idea_20260511_operator_summary_docs
```

Expected:

- `main_review` created;
- review targets the idea;
- scope is locked;
- allowed paths are explicit;
- blocked paths are explicit;
- non-goals are explicit;
- acceptance criteria are explicit;
- risk is low or watch-level;
- review decision is `approved_for_operator`.

Example output:

```text
Review created:
review_20260511_operator_summary_docs

Decision:
approved_for_operator

Requested scope:
- docs/Auto-Buildroom/examples/**
- tests/fixtures/auto-buildroom/**

Non-goals:
- do not edit agents/**
- do not edit config.yml
- do not publish, deploy, or call external APIs

Next:
anthroclaw buildroom show review_20260511_operator_summary_docs
anthroclaw buildroom approve review_20260511_operator_summary_docs
```

### 5. Negative Check: Build Before Approval Is Blocked

Command:

```text
anthroclaw buildroom build review_20260511_operator_summary_docs
```

Expected:

- command rejected;
- no Builder run starts;
- no approval is inferred;
- no build plan is created from raw review authority;
- exit code indicates approval required or invalid target.

Example output:

```text
Build rejected.

Reason:
build requires approval artifact

This command accepts:
- approval ID
- build plan ID

Next:
anthroclaw buildroom approve review_20260511_operator_summary_docs
```

### 6. Approve The Review

Command:

```text
anthroclaw buildroom approve review_20260511_operator_summary_docs
```

Expected:

- `approval` artifact created;
- approval targets `main_review`;
- operator identity recorded;
- route recorded;
- approval does not start build;
- approval state is `granted`;
- status shows approved-not-built.

Example output:

```text
Approval created:
approval_20260511_operator_summary_docs

Approved by:
cli:user:local-operator

Important:
Approval grants authority.
Build consumes authority.
Approval did not start a build.

Next:
anthroclaw buildroom build approval_20260511_operator_summary_docs
```

Status after approval:

```text
Pending approvals: 0
Approved not built: 1
Active builds: 0
QA pending: 0
```

There must be no `coder_receipt` yet.

### 7. Build Inside Approved Scope

Command:

```text
anthroclaw buildroom build approval_20260511_operator_summary_docs
```

Expected:

- per-room/per-approval lock acquired;
- build plan created or resolved;
- approval consumed at execution boundary;
- worktree/sandbox prepared;
- baseline recorded;
- native Agent SDK runtime invoked for mutation;
- Builder receives approved scope and non-goals;
- no external side effects occur;
- post-run diff computed independently;
- `coder_receipt` created;
- `error_receipt` created if runtime or policy fails.

Example output:

```text
Build started:
build_20260511_operator_summary_docs

Approval consumed:
approval_20260511_operator_summary_docs

Mutation target:
worktree

Allowed scope:
- docs/Auto-Buildroom/examples/**
- tests/fixtures/auto-buildroom/**
```

Expected completed output:

```text
Build completed:
build_20260511_operator_summary_docs

Coder receipt:
coder_20260511_operator_summary_docs

Changed files:
- docs/Auto-Buildroom/examples/operator-summary.md
- tests/fixtures/auto-buildroom/operator-summary.fixture.json

Next:
anthroclaw buildroom qa coder_20260511_operator_summary_docs
```

### 8. Negative Check: Duplicate Build Does Not Double-Run

Command:

```text
anthroclaw buildroom build approval_20260511_operator_summary_docs
```

Expected:

- no second Builder run starts;
- command returns existing build/run status;
- idempotency lock or consumed approval prevents duplicate execution.

Example output:

```text
Build already exists for this approval:
build_20260511_operator_summary_docs

No new Builder run was started.
```

### 9. QA Independently Checks The Build

Command:

```text
anthroclaw buildroom qa coder_20260511_operator_summary_docs
```

Expected:

- QA role/run differs from Builder;
- QA receives redacted/bounded runtime refs;
- QA checks changed files against independent diff;
- QA checks acceptance criteria;
- QA records commands run or skipped;
- QA records evidence;
- QA does not mutate repo except approved temp/cache outputs;
- `qa_report` created.

Example output:

```text
QA report created:
qa_20260511_operator_summary_docs

Status:
pass_with_notes

Confirmed:
- operator summary example exists
- fixture exists
- changed files are inside approved scope

Notes:
- no production autonomous mode tested

Next:
anthroclaw buildroom trust coder_20260511_operator_summary_docs
```

### 10. Generate Verification Delta And Trust Report

Command:

```text
anthroclaw buildroom trust coder_20260511_operator_summary_docs
```

Expected:

- `verification_delta` created;
- every Builder claim classified;
- QA-only findings included;
- `trust_report` created;
- trust state derived from QA/Delta/policy, not Builder;
- trust state stored lowercase and rendered uppercase.

Example output:

```text
Verification Delta:
delta_20260511_operator_summary_docs

Trust Report:
trust_20260511_operator_summary_docs

Trust: WATCH

Why not CLEAN:
- docs/example improvement was verified
- production autonomous mode was not tested
- no external side-effect behavior was tested

Next:
anthroclaw buildroom report --save
```

For this v0.1 scenario, `watch` is an acceptable and often preferred trust state. The goal is not to force `clean`; the goal is to honestly report what was proven.

### 11. Save Operator Summary

Command:

```text
anthroclaw buildroom report --save
```

Expected:

- Markdown operator summary rendered;
- `operator_summary` artifact created;
- summary includes `renderedFromIds`;
- summary includes trust state, confirmed items, missing evidence, risks, next action;
- summary does not become source of truth if it disagrees with artifacts.

Example output:

```text
Operator summary saved:
.anthroclaw/auto-buildroom/rooms/anthroclaw-core/buildroom/operator/reports/summary_20260511_operator_summary_docs.md

Operator summary artifact:
summary_20260511_operator_summary_docs

Rendered from:
- trust_20260511_operator_summary_docs
- delta_20260511_operator_summary_docs
- qa_20260511_operator_summary_docs
```

### 12. Optional Retention Review

Command:

```text
anthroclaw buildroom retain trust_20260511_operator_summary_docs
```

Expected:

- `retention_review` created;
- recommendation stored in payload;
- no destructive cleanup;
- no automatic memory/skill/config mutation.

Example output:

```text
Retention review:
retention_20260511_operator_summary_docs

Recommendation:
keep

Learning:
none applied automatically
```

Retention is optional for the first E2E but required before claiming the full lifecycle is implemented.

## Required Negative Checks

The E2E must include these negative checks, either inline or as adjacent test cases.

### Approval Boundary

Must prove:

- raw idea ID cannot be approved;
- signal cannot be approved;
- handoff cannot be approved;
- review cannot build without approval;
- approval does not auto-build;
- approval through non-operator route is rejected.

Example:

```text
anthroclaw buildroom approve idea_20260511_operator_summary_docs
```

Expected:

```text
Approval rejected.
Reason: approval target must be main_review
```

### Build Boundary

Must prove:

- raw idea ID cannot build;
- raw review ID cannot build;
- missing approval blocks build;
- consumed approval cannot authorize a second build;
- changed scope requires new review/approval.

### Policy Boundary

Must prove:

- blocked path change prevents clean trust;
- out-of-scope file change prevents clean trust;
- symlink escape is rejected;
- unapproved deletion prevents clean trust;
- external side-effect request is blocked.

### Trust Boundary

Must prove:

- Builder self-report cannot produce clean trust;
- runtime success alone cannot produce clean trust;
- missing QA prevents clean trust;
- missing Delta prevents clean trust;
- missing critical safety/scope evidence produces blocked.

## Filesystem Assertions

After the E2E, the operator or test harness should verify:

Allowed changes only:

```text
docs/Auto-Buildroom/examples/**
tests/fixtures/auto-buildroom/**
```

No changes to:

```text
agents/**
config.yml
config.yaml
.env
.env.*
data/**
.anthroclaw/auto-buildroom/**/buildroom.yml
```

Buildroom artifacts may be created under:

```text
.anthroclaw/auto-buildroom/**
```

Repository mutation must be compared against the recorded baseline, not against Builder claims.

## Receipt Assertions

The E2E passes only if receipts exist and link correctly.

Required receipt checks:

- each artifact has valid `contentHash`;
- artifact parent chain is complete;
- approval parent is `main_review`;
- coder receipt parent includes build plan/approval chain;
- QA parent includes coder receipt;
- Delta parent includes coder receipt and QA report;
- Trust parent includes Delta and QA;
- operator summary parent includes Trust;
- no artifact contains raw transcript by default;
- no artifact contains detected secrets;
- no artifact claims more than its evidence supports.

If there is no receipt, the E2E should behave as if the action did not happen.

## Expected Trust Outcome

Recommended v0.1 outcome:

```text
Trust: WATCH
```

Why:

- docs/example improvement can be verified;
- allowed scope can be verified;
- QA can confirm claims;
- but production autonomous operation is not proven;
- external side effects are intentionally untested;
- future dashboard/Telegram surfaces may be out of scope.

`CLEAN` is allowed only if all high/critical claims are confirmed, policy checks pass, no unresolved errors exist, and the Trust Report does not overclaim production readiness.

`BLOCKED` is required if any critical safety/scope evidence is missing or if policy violations occurred.

## Telegram Variant

Telegram is optional for CLI-only v0.1.

If included, the Telegram E2E should reuse the same service APIs and artifact chain.

Required Telegram checks:

- `/buildroom status` works in allowed command route;
- `/buildroom approve <review_id>` works only for configured `telegram_user`;
- approval records user ID, chat route, and thread route if present;
- General/no-topic approval records `sourceThread` as null or omitted;
- notification route receives reports but does not grant authority;
- replies like `yes` or `approve` do not create authority;
- unauthorized users cannot learn whether artifact IDs exist.

Recommended route model:

```yaml
operators:
  - id: telegram_user:48705953
    commandRoutes:
      - telegram_chat:-1003931616911
    approvalRoutes:
      - telegram_chat:-1003931616911

notifications:
  routes:
    - telegram_thread:-1003931616911:2
```

The Telegram E2E must not replace the CLI E2E. CLI remains canonical for v0.1.

## Failure Handling Expectations

Every failure should leave an operator-visible explanation.

Expected failure artifacts or transitions:

- invalid config -> blocked status with config reason;
- policy violation before runtime -> `error_receipt`;
- runtime failure -> `error_receipt`;
- runtime blocked by native approval -> blocked/operator action required;
- post-run policy failure -> `coder_receipt` when safe plus `error_receipt` or blocked policy result;
- QA failure -> `qa_report` with failure evidence;
- trust failure -> `trust_report` with `blocked` or `investigate`.

Failure must not silently disappear.

## Manual Acceptance Checklist

An operator should be able to answer yes to every item:

- I can see what the Buildroom noticed.
- I can see the evidence behind the proposal.
- I can see the locked scope before approval.
- I can see who approved and through which route.
- I can verify approval did not start the build.
- I can see what Builder changed.
- I can see whether changes stayed inside scope.
- I can see what QA confirmed.
- I can see what QA did not confirm.
- I can see the Verification Delta between claims and evidence.
- I can see a Trust Report that does not overclaim.
- I can open the saved receipt chain later.

If any answer is no, the E2E has not proven the v0.1 product promise.

## Automated Acceptance Criteria

The automated E2E is good enough for v0.1 when:

- it can run from a fresh project-local Buildroom config;
- it creates the full receipt chain;
- it includes at least one blocked pre-approval build attempt;
- it proves approval does not auto-build;
- it proves duplicate build does not double-run;
- it proves Builder mutation goes through native runtime or fixture is explicitly non-mutating;
- it computes post-run diff independently;
- it verifies changed files are inside approved scope;
- it runs independent QA;
- it generates Delta and Trust;
- it saves an operator summary;
- it exits non-zero on missing receipts, missing QA, policy violation, or trust overclaim.

## Release Gate

Auto-Buildroom v0.1 should not be considered ready until Mode B passes at least once on the real AnthroClaw repository.

Minimum release statement:

```text
Auto-Buildroom v0.1 passed the real-world E2E:
one local repo improvement was noticed, proposed, approved, built in scope,
verified independently, summarized with trust state, and persisted as receipts.
```

Do not claim:

```text
fully autonomous agent team
self-improving organization
production autonomous mode
external action safety
dashboard readiness
```

unless separate E2E tests prove those claims.
