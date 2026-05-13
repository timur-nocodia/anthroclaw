# Auto-Buildroom UI Control Surface Plan

Status: Draft

Purpose: define the user-facing Buildroom cockpit for v0.1 so operators can initialize, pause, disable, inspect, configure, approve, and verify Buildroom work without editing JSON/YAML by hand.

## Thesis

Auto-Buildroom already has a CLI, Telegram command adapter, artifacts, policy gates, and local config.

That is not enough as a product surface.

The UI must make Buildroom understandable and controllable:

```text
Overview -> Receipts -> Approvals -> Execution -> Settings -> Diagnostics
```

The UI should not hide the authority chain:

```text
Proposal asks for authority.
Approval grants authority.
Build consumes authority.
QA checks the claims.
Trust tells the operator what to believe.
```

## Current State

Implemented control surfaces:

- CLI: `pnpm buildroom ...`;
- Telegram `/buildroom ...` command adapter when routes are configured;
- project-local config under `.anthroclaw/auto-buildroom/`;
- optional ordinary-agent tools:
  - `buildroom_submit_session_summary`;
  - `buildroom_submit_signal`.

Missing control surface:

- no Buildroom page in the Next.js UI;
- no sidebar entry;
- no UI API routes for Buildroom status/config/actions;
- no UI toggle for pause, kill switch, mode, path policy, operators, or Telegram routes;
- no receipt browser.

## Product Boundary

The UI is an operator cockpit, not a shortcut around policy.

It may:

- display current room state;
- initialize local Buildroom config;
- pause/resume;
- activate/deactivate kill switch;
- set mode;
- edit safe config fields;
- run workflow commands through the same service path as CLI;
- inspect receipts and trust reports.

It must not:

- approve raw ideas;
- build raw ideas or reviews;
- infer approval from button labels like "continue";
- auto-build after approval;
- hide receipt IDs;
- treat rendered reports as canonical truth;
- create a second Buildroom execution path separate from CLI/service APIs.

## Navigation

Add a first-class Buildroom navigation item.

Recommended route:

```text
/fleet/local/buildroom
```

Future fleet route:

```text
/fleet/[serverId]/buildroom
```

The first implementation may support local only. Remote/fleet support can follow existing fleet proxy patterns later.

## Top-Level Tabs

The v0.1 UI should use six tabs.

```text
Overview
Receipts
Approvals
Execution
Settings
Diagnostics
```

Do not start with a large visual dashboard. Start with a dense operator surface that maps directly to artifacts and policy.

## 1. Overview

Purpose: answer "is Buildroom on, what is it doing, and what should I do next?"

Show:

- initialized or not initialized;
- room ID;
- mode;
- room state;
- paused;
- kill switch state;
- latest trust state;
- pending approvals;
- approved not built;
- active builds;
- QA pending;
- trust pending;
- unresolved errors;
- latest receipt IDs;
- next recommended action.

Primary controls:

- Initialize;
- Pause;
- Resume;
- Enable;
- Disable;
- Kill switch on;
- Kill switch off;
- Validate.

Empty state:

```text
Buildroom is not enabled for this project.

Initialize creates local project state under:
.anthroclaw/auto-buildroom/

Default mode: manual approval.
Buildroom will not auto-build.
```

Required behavior:

- If config is missing, show `not initialized`, not a raw filesystem error.
- If mode is `off`, show disabled state and do not show workflow action buttons as available.
- If kill switch is active, show hard stop state before all other workflow prompts.

## 2. Receipts

Purpose: make the artifact chain inspectable without opening JSON files manually.

Receipt types:

- `research_packet`;
- `session_summary`;
- `handoff_signal`;
- `signal`;
- `idea_contract`;
- `main_review`;
- `approval`;
- `build_plan`;
- `coder_receipt`;
- `error_receipt`;
- `qa_report`;
- `verification_delta`;
- `trust_report`;
- `operator_summary`;
- `retention_review`.

List columns:

- ID;
- type;
- status;
- created at;
- producer role;
- trust state when applicable;
- parent count;
- hash status.

Receipt detail view:

