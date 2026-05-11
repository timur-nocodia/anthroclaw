# Rollout Plan

Status: Draft

Purpose: define staged rollout from local manual MVP to dogfooding, Telegram operator flows, low-risk auto-build, and public release.

## Rollout Thesis

Auto-Buildroom should roll out by increasing trust, not by increasing autonomy first.

The rollout order is:

```text
receipts -> policies -> CLI loop -> deterministic proof -> real local worktree -> dogfood -> optional Telegram -> private alpha -> v0.1 public
```

Do not ship broader autonomy until the system can prove:

- who proposed the work;
- why it was worth doing;
- who approved the scope;
- what Builder changed;
- what QA confirmed;
- what remained unproven;
- what Trust Report says the operator should believe.

The product should earn autonomy through receipts.

## Implementation Milestone Mapping

Implementation milestones and rollout phases are related, but not identical.

Rough mapping:

```text
Implementation Milestones 0-3 -> Rollout Phases 1-2
Implementation Milestone 4 -> Rollout Phase 3
Implementation Milestones 5-7 -> Rollout Phase 4
Implementation Milestones 8-9 -> Rollout Phases 6-7 if included
Implementation Milestone 10 -> Release gate for Rollout Phase 8
```

Rollout Phase 5 begins only after the real-world E2E passes.

## E2E Modes

Mode A:

```text
deterministic non-mutating fixture loop
```

Purpose:

- prove artifact chain;
- prove approval boundaries;
- prove report rendering;
- prove trust logic;
- avoid repository mutation.

Mode B:

```text
real local worktree/sandbox build through native AnthroClaw runtime
```

Purpose:

- prove native runtime boundary;
- prove scoped mutation;
- prove independent diff;
- prove QA, Delta, Trust, and operator summary on the real repo.

Public v0.1 requires Mode B.

## Global Stop Conditions

Pause rollout and fix before progressing if any of these occur:

- Builder mutation bypasses native runtime adapter;
- build runs without explicit approval;
- approval is inferred from ordinary chat, reply, or reaction;
- path/scope violation is missed by post-run policy;
- `trust.clean` is produced without QA and Verification Delta;
- secret or raw transcript is persisted;
- retention deletes audit evidence;
- operator cannot tell what changed from reports/receipts.

A conservative `watch` or `investigate` is a successful safety outcome when evidence is incomplete.

A false `clean` is a release blocker.

## Non-Negotiables During Rollout

These constraints apply to every rollout phase:

- no second LLM/runtime loop;
- no self-approval;
- no Builder self-QA;
- no build without explicit approval;
- no approval outside Buildroom operator surface;
- no raw transcript watching by default;
- no external mutating side effects by default;
- no production deploy/release/social/email actions;
- no automatic skill/agent/config learning writes;
- no `trust.clean` without QA and Verification Delta;
- no destructive retention cleanup of audit artifacts.

Any rollout step that violates these constraints is not v0.1 rollout. It is a separate product decision.

## Rollout Principles

### 1. CLI First

CLI is the canonical v0.1 operator surface.

Telegram, dashboard, daily digest, and future UI surfaces should call the same Buildroom service APIs and produce the same artifact chain.

If CLI and Telegram disagree, CLI/artifacts win.

### 2. Manual Approval First

v0.1 mode:

```text
manual_approval
```

Allowed automation:

- collect evidence;
- detect signals;
- propose ideas;
- generate review drafts;
- render reports.

Not allowed in v0.1:

- build execution without explicit operator approval;
- approval inferred from ordinary chat;
- approval inferred from handoff;
- approval inferred from watched sessions.

### 3. Local Repo First

The first release is project-local:

```text
.anthroclaw/auto-buildroom/
```

Do not introduce global `buildrooms` config, multi-tenant storage, or centralized enterprise dashboards before the local loop proves itself.

Buildroom state is local project state and should usually be gitignored by default:

