# Subconscious And Signal Filter

Status: Draft

Purpose: describe how repeated signals, heat, fascinations, ghosts, lanes, sprint locks, and build intent markers work without turning every thought into a task.

## Thesis

Subconscious develops taste. Signal Filter protects action.

Subconscious notices recurring patterns, stale themes, returning ideas, and work that seems alive again.

Signal Filter decides whether those observations should stay in watching, be rejected, become a small experiment, or move toward Main Review.

Core rule:

```text
A thought is not a task.
A signal is not approval.
Heat is not authority.
```

Subconscious can say:

```text
This keeps coming back.
```

Signal Filter can say:

```text
This is ready for idea/review preparation, still watching, rejected, or parked.
```

Neither can say:

```text
This is approved or ready to build.
```

## v0.1 Scope

Required for v0.1:

- consume `research_packet`, `session_summary`, and `handoff_signal` artifacts;
- track repeated signals and heat;
- create or update `signal` artifacts in safe states;
- classify signals as `watching`, `ready`, `queued_for_idea`, `rejected`, or `parked`;
- prevent weak observations from becoming tasks automatically;
- create clear handoff to `idea_contract` generation only when ready;
- record why a signal is not a task yet;
- preserve evidence refs;
- keep approval/build authority out of this layer.

Deferred:

- long-running autonomous subconscious walks;
- complex taste models;
- multi-room signal scoring;
- social/market trend watching;
- automatic sprint planning;
- automatic build intent markers;
- retention-driven ghost reopening;
- cross-project signal federation.

v0.1 should prove:

```text
Research evidence -> signal watching -> Signal Filter classification -> idea candidate or parked/rejected
```

## Role Split

### Subconscious

Subconscious is the pattern watcher.

It looks for:

- repeated friction;
- recurring user requests;
- ideas that return across sessions;
- docs/tests gaps that keep appearing;
- useful features that were built but never used;
- stale assumptions;
- ghosts that become relevant again.

Subconscious produces taste signals, not authority.

Allowed:

- create candidate signal payloads;
- create `signal` artifacts in `watching` status;
- update heat/history on watching signals;
- connect related evidence;
- suggest a lane;
- explain why something is not a task yet.

Not allowed:

- approve work;
- create build plans;
- run builds;
- verify Builder output;
- mark trust state;
- promote a signal directly to build work;
- bypass Signal Filter or Main Review.

### Signal Filter

Signal Filter is the boundary between thought and work.

It asks:

- is this just a thought?
- is this a real signal?
- is there evidence?
- is the evidence strong enough?
- is this repeated or just novel?
- is it stale, noisy, risky, or blocked?
- should it remain watching?
- is it ready for idea generation or review?

Allowed:

- classify signals;
- promote `watching` signals to `ready`;
- move ready signals to `queued_for_idea` for idea generation;
- reject or park signals;
- request more research;
- attach rationale and evidence gaps;
- create a bounded handoff to Dreamer/idea generation.

Not allowed:

- approve work;
- create operator approval;
- create build plan;
- start build;
- perform QA;
- mark trust state.

## Signal Status Ownership

Signal statuses:

```text
watching
ready
queued_for_idea
rejected
parked
consumed
```

Recommended ownership:

| Status | Meaning | Who can set |
| --- | --- | --- |
| `watching` | structured observation, not ready for work | Research, Subconscious, Signal Filter |
| `ready` | eligible for idea generation/review preparation | Signal Filter |
| `queued_for_idea` | scheduled or accepted into the Dreamer/idea lane | Signal Filter or Main Review |
| `rejected` | should not proceed | Signal Filter or Main Review |
| `parked` | valid but not now | Signal Filter or Main Review |
| `consumed` | signal was used by downstream artifact | Orchestrator / downstream stage |

Rules:

- Research-created signals start as `watching`;
- Subconscious-created signals start as `watching`;
- only Signal Filter or Main Review can promote to `ready` or `queued_for_idea`;
- `queued_for_idea` means queued for idea/review work, not queued for build;
- `queued_for_idea` is still not approval;
- `consumed` should reference the child artifact that used the signal.

