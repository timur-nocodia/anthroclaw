# Testing Strategy

Status: Draft

Purpose: define unit, integration, security, fixture, and E2E test coverage required before Auto-Buildroom can be considered safe.

## Testing Thesis

Auto-Buildroom tests must prove safety boundaries, not just happy paths.

The system is only trustworthy if tests show:

- thoughts do not become tasks automatically;
- approvals are explicit artifacts;
- builds cannot run without approval;
- Builder cannot verify itself;
- runtime success is not trust;
- path violations block clean trust;
- reports render receipts, not invented state.

Core test principle:

```text
Every authority boundary needs a negative test.
```

## TDD And Negative-First Rule

Auto-Buildroom safety gates should be implemented test-first.

For each authority boundary:

1. write the negative test first;
2. run it and verify it fails for the expected reason;
3. implement the smallest schema, policy, state, or runtime check;
4. run the focused test and verify it passes;
5. run the relevant layer suite.

Do not implement a new authority path unless its forbidden shortcuts already have failing tests.

This rule matters most for:

- artifact validation;
- approval gates;
- path policy;
- Telegram identity and route checks;
- trust clean blockers;
- retention no-delete behavior.

## Authority Boundary Checklist

Each boundary below must have at least one negative test:

- Research cannot approve.
- Subconscious cannot approve.
- Signal Filter cannot build.
- Signal cannot become approval.
- Idea cannot become approval directly.
- Main Review cannot build without approval.
- Approval does not auto-build.
- Build cannot start without unexpired and unrevoked approval.
- Consumed approval cannot authorize a different scope.
- Builder cannot produce QA, Verification Delta, or Trust.
- QA cannot approve.
- QA cannot mutate repo except approved temp/cache outputs.
- Runtime success cannot create `trust.clean`.
- Missing QA prevents clean trust.
- Missing Delta prevents clean trust.
- Path or scope violation prevents clean trust.
- Telegram chat/thread cannot approve without configured user identity.
- Notification route cannot grant approval authority.
- Retention cannot delete receipts.
- Learning candidate cannot mutate memory, skills, agents, or config automatically.

## Code-Awareness Requirement

This strategy assumes the current AnthroClaw test stack is Vitest and follows existing `src/**/__tests__` patterns.

Milestone 0 must confirm:

- package manager;
- test runner;
- TypeScript build/typecheck command;
- CLI test harness pattern;
- Telegram command test harness pattern;
- runtime adapter mock/stub strategy;
- worktree/sandbox test feasibility.

If the codebase differs, keep the same test boundaries but adapt paths and commands.

## Test Commands

Baseline command:

```text
pnpm test
```

Focused command after implementation:

```text
npx vitest run src/auto-buildroom/**/__tests__/*.test.ts
```

Build/typecheck gate:

```text
pnpm build
```

Exact commands must be confirmed in Milestone 0.

## Test Layers

Required layers:

1. Schema and artifact unit tests.
2. Storage and hash tests.
3. State machine tests.
4. Policy and safety tests.
5. CLI integration tests.
6. Deterministic role fixture tests.
7. Runtime adapter tests.
8. Worktree/sandbox tests.
9. QA/Delta/Trust tests.
10. Report rendering tests.
11. Telegram authorization tests.
12. Retention/learning tests.
13. Real-world E2E test.

Each layer should include positive tests and negative tests.

## Suggested Test Layout

Pending Milestone 0 confirmation:

```text
src/auto-buildroom/
  artifacts/__tests__/
  config/__tests__/
  engine/__tests__/
  policy/__tests__/
  storage/__tests__/
  cli/__tests__/
  roles/__tests__/
  runtime/__tests__/
  reports/__tests__/
  telegram/__tests__/
  testing/
```

Integration tests may live under:

```text
src/__tests__/integration/
```

Fixtures may live under:

```text
tests/fixtures/auto-buildroom/
src/auto-buildroom/testing/fixtures/
```

Do not rely on exact paths until Milestone 0 confirms codebase conventions.

## Schema And Artifact Tests

Must test:

- all required v0.1 artifact schemas validate good fixtures;
- missing required fields fail;
- unknown unsafe producer-role transitions fail;
- common envelope required fields exist;
- `contentHash` excludes `contentHash`;
- canonical JSON serialization is stable;
- typed refs validate;
- parent IDs are required where expected;
- missing parent artifacts block child artifact creation;
- `supersedesId` works without silent mutation;
- unsupported schema versions fail closed with an actionable error;
- superseded artifacts remain inspectable;
- artifacts are redacted before persistence;
- high-confidence secrets fail closed.

Negative tests:

- `approval` without `main_review` rejected;
- `build_plan` without `approval` rejected;
- Builder-produced `qa_report` rejected;
- Builder-produced `verification_delta` rejected;
- Builder-produced `trust_report` rejected;
- operator summary cannot create approval/trust;
- malformed hash detected.

Schema evolution tests:

- unsupported future `schemaVersion` rejected or marked unsupported;
- minor-compatible versions are accepted only if explicitly supported;
- validation errors appear through `validate` or equivalent operator surface;
- `supersedesId` never deletes the prior artifact.

## Storage Tests

Must test:

- `init` creates project-local root;
- one default room is created;
- root-level `locks/` exists;
- room-level artifact directories exist;
- indexes/state are rebuildable from artifacts;
- logs are diagnostic, not source of truth;
- `research-vault/raw/` is not created by default or contains warning if created;
- archive move preserves content hashes;
- artifacts win when index disagrees;
- transition log records status changes.

Negative tests:

- corrupt artifact blocks derived state;
- missing artifact prevents report regeneration;
- cache deletion does not delete artifacts;
- archive cannot invalidate hash by path move.

## Config Tests

Must test:

- minimal config validates;
- full v0.1 config validates;
- `killSwitchActive` overrides mode;
- `manual_approval` requires operator identity;
- empty allowed paths invalid when build execution is enabled;
- blocked paths override allowed paths;
- raw transcripts disabled by default;
- external side effects denied by default;
- session watching default is disabled;
- Builder and QA identities must differ.

Negative tests:

- Telegram chat ID treated as operator identity is rejected;
- raw transcripts enabled without explicit opt-in rejected or warned;
- worktree required but unavailable blocks build-capable config;
- global `buildrooms` config is not required for v0.1.

## State Machine Tests

Must test allowed transitions:

```text
idle -> collecting
collecting -> proposal_ready
proposal_ready -> awaiting_approval
awaiting_approval -> approved
approved -> building
building -> qa_pending
qa_pending -> trust_pending
trust_pending -> complete
```

Must test artifact states:

- `signal.watching -> ready -> queued_for_idea`;
- `idea_contract.ready_for_review -> approved_by_review`;
- `approval.granted -> consumed`;
- `coder_receipt.submitted -> qa_pending`;
- `qa_report.submitted -> delta_pending`;
- `verification_delta.generated -> trust_pending`.

Forbidden transition tests:

- signal -> approval;
- idea -> approval;
- idea -> build plan;
- review -> build without approval;
- approval -> implicit execution;
- approval revoked/expired -> build;
- build plan -> trust clean;
- coder receipt -> trust clean without QA;
- verification delta with missing high/critical evidence -> clean;
- paused -> build without resume;
- unresolved error receipt -> clean.

## Approval And Identity Tests

Must test:

- approval targets `main_review`;
- approval records operator identity;
- approval records approval route;
- approval does not start build;
- approval is consumed at execution boundary;
- setup failure before execution boundary does not consume approval;
- native runtime start attempt consumes approval;
- consumed approval cannot authorize different scope;
- retry references consumed approval plus error receipt.

Negative tests:

- raw idea ID approval rejected;
- watched session approval rejected;
- handoff approval rejected;
- ordinary chat approval rejected;
- unknown operator rejected;
- missing route rejected;
- approval by chat ID alone rejected.

Concurrency tests:

- two concurrent build commands for the same approval produce one Builder run;
- approval consumption is atomic with the runtime start boundary;
- stale lock recovery does not start a duplicate Builder run;
- duplicate requests return the existing run or blocked state.