```text
.anthroclaw/auto-buildroom/
```

### 4. Docs/Test Scope First

The first mutation target should be low-risk:

```text
docs/Auto-Buildroom/examples/**
tests/fixtures/auto-buildroom/**
```

Do not start with:

- `agents/**`;
- `config.yml`;
- production runtime config;
- deploy workflows;
- channel adapters;
- external API mutation.

### 5. Trust Before Autonomy

Low-risk auto-build modes may be explored only after v0.1 proves:

- approval boundary;
- runtime boundary;
- independent QA;
- Verification Delta;
- Trust Report;
- real-world E2E.

Auto-build is not the first wedge.

The first wedge is:

```text
Agents with receipts.
```

## Rollout Phases

## Phase 0: Documentation Baseline

Goal: make the product, safety, runtime, storage, UX, and test model explicit before coding.

Scope:

- product concept;
- AnthroClaw integration model;
- user mental model;
- operator UX;
- artifact model;
- state machine;
- policy/safety;
- runtime boundary;
- storage/config;
- CLI/Telegram specs;
- reports;
- research/subconscious/build/QA/trust/retention;
- implementation plan;
- testing strategy;
- real-world E2E.

Exit criteria:

- documentation set exists under `docs/Auto-Buildroom/`;
- v0.1 product decisions are recorded;
- open questions that block implementation are converted into product decisions;
- implementation plan is explicitly marked milestone-level until code-aware fit check.

Do not proceed if:

- approval route is ambiguous;
- runtime boundary is ambiguous;
- artifact chain is ambiguous;
- v0.1 scope includes auto-build by default.

## Phase 1: Codebase Fit Check

Goal: convert architecture-level plan into code-aware implementation plan.

Required checks:

- package manager and test runner;
- CLI entrypoint and command registration;
- Telegram command interception path;
- Agent SDK runtime integration points;
- runtime event/status/error model;
- workdir/sandbox support;
- redaction utilities;
- file-safety helpers;
- existing storage/log patterns;
- route identity extraction;
- test conventions;
- build/typecheck commands.

Output:

- updated implementation plan or companion code-aware plan;
- confirmed module paths;
- confirmed test commands;
- confirmed runtime adapter seam.

Exit criteria:

- no speculative runtime integration remains;
- Buildroom can be implemented without importing deep runtime internals;
- CLI and Telegram can share the same Buildroom service layer;
- negative-first testing plan can be mapped to actual test files.

Do not proceed if:

- the only path to Builder mutation is a custom LLM/tool loop;
- runtime seam cannot record run IDs/status/errors;
- approval identity cannot be recorded;
- no safe artifact store path is available.

## Phase 2: Storage, Config, And Artifact Skeleton

Goal: create the local Buildroom control-plane foundation without real build execution.

Scope:

- `.anthroclaw/auto-buildroom/` root;
- one default room;
- config validation;
- artifact envelope;
- canonical hashing;
- typed refs;
- transition logs;
- derived status/index rebuild;
- `init`, `status`, `show`, `validate` or equivalent.

Operator-visible capability:

```text
anthroclaw buildroom init
anthroclaw buildroom status
anthroclaw buildroom show <id>
```

Exit criteria:

- Buildroom can initialize safely;
- invalid config blocks execution;
- artifacts can be written and validated;
- status can explain blockers;
- no runtime execution exists yet.

Do not proceed if:

- artifacts are mutable without transitions/supersession;
- `contentHash` is ambiguous;
- config allows raw transcripts by default;
- config treats Telegram chat ID as operator identity.

## Phase 3: Deterministic Receipt Loop

Goal: prove the artifact chain and operator flow before any repository mutation.

Scope:

- deterministic Research;
- deterministic Signal/Idea;
- deterministic Main Review;
- explicit approval artifact;
- deterministic non-mutating Builder fixture;
- deterministic QA/Delta/Trust;
- operator summary rendering.

