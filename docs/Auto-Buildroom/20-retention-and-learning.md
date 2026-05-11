# Retention And Learning

Status: Draft

Purpose: define how Auto-Buildroom decides whether work should be kept, improved, parked, pruned, ghosted, or reopened, and what belongs in memory versus receipts.

## Thesis

Autonomous systems must know what to keep, what to improve, what to park, and what to forget operationally without erasing receipts.

Retention is not cleanup.

Retention is judgment after evidence.

Core rule:

```text
Retention recommends lifecycle treatment.
It does not erase audit evidence.
```

Learning is also bounded:

```text
Receipts are durable audit.
Memory is reusable context.
Skills are reusable behavior.
Learning proposals are not auto-approval.
```

## v0.1 Scope

Required for v0.1:

- create optional `retention_review` after `trust_report`;
- recommend `keep`, `improve`, `park`, `prune_recommended`, `ghost`, or `reopen`;
- preserve full receipt chain;
- prefer archive over delete;
- distinguish durable receipts from reusable memory;
- require operator/policy approval before destructive cleanup;
- allow learning suggestions without modifying agents/skills automatically.

Deferred:

- automatic artifact pruning;
- autonomous skill updates;
- automatic memory consolidation across rooms;
- enterprise retention policies;
- legal hold/compliance workflows;
- cross-project learning federation;
- usage analytics-driven retention automation.

v0.1 should prove:

```text
trust_report -> retention_review -> operator-visible recommendation
```

## Retention Recommendations

Allowed recommendation values:

```text
keep
improve
park
prune_recommended
ghost
reopen
```

Meanings:

| Recommendation | Meaning |
| --- | --- |
| `keep` | result is useful and should remain active |
| `improve` | useful but needs follow-up |
| `park` | valid but not now |
| `prune_recommended` | candidate for cleanup/archive, not deletion authority |
| `ghost` | idea/work is inactive but may return later |
| `reopen` | previously parked/ghosted item is relevant again |

Rules:

- retention recommendation is not approval;
- `prune_recommended` does not delete anything;
- `reopen` does not bypass Signal Filter/Main Review;
- `improve` should create a follow-up signal or idea candidate, not a build;
- `keep` does not imply `trust.clean`;
- `park` and `ghost` preserve evidence.

## Retention Review Artifact

`retention_review` should use the common artifact envelope.

Parent should be one of:

- `trust_report`;
- stale `signal`;
- stale `idea_contract`;
- stale `research_packet`;
- previous `retention_review`.

Payload fields:

- targetArtifactId;
- recommendation;
- reason;
- usageEvidence;
- trustState;
- followUpNeeded;
- followUpRefs;
- archiveAllowed;
- destructiveCleanupAllowed;
- learningCandidates;
- operatorActionNeeded.

Example:

```yaml
id: retention_20260511_build_sandbox
type: retention_review
schemaVersion: auto-buildroom/v1
status: completed
producer:
  role: retention
room:
  id: anthroclaw-core
parentIds:
  - trust_20260511_build_sandbox
traceId: trace_20260511_build_sandbox
payload:
  targetArtifactId: trust_20260511_build_sandbox
  recommendation: improve
  reason: "Docs spec is useful, but implementation tests are missing."
  usageEvidence:
    - kind: artifact
      ref: trust_20260511_build_sandbox
  trustStateAtReview: watch
  reviewAfter: 2026-06-11T00:00:00Z
  followUpNeeded: true
  followUpRefs:
    - type: signal_candidate
      summary: "Add implementation tests for build/sandbox policy."
  archiveAllowed: true
  destructiveCleanupAllowed: false
  learningCandidates:
    - type: operator_memory
      summary: "Build/sandbox docs should always mention independent diff."
  operatorActionNeeded: "Approve follow-up or leave as watch."
```

Rules:

- Retention recommends;
- envelope `status` describes review lifecycle, while `payload.recommendation` describes the lifecycle recommendation;
- Retention cannot delete receipts by itself;
- destructive cleanup requires explicit policy and operator-visible action;
- archived artifacts must remain hash-verifiable;
- retention review must not rewrite prior trust state.

Retention role/run should differ from Builder. It should consume Trust, QA, Delta, and usage evidence, not Builder self-report alone.

## Retention Decision Inputs

Retention should consider:

- trust state;
- QA result;
- Verification Delta;
- missing evidence;
- operator action needed;
- whether work is used later;
- whether the same signal keeps returning;
- whether follow-up is already created;
- policy violations;
- stale age;
- sprint lock/focus;
- operator feedback.

