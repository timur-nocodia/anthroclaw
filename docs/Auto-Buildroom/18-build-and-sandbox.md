# Build And Sandbox

Status: Draft

Purpose: define scoped build execution, worktree isolation, command running, diff boundary enforcement, cleanup, and rollback expectations.

## Build Thesis

Builder executes approved work inside a box.

The box is defined by:

- `main_review` locked scope;
- `approval` artifact;
- `build_plan`;
- allowed paths;
- blocked paths;
- mutation target;
- native runtime permissions;
- pre-run and post-run policy checks;
- idempotency lock;
- resulting `coder_receipt` or `error_receipt`.

Core rule:

```text
Builder may act only after approval, only inside scope, and only through the native runtime.
```

Builder is not an autonomous product owner. It is the hands of a bounded workflow.

## v0.1 Scope

Required for v0.1:

- build starts only from `approval_id` or `build_plan_id`;
- approval must target `main_review` with `decision: approved_for_operator`;
- approval is consumed when the first build attempt starts;
- Builder uses native AnthroClaw Agent SDK runtime;
- repo mutation happens in configured `worktree` or `sandbox`;
- in-place mutation is disabled by default;
- pre-run path policy check;
- post-run path policy check;
- duplicate Builder starts prevented by lock/idempotency key;
- Builder creates `coder_receipt` on completion;
- `error_receipt` is created when Builder cannot produce expected receipt;
- Builder claims are passed to QA, not treated as proof.

Deferred:

- autonomous low-risk builds;
- production deploys;
- release publishing;
- external system mutation;
- PR creation;
- multi-builder parallel execution;
- long-lived build environments;
- automatic rollback of arbitrary code changes.

v0.1 should prove:

```text
approval -> build_plan -> native runtime in worktree/sandbox -> coder_receipt -> QA
```

## Build Preconditions

Before Builder starts, all conditions must pass:

- Buildroom mode allows build execution;
- room is not paused;
- `killSwitchActive` is false;
- config validates;
- target approval exists;
- approval is unrevoked and unexpired;
- approval has not been consumed by a different build plan;
- approval targets a `main_review` with locked scope;
- allowed paths and blocked paths are present;
- blocked paths override allowed paths;
- build plan exists or can be derived from approval/review;
- build plan scope matches approval scope;
- idempotency lock is acquired;
- mutation target is available;
- working directory stays inside approved repo/worktree/sandbox root;
- pre-run path policy passes;
- external side effects are denied unless explicitly allowed by policy.

If any precondition fails, Builder must not start.

Failure should create an `error_receipt` when artifact storage is available.

## Authority Chain

Allowed chain:

```text
main_review.approved_for_operator
-> approval.granted
-> build_plan.ready
-> builder run
-> coder_receipt.submitted
```

Forbidden shortcuts:

```text
idea_contract -> build
signal -> build
handoff_signal -> build
main_review -> build without approval
approval -> implicit build
approval -> build with changed scope
builder claim -> trust.clean
```

Approval grants authority.

Build consumes authority.

Approval does not execute the build by itself.

## Approval Consumption

For v0.1, approval is consumed at the execution boundary.

The execution boundary is reached when:

- lock is acquired;
- build plan is resolved;
- final pre-run policy passes;
- mutation target is prepared;
- native runtime Builder start is attempted.

Rules:

- approval consumption and Builder start must be protected by the same lock;
- failures before the execution boundary create an `error_receipt` when possible but do not consume the approval;
- failures after native runtime start is attempted consume the approval and require explicit retry handling;
- consumed approval cannot authorize a different build plan;
- if scope changes, a new Main Review and approval are required;
- retry must be explicit and reference the consumed approval plus previous `error_receipt`;
- duplicate CLI/Telegram/cron triggers must return existing run status instead of starting another Builder.

Lock scope:

```text
roomId + approvalId + buildPlanId
```

Idempotency key:

```text
buildroom:<roomId>:builder:<approvalId>:<buildPlanId>
```

## Build Plan

`build_plan` translates approved scope into executable work.

It is not execution outcome.

Required payload fields:

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
- timeout.

Rules:

- build plan cannot be ready without approval;
- build plan cannot expand approved scope;
- build plan should be deterministic enough for QA to inspect;
- build plan commands are proposed execution steps, not proof;
- runtime status belongs in `coder_receipt` or `error_receipt`.

