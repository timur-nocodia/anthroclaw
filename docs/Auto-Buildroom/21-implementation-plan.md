# Implementation Plan

Status: Draft

Purpose: break implementation into milestones and PR-sized slices from skeleton and schemas through policy, demo workflow, runtime runners, sandboxing, Telegram, and the real-world v0.1 E2E test.

## Implementation Thesis

Implement Auto-Buildroom as a project-local control plane around existing AnthroClaw runtime primitives.

Do not build a second agent runtime.

Do not start with a dashboard.

Do not start with autonomous builds.

v0.1 should prove:

```text
local repo evidence
-> research_packet
-> signal / idea_contract
-> main_review
-> explicit approval
-> scoped Builder run
-> independent QA
-> verification_delta
-> trust_report
-> operator_summary
-> optional retention_review
```

The first implementation target is the safe real-world demo:

```text
Improve AnthroClaw operator summary documentation/test/example.
```

## Code-Awareness Requirement

This document is a milestone-level implementation roadmap.

Before coding, Milestone 0 must inspect the actual AnthroClaw repository and replace speculative paths or integration points with confirmed ones.

If any proposed path such as `src/auto-buildroom/`, `src/sdk/`, `src/security/`, or `src/channels/telegram.ts` does not fit the real codebase, keep the same architectural boundary but adapt to the actual AnthroClaw module layout.

No native runtime integration should be implemented until the actual Agent SDK/runtime seam is confirmed.

After Milestone 0, this document should be updated or paired with a code-aware plan that includes exact files, APIs, test commands, and runtime adapter seams.

## Product Boundary For v0.1

In scope:

- project-local config under `.anthroclaw/auto-buildroom/`;
- one default room first;
- JSON artifact store;
- schemas and validation;
- CLI as canonical operator surface;
- manual approval only;
- local repo/docs/tests research;
- sanitized session summaries only if explicitly enabled;
- deterministic Research/Dreamer/Main/QA/Delta/Trust fixtures where useful;
- Builder through native Agent SDK runtime for any repo mutation;
- worktree/sandbox policy;
- Telegram commands after CLI path works;
- real-world E2E test.

Out of scope:

- global `buildrooms` config;
- full web dashboard;
- autonomous low-risk build mode;
- raw session transcript watching;
- external mutating APIs;
- deploy/release/social/email side effects;
- marketplace;
- multi-tenant enterprise console;
- automatic skill/agent/config learning writes.

## Proposed Code Shape

Recommended new module, pending Milestone 0 confirmation:

```text
src/auto-buildroom/
  artifacts/
  cli/
  config/
  engine/
  policy/
  reports/
  research/
  roles/
  runtime/
  storage/
  telegram/
  testing/
  types.ts
```

Existing integration points:

| Existing area | Use |
| --- | --- |
| `src/cli/` | expose `anthroclaw buildroom ...` commands |
| `src/config/` | reuse YAML loading, validation patterns, writer patterns |
| `src/sdk/` | call native Agent SDK integration through adapter |
| `src/security/` | reuse redaction, file safety, approval concepts |
| `src/channels/telegram.ts` | route `/buildroom ...` commands |
| `src/notifications/` | emit Buildroom notifications later |
| `src/learning/` | align retention learning candidates later |

The Buildroom module should be internally cohesive and externally narrow:

- CLI calls Buildroom service APIs;
- Telegram calls the same service APIs;
- runtime adapter is narrow;
- artifact store is the source of truth;
- no Buildroom code imports deep runtime internals except through adapter.

## Milestone 0: Codebase Fit Check

Goal: verify exact AnthroClaw integration points before implementation.

Tasks:

- identify exact package manager and test runner;
- identify TypeScript/ESM build settings and typecheck commands;
- identify existing command parser or CLI registration framework;
- confirm CLI entry strategy for `anthroclaw buildroom`;
- confirm how Telegram command interception should route `/buildroom`;
- confirm Agent SDK runtime call points in `src/sdk/` and `src/gateway.ts`;
- identify native runtime event/status/error model;
- identify whether runtime supports workdir/sandbox/path constraints natively;
- confirm redaction utilities in `src/security/redact.ts`;
- confirm file-safety helpers in `src/security/file-safety.ts`;
- identify existing artifact/log/storage patterns if any;
- identify existing Telegram user identity extraction logic;
- identify whether repo has git worktree assumptions;
- confirm test patterns in `src/**/__tests__`;
- confirm whether repo uses pnpm workspace/plugin builds that affect `pnpm build`.