Canonical flow:

```text
collect -> propose -> review -> approve -> build fixture -> qa -> trust -> report
```

Required safety checks:

- approval still required;
- approval does not auto-build;
- build before approval is blocked;
- fixture Builder cannot mutate repo;
- fixture artifacts are marked as test/demo data;
- `trust.clean` cannot come from Builder self-report.

Exit criteria:

- full receipt chain exists;
- CLI can show every artifact;
- report is understandable without raw JSON;
- deterministic E2E passes;
- negative authority boundary tests pass.

Do not proceed if:

- fixture mode bypasses approval;
- fixture mode can create production-looking receipts;
- Trust Report overclaims real mutation or production readiness.

## Phase 4: Real Worktree Build Dogfood

Goal: prove one real local repository improvement with approved worktree/sandbox mutation.

Target scenario:

```text
operator-summary-docs-improvement
```

Preferred target files:

```text
docs/Auto-Buildroom/examples/operator-summary.md
tests/fixtures/auto-buildroom/operator-summary.fixture.json
```

Required behavior:

- Builder mutation goes through native Agent SDK runtime;
- mutation target is worktree/sandbox;
- approval consumed at execution boundary;
- baseline recorded;
- post-run diff computed independently;
- changes stay inside approved paths;
- QA is independent;
- Verification Delta classifies every Builder claim;
- Trust Report is produced;
- operator summary saved.

Expected trust outcome:

```text
watch
```

`watch` is acceptable and expected if the build proves the docs/example improvement but does not prove production autonomous mode.

A `clean` result is not required for the first real dogfood run.

Overclaiming `clean` is worse than shipping `watch`.

Exit criteria:

- Mode B real-world E2E passes once on the real AnthroClaw repository;
- duplicate build does not double-run;
- policy violation tests pass;
- no external side effects occur;
- no blocked paths are touched;
- saved receipts can be inspected after the run.

Do not proceed if:

- Builder mutation bypasses native runtime adapter;
- post-run diff comes only from Builder/runtime claims;
- worktree unavailable silently falls back to in-place mutation;
- approval consumption is racy;
- Trust Report says `clean` without full evidence.

## Phase 5: Internal Dogfood

Goal: use Buildroom repeatedly on AnthroClaw itself in manual mode.

Allowed work types:

- docs improvements;
- test fixture improvements;
- operator summary examples;
- narrow report wording improvements;
- non-mutating research/reporting refinements.

Not allowed:

- config mutation;
- agent prompt mutation;
- skill mutation;
- channel adapter mutation;
- deploy/release automation;
- external system mutation;
- raw session watching.

Dogfood cadence:

- run at least 3 manual approval loops;
- review receipts after each loop;
- record friction in docs/issues;
- adjust CLI/report UX before adding more surfaces.

Required measurements:

- number of proposals;
- number approved;
- number built;
- QA status distribution;
- Trust state distribution;
- policy blocks;
- operator time to understand report;
- confusing or missing receipt fields.

Exit criteria:

- at least 3 successful receipt chains;
- no high/critical safety regression;
- operator can explain each Trust Report from receipts;
- failure cases produce useful `error_receipt` or blocked status;
- no report requires raw JSON to understand.

Do not proceed if:

- operator cannot tell what happened;
- report language overstates trust;
- QA misses obvious scope/path issues;
- receipts are hard to inspect or link.

## Phase 6: Optional Telegram Operator Surface

Goal: add remote operator commands and notifications without changing authority semantics.

Telegram is optional for CLI-only v0.1.

If included, it must support:

- `/buildroom status`;
- `/buildroom show <id>`;
- `/buildroom approve <review_id>`;
- `/buildroom build <approval_id>`;
- `/buildroom report`;
- notification routing.

Required model:

```text
operator identity != chat/thread route
```

Recommended route split:

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

Exit criteria:

- Telegram commands call same service APIs as CLI;
- unauthorized users cannot learn whether artifact IDs exist;
- notification route does not grant authority;
- replies like `yes` or `approve` do not create authority;
- General/no-topic sourceThread is null/omitted;
- long-running commands acknowledge asynchronously.

Do not proceed if:

- approval can be inferred from ordinary chat;
- chat ID is treated as operator identity;
- Telegram path bypasses CLI policy/state checks;
- notification topic can approve work by accident.

## Phase 7: Private Alpha

Goal: validate the product with a small number of trusted technical users.

Target users:

- AnthroClaw maintainers;
- AI builders already using local agents;
- solo operators comfortable with CLI;
- users comfortable inspecting local repo files and artifacts when needed;
- internal engineering users.

Alpha scope:

- CLI-first;
- local repo only;
- manual approval only;
- docs/tests examples only;
- no external side effects;
- no raw transcript watching;
- Telegram optional.

Onboarding promise:

```text
Buildroom turns agent work from chat output into accountable work artifacts.
```

Do not promise:

- autonomous employee;
- self-improving organization;
- unattended production changes;
- enterprise dashboard;
- automatic PR/deploy.

Alpha success criteria:

- users understand Agent vs Buildroom distinction;
- users understand approval does not auto-build;
- users can inspect receipts;
- users trust `watch` as useful, not as failure;
- users do not need raw JSON for normal operation;
- users can recover from blocked/error states.

Alpha failure signals:

- users think Buildroom is just another chat agent;
- users expect “yes” in chat to approve;
- reports are too long or too vague;
- users cannot find what changed;
- users cannot tell why Trust is `watch` or `blocked`;
- path/scope policies feel surprising or invisible.

## Phase 8: v0.1 Public Release

Goal: ship a narrow, honest version that proves accountable agent work.

Required release surface:

- documentation;
- CLI commands;
- project-local config;
- artifact store;
- manual approval flow;
- native-runtime Builder path for mutation;
- independent QA;
- Verification Delta;
- Trust Report;
- operator summary;
- real-world E2E proof.

Optional release surface:

- Telegram commands and notifications;
- retention review;
- deterministic demo mode.

If Telegram is not included in public v0.1, all Telegram docs/specs must be marked planned or optional and must not be represented as shipped behavior.

Release claim:

```text
Auto-Buildroom v0.1 turns local AnthroClaw agent work into scoped, approvable, verified receipts.
```

Allowed tagline:

```text
Receipts for autonomous agent work.
```

Do not claim:

```text
fully autonomous AI employee
self-improving organization
production autonomous mode
automatic low-risk builds
external action safety
enterprise control room
```

unless separate implementation and E2E proof exists.

## Schema Compatibility Before Public v0.1

Dogfood artifacts created before public v0.1 may require reset or migration.

Before public v0.1:

- schema version must be documented;
- compatibility expectations must be stated;
- unsupported schema versions must fail closed;
- if dogfood artifacts are not migrated, the reset path must be explicit;
- public v0.1 artifacts should remain inspectable across patch releases unless a migration note says otherwise.

## Deferred Phases

The following are explicitly post-v0.1.

### Low-Risk Auto-Build

Potential future mode:

```text
auto_low_risk
```

Requirements before enabling:

- repeated successful manual loops;
- risk classifier validated;
- scoped path policy proven;
- rollback/recovery tested;
- operator notification before/after;
- explicit config opt-in;
- hard daily budgets;
- new E2E tests for unattended execution.

Even then:

```text
auto_low_risk does not mean self-approval
```

It means pre-approved low-risk classes under strict policy.

### Raw Session Watching

Potential future capability:

- explicit opt-in only;
- strong redaction;
- privacy review;
- per-agent/session allowlist;
- clear operator visibility;
- no approval authority from raw sessions.

Default remains:

```text
watch sanitized summaries, not raw sessions
```

### External Research

Potential future capability:

- read-only web/GitHub/Linear research;
- source records;
- prompt-injection hardening;
- no external mutation;
- evidence treated as evidence, not policy.

### External Side Effects

Potential future capability:

- PR creation;
- issue comments;
- release notes publishing;
- deploy triggers;
- social/email posting.

Requirements:

- separate approval class;
- identity and route hardening;
- dry-run preview;
- external receipt;
- rollback or correction plan;
- dedicated E2E per side-effect type.

### Dashboard

Potential future capability:

- read-only receipt navigation first;
- no dashboard approval until identity model is hardened;
- CLI remains canonical until dashboard parity is tested.

## Rollback And Kill Switch

Every phase must preserve a fast stop path.

Required controls:

- `killSwitchActive: true` blocks new scheduled stages and new builds;
- `pause` blocks new stages without deleting state;
- `resume` does not auto-start builds;
- failed stages leave `error_receipt`;
- stuck locks are visible in status;
- config blockers are shown to operator.

Rollback expectations:

- rollback implementation changes through normal git workflow;
- do not delete receipts to “undo” a Buildroom run;
- archive or supersede artifacts instead of mutating history;
- preserve audit chain for failed rollout attempts.

## Release Gates

Auto-Buildroom may progress from one phase to the next only when:

- all phase exit criteria are met;
- required negative tests pass;
- no non-negotiable safety rule is broken;
- operator reports are understandable without raw JSON;
- failures leave receipts or explicit blocked status;
- Trust Reports do not overclaim.

v0.1 public release requires:

- documentation baseline complete;
- code-aware plan complete;
- core CI green;
- real-world E2E Mode B passed;
- no runtime fork;
- no external side effects;
- manual approval only;
- at least one saved operator summary from real run;
- release notes accurately describe limits.

## Launch Checklist

Before public v0.1:

- confirm `pnpm build` passes;
- confirm `pnpm test` passes;
- run focused Auto-Buildroom tests;
- run real-world E2E Mode B;
- inspect receipt chain manually;
- verify no secrets in artifacts/reports;
- verify no blocked paths changed;
- verify status/report are understandable;
- verify README/docs say manual approval only;
- verify docs do not imply production autonomy;
- verify Telegram docs are marked optional if not shipped.

## Success Metrics

Product metrics:

- proposal-to-approval rate;
- approval-to-build completion rate;
- QA pass/pass_with_notes/fail/blocked distribution;
- Trust state distribution;
- number of blocked unsafe actions;
- operator time to understand report;
- number of follow-up questions needed to trust a result.

Safety metrics:

- builds blocked before approval;
- duplicate builds prevented;
- path violations detected;
- external side-effect attempts blocked;
- secret redactions triggered;
- failed stages with receipts;
- blocked/error states resolved without developer intervention;
- trust overclaim regressions.

Adoption metrics:

- number of local rooms initialized;
- number of completed receipt chains;
- number of saved operator summaries;
- number of users completing first E2E demo;
- number of users who can explain Agent vs Buildroom after onboarding.

## Positioning By Phase

Early internal:

```text
Buildroom is a receipt chain for agent work.
```

Dogfood:

```text
Buildroom turns local agent initiative into scoped, approved, verified work.
```

Private alpha:

```text
Let agents find useful work without losing control.
```

v0.1 public:

```text
Receipts for autonomous agent work.
```

Avoid:

```text
AI employee
self-driving engineering team
hands-free production builder
agent that does everything
```

## Acceptance Criteria

The rollout plan is good enough for v0.1 when:

- phases increase trust before autonomy;
- CLI-first path is clear;
- Telegram is optional and authority-safe;
- private alpha scope is narrow;
- public claims match proven behavior;
- low-risk auto-build is explicitly deferred;
- raw transcripts and external side effects are explicitly deferred;
- kill switch and rollback behavior are defined;
- release gates require real-world E2E Mode B.