## Mutation Target

Supported config values:

```text
worktree
sandbox
in_place
```

Recommended v0.1 default:

```yaml
execution:
  mutationTarget: worktree
  allowInPlaceDocsTests: false
```

Rules:

- `worktree` or `sandbox` is preferred for any repo mutation;
- `in_place` is disabled by default;
- in-place mutation may be allowed only through explicit config for low-risk docs/tests flows;
- mutation target path must stay inside configured repo/worktree/sandbox root;
- symlink escape and path traversal must be rejected before runtime start;
- worktree cleanup must not delete artifacts.

## Worktree Layout

Suggested location:

```text
.anthroclaw/auto-buildroom/rooms/<roomId>/worktrees/
```

Suggested build worktree:

```text
worktrees/
  build_<traceId>/
```

Worktree record should include:

- worktree path;
- source repo root;
- base commit or base file hashes when available;
- dirty-state summary;
- approved untracked inputs included in the worktree;
- build plan ID;
- approval ID;
- trace ID;
- createdAt;
- cleanup policy;
- archived diff path if retained.

If worktree creation fails and config requires worktree, build is blocked.

Do not silently fall back to in-place mutation.

If the project is a git repo, the worktree record should include base commit and dirty-state summary.

If no git metadata is available, record base file hashes for approved paths when feasible.

If the source repo is dirty, v0.1 may allow the build only when baseline hashes are recorded for approved paths.

Worktree creation must define how untracked but approved input files are handled: copied, blocked, or explicitly included. For v0.1, untracked approved files should be copied into the worktree only if they are inside approved scope and recorded in the worktree record.

## Native Runtime Boundary

Builder execution must go through the native AnthroClaw Agent SDK runtime.

Buildroom must not:

- implement a parallel LLM tool loop;
- bypass native runtime permissions;
- run Builder shell/code outside configured runtime/sandbox;
- spoof runtime messages;
- mutate runtime session state outside official APIs;
- reinterpret native runtime failure as success.

Buildroom passes constraints to runtime:

- role;
- stage;
- working directory;
- prompt/context;
- allowed paths;
- blocked paths;
- parent artifact IDs;
- runtime approval mode;
- external side effect policy;
- idempotency key;
- trace ID.

Passing path constraints to runtime is not enough. Buildroom must still run its own pre-run and post-run filesystem checks.

## Path Policy

Builder may modify only approved paths.

Path policy comes from:

- room config;
- Main Review locked scope;
- approval artifact;
- build plan.

Blocked paths override allowed paths.

Path policy applies to repository filesystem paths, not code blocks inside documentation files.

Default blocked examples:

```text
.env
**/.env
**/*secret*
**/*token*
**/credentials*
config.yml
config.yaml
**/config.yml
**/config.yaml
agents/**
```

Pre-run policy should verify:

- working directory is inside allowed root;
- planned paths are within allowed paths;
- blocked paths are not targeted;
- external side effects are denied;
- approval/build plan scope matches review scope.

Post-run policy should verify:

- changed files;
- created files;
- deleted files;
- symlink changes;
- file mode changes if relevant;
- generated artifacts;
- blocked path violations;
- unexpected files.

Deleting files should require explicit approval in the build plan unless the file is generated or temporary within approved scope.

Builder must not create or modify symlinks unless explicitly approved.

Post-run policy must resolve real paths before allow/deny decisions.

Example:

```yaml
preRunPolicyResult:
  allowed: true
  checkedPaths:
    - docs/**
    - tests/**
  blockedPaths:
    - .env
    - config.yml
  violations: []
postRunPolicyResult:
  allowed: false
  changedFiles:
    - docs/Auto-Buildroom/18-build-and-sandbox.md
    - config.yml
  violations:
    - path: config.yml
      reason: blocked_path
```

Any blocked path violation prevents `trust.clean`.

Severe path violations may set `blockScope: room`.

## Independent Diff Computation

Buildroom must compute changed files independently from the recorded baseline.

Allowed sources:

- `git diff` when available;
- filesystem snapshot and file hashes when git is unavailable;
- worktree metadata.

Builder/runtime-reported changed files are claims, not proof.

