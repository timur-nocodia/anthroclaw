# Storage Layout

Status: Draft

Purpose: define where buildroom data lives on disk, including research vault, subconscious room, buildroom artifacts, indexes, logs, and worktrees.

## Storage Thesis

Auto-Buildroom state is project-local in v0.1.

Default root:

```text
.anthroclaw/auto-buildroom
```

Rationale:

- a Buildroom is scoped to one repo;
- allowed paths are repo-specific;
- receipts are repo-specific;
- worktrees/sandboxes are repo-specific;
- operator decisions are tied to local project context.

The root is namespaced under `.anthroclaw` to make ownership explicit and avoid collisions with unrelated `.buildroom` tools.

## Source Of Truth

The filesystem artifact store is the source of truth.

These are source-of-truth data:

- `buildroom.yml`;
- room config files;
- durable artifact JSON files;
- transition logs;
- lock records;
- error receipts.

These are durable renderings, but not canonical source of truth:

- `operator_summary` JSON artifacts;
- operator summary Markdown;
- rendered HTML reports.

If renderings disagree with underlying artifacts, the underlying artifacts win.

These are not source of truth:

- SQLite indexes;
- caches;
- search indexes;
- Telegram messages;
- CLI output;
- in-memory state;
- temporary worktrees.

If an index disagrees with artifact files, artifacts win and the index should be rebuilt.

## Top-Level Layout

Recommended v0.1 layout:

```text
.anthroclaw/
  auto-buildroom/
    buildroom.yml
    state.json
    index.sqlite
    locks/
    logs/
    cache/
    rooms/
      anthroclaw-core/
        buildroom.yml
        state.json
        research-vault/
        subconscious-room/
        buildroom/
        runtime/
        worktrees/
        archive/
```

### Root Files

`buildroom.yml`

Global project-local defaults for Auto-Buildroom.

`state.json`

Small derived state for fast status. It may be rebuilt from artifacts.

`index.sqlite`

Optional query index. Not source of truth.

`locks/`

Idempotency and run locks.

`logs/`

Buildroom orchestrator logs, redacted. Diagnostic only, not source of truth.

`cache/`

Derived cache only. Safe to delete.

`rooms/`

One or more named Buildrooms. v0.1 should support one room first.

Transition logs under `buildroom/transitions/` are durable audit records. Orchestrator logs under `logs/` are diagnostics.

## Room Layout

Recommended room layout:

```text
rooms/
  anthroclaw-core/
    buildroom.yml
    state.json
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
    subconscious-room/
      SOUL.md
      walks/
      fascinations/
      projects/
      ghosts/
      signal-state/
      build-intents/
      sprint-lock.json
      digests/
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
      transitions/
    runtime/
      events/
      results/
      refs/
    worktrees/
    archive/
```

v0.1 does not need every Research Vault or Subconscious Room subdirectory to be active. They are included to preserve the conceptual separation and future path.

Required for v0.1:

```text
root-level:
  locks/

room-level:
  buildroom/
    session-summaries/
    research/
    ideas/
    reviews/
    approvals/
    plans/
    builds/
    qa/
    deltas/
    trust/
    errors/
    operator/
    transitions/
  runtime/
    events/
    results/
```

Locks are root-level for v0.1 because lock keys include `roomId` and must coordinate CLI, Telegram, cron, and any other trigger across rooms.

`research-vault/raw/` must not contain secrets, raw private transcripts, or unredacted runtime logs by default. For v0.1, raw external captures should be disabled or bounded unless explicitly enabled.

## Buildroom Artifact Layout

Artifact directories:

| Artifact type | Directory |
| --- | --- |
| `session_summary` | `buildroom/session-summaries/` |
| `research_packet` | `buildroom/research/` |
| `signal`, `handoff_signal` | `buildroom/signals/` |
| `idea_contract` | `buildroom/ideas/` |
| `main_review` | `buildroom/reviews/` |
| `approval` | `buildroom/approvals/` |
| `build_plan` | `buildroom/plans/` |
| `coder_receipt` | `buildroom/builds/` |
| `qa_report` | `buildroom/qa/` |
| `verification_delta` | `buildroom/deltas/` |
| `trust_report` | `buildroom/trust/` |
| `retention_review` | `buildroom/retention/` |
| `error_receipt` | `buildroom/errors/` |
| `operator_summary` | `buildroom/operator/` |