Deliverables:

- short implementation note inside PR description or `21` update;
- no behavior change.

Exit criteria:

- exact files/modules for next milestones are known;
- no speculative runtime integration remains;
- exact code-aware task plan can be written with real file paths and test commands.

## Milestone 1: Storage Skeleton And Config

Goal: create project-local Buildroom root and config validation.

Implementation areas:

```text
src/auto-buildroom/config/
src/auto-buildroom/storage/
src/auto-buildroom/types.ts
src/cli/
```

Tasks:

- define `BuildroomConfig` schema with Zod;
- support root `.anthroclaw/auto-buildroom`;
- support one default room: `anthroclaw-core`;
- create required directories;
- create root-level `locks/`;
- create room-level `buildroom/`, `runtime/`, `worktrees/`;
- implement `init`;
- implement `validate` or internal config validation;
- add `.gitignore` recommendation behavior but do not silently edit unless command explicitly opts in;
- make `killSwitchActive` override mode.

CLI:

```text
anthroclaw buildroom init
anthroclaw buildroom status
```

Tests:

- init creates expected layout;
- init does not overwrite existing config without explicit flag;
- invalid config blocks execution;
- empty allowed paths invalid in build-capable mode;
- session watching disabled by default;
- raw transcripts disabled by default.

Exit criteria:

- local project can initialize Buildroom safely;
- status can show config blockers.

## Milestone 2: Artifact Store And Schemas

Goal: durable receipt chain exists before behavior.

Implementation areas:

```text
src/auto-buildroom/artifacts/
src/auto-buildroom/storage/
src/auto-buildroom/reports/
```

Tasks:

- implement common artifact envelope;
- implement canonical JSON serialization;
- compute `contentHash` excluding `contentHash`;
- implement typed refs;
- implement artifact ID generation;
- implement artifact validation schemas for required v0.1 artifacts;
- implement append-only write behavior;
- implement `supersedesId`;
- implement transition log;
- implement artifact lookup by ID/type;
- implement redaction-before-persistence gate;
- implement `error_receipt`.

Required schemas:

- `session_summary`;
- `handoff_signal`;
- `research_packet`;
- `signal`;
- `idea_contract`;
- `main_review`;
- `approval`;
- `build_plan`;
- `coder_receipt`;
- `qa_report`;
- `verification_delta`;
- `trust_report`;
- `operator_summary`;
- `retention_review`;
- `error_receipt`.

CLI:

```text
anthroclaw buildroom show <id>
anthroclaw buildroom validate
```

Tests:

- invalid artifact rejected;
- content hash stable;
- hash excludes `contentHash`;
- missing parent blocks child artifact creation;
- Builder-produced QA/Delta/Trust artifact rejected by producer policy;
- `show <id>` auto-detects artifact type.

Exit criteria:

- receipt chain can be stored, validated, rendered, and inspected.

## Milestone 3: State Machine And Policy Gates

Goal: no unsafe transition can happen.

Implementation areas:

```text
src/auto-buildroom/engine/
src/auto-buildroom/policy/
```

Tasks:

- implement room state derivation from artifacts;
- implement lifecycle states;
- implement active/pending workflow precedence;
- separately track latest completed run and latest trust state;
- implement forbidden transition checks;
- implement approval policy;
- implement role separation policy;
- implement path policy;
- implement blockScope: `job | room`;
- implement pause/resume state;
- implement kill switch blocking;
- implement idempotency lock abstraction.

Tests:

- idea cannot become approval directly;
- main_review cannot build without approval;
- approval does not auto-build;
- build without approval blocked;
- revoked/expired approval cannot build;
- approval consumed at execution boundary;
- pause blocks new stages;
- kill switch blocks execution;
- duplicate build start returns existing status;
- path policy violations block trust progression.

Exit criteria:

- engine can reject unsafe workflow transitions without runtime involvement.

