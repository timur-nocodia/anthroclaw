# Config Model

Status: Draft

Purpose: describe how users configure Auto-Buildroom: buildroom roots, modes, operator IDs, role agents, watched agents, allowed paths, blocked paths, and budgets.

## Config Thesis

Auto-Buildroom v0.1 uses project-local configuration.

Default:

```text
.anthroclaw/auto-buildroom/buildroom.yml
```

Named room override:

```text
.anthroclaw/auto-buildroom/rooms/anthroclaw-core/buildroom.yml
```

Do not add a first-class global `buildrooms` config section in v0.1. The workflow, schemas, and safety model should stabilize locally before expanding the global AnthroClaw config surface.

## Config Goals

Config must answer:

- which room is this?
- where are artifacts stored?
- who can approve?
- what mode is active?
- which paths may be changed?
- which paths are blocked?
- which agents/sources may be watched?
- which roles exist?
- what budgets apply?
- are external side effects allowed?
- is the kill switch active?

Config must not:

- store secrets;
- grant ordinary agents build authority by default;
- enable raw transcript watching by default;
- enable external side effects by default;
- silently mutate global AnthroClaw config.

## Config File Hierarchy

Recommended hierarchy:

```text
.anthroclaw/auto-buildroom/buildroom.yml
  -> project-local defaults

.anthroclaw/auto-buildroom/rooms/<roomId>/buildroom.yml
  -> room-specific config
```

Room config overrides project defaults.

If both files exist, resolution order:

```text
hardcoded safe defaults
-> project-local buildroom.yml
-> room buildroom.yml
-> CLI flags for one command only
```

CLI flags must not silently persist unless the command explicitly says it writes config.

## v0.1 Minimal Config

Minimal `buildroom.yml`:

```yaml
schemaVersion: auto-buildroom/v1
roomId: anthroclaw-core
mode: manual_approval
root: .anthroclaw/auto-buildroom/rooms/anthroclaw-core
killSwitchActive: false

operators:
  - id: cli:user:local-operator
    routes:
      - cli:local

paths:
  allowed:
    - docs/**
    - tests/**
  blocked:
    - .env
    - **/.env
    - **/*secret*
    - **/*token*
    - **/credentials*
    - config.yml
    - config.yaml
    - **/config.yml
    - **/config.yaml

roles:
  mode: internal

watch:
  sessions:
    enabled: false
  rawTranscripts:
    enabled: false

externalSideEffects:
  default: deny
```

This is enough for a local docs/test MVP.

## Full v0.1 Config Shape

Example:

```yaml
schemaVersion: auto-buildroom/v1
roomId: anthroclaw-core
displayName: AnthroClaw Core Buildroom
mode: manual_approval
root: .anthroclaw/auto-buildroom/rooms/anthroclaw-core
killSwitchActive: false

operators:
  - id: cli:user:local-operator
    routes:
      - cli:local
  - id: telegram_user:123456789
    routes:
      - telegram_chat:-1001234567890
      - telegram_thread:-1001234567890:2

roles:
  mode: internal
  profiles:
    research:
      runner: internal
    dreamer:
      runner: internal
    mainReview:
      runner: internal
    builder:
      runner: native_runtime
    qa:
      runner: internal
    verificationDelta:
      runner: deterministic
    trust:
      runner: internal

watch:
  repo:
    enabled: true
  docs:
    enabled: true
  tests:
    enabled: true
  sessions:
    enabled: true
    mode: sanitized_summaries
    agents:
      - code-helper
      - support_agent
  rawTranscripts:
    enabled: false
  external:
    enabled: false

paths:
  allowed:
    - docs/**
    - tests/**
  blocked:
    - .env
    - **/.env
    - **/*secret*
    - **/*token*
    - **/credentials*
    - config.yml
    - config.yaml
    - **/config.yml
    - **/config.yaml
    - agents/**
    - src/gateway.ts

execution:
  mutationTarget: worktree
  allowInPlaceDocsTests: false
  requireApprovalForBuild: true
  consumeApprovalOnBuildStart: true
  retryRequiresOperatorCommand: true

externalSideEffects:
  default: deny
  readOnlyResearch:
    enabled: false

budgets:
  maxIdeasPerDay: 5
  maxBuildsPerDay: 1
  maxActiveBuilds: 1
  maxRuntimeMinutesPerStage: 20

storage:
  indexEnabled: true
  runtimeEventRetention:
    maxBytesPerRun: 1048576
    keepRawEvents: false
  offerGitignoreEntry: true
```