Recommended file naming:

```text
<artifact_id>.json
```

Examples:

```text
buildroom/ideas/idea_20260511_operator_summary_docs.json
buildroom/approvals/approval_20260511_operator_summary_docs.json
buildroom/builds/build_20260511_operator_summary_docs.json
buildroom/trust/trust_20260511_operator_summary_docs.json
```

## Transitions

Transitions should be append-only.

Recommended location:

```text
buildroom/transitions/transitions.jsonl
```

Each transition should record:

- transition ID;
- artifact ID;
- from status;
- to status;
- actor role;
- actor run ID;
- reason;
- timestamp;
- policy result;
- trace ID.

Transitions must not silently rewrite artifacts.

## Runtime References

Runtime events should be referenced, not copied raw by default.

Recommended layout:

```text
runtime/
  events/
    run_20260511_operator_summary.jsonl
  results/
    run_20260511_operator_summary.json
  refs/
    run_20260511_operator_summary.refs.json
```

Rules:

- store redacted bounded excerpts when useful;
- store references and hashes for large logs;
- cap, rotate, or summarize runtime event logs;
- large raw event logs should not be retained by default;
- do not persist raw secrets;
- do not feed raw runtime logs into later LLM prompts;
- runtime refs should be linked from artifact `runtimeRefs`.

## Locks And Idempotency

Locks prevent duplicate execution.

Root-level lock location:

```text
.anthroclaw/auto-buildroom/locks/
```

Recommended lock key:

```text
roomId + approvalId + buildPlanId
```

Recommended lock file:

```text
locks/anthroclaw-core__approval_...__plan_....lock
```

Lock record should include:

- room ID;
- approval ID;
- build plan ID;
- idempotency key;
- runtime run ID if started;
- created at;
- expires at;
- status;
- owner process ID if available.

Rules:

- lock acquisition must happen before Builder runtime starts;
- approval consumption and Builder start must be protected by the same lock;
- duplicate starts return existing run status;
- stale locks require safe recovery before retry.

## Worktrees And Sandboxes

Builder code mutation should happen in an approved worktree or sandbox.

Recommended layout:

```text
rooms/anthroclaw-core/worktrees/
  build_20260511_operator_summary_docs/
```

Rules:

- default v0.1 Builder mutation target is an isolated worktree/sandbox when available;
- in-place repo mutation is allowed only behind explicit config for low-risk docs/tests flows;
- worktree path must stay inside room worktrees root;
- no symlink escape;
- no path traversal;
- changed files are checked against approved repo-relative paths;
- worktree cleanup should be explicit or archived;
- deletion of worktrees must not delete artifacts.

v0.1 may defer real worktree execution if the first E2E uses deterministic non-mutating fixtures, but any Builder stage that mutates the repo must use the native runtime and approved sandbox/worktree policy.

## Config Files

Project-local default:

```text
.anthroclaw/auto-buildroom/buildroom.yml
```

Named room override:

```text
.anthroclaw/auto-buildroom/rooms/anthroclaw-core/buildroom.yml
```

Config should include:

- room ID;
- mode;
- operator IDs;
- allowed paths;
- blocked paths;
- watched sources;
- role profiles/runners;
- artifact root;
- budgets;
- kill switch state.

Example:

```yaml
roomId: anthroclaw-core
mode: manual_approval
root: .anthroclaw/auto-buildroom/rooms/anthroclaw-core
operators:
  - telegram_user:123456789
allowedPaths:
  - docs/**
  - tests/**
blockedPaths:
  - .env
  - **/.env
  - **/*secret*
  - **/*token*
killSwitchActive: false
```

## State Files

`state.json` is derived state.