- envelope summary;
- payload summary;
- parent IDs;
- child IDs;
- input refs;
- output refs;
- runtime refs;
- content hash status;
- redaction flags;
- rendered report when applicable.

Actions:

- copy receipt ID;
- show parent chain;
- show child chain;
- validate hash;
- open rendered report;
- copy CLI equivalent command.

Rules:

- The UI must not silently repair or rewrite receipts.
- Hash mismatch should show `investigate` or `blocked`.
- If there is no receipt, the UI should treat the action as not proven.

## 3. Approvals

Purpose: make authority decisions explicit and auditable.

Show lanes:

- pending reviews awaiting approval;
- rejected reviews;
- approvals granted;
- approved not built;
- consumed approvals;
- expired/revoked/cancelled approvals when implemented.

Allowed actions:

- approve `review_...`;
- reject `review_...`;
- reject other supported artifacts;
- show approval receipt;
- show approved scope.

Approval modal must show:

- target review ID;
- idea title;
- approved paths;
- blocked paths;
- non-goals;
- acceptance criteria;
- risks;
- operator identity;
- route;
- exact next command/action.

Approval modal must include explicit boundary text:

```text
Approval grants authority.
It does not start a build.
```

Forbidden:

- approve `idea_...`;
- approve latest;
- approve from notification-only route;
- approve without configured operator identity;
- auto-run build after approval.

## 4. Execution

Purpose: control build plans, execution boundary, QA, Delta, Trust, and Retention.

Show:

- build plans;
- approved-not-built items;
- active builds;
- build receipts;
- QA pending;
- trust pending;
- latest runtime status;
- worktree/sandbox path where applicable;
- pre-run and post-run policy results;
- independent changed-file diff.

Actions:

- create/show build plan from `approval_...`;
- execute build plan;
- run QA for `build_...`;
- create Trust report;
- render report;
- save operator summary;
- create retention review.

Danger confirmations:

- execute build;
- resume after pause;
- kill switch off;
- enable from off.

Build execution confirmation must show:

- approval ID;
- build plan ID;
- allowed paths;
- blocked paths;
- mutation target;
- whether execution is worktree/sandbox/in-place;
- statement that approval is consumed at execution boundary.

Rules:

- `build --execute` must still use the native runtime adapter.
- UI must not run shell commands directly for Builder.
- UI must not bypass path policy.
- Duplicate start should return existing run/build status.
- Builder claims are not proof.
- QA pass is evidence, not final trust.

## 5. Settings

Purpose: expose all controllable Buildroom config without forcing users to edit YAML.

Settings are grouped by risk.

### Lifecycle

Config:

```yaml
mode: off | observe_only | manual_approval
paused: true | false
killSwitchActive: true | false
roomId: anthroclaw-core
schemaVersion: auto-buildroom/v1
```

Controls:

- mode selector;
- pause/resume;
- kill switch;
- room display name when implemented.

Rules:

- `manual_approval` requires at least one operator.
- UI should not offer autonomous modes in v0.1.
- `off` should disable workflow actions but keep receipts inspectable.

### Watch Sources

Config:

```yaml
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
```

Controls:

- watch repo;
- watch docs;
- watch tests;
- watch sanitized session summaries;
- raw transcripts;
- external watching.

Rules:

- Raw transcripts remain off by default.
- Enabling raw transcripts should require a scary confirmation or remain CLI/manual-only in v0.1.
- External watching remains off by default.

### Operators

Config:

```yaml
operators:
  - id: cli:user:local-operator
    commandRoutes:
      - cli:local
    approvalRoutes:
      - cli:local
```

Controls:

- add operator;
- remove operator;
- edit command routes;
- edit approval routes;
- validate route format.

Rules:

- Telegram user ID is identity.
- Telegram chat/thread is route evidence.
- Telegram chat/thread must never be accepted as operator identity.
- Removing the last operator in `manual_approval` is invalid.

### Telegram Routes

Config:

```yaml
notifications:
  routes:
    - telegram_thread:-1001234567890:2
```

Controls:

- command routes;
- approval routes;
- notification routes;
- test notification;
- route health/status when available.

Route types:

- `telegram_chat:<chatId>`;
- `telegram_thread:<chatId>:<threadId>`.

Rules:

- Notification route does not grant authority.
- Approval commands require configured operator identity and allowed approval route.
- General/no-topic route uses `sourceThread: null`.

### Path Policy

Config:

```yaml
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
```

Controls:

- add/remove allowed path;
- add/remove blocked path;
- validate path pattern;
- show broad path warnings;
- show effective build-capable status.

Rules:

- Blocked paths override allowed paths.
- Path policy applies to repository filesystem paths, not code snippets inside docs.
- Broad patterns like `**` should be discouraged.

### Execution Policy

Config:

```yaml
execution:
  mutationTarget: worktree | sandbox | in_place
  allowInPlaceDocsTests: false
  requireApprovalForBuild: true
  consumeApprovalOnBuildStart: true
  retryRequiresOperatorCommand: true
```

Controls:

- mutation target;
- allow in-place docs/tests mutation;
- require approval for build;
- consume approval on build start;
- retry requires operator command.

Rules:

- v0.1 UI should not allow disabling `requireApprovalForBuild`.
- In-place mutation should be visibly risky.
- Builder network/external side effects remain denied by default.

### External Access

Config:

```yaml
external:
  readOnlyResearch:
    enabled: false
  sideEffects:
    default: deny
```

Controls:

- read-only external research;
- side effects status.

Rules:

- Mutating external side effects stay denied in v0.1.
- Read-only external access is research, not authority.

### Budgets

Config:

```yaml
budgets:
  maxIdeasPerDay: 5
  maxBuildsPerDay: 1
  maxActiveBuilds: 1
  maxRuntimeMinutesPerStage: 20
```

Controls:

- max ideas per day;
- max builds per day;
- max active builds;
- max runtime minutes per stage;
- show budget used today when available.

Recommended v0.1 defaults:

- `maxBuildsPerDay: 1`;
- `maxActiveBuilds: 1`.

### Agent Handoff

Per-agent settings may expose optional tools:

```yaml
mcp_tools:
  - buildroom_submit_session_summary
  - buildroom_submit_signal
```

Controls:

- allow sanitized session summary submission;
- allow Buildroom handoff signal submission;
- choose target Buildroom when multiple rooms exist later.

Rules:

- Handoff is not approval.
- Session summary is sanitized evidence, not raw transcript.
- These tools should remain off unless intentionally enabled per agent.

## 6. Diagnostics

Purpose: help operators understand why Buildroom is blocked or unavailable.

Show:

- initialized status;
- config path;
- room path;
- current room ID;
- config validation status;
- artifact hash validation status;
- paused state;
- kill switch state;
- mode;
- latest error receipt;
- latest trust report;
- Telegram route config summary;
- notification test status;
- local storage status.

Actions:

- validate config/artifacts;
- copy diagnostic summary;
- test Telegram notification;
- show latest error receipt.

Important UX behavior:

- Missing config should render as `not initialized`.
- It should not render as raw `ENOENT`.
- Derived state should not be editable directly.

## API Surface

Add UI API routes that call the same Buildroom service/CLI logic.

Recommended initial routes:

```text
GET  /api/buildroom/status
POST /api/buildroom/init
POST /api/buildroom/pause
POST /api/buildroom/resume
POST /api/buildroom/kill-switch
POST /api/buildroom/mode
GET  /api/buildroom/receipts
GET  /api/buildroom/receipts/[id]
POST /api/buildroom/validate
PATCH /api/buildroom/config
POST /api/buildroom/actions
```

`POST /api/buildroom/actions` can dispatch safe workflow actions:

```text
collect
propose
review
reject
approve
build_plan
build_execute
qa
trust
report
report_save
retain
```

The API layer must not duplicate Buildroom policy. It should call shared Buildroom services used by CLI/Telegram or a thin wrapper around the CLI command implementation until services are extracted.

## Implementation Phases

### Phase 1: UI Foundation

Goal: make Buildroom visible and controllable.

Scope:

- sidebar item;
- `/fleet/local/buildroom` page;
- status API;
- init API;
- validate API;
- pause/resume;
- kill switch on/off;
- mode display and off/manual controls;
- not-initialized empty state.

Exit criteria:

- user can see whether Buildroom exists;
- user can initialize it;
- user can pause/resume;
- user can hard-stop via kill switch;
- missing config is not shown as raw `ENOENT`;
- UI build and tests pass.

### Phase 2: Config Settings

Goal: expose config safely.

Scope:

- watch toggles;
- operators;
- Telegram command/approval/notification routes;
- path policy editor;
- execution policy view;
- budgets editor;
- external access display.

Exit criteria:

- invalid config cannot be saved;
- last operator cannot be removed in `manual_approval`;
- Telegram chat/thread cannot be saved as operator identity;
- broad path warning exists;
- `requireApprovalForBuild` cannot be disabled from v0.1 UI.

### Phase 3: Receipt Browser

Goal: make artifact chain inspectable.

Scope:

- receipt list;
- receipt detail;
- parent/child chain;
- copy ID;
- hash validation;
- rendered report display.

Exit criteria:

- operator can inspect a run without opening JSON manually;
- hash mismatch is visible;
- report rendering is labeled non-canonical.

### Phase 4: Workflow Actions

Goal: operate the Buildroom loop from UI.

Scope:

- collect;
- propose;
- review;
- reject;
- approve with confirmation;
- build plan;
- build execute with confirmation;
- QA;
- Trust;
- report;
- report save;
- retain.

Exit criteria:

- approve accepts only `review_...`;
- build accepts only `approval_...` or `plan_...`;
- approve does not execute build;
- build execute uses existing native runtime adapter path;
- action results produce receipts.

### Phase 5: Agent Handoff Settings

Goal: let operators enable Buildroom handoff per ordinary agent.

Scope:

- per-agent toggles for `buildroom_submit_session_summary`;
- per-agent toggles for `buildroom_submit_signal`;
- warning copy for handoff boundaries;
- optional target room display later.

Exit criteria:

- tools are not enabled globally by accident;
- public safety profile cannot enable unsafe handoff tools if blocked by existing safety policy;
- handoff tools fail cleanly when Buildroom is not initialized.

## Testing Requirements

UI/API tests:

- not initialized status renders correctly;
- init creates local config;
- pause blocks workflow actions;
- kill switch blocks workflow actions;
- mode `off` disables workflow controls;
- invalid operator identity rejected;
- Telegram route is not operator identity;
- path policy validation rejects escape paths;
- approve idea is rejected;
- approve review works;
- build idea is rejected;
- build approval creates or shows plan;
- build execute requires confirmation;
- report rendering does not claim canonical truth;
- receipt hash mismatch is visible.

Build verification:

```bash
pnpm test
pnpm ui:build
pnpm build
```

Focused candidates:

```bash
npx vitest run src/auto-buildroom ui/__tests__
```

## Release Criteria

Buildroom UI v0.1 is acceptable when:

- users can initialize and disable Buildroom without CLI;
- users can see the current safety state without reading YAML;
- users can pause and hard-stop Buildroom from UI;
- users can inspect receipts from UI;
- approval/build boundaries are more visible in UI than CLI;
- no UI path grants authority that CLI/Telegram would reject;
- no UI path bypasses native runtime or Buildroom policy;
- UI build passes.

## Deferred

Do not include in the first UI slice:

- full web dashboard analytics;
- graph visualization of all artifact chains;
- autonomous low-risk mode;
- global Buildroom config;
- multi-room management;
- fleet remote Buildroom control;
- raw transcript browsing;
- external side-effect approvals;
- destructive cleanup;
- direct artifact editing.

## Open Implementation Questions

1. Should UI call `runBuildroomCli()` directly at first, or should we extract a shared Buildroom service before adding UI routes?
2. Should `/fleet/local/buildroom` be local-only in the first PR, with remote fleet support deferred?
3. Should `killSwitchActive` get explicit CLI commands before UI controls are added?
4. Should `status` gracefully handle missing config before UI work starts?
5. Should agent handoff toggles live on the Buildroom page or inside each agent's existing settings?