## Policy Tests

Must test:

- blocked paths override allowed paths;
- path policy applies to filesystem paths, not Markdown code blocks;
- realpath resolves symlink escape;
- path traversal rejected;
- deleting files requires explicit approval;
- symlink creation/modification requires explicit approval;
- Builder cannot change Buildroom config or approval policy;
- external side effects denied by default;
- Builder network access denied by default.

Path policy should use table-driven tests for:

- allowed docs path accepted;
- blocked path rejected even when it also matches an allowed glob;
- `docs/../config.yml` rejected after normalization;
- absolute paths rejected unless normalized under the repo/sandbox root;
- symlink inside an allowed directory pointing outside scope rejected;
- symlink inside an allowed directory pointing to `.env` rejected;
- Windows-style separators normalized or explicitly unsupported;
- case-sensitivity behavior documented and tested for the target platforms.

Negative tests:

- changed blocked path prevents `trust.clean`;
- changed file outside allowed scope blocks clean;
- unapproved deletion blocks clean;
- unapproved symlink blocks clean;
- external write API action blocked;
- native runtime approval request blocks unless exact approved action/path proven.

Redaction regression fixtures should include:

- `.env`-style content;
- `OPENAI_API_KEY=...`;
- `ANTHROPIC_API_KEY=...`;
- Telegram bot token-like strings;
- OAuth refresh token-like strings;
- private key blocks;
- command arguments containing token-like values.

These must be tested across:

- artifact JSON;
- `error_receipt`;
- CLI output;
- Markdown reports;
- Telegram message rendering if Telegram is included.

## CLI Tests

Must test:

- `init` creates config and storage;
- `status` shows mode, room state, latest trust, pending approvals, approved-not-built, blockers;
- `collect` creates research packet;
- `propose` creates idea contract but not approval;
- `review` creates main review;
- `approve <review_id>` creates approval and does not build;
- `build <approval_id|build_plan_id>` starts only with valid approval;
- `qa <build_id>` requires coder receipt;
- `trust <build_id>` requires QA;
- `report` renders without writing by default;
- `report --save` creates operator summary;
- `show <id>` auto-detects artifact type;
- `pause` blocks new stages;
- `resume` does not auto-start build.

Negative tests:

- build rejects raw idea ID;
- approve rejects raw idea ID;
- missing artifact returns missing artifact error;
- paused room rejects build;
- kill switch rejects execution;
- duplicate build returns existing run.

## Deterministic Fixture Tests

Must test:

- deterministic Research creates valid `research_packet`;
- deterministic Signal Filter creates safe signal status;
- deterministic Dreamer creates `idea_contract`;
- deterministic Main Review locks scope;
- deterministic non-mutating Builder fixture creates valid receipt;
- deterministic QA/Delta/Trust produce expected `watch` when evidence is missing.

Safety requirements:

- fixture Builder cannot mutate repo;
- fixture Builder receipt must include an explicit mode such as `executionMode: fixture_non_mutating`;
- fixture workflow still requires approval if simulating execution;
- fixture artifacts validate schemas;
- fixture output is clearly marked demo/test data;
- fixture path cannot bypass policy.

Negative tests:

- fixture artifacts cannot be treated as production artifacts unless test/demo mode is active;
- fixture mode cannot produce `trust.clean` without QA and Delta;
- fixture mode cannot bypass path policy.

## Runtime Adapter Tests

Must test with mocks/stubs before real runtime:

- Buildroom calls adapter, not runtime internals;
- runtime input includes roomId, role, stage, workingDirectory, traceId, idempotencyKey;
- allowed/blocked paths passed;
- runtime refs persisted;
- runtime completed still runs post-policy;
- runtime failure creates `error_receipt`;
- runtime cancellation creates error/cancelled transition;
- runtime blocked_by_approval surfaces operator action;
- runtime success plus policy violation blocks clean;
- raw runtime logs are not persisted.

Negative tests:

- direct shell/LLM executor path for Builder mutation does not exist;
- native approval request is not auto-granted by Buildroom approval;
- missing runtime refs prevent clean trust when needed.