## Milestone 4: Deterministic Local Demo Chain

Goal: prove artifact loop without mutating repo.

Implementation areas:

```text
src/auto-buildroom/research/
src/auto-buildroom/roles/
src/auto-buildroom/reports/
```

Tasks:

- implement deterministic local Research over configured docs/tests paths;
- implement deterministic Signal Filter for demo signals;
- implement deterministic Dreamer/idea generation for one safe improvement;
- implement deterministic Main Review that locks docs/tests scope;
- implement manual approval artifact creation;
- approval must record operator identity and route, even for CLI local operator;
- implement deterministic non-mutating Builder fixture for demo mode;
- implement deterministic QA/Delta/Trust over fixture output;
- implement report rendering.

CLI:

```text
anthroclaw buildroom collect
anthroclaw buildroom propose
anthroclaw buildroom review <idea_id>
anthroclaw buildroom approve <review_id>
anthroclaw buildroom build <approval_id>
anthroclaw buildroom qa <build_id>
anthroclaw buildroom trust <build_id>
anthroclaw buildroom report
```

Tests:

- full deterministic chain creates all expected artifacts;
- approval targets `main_review`, not raw idea;
- build does not accept raw idea ID;
- report includes confirmed and unconfirmed claims;
- trust is `watch` when implementation evidence is missing;
- retention review optional but schema-valid.

Exit criteria:

- user can run complete loop locally without repo mutation.

## Milestone 5: Build/Sandbox Execution

Goal: support real scoped repo mutation through native runtime.

Implementation areas:

```text
src/auto-buildroom/runtime/
src/auto-buildroom/policy/
src/sdk/
```

Tasks:

- implement `NativeAgentRuntimeAdapter`;
- prepare Builder prompt contract;
- ensure Auto-Buildroom does not import native runtime internals except through the adapter boundary confirmed in Milestone 0;
- create worktree/sandbox target;
- record baseline:
  - git commit and dirty state when available;
  - approved-path hashes when git unavailable;
  - approved untracked inputs included;
- pass allowed/blocked paths to runtime input;
- persist `runtimeRefs` on build, coder, and error artifacts;
- record native run ID and session ID where available;
- map native runtime statuses/errors to Buildroom statuses without reinterpreting failures as success;
- deny Builder network access by default;
- block native runtime approval requests unless exact action/path is approved;
- ensure Buildroom approval is not treated as blanket native tool approval;
- prepare cancellation/status mapping even if cancel command is deferred;
- compute independent post-run diff;
- run post-run path policy;
- create `coder_receipt` and/or `error_receipt`;
- archive diff summary;
- prevent silent fallback to in-place mutation.

Tests:

- Builder runtime adapter called for real mutation;
- fixture Builder cannot mutate repo;
- worktree creation failure blocks if required;
- dirty baseline recorded;
- untracked approved files handled explicitly;
- post-run diff computed independently;
- symlink escape rejected;
- deletion requires explicit approval;
- blocked path violation creates blocked policy result;
- runtime failure creates `error_receipt`;
- runtime success plus path violation cannot be clean.
- no parallel shell or LLM executor exists for Builder mutation path.

Exit criteria:

- one approved docs/test change can be built in worktree/sandbox with receipts.

## Milestone 6: QA, Delta, Trust Implementation

Goal: real verification layer over Builder output.

Implementation areas:

```text
src/auto-buildroom/roles/
src/auto-buildroom/policy/
src/auto-buildroom/reports/
```

Tasks:

- implement QA runner over coder receipt and independent diff;
- enforce QA role/run differs from Builder;
- record read-only commands or skipped command reasons;
- detect scope/path policy issues;
- implement deterministic Verification Delta;
- classify every Builder claim;
- implement `qaOnlyFindings`;
- implement trust state rules;
- render trust report.

Tests:

- missing QA prevents clean;
- missing delta prevents clean;
- rejected high/critical claim prevents clean;
- missing critical safety/scope evidence blocks;
- unclassified claim becomes missing evidence;
- path/scope violation blocks clean;
- QA pass does not automatically mean clean;
- Builder-produced QA/Delta/Trust artifacts rejected.

Exit criteria:

- trust state is derived from QA/Delta, not Builder self-report.