Examples may omit some common envelope fields for readability. Implementations must include the full common artifact envelope.

Signal status and filterDecision updates must not be silently rewritten. They must be recorded as transitions. If the implementation treats artifacts as append-only, create a superseding signal artifact with `supersedesId`.

## Signal Artifact

`signal` should use the common artifact envelope from `07-artifact-model.md`.

Payload fields:

- signalType;
- target;
- summary;
- evidenceRefs;
- confidence;
- heat;
- suggestedLane;
- reasonNotTaskYet;
- recurrence;
- freshness;
- risk;
- filterDecision;
- nextAction.

Example:

```yaml
id: signal_20260511_operator_reporting
type: signal
schemaVersion: auto-buildroom/v1
status: watching
producer:
  role: subconscious
room:
  id: anthroclaw-core
parentIds:
  - research_20260511_operator_summary_docs
traceId: trace_20260511_operator_summary_docs
payload:
  signalType: docs_gap
  target: operator_reporting
  summary: "Operator reporting keeps appearing as a trust surface gap."
  evidenceRefs:
    - kind: artifact
      ref: research_20260511_operator_summary_docs
  confidence: medium
  heat:
    score: 0.68
    reasons:
      - repeated_in_docs
      - referenced_by_e2e_plan
  recurrence:
    count: 3
    window: 7d
  freshness:
    lastSeenAt: 2026-05-11T12:00:00Z
    stale: false
  suggestedLane: docs_test_improvement
  reasonNotTaskYet: "Needs Signal Filter classification and Main Review scope."
  filterDecision: null
  nextAction: classify
```

## Heat Model

Heat is a prioritization hint, not authority.

Heat can come from:

- repeated mentions;
- repeated user friction;
- evidence across multiple sources;
- recent failures;
- stale docs that block E2E;
- repeated operator questions;
- unused but valuable built work;
- returning ghosts.

Heat should be explainable:

```yaml
heat:
  score: 0.68
  level: medium
  reasons:
    - repeated_in_sessions
    - evidence_in_docs
    - blocks_v0_1_demo
  lastUpdatedAt: 2026-05-11T12:00:00Z
```

Recommended heat levels:

```text
low
medium
high
critical
```

Rules:

- heat cannot approve work;
- heat cannot override policy;
- heat cannot bypass review;
- high heat without evidence should become `needs_more_research`, not `ready`;
- critical heat may increase visibility but still requires approval before build.

Heat level `critical` means visibility urgency. It does not mean permission, safety criticality, or policy severity.

## Confidence Versus Heat

Confidence and heat are different.

Confidence answers:

```text
How well supported is this signal by evidence?
```

Heat answers:

```text
How much does this seem to matter right now?
```

Examples:

| Case | Confidence | Heat | Treatment |
| --- | --- | --- | --- |
| repeated pain with clear evidence | high | high | likely `ready` |
| interesting new idea | low | medium | `watching` |
| urgent but poorly evidenced claim | low | high | `needs_more_research` |
| old valid idea with no current need | high | low | `parked` |

## Lanes

Lanes group signals by likely treatment.

Recommended v0.1 lanes:

```text
docs_test_improvement
operator_visibility
runtime_safety
qa_gap
config_gap
research_only
retention_candidate
blocked_policy
```

Lane rules:

- lane is a hint, not a plan;
- lane does not grant authority;
- lane can change after Signal Filter review;
- Main Review defines actual scope later.

## Signal Filter Decisions

Signal Filter should produce an explicit decision.

Decision values:

```text
watch
ready_for_idea
queue_for_review
needs_more_research
park
reject
blocked
```

Decision meanings:

| Decision | Meaning |
| --- | --- |
| `watch` | keep observing, no work yet |
| `ready_for_idea` | enough to create an `idea_contract` |
| `queue_for_review` | strong enough for Main Review path |
| `needs_more_research` | potentially useful, evidence insufficient |
| `park` | valid but not now |
| `reject` | noisy, duplicate, unsafe, or not worth pursuing |
| `blocked` | policy or safety prevents progression |

## Decision To Status Mapping