The independently computed diff is used for:

- post-run path policy;
- QA input;
- trust gating;
- operator report changed-file lists.

Before runtime starts, Buildroom records a baseline:

- git commit and worktree status when available;
- approved-path file hashes when git is unavailable;
- untracked approved inputs if included.

After runtime ends, Buildroom computes changed files against that baseline.

## External Side Effects

External side effects are blocked by default in v0.1.

Blocked unless separately approved by future policy:

- deploy;
- publish release;
- send email;
- post social content;
- mutate GitHub issues/PRs;
- push commits;
- change production config;
- call external write APIs;
- rotate credentials.

Read-only external research belongs to Research policy, not Builder by default.

Builder should operate on local repo/worktree state for the v0.1 demo.

## Builder Prompt Contract

Builder should receive a contract, not an open-ended prompt.

Required prompt/context sections:

- objective;
- approved scope;
- allowed paths;
- blocked paths;
- non-goals;
- acceptance criteria;
- verification plan;
- external side effects policy;
- expected receipt fields;
- what not to claim without evidence.

Builder prompt must say:

```text
Do not modify files outside approved scope.
Do not change Buildroom config or approval policy.
Do not create QA, Delta, Trust, or approval artifacts.
Your claims are not proof.
```

## Command Execution

Build plan may include commands, but runtime owns execution semantics.

Rules:

- commands must be inside approved working directory;
- commands must not use network or external side effects unless policy allows;
- commands should avoid destructive cleanup outside sandbox/worktree;
- command output should be bounded and redacted before persistence;
- failed commands should be recorded in `coder_receipt` or `error_receipt`;
- command success is not equivalent to QA success.

Build plan commands are advisory unless approved as exact commands.

Native runtime may choose equivalent safe actions within scope, but any command execution must respect policy.

If exact shell commands are approved, command arguments must be redacted before artifact persistence.

In v0.1, Builder network access is denied by default, including read-only network, unless explicitly allowed for the stage. Read-only external research belongs to Research, not Builder.

If a command needs native runtime approval, Buildroom must not auto-grant it from prior Buildroom approval unless that exact tool/action/path was included in approved scope and routed through the correct approval surface.

For v0.1, native runtime approval requests during Builder should block and surface to the operator unless implementation can prove the exact tool/action/path was included in the approval artifact.

## Coder Receipt

Builder must produce `coder_receipt` when execution completes enough to describe what happened.

Required payload fields:

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

Rules:

- Builder claims are not proof;
- changed files must be listed;
- claims should reference files or command evidence when possible;
- known limitations must not be omitted;
- path policy violations must be explicit;
- `coder_receipt` moves the workflow to QA, not trust.

## Error Receipt

Create `error_receipt` when:

- pre-run policy fails before Builder starts;
- lock acquisition fails in a way that blocks execution;
- worktree/sandbox cannot be created;
- native runtime fails;
- native runtime is cancelled;
- native runtime is blocked by approval;
- Builder times out;
- Builder cannot produce `coder_receipt`;
- post-run policy fails before a safe receipt can be produced;
- redaction fails.

If Builder completed but post-run policy fails, Buildroom should create a `coder_receipt` if it can safely describe changed files, and also create an `error_receipt` or mark the receipt policy result as blocked.

Trust cannot become clean while the policy failure remains unresolved.

Error receipt should include:

- stage: builder;
- target build plan;
- approval ID;
- runtime refs if available;
- error type;
- redacted message;
- recoverable;
- retryAllowed;
- blockScope.

If artifact storage is unavailable, operator report must say that no durable error receipt was created.

## Diff And Output Capture

Buildroom should capture a bounded diff summary.

Capture:

- changed file paths;
- additions/deletions summary;
- created/deleted files;
- relevant command summaries;
- runtime run refs;
- output file hashes when possible.

Do not persist by default:

- full raw runtime logs;
- secrets;
- `.env` contents;
- credential values;
- massive command output;
- private transcripts.

Large outputs should be referenced, summarized, redacted, capped, or rotated.

## Cleanup And Archive

Cleanup must not erase receipts.

Worktree cleanup policies:

```text
keep
archive_diff
delete_after_receipt
manual
```

Recommended v0.1:

```text
archive_diff
```

Rules:

- cleanup happens after coder receipt/error receipt is persisted;
- cleanup must not delete artifacts;
- cleanup failures should be visible but should not rewrite build result;
- archived diffs should be content-hashable when possible.

## Rollback

Rollback is limited in v0.1.

If using worktree/sandbox:

- discard worktree to abandon changes;
- preserve artifacts and diff summary;
- record resolution transition.

If in-place mutation is explicitly allowed:

- rollback must be manual or operator-confirmed;
- automatic rollback is deferred unless implementation has a safe revert mechanism;
- rollback action must create a receipt/transition;
- rollback must not erase evidence of the failed build.

## Retry

Retry is explicit.

Rules:

- retry must reference prior `error_receipt`;
- retry must reference consumed approval;
- retry must not change scope;
- retry must acquire same lock or a retry-specific lock;
- retry must create new runtime run refs;
- retry must not bypass failed policy checks;
- if scope changes, new Main Review and approval are required.

v0.1 may defer retry command implementation. If deferred, operator should create a new approval/build path or use a documented explicit retry later.

## Pause And Cancel

Pause is not cancellation.

Pause:

- blocks new stages;
- does not automatically stop active native runtime;
- should show `activeRun: true` when a build is running.

Cancel:

- must be explicit;
- asks native runtime to cancel;
- records cancellation in `error_receipt` or transition;
- does not delete artifacts or worktree evidence.

## Fixture Builds

Deterministic fixtures are allowed only for non-executing demos/tests that do not mutate the repo.

Rules:

- fixture workflows must still produce valid artifacts;
- simulated execution must not bypass approval requirements;
- fixture Builder cannot mutate repository files;
- fixture output must be clearly marked as demo/test data;
- real mutation requires native runtime.

## Trust Boundary

Builder completion does not mean the work is trusted.

After Builder:

```text
coder_receipt -> QA -> verification_delta -> trust_report
```

Trust cannot become `clean` from:

- runtime success alone;
- command success alone;
- Builder's self-report;
- changed files existing;
- missing QA;
- path policy violation.

QA may run on a path-violating coder receipt to document evidence, but trust cannot become `clean` until the violation is resolved.

## Operator UX

Build start response should show:

- build ID;
- approval ID;
- build plan ID;
- mutation target;
- working directory;
- allowed scope;
- blocked paths;
- next status command.

Example:

```text
Build started

Build:
build_20260511_operator_summary_docs

Approval:
approval_20260511_operator_summary_docs

Mutation target:
worktree

Scope:
- docs/**
- tests/**

Next:
anthroclaw buildroom status
```

Build completion response should show:

- runtime status;
- changed files;
- policy result;
- coder receipt ID;
- QA next action.

Example:

```text
Build completed

Coder receipt:
build_20260511_operator_summary_docs

Changed:
- docs/Auto-Buildroom/18-build-and-sandbox.md

Policy:
post-run allowed

Important:
Builder claims are not proof.

Next:
anthroclaw buildroom qa build_20260511_operator_summary_docs
```

## Acceptance Criteria

Build and sandbox are good enough for v0.1 when:

- build cannot start without unrevoked, unexpired approval;
- approval is consumed at the native runtime execution boundary;
- duplicate build triggers do not create duplicate Builder runs;
- Builder runs through native runtime for any repo mutation;
- Builder mutation target is worktree/sandbox by default;
- in-place mutation is explicit and disabled by default;
- dirty repo baseline is recorded for approved paths when allowed;
- untracked approved inputs are handled explicitly;
- working directory cannot escape approved root;
- pre-run and post-run path policy results are recorded;
- Buildroom computes post-run diff independently from Builder/runtime claims;
- blocked paths override allowed paths;
- symlink creation/modification requires explicit approval;
- file deletion requires explicit approval unless generated/temp within approved scope;
- path violation prevents `trust.clean`;
- Builder creates `coder_receipt` or `error_receipt`;
- Builder cannot write QA, Delta, Trust, or approval artifacts;
- external side effects are blocked by default;
- Builder network access is denied by default;
- native runtime approval requests block by default unless exact approved action/path is proven;
- fixture builds cannot mutate repo;
- cleanup never deletes receipts;
- retry cannot bypass approval or policy;
- operator output says Builder claims are not proof.