## Milestone 7: Operator Reports

Goal: human-readable receipts.

Implementation areas:

```text
src/auto-buildroom/reports/
src/auto-buildroom/cli/
```

Tasks:

- implement status renderer;
- implement proposal renderer;
- implement build renderer;
- implement QA/Delta/Trust renderer;
- implement Markdown operator summary;
- implement `operator_summary` artifact with `renderedFromIds`;
- support `report --save`;
- include rendererVersion/templateVersion;
- include policy refs;
- include approval identity and route;
- redact secrets before rendering.

Tests:

- report can be regenerated from artifacts;
- missing artifact produces investigate/blocked output;
- saved summary includes `renderedFromIds`;
- Telegram-safe report path avoids tables later;
- redaction failure blocks report generation.

Exit criteria:

- operator can understand full loop without raw JSON.

## Milestone 8: Telegram Operator Surface

Goal: remote operator commands without approval ambiguity.

Telegram is optional for the first v0.1 release unless the product release requires a remote operator surface. A CLI-only v0.1 is acceptable if the receipt loop is complete and safe.

Implementation areas:

```text
src/auto-buildroom/telegram/
src/channels/telegram.ts
src/notifications/
```

Tasks:

- parse `/buildroom ...` commands;
- enforce Telegram user ID as operator identity;
- separate commandRoutes, approvalRoutes, notificationRoutes;
- reject forwarded approvals;
- reject chat ID as identity;
- reject replies like `yes` or `approve`;
- support status/show/report first;
- support approval/build only after CLI behavior is stable;
- implement async acknowledgement for long-running commands;
- send notifications to configured notification routes.

Tests:

- unconfigured user rejected;
- allowed chat but wrong user rejected;
- right user wrong approval route rejected;
- forwarded approval rejected;
- `/buildroom approve <idea_id>` rejected;
- notification route does not grant approval authority;
- reply text does not approve;
- long report splits safely.

Exit criteria:

- Telegram can operate the same safe workflow as CLI without creating shortcut authority.

## Milestone 9: Retention And Learning Candidates

Goal: post-trust lifecycle recommendation.

Implementation areas:

```text
src/auto-buildroom/roles/
src/learning/
```

Tasks:

- create `retention_review` after trust report;
- support `keep/improve/park/prune_recommended/ghost/reopen`;
- keep `status` as lifecycle and `payload.recommendation` as decision;
- emit learning candidates as recommendations only;
- link memory candidates to receipt IDs;
- never auto-write global memory/skills/config;
- archive recommendation only, no destructive cleanup.

Tests:

- retention cannot delete artifacts;
- `prune_recommended` does not delete;
- memory candidate cannot approve work;
- skill/config prompt update requires new Buildroom loop;
- reopened ghost re-enters Signal Filter.

Exit criteria:

- completed run can produce lifecycle recommendation without new authority.

## Milestone 10: Real-World E2E Test

Goal: prove the user scenario end to end.

Scenario:

1. Operator initializes Buildroom for local AnthroClaw repo.
2. Research inspects docs/tests/recent safe artifacts.
3. Signal/idea proposes one safe operator-summary docs/example/test-fixture improvement.
4. Main Review locks scope.
5. Operator manually approves.
6. Builder runs inside approved worktree/sandbox.
7. QA independently checks.
8. Delta compares claims vs evidence.
9. Trust report is generated.
10. Operator summary is saved.
11. Retention recommends keep/improve/park.

Test command target:

```text
pnpm test
```

Possible focused tests:

```text
npx vitest run src/auto-buildroom/**/__tests__/*.test.ts
```

E2E must prove:

- build blocked before approval;
- approval does not auto-build;
- build consumes approval;
- duplicate build does not double-run;
- Builder cannot write QA/Trust;
- QA cannot be Builder;
- path violation prevents clean;
- operator report contains receipts.

Recommended target should live under examples or fixtures rather than mutating core spec docs when possible:

```text
docs/Auto-Buildroom/examples/operator-summary.md
tests/fixtures/auto-buildroom/operator-summary.fixture.json
```

Exact paths should be confirmed after Milestone 0.

Exit criteria:

- one real local workflow completes with durable receipt chain and operator-readable report.