This full example shows an enabled watched-session setup. It is not the safest `buildroom init` default. `buildroom init` should default session watching to `false`.

## Modes

Supported v0.1 modes:

```text
off
observe_only
manual_approval
```

Deferred:

```text
auto_low_risk
auto_all_guarded
```

### off

Buildroom is disabled.

Allowed:

- status;
- show existing artifacts;
- report existing artifacts.

Blocked:

- collect;
- propose;
- approve;
- build;
- QA;
- scheduled stages.

### observe_only

Buildroom may collect and summarize signals.

Allowed:

- collect;
- create research packets;
- create operator reports.

Blocked:

- approval;
- build execution;
- external side effects.

### manual_approval

Default v0.1 mode.

Allowed:

- collect;
- propose;
- review;
- approval through operator surface;
- build after approval;
- QA;
- trust report.

Blocked:

- auto-build without approval;
- external side effects unless explicitly approved in later versions.

## Operators

Operator identity and route are separate.

Identity examples:

```text
cli:user:local-operator
telegram_user:123456789
```

Route examples:

```text
cli:local
telegram_chat:-1001234567890
telegram_thread:-1001234567890:2
```

Config must not treat Telegram chat ID as operator identity.

Operator entry:

```yaml
operators:
  - id: telegram_user:123456789
    routes:
      - telegram_chat:-1001234567890
      - telegram_thread:-1001234567890:2
```

Approval must match a configured operator identity and allowed approval route.

## Roles

v0.1 decision:

```text
roles are internal runners/profiles, not public ordinary agents by default
```

Config:

```yaml
roles:
  mode: internal
  profiles:
    builder:
      runner: native_runtime
    verificationDelta:
      runner: deterministic
```

Future explicit role agents may look like:

```yaml
roles:
  mode: agent_refs
  agents:
    research: buildroom-research
    builder: buildroom-builder
    qa: buildroom-qa
```

`agent_refs` is deferred beyond v0.1 unless implementation requires it.

## Watched Sources

Allowed v0.1 source types:

```text
repo
docs
tests
sessions:sanitized_summaries
```

Raw sessions are disabled by default:

```yaml
watch:
  sessions:
    enabled: true
    mode: sanitized_summaries
  rawTranscripts:
    enabled: false
```

External sources are disabled by default in v0.1:

```yaml
watch:
  external:
    enabled: false
```

If read-only external research is later enabled, config must distinguish read-only from mutation:

```yaml
externalSideEffects:
  default: deny
  readOnlyResearch:
    enabled: true
```

## Path Policy Config

Path config:

```yaml
paths:
  allowed:
    - docs/**
    - tests/**
  blocked:
    - .env
    - **/.env
    - **/*secret*
    - **/*token*
    - **/credentials*
```

Rules:

- blocked paths override allowed paths;
- path policy applies to real filesystem paths, not code blocks inside docs;
- in-place mutation requires explicit config;
- config paths are blocked unless explicitly approved;
- `agents/**` is blocked by default for the first docs/test MVP.

Repo root is derived from the AnthroClaw project root in v0.1. If explicit `repoRoot` is added later, it must not be allowed to escape the project directory.

## Execution Config

Execution config:

```yaml
execution:
  mutationTarget: worktree
  allowInPlaceDocsTests: false
  requireApprovalForBuild: true
  consumeApprovalOnBuildStart: true
  retryRequiresOperatorCommand: true
```

Allowed `mutationTarget` values:

```text
worktree
sandbox
in_place
none
```

Recommended v0.1:

```text
worktree
```

`in_place` should be allowed only for explicitly approved low-risk docs/tests flows.

`none` is for non-executing demos and dry runs.

## External Side Effects Config

Default:

```yaml
externalSideEffects:
  default: deny
```

Blocked by default:

- deploy;
- release;
- publish;
- social post;
- email;
- purchases;
- production config mutation;
- issue/PR mutation;
- external API writes.

Do not add broad `allowAll` style config in v0.1.

## Budgets

Budgets prevent runaway loops.

Recommended v0.1:

```yaml
budgets:
  maxIdeasPerDay: 5
  maxBuildsPerDay: 1
  maxActiveBuilds: 1
  maxRuntimeMinutesPerStage: 20
```

Rules:

- `maxActiveBuilds` should default to `1`;
- `maxBuildsPerDay` should default to `1` for v0.1;
- hitting a budget should create operator-visible status;
- budget exhaustion should not be treated as failure;
- budget bypass requires explicit operator action.

## Storage Config

Storage config:

```yaml
storage:
  indexEnabled: true
  runtimeEventRetention:
    maxBytesPerRun: 1048576
    keepRawEvents: false
  offerGitignoreEntry: true
```

Rules:

- raw runtime logs are not retained by default;
- index is rebuildable;
- `.anthroclaw/auto-buildroom/` should be offered for `.gitignore`;
- committed examples should live under docs/examples/tests, not live state root.

## Kill Switch

Use unambiguous field:

```yaml
killSwitchActive: false
```

When `true`:

- no new builds start;
- no scheduled stages start;
- reports remain readable;
- artifacts are preserved;
- resume requires explicit operator action.

`killSwitchActive: true` overrides `mode` and blocks new execution/scheduled stages even if `mode` is `manual_approval`.

## Validation Rules

Config validation must fail closed for:

- missing `schemaVersion`;
- missing `roomId`;
- invalid mode;
- no operators in `manual_approval`;
- raw transcripts enabled without explicit opt-in;
- external side effects enabled without explicit policy;
- empty allowed paths in `manual_approval` when build execution is enabled;
- blocked paths missing `.env`;
- `maxActiveBuilds` greater than `1` in v0.1 unless explicitly overridden;
- `in_place` mutation without explicit docs/tests-only allowlist;
- Builder and QA configured with the same role/run identity.

Warnings, not hard failures:

- no Telegram operator route;
- index disabled;
- external research disabled;
- worktree unavailable but mutation target is `worktree`.

Empty allowed paths are valid in `off` and `observe_only` modes when no build execution is possible.

Config validation errors that block execution should be visible in operator status:

```yaml
roomState: blocked
blockScope: room
reason: invalid_config
```

## Config Mutation Rules

Auto-Buildroom should not silently edit config during runs.

Allowed:

- `buildroom init` creates config;
- explicit config command modifies config;
- operator-approved migration updates schema version.

Not allowed:

- Builder modifies Buildroom config during a build;
- watched ordinary agent modifies Buildroom config;
- LLM role rewrites approval/path policy;
- runtime run changes `killSwitchActive`.

Config writes must:

- create backup;
- validate before replace;
- write atomically;
- preserve comments if possible;
- create operator-visible receipt or transition.

## Future Reconsiderations

Deferred beyond v0.1:

- global AnthroClaw `buildrooms` section;
- role agents as explicit `agents/{id}`;
- raw transcript watching opt-in;
- read-only external research defaults;
- auto-low-risk mode;
- broader approval routes;
- multi-room UI;
- portable `.buildroom` root.

## v0.1 Acceptance Criteria

The config model is good enough for v0.1 when:

- `buildroom init` creates valid project-local config;
- config can express one named room;
- config separates operator identity from route;
- manual approval mode requires at least one operator;
- paths have explicit allowed and blocked lists;
- raw transcripts are disabled by default;
- external side effects are denied by default;
- roles are internal by default;
- Builder mutation target is explicit;
- kill switch is unambiguous;
- invalid config fails closed before any build starts.