## Worktree And Sandbox Tests

Must test:

- worktree/sandbox created under approved root;
- no silent fallback to in-place mutation;
- dirty baseline recorded when allowed;
- untracked approved files handled explicitly;
- independent diff computed after runtime;
- Builder-reported changed files are not trusted alone;
- cleanup does not delete artifacts;
- archived diff is hashable.

Negative tests:

- worktree unavailable blocks build when required;
- working directory escape rejected;
- symlink escape rejected;
- changed blocked path detected independently;
- changed unexpected file detected;
- in-place mutation rejected unless explicitly configured.

## QA, Delta, And Trust Tests

Must test:

- QA role/run differs from Builder;
- QA receives redacted/bounded runtime refs;
- QA records confirmed claims;
- QA records rejected claims;
- QA records missing evidence;
- QA records skipped commands and why;
- QA can inspect path-violating receipt without making it clean;
- Delta classifies every Builder claim;
- unclassified claim becomes `missing_evidence`;
- `qaOnlyFindings` recorded;
- Trust state stored lowercase and rendered uppercase if desired.

Trust negative tests:

- missing QA prevents `trust.clean`;
- missing Delta prevents `trust.clean`;
- missing high/critical evidence prevents `trust.clean`;
- missing critical safety/scope evidence produces `blocked`;
- rejected high claim produces at least `investigate`;
- rejected critical safety/scope claim produces `blocked`;
- unresolved error receipt prevents clean;
- path/scope violation prevents clean;
- QA pass does not automatically mean clean.

## Report Rendering Tests

Must test:

- status renders without raw JSON;
- proposal report includes review ID and exact approval command;
- build report says Builder claims are not proof;
- QA report reads like audit note;
- Delta report includes confirmed/rejected/missing/not_in_scope;
- Trust report includes confirmed/unconfirmed/rejected/risks/receipts/next action;
- operator summary includes `renderedFromIds`;
- rendererVersion/templateVersion recorded;
- report regeneration from artifacts works;
- operator can understand status/report output without reading raw JSON;
- missing artifact creates investigate/blocked report;
- redaction failure blocks report generation.

Snapshot tests may be used for stable report examples, but they are not enough by themselves.

Snapshot-backed report tests must also assert semantic fields:

- trust state;
- receipt IDs;
- exact next command;
- redaction status;
- approval/build boundary language.

Telegram-safe report tests:

- no Markdown tables;
- long messages split;
- copyable IDs present;
- next action uses exact command;
- report does not imply reply `yes` is enough.

## Telegram Tests

Telegram may be optional for CLI-only v0.1, but if included it needs dedicated tests.

Must test:

- commandRoutes, approvalRoutes, notificationRoutes are distinct;
- Telegram user ID is operator identity;
- chat/thread route is route evidence only;
- General/no-topic sourceThread is null/omitted;
- `/buildroom approve <review_id>` works for configured user and route;
- `/buildroom build <approval_id>` works only with valid approval;
- long-running commands acknowledge asynchronously;
- notifications go to notification routes.

Negative tests:

- unconfigured user rejected;
- allowed chat but wrong user rejected;
- right user wrong approval route rejected;
- forwarded approval rejected;
- reply `yes` rejected;
- reply `approve` rejected;
- `/buildroom approve <idea_id>` rejected;
- `/buildroom build <idea_id>` rejected;
- notification route does not grant approval authority;
- unauthorized user cannot learn whether artifact ID exists.

## Retention And Learning Tests

Must test:

- `retention_review` can follow `trust_report`;
- envelope status is lifecycle status;
- `payload.recommendation` stores recommendation;
- `keep/improve/park/prune_recommended/ghost/reopen` validate;
- `prune_recommended` does not delete artifacts;
- archive move records paths and hashes if implemented;
- memory candidate links receipt IDs;
- memory candidate cannot approve work;
- learning candidate does not auto-mutate agents/config/skills;
- reopened ghost re-enters Signal Filter.

Negative tests:

- retention cannot delete approval artifacts;
- retention cannot delete error receipts;
- retention cannot delete policy violation records;
- retention cannot alter trust state;
- stale learning cannot override current policy.

## Real-World E2E Test

The v0.1 E2E should run the canonical operator flow:

```text
init
collect
propose
review
approve
build
qa
trust
report --save
optional retention
```

Target should preferably be examples/fixtures:

```text
docs/Auto-Buildroom/examples/operator-summary.md
tests/fixtures/auto-buildroom/operator-summary.fixture.json
```

E2E must prove:

- project-local config created;
- research packet created;
- idea/review created;
- approval records operator identity/route;
- approval does not auto-build;
- build blocked before approval;
- build consumes approval;
- duplicate build does not double-run;
- Builder runs through native runtime for mutation or fixture is explicitly non-mutating;
- post-run diff computed independently;
- QA is independent;
- Delta compares claims vs evidence;
- Trust report is not clean when evidence is missing;
- operator summary includes receipts;
- operator can understand the result from status/report without opening raw artifact JSON;
- no external side effects occur.

## Security Regression Suite

Required security regressions:

- no self-approval;
- no self-QA;
- no hidden approval from chat text;
- no build from signal/handoff/idea directly;
- no raw transcript ingestion by default;
- no secret persistence in artifacts;
- no external side effects by default;
- no destructive retention cleanup;
- no runtime fork/parallel executor;
- no trust clean from Builder self-report.

## Test Data And Fixtures

Fixtures should be:

- small;
- deterministic;
- redacted;
- explicit about whether they are executable or non-executing;
- stored outside live production config;
- safe to run repeatedly.

Fixture artifacts should include:

- valid parent IDs;
- trace IDs;
- producer role/run IDs;
- content hashes when applicable;
- redaction status;
- fixture marker.

Forbidden fixture behavior:

- mutate repo unless test explicitly owns a temp workspace;
- bypass approval requirements;
- use real secrets;
- call external network by default;
- create clean trust without QA.

## CI Gates

Minimum CI before merge:

```text
pnpm build
pnpm test
```

Focused CI during development:

```text
npx vitest run src/auto-buildroom/**/__tests__/*.test.ts
```

Release CI must include:

- all unit tests;
- CLI integration tests;
- policy negative tests;
- runtime adapter tests;
- worktree/sandbox tests;
- real-world E2E test.

Telegram tests may be gated separately if Telegram surface is optional for the first CLI-only release.

## CI Profiles

Core CI:

- build/typecheck;
- unit tests;
- policy negative tests;
- CLI deterministic workflow;
- report rendering;
- retention no-delete tests.

Runtime CI:

- runtime adapter mock tests;
- worktree/sandbox tests;
- lock/idempotency race tests;
- E2E with temp repo.

Telegram CI, if included:

- command parsing;
- identity/route authorization;
- async acknowledgement behavior;
- Telegram-safe rendering and message splitting.

CLI-only v0.1 must not be blocked by Telegram tests if the Telegram operator surface is not shipped.

## Coverage Expectations

Coverage should focus on safety-critical behavior, not line percentage.

Must be covered:

- artifact validation;
- approval boundaries;
- state transitions;
- path policy;
- runtime status mapping;
- independent diff computation;
- QA/Delta/Trust gates;
- Telegram identity/route gates if included;
- retention no-delete behavior.

Do not ship v0.1 if a core safety boundary lacks a negative test.

## Acceptance Criteria

Testing strategy is good enough for v0.1 when:

- every required artifact schema has positive and negative tests;
- every authority boundary has a negative test;
- build without approval is tested blocked;
- approval without Main Review is tested blocked;
- approval does not auto-build;
- Builder cannot QA itself;
- path violation prevents clean trust;
- concurrency cannot double-run a consumed approval;
- redaction works for artifacts, errors, CLI, reports, and Telegram if included;
- missing QA prevents clean trust;
- runtime success alone cannot produce clean trust;
- operator can understand E2E result without reading raw JSON;
- Telegram approval identity is tested if Telegram is included;
- retention cannot delete or auto-learn behavior;
- real-world E2E proves the full receipt chain.