Retention should not rely only on:

- Builder self-report;
- a single successful command;
- heat without evidence;
- ordinary chat reactions;
- lack of recent activity without context.

## Recommendation Criteria

### keep

Use when:

- trust state is `clean` or strong `watch`;
- output is useful;
- no critical follow-up is needed;
- receipts are complete;
- operator can understand the result.

`keep` may still have minor future improvements.

`keep` means keep active or available for now. It does not exempt the target from future retention review.

### improve

Use when:

- output is useful but incomplete;
- trust state is `watch` or `investigate`;
- missing evidence suggests follow-up;
- QA found non-blocking issues;
- implementation needs tests/docs/examples.

`improve` should create a follow-up signal candidate, not automatic build authority.

### park

Use when:

- idea is valid;
- timing is wrong;
- outside sprint lock/focus;
- evidence is insufficient but not false;
- operator intentionally defers.

Parked items can be revisited by Signal Filter.

### prune_recommended

Use when:

- artifact/work is no longer operationally useful;
- duplicate exists;
- superseded by later receipt chain;
- stale and low value;
- safe archive is possible.

Rules:

- prune recommendation does not delete;
- archive is preferred;
- audit evidence remains;
- deletion requires explicit retention policy.

### ghost

Use when:

- idea/work is inactive;
- not worth active watching;
- may return later;
- historical context could be useful.

Ghosts should live in:

```text
subconscious-room/ghosts/
```

Ghost returning does not mean approval. It must re-enter Signal Filter.

### reopen

Use when:

- parked/ghosted item becomes relevant again;
- new evidence appears;
- sprint focus changes;
- operator asks to revisit;
- repeated signal returns.

`reopen` creates a signal/research path, not a build path.

`reopen` should usually target a parked or ghosted signal, idea, dossier, or prior retention review. For a completed trusted build, `improve` is usually the safer recommendation unless new evidence indicates the prior lifecycle decision itself should be reopened.

## Receipts Versus Memory

Receipts are durable audit artifacts.

Memory is reusable context.

Rules:

- receipts are the source of truth;
- memory can summarize receipts but cannot replace them;
- memory entries should link to receipt IDs;
- memory should not contain raw secrets or private transcripts;
- memory should not grant approval authority;
- memory should not be treated as current truth without freshness check.

Memory candidate shape:

```yaml
type: operator_memory
sourceReceiptIds:
  - trust_20260511_build_sandbox
  - retention_20260511_build_sandbox
summary: "For build/sandbox work, independent diff computation is a required safety gate."
confidence: high
freshness:
  createdAt: 2026-05-11T12:00:00Z
  reviewAfter: 2026-06-11T00:00:00Z
allowedUse:
  canInformResearch: true
  canInformProposal: true
  canApproveWork: false
```

In v0.1, memory candidates are recommendations. They should not be written to global, user, or agent memory without explicit operator approval.

## Learning Candidates

Learning candidates are proposals for reusable knowledge.

Types:

```text
operator_memory
project_convention
doc_update
test_fixture
agent_prompt_update
skill_update
config_recommendation
```

Rules:

- learning candidate is not automatically applied;
- prompt/skill/config updates require separate approval;
- skill, prompt, and config updates are behavior changes and require a new Buildroom proposal and explicit operator approval;
- learning candidates must reference receipts;
- learning must not include secrets;
- learning must not erase receipts;
- stale learning should be reviewed or parked.

## Skills And Agent Updates

Auto-Buildroom may recommend updates to:

- agent prompt;
- project docs;
- tests;
- reusable skill;
- operator guide;
- troubleshooting guide.

But v0.1 must not automatically mutate:

- `agents/**`;
- global skills;
- Buildroom policy;
- approval routes;
- security config.

Such updates require a new Buildroom loop:

```text
learning_candidate -> research/proposal -> main_review -> approval -> build -> QA -> trust
```

## Archive Policy

Archive is preferred over delete.

Archive should preserve:

- receipt chain;
- content hashes;
- parent/child links;
- trace ID;
- operator summaries;
- policy results;
- runtime refs or redacted excerpts;
- retention review.

Suggested archive location:

```text
.anthroclaw/auto-buildroom/rooms/<roomId>/archive/YYYY/MM/<traceId>/
```

Rules:

- moving artifacts to archive must not invalidate content hashes;
- artifact hashes must not include filesystem path;
- indexes can be rebuilt from archive;
- archived receipts remain inspectable;
- archive action should create a transition or receipt.