Signal Filter decisions map to signal status as follows:

| Decision | Signal status |
| --- | --- |
| `watch` | `watching` |
| `needs_more_research` | `watching` |
| `ready_for_idea` | `ready` |
| `queue_for_review` | `queued_for_idea` |
| `park` | `parked` |
| `reject` | `rejected` |
| `blocked` | `parked` or `rejected` with policy reason |

If `blocked` is caused by sprint focus or product timing, no `error_receipt` is required. If `blocked` is caused by policy or safety violation, create or reference an `error_receipt`.

Example decision payload:

```yaml
filterDecision:
  decision: ready_for_idea
  reason: "Evidence-backed docs/test gap within v0.1 scope."
  evidenceStrength: medium
  risk: low
  allowedNext:
    - create_idea_contract
  blockedNext:
    - approval
    - build
```

Rules:

- every promotion must include rationale;
- every rejection should include reason;
- `ready_for_idea` may create `idea_contract`;
- `queue_for_review` still requires Main Review and operator approval before build;
- `blocked` should create or reference an `error_receipt` when policy is involved.

## Idea Handoff

When a signal is ready, Signal Filter may hand it to Dreamer/idea generation.

Handoff shape:

```yaml
target: dreamer
sourceSignalId: signal_20260511_operator_reporting
requestedArtifact: idea_contract
constraints:
  mustStayWithin:
    - docs/**
    - tests/**
  mustNotTouch:
    - src/**
    - agents/**
  approvalRequired: true
authority:
  canApprove: false
  canBuild: false
```

Rules:

- idea handoff is not approval;
- idea handoff cannot authorize code changes;
- idea handoff must preserve source signal and evidence refs;
- if scope is unclear, request Main Review or more research instead.

## Fascinations

Fascinations are recurring themes that may or may not become useful.

Suggested location:

```text
subconscious-room/fascinations/
```

Examples:

- "operator reports need evidence links";
- "Telegram approval identity keeps recurring";
- "runtime boundary must stay native";
- "docs/test E2E should be the v0.1 demo."

Rules:

- fascinations are not tasks;
- fascinations should cite signals or research packets;
- fascinations can become candidate signals only through Signal Filter;
- old fascinations should be parked or ghosted if stale.

## Ghosts

Ghosts are ideas that died, were parked, or went cold, but may return.

Suggested location:

```text
subconscious-room/ghosts/
```

Ghost fields:

- ghost ID;
- original signal or idea;
- why it was parked/pruned;
- last seen;
- reason it might return;
- current status.

Rules:

- ghost returning does not mean approved;
- reopened ghosts must re-enter Signal Filter;
- old evidence must be checked for staleness;
- if scope or policy changed, Main Review must re-evaluate.

## Sprint Locks

Sprint locks prevent the system from chasing every interesting signal.

Suggested location:

```text
subconscious-room/sprint-lock.json
```

Example:

```yaml
activeFocus:
  - v0_1_docs_test_e2e
lockedOut:
  - web_dashboard
  - external_research
  - autonomous_builds
reason: "v0.1 must prove local docs/test loop first."
expiresAt: 2026-05-18T00:00:00Z
```

Rules:

- sprint lock is a focus constraint, not approval;
- Signal Filter should reject or park signals outside active focus unless critical;
- operator may change sprint lock through approved config/operator path;
- Subconscious may suggest sprint lock changes, but cannot modify sprint lock directly;
- sprint lock cannot override safety policy.

## Build Intent Markers

Build intent markers are deferred for v0.1.

They may later represent:

```text
This signal may be worth building soon.
```

But in v0.1:

- build intent marker is not approval;
- build intent marker is not build plan;
- build intent marker cannot start Builder;
- build intent marker must go through Main Review and operator approval.

If implemented later, markers should reference:

- source signal;
- evidence refs;
- suggested scope;
- risk;
- why now;
- required approval.

## Signal Board Snapshot

Signal board snapshots are optional in v0.1.

They summarize current signals for operator visibility.

Suggested shape:

```yaml
generatedAt: 2026-05-11T12:00:00Z
roomId: anthroclaw-core
generatedFromSignalIds:
  - signal_20260511_operator_reporting
  - signal_20260511_docs_e2e
signals:
  watching:
    - signal_20260511_operator_reporting
  ready:
    - signal_20260511_docs_e2e
  parked:
    - signal_20260511_web_dashboard
blocked:
  - signal_20260511_external_posting
```

Rules:

- snapshot is a rendering/index, not source of truth;
- signal artifacts remain canonical;
- snapshots must not create approval authority.

## Subconscious Walks

Subconscious walks are deferred or limited in v0.1.

A walk is a bounded pass over Research, signals, ghosts, and fascinations.

Allowed v0.1 walk:

- local artifacts only;
- bounded by budget;
- no raw transcripts;
- no external network by default;
- no build execution;
- output is candidate signals or updates to watching signals.

Walk record should include:

- walk ID;
- inputs inspected;
- signals created/updated;
- ghosts reopened;
- fascinations updated;
- budget used;
- redaction result;
- errors.

## Duplicate And Stale Signal Handling

Signal Filter should avoid task spam.

Duplicate handling:

- merge duplicate watching signals when evidence overlaps;
- preserve parent IDs or related IDs;
- create a transition or superseding artifact for the merge;
- do not delete the duplicate evidence chain;
- increment recurrence/heat;
- do not create new idea contracts for every duplicate.

Stale handling:

- mark signal stale when not seen recently;
- reduce heat;
- park if valid but not current;
- ghost if it may return later;
- reject if evidence was wrong or no longer relevant.

Suggested freshness fields:

```yaml
freshness:
  firstSeenAt: 2026-05-01T12:00:00Z
  lastSeenAt: 2026-05-11T12:00:00Z
  staleAfterDays: 14
  stale: false
```

## Policy And Safety

Forbidden:

- Subconscious approves work;
- Signal Filter approves work;
- Subconscious creates build plan;
- Signal Filter creates build plan;
- heat creates approval;
- signal creates approval;
- build intent marker starts Builder;
- queued_for_idea signal starts Builder;
- ordinary agent handoff becomes approval;
- weak signal becomes task without review;
- external content overrides policy;
- sprint lock overrides safety;
- duplicate signal creates spammy tasks.

Required:

- every ready/queued_for_idea signal has evidence refs;
- every promotion records rationale;
- every rejection records reason;
- policy-blocked signals reference policy reason or `error_receipt`;
- Main Review and operator approval remain required before build.

## Operator UX

Operator-facing summary should be compact.

Example:

```text
Signal Filter

Ready:
- signal_20260511_operator_reporting
  reason: docs/test reporting gap is evidence-backed
  next: create idea_contract

Watching:
- signal_20260511_web_dashboard
  reason: useful later, outside v0.1 focus

Rejected:
- signal_20260511_autonomous_deploy
  reason: external side effects blocked in v0.1
```

The operator should see:

- which signals are ready;
- which are watching;
- which were rejected or parked;
- why;
- what evidence supports them;
- what next explicit command/action is needed.

## Acceptance Criteria

Subconscious and Signal Filter are good enough for v0.1 when:

- Subconscious can create/update `watching` signals;
- Signal Filter can classify signals into explicit decisions;
- decision-to-status mapping is deterministic;
- `ready` and `queued_for_idea` promotions require Signal Filter/Main Review rationale;
- heat is visible but cannot create authority;
- heat criticality is treated as visibility urgency, not permission;
- confidence and heat are separate;
- weak signals do not become tasks automatically;
- duplicate signals are merged or linked instead of spamming ideas;
- duplicate merges preserve evidence and create transition/supersession;
- stale signals can be parked or ghosted;
- idea handoff preserves evidence and authority flags;
- queued_for_idea signals still require Main Review and operator approval before build;
- sprint locks can constrain focus without overriding safety;
- Subconscious cannot modify sprint lock directly;
- signal board snapshots are renderings, not source of truth;
- signal board snapshots include `generatedFromSignalIds`;
- no Subconscious/Signal Filter path can approve, build, QA, or mark trust.