It may include:

- schema version;
- rebuilt timestamp;
- derivation source;
- room state;
- latest completed run;
- latest trust state;
- pending approval count;
- approved-not-built count;
- active runtime ref;
- paused flag;
- block scope.

Example:

```json
{
  "schemaVersion": "state/v1",
  "rebuiltAt": "2026-05-11T12:00:00Z",
  "derivedFromTransitionOffset": 123,
  "roomState": "approved",
  "latestCompletedRun": "run_20260511_operator_summary_docs",
  "latestTrustState": "watch",
  "pendingApprovals": 0,
  "approvedNotBuilt": 1,
  "activeRun": null,
  "paused": false,
  "blockScope": null
}
```

If `state.json` is missing or corrupted, rebuild it from artifacts and transitions.

## Index

`index.sqlite` is optional but recommended for fast status/report queries.

It may index:

- artifact ID;
- artifact type;
- path;
- status;
- producer role;
- parent IDs;
- trace ID;
- content hash;
- created at;
- latest trust state;
- pending approvals;
- active runs.

Rules:

- index is not source of truth;
- index can be deleted and rebuilt;
- hash mismatch between index and artifact file means artifact verification is required;
- index must not store unredacted secrets.

## Archive

Archive is for old or superseded room data.

Recommended layout:

```text
archive/
  2026/
    05/
      trace_20260511_operator_summary_docs/
```

Rules:

- archive, do not delete by default;
- archive must preserve receipt chain;
- archived artifacts remain hash-verifiable;
- artifact content hashes must not include filesystem path, so archive moves do not invalidate hashes;
- retention recommendations do not delete audit trail;
- destructive cleanup requires explicit retention policy.

## Backups

Backups are optional for v0.1, but storage should not make backups hard.

Backup candidate:

```text
.anthroclaw/auto-buildroom/
```

Safe-to-exclude:

```text
cache/
worktrees/
index.sqlite if rebuildable
```

Do not exclude:

```text
buildroom/**/*.json
buildroom/transitions/*.jsonl
runtime/refs/
operator reports
```

## Privacy And Redaction Storage Rules

Artifacts must be redacted before write.

Storage must not contain:

- raw `.env` values;
- raw private transcripts by default;
- secrets from runtime logs;
- unredacted tokens;
- unbounded command output.

If redaction fails, do not write unsafe artifact content. Create an `error_receipt` if possible.

## Git Policy

Default recommendation for v0.1:

```text
.anthroclaw/auto-buildroom/ should usually be local project state, not committed by default.
```

However, selected docs/examples/fixtures may be committed under normal docs or test fixture paths.

If a project chooses to commit Buildroom receipts:

- secrets must be redacted;
- artifacts must pass schema validation;
- large runtime logs should be excluded;
- operator identity privacy must be considered.

`anthroclaw buildroom init` should offer to add this path to `.gitignore`:

```text
.anthroclaw/auto-buildroom/
```

Committed examples should live under `docs/`, `examples/`, or `tests/fixtures/`, not under the live local Buildroom state root.

## Recovery

Recovery should be possible from filesystem artifacts.

Recovery steps:

1. validate config;
2. scan artifact directories;
3. verify content hashes;
4. rebuild index;
5. replay transitions;
6. rebuild state;
7. identify unresolved error receipts;
8. render operator summary.

If recovery finds corruption:

- set `roomState: blocked`;
- set `blockScope: room`;
- create `error_receipt` if safe;
- require operator intervention.

## v0.1 Acceptance Criteria

Storage layout is good enough for v0.1 when:

- `anthroclaw buildroom init` can create the root and required room directories;
- every v0.1 artifact type has a deterministic directory;
- artifacts are the source of truth;
- `state.json` and `index.sqlite` can be rebuilt;
- runtime refs can be linked from artifacts;
- locks prevent duplicate Builder starts;
- worktrees cannot escape the approved root;
- archive preserves receipt chains;
- redaction happens before artifact persistence;
- operator reports can be regenerated from artifacts.