If archive moves are implemented, the archive action should create a transition or archive receipt that records:

- moved artifact IDs;
- old paths;
- new paths;
- content hashes;
- trace ID;
- operator or policy trigger.

## Destructive Cleanup

Destructive cleanup is deferred by default in v0.1.

v0.1 should not implement destructive cleanup of approval artifacts, error receipts, policy violation records, or trust reports.

Not allowed without explicit retention policy:

- deleting receipt artifacts;
- deleting parent artifacts needed for audit;
- deleting evidence needed for trust reports;
- deleting operator approval records;
- deleting error receipts;
- deleting policy violation records.

If destructive cleanup is ever allowed:

- operator must explicitly approve;
- deletion target must be exact;
- reason must be recorded;
- receipt chain impact must be shown;
- tombstone record must remain;
- legal/compliance hold must override cleanup.

Tombstone shape:

```yaml
type: retention_tombstone
deletedArtifactId: artifact_...
deletedArtifactType: artifact_type
deletedArtifactHash: sha256:...
deletedAt: 2026-05-11T12:00:00Z
deletedBy: cli:user:local-operator
deletionPolicyId: retention-policy_...
reason: "Explicit cleanup of duplicate generated fixture."
retainedRefs:
  - retention_...
  - trust_...
```

## Ghost Reopening

Ghosts can return when:

- new evidence appears;
- same friction repeats;
- operator asks about it;
- sprint lock changes;
- related work becomes active.

Reopen path:

```text
ghost -> signal watching -> Signal Filter -> idea/review path
```

Rules:

- reopened ghost is not approval;
- old evidence must be checked for staleness;
- if policy changed, Main Review must reassess;
- reopened ghost should reference original ghost and new evidence.

## Learning Freshness

Learning can go stale.

Every memory/learning candidate should have:

- source receipts;
- createdAt;
- confidence;
- reviewAfter;
- staleWhen;
- invalidationTriggers;
- owner or role;
- allowed uses.

Invalidation trigger examples:

- config schema changes;
- runtime adapter changes;
- policy changes;
- repo structure changes;
- trust report superseded;
- operator correction;
- related receipt chain archived or reopened.

Freshness rule:

```text
Old learning can inform Research, but it cannot override current artifacts, config, policy, or approval requirements.
```

## Operator UX

Retention summary should be concise.

Example:

```text
Retention: IMPROVE

Why:
Docs spec is useful, but implementation tests are missing.

Trust:
WATCH

Suggested follow-up:
Add build/sandbox implementation tests.

Receipts:
- trust_20260511_build_sandbox
- retention_20260511_build_sandbox

Authority:
No build approval created.
```

Operator should see:

- recommendation;
- why;
- trust state;
- follow-up needed;
- archive allowed;
- destructive cleanup allowed or not;
- learning candidates;
- receipts.

## Policy And Safety

Forbidden:

- Retention deletes receipts by default;
- Retention erases audit trail;
- Retention removes evidence needed for trust reports;
- Retention changes trust state;
- Retention approval creates build authority;
- learning candidate updates agents/config/skills automatically;
- memory replaces receipts;
- old learning overrides current policy;
- ghost reopening bypasses Signal Filter;
- prune recommendation deletes artifacts.

Required:

- retention review references target artifact;
- archive preserves receipt chain;
- destructive cleanup requires explicit policy;
- learning candidates reference receipts;
- operator can inspect why recommendation was made.

## Acceptance Criteria

Retention and learning are good enough for v0.1 when:

- `retention_review` can be created after `trust_report`;
- `retention_review.status` is lifecycle status, while `payload.recommendation` stores the recommendation;
- recommendation values are `keep`, `improve`, `park`, `prune_recommended`, `ghost`, `reopen`;
- retention recommendations do not delete artifacts;
- archive is preferred over delete;
- archive moves record paths and content hashes if implemented;
- destructive cleanup is disabled unless explicit policy exists;
- approvals, errors, policy violations, and trust reports are not destructively cleaned up in v0.1;
- receipts remain source of truth;
- memory summaries link to receipt IDs;
- memory candidates are not written automatically;
- learning candidates do not auto-mutate agents, config, or skills;
- skill/prompt/config updates require a new approved Buildroom loop;
- reopened ghosts re-enter Signal Filter;
- stale learning cannot override current artifacts/policy;
- learning candidates include invalidation triggers;
- operator report shows recommendation, reason, trust state, follow-up, and receipts.