## Recommended PR Slices

PR 1: docs + storage/config skeleton.

PR 2: artifact schemas/store/hash/transitions.

PR 3: state machine/policy/locks.

PR 4: CLI init/status/show/validate.

PR 5: deterministic demo chain through approval.

PR 6: deterministic QA/Delta/Trust/report.

PR 7: native runtime adapter and worktree build.

PR 8: independent diff/path policy hardening.

PR 9: Telegram operator commands.

PR 10: retention/learning candidates.

PR 11: real-world E2E and operator guide.

Each PR should include tests for the safety boundary it introduces.

## Test Strategy Summary

Use layers:

- unit tests for schemas, hashing, path policy, state transitions;
- integration tests for CLI artifact workflow;
- runtime adapter tests with fixtures;
- worktree/sandbox tests;
- Telegram command authorization tests;
- E2E test for v0.1 scenario.

Required negative tests:

- no approval without `main_review`;
- no build without approval;
- no build from raw idea/signal/handoff;
- no self-QA;
- no clean trust without QA;
- no clean trust with path violation;
- no auto memory/skill mutation from retention;
- no Telegram approval from chat ID alone.

## Release Gates

v0.1 is releasable when:

- Milestone 0 codebase fit check is complete and implementation paths are no longer speculative;
- config/init works project-locally;
- all required schemas validate;
- full receipt chain exists;
- CLI can run the canonical flow;
- Builder mutating run uses native runtime;
- worktree/sandbox policy is enforced;
- QA/Delta/Trust rules pass negative tests;
- report renders without raw JSON;
- Telegram approval identity is safe if Telegram surface is included;
- real-world E2E passes;
- docs explain limitations;
- no Auto-Buildroom code path can mutate the repo without native runtime adapter or explicitly marked non-mutating fixture mode.

## Do Not Implement In v0.1

Do not implement:

- global Buildroom config;
- dashboard approval buttons;
- autonomous build mode;
- raw transcript watcher;
- destructive cleanup;
- automatic skill updates;
- production deploy/release actions;
- external mutating integrations;
- social/email posting;
- multi-tenant features.

These can be reconsidered after the local receipt loop is proven.

## Implementation Risks

| Risk | Mitigation |
| --- | --- |
| Buildroom becomes second runtime | keep runtime adapter narrow; use Agent SDK only |
| Artifact schema too complex | implement required v0.1 fields first; validate hard |
| Approval ambiguity | approve only `main_review`; build only approval/plan |
| Path policy bypass | independent baseline/diff; realpath checks |
| Telegram shortcut authority | require user ID + approval route + exact command |
| Fixture bypasses safety | non-mutating fixtures only; same artifact checks |
| Trust overstates result | default to `watch/investigate/blocked` when evidence missing |
| Retention deletes evidence | archive preferred; destructive cleanup deferred |

## Open Implementation Questions

These should be answered by code inspection before the relevant milestone:

- exact CLI registration pattern for `anthroclaw buildroom`;
- whether Buildroom should be a plugin package or core module in v0.1;
- exact native runtime adapter boundary in current `src/sdk/`;
- how to expose Telegram command route without cluttering ordinary agent chats;
- whether worktree is mandatory for first real mutation or sandbox is enough;
- whether deterministic role fixtures should live under tests only or production-gated demo mode;
- how much of `retention_review` is required for the first E2E.

## v0.1 Completion Definition

Auto-Buildroom v0.1 implementation is complete when an operator can run:

```text
anthroclaw buildroom init
anthroclaw buildroom collect
anthroclaw buildroom propose
anthroclaw buildroom review <idea_id>
anthroclaw buildroom approve <review_id>
anthroclaw buildroom build <approval_id>
anthroclaw buildroom qa <build_id>
anthroclaw buildroom trust <build_id>
anthroclaw buildroom report --save
anthroclaw buildroom retain <trust_id>
```

And then inspect:

- the full artifact chain;
- approval identity and route;
- build scope;
- changed files;
- QA evidence;
- Verification Delta;
- Trust Report;
- operator summary;
- retention recommendation.

The result should demonstrate:

```text
agent work becomes structured, inspectable, and approvable
```
