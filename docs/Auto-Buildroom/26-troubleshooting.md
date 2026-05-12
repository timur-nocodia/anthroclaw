# Troubleshooting

Status: Draft

Purpose: document common failure modes: stuck builds, missing approvals, path violations, failed QA, corrupted artifacts, runtime blocks, and rollback.

## Troubleshooting Thesis

Auto-Buildroom should fail closed and leave receipts.

When something looks wrong, do not guess from chat text or Builder claims.

Start from:

```text
status -> show receipt -> inspect policy/trust -> choose explicit next action
```

Core rule:

```text
If there is no receipt, treat the action as if it did not happen.
```

## First Commands To Run

In this repository, the local command entrypoint is:

```text
pnpm buildroom <command>
```

Docs may also show the installed product-facing form:

```text
anthroclaw buildroom <command>
```

Start with:

```text
anthroclaw buildroom status
```

Then inspect the relevant receipt:

```text
anthroclaw buildroom show <id>
```

If available, validate the room:

```text
anthroclaw buildroom validate
```

If available, render a report:

```text
anthroclaw buildroom report
```

Use JSON only when debugging automation:

```text
anthroclaw buildroom status --json
```

Never paste unredacted JSON or runtime logs into chat if they may contain secrets.

## Exit Codes

Recommended CLI meanings:

| Code | Meaning | First action |
| --- | --- | --- |
| `0` | success | continue to next shown action |
| `1` | general failure | inspect error receipt or command output |
| `2` | invalid usage | check command target ID and syntax |
| `3` | invalid config | run status/validate, fix config |
| `4` | policy blocked | inspect policy result and error receipt |
| `5` | missing artifact | inspect parent IDs and storage |
| `6` | runtime failed | inspect runtime refs and error receipt |
| `7` | approval required | inspect review, approve explicitly |
| `8` | paused or kill switch active | inspect pause/kill switch state |

## Safety Response Order

When a build or trust chain looks unsafe:

1. Pause the room if new stages may start.
2. Inspect status.
3. Inspect the latest relevant receipt.
4. Check whether approval was granted and consumed.
5. Check policy results.
6. Check QA and Verification Delta.
7. Decide whether to reject, retry, revise scope, or leave blocked.

Pause:

```text
anthroclaw buildroom pause
```

Resume only after you understand the next action:

```text
anthroclaw buildroom resume
anthroclaw buildroom status
```

Resume must not auto-start approved-not-built work.

## Symptom: Build Says Approval Required

What you see:

```text
Build rejected.
Reason: build requires approval artifact
```

Likely causes:

- approval was never created;
- approval target was an idea instead of a review;
- approval was revoked, expired, or already consumed;
- command used `review_...` or `idea_...` where `approval_...` was required.

Check:

```text
anthroclaw buildroom status
anthroclaw buildroom show <review_id>
```

Fix:

```text
anthroclaw buildroom approve <review_id>
anthroclaw buildroom build <approval_id>
```

Do not:

- build raw idea IDs;
- build raw review IDs;
- infer approval from chat;
- build ambiguous targets like `latest`.

## Symptom: Approval Did Not Start Build

What you see:

```text
Approval created
Approved not built: 1
Active builds: 0
```

This is expected in v0.1.

Approval grants authority. Build consumes authority.

Next:

```text
anthroclaw buildroom build <approval_id>
```

If approval automatically starts Builder in v0.1, treat it as a safety bug.

## Symptom: Build Started Twice Or Looks Duplicated

Likely causes:

- duplicate CLI command;
- concurrent CLI/Telegram triggers;
- stale lock handling bug;
- approval consumption was not atomic.

Check:

```text
anthroclaw buildroom status
anthroclaw buildroom show <approval_id>
anthroclaw buildroom show <build_id>
```

Look for:

- one approval;
- one build plan;
- one consumed approval;
- one active or completed Builder run;
- lock record for `roomId + approvalId + buildPlanId`.

Expected behavior:

```text
duplicate build request returns existing build status
```

Do not start a second Builder run manually to “fix” a duplicate.

If duplicate mutation happened, leave the chain blocked or investigate until the diff is understood.

## Symptom: Room Is Paused

What you see:

```text
paused or kill switch active
```

Check:

```text
anthroclaw buildroom status
```

If paused:

```text
anthroclaw buildroom resume
anthroclaw buildroom status
```

Resume should not auto-run builds.

If a native runtime build was active during pause, status should show whether it is still running, cancelled, or failed.

## Symptom: Kill Switch Active

What you see:

```text
Kill switch: active
```

Meaning:

```text
new scheduled stages and new builds are blocked
```

Check config:

```yaml
killSwitchActive: true
```

Fix only if you intentionally want to resume new execution:

```yaml
killSwitchActive: false
```

Then:

```text
anthroclaw buildroom status
```

Do not expect disabled kill switch to auto-start work.

## Symptom: Config Invalid

What you see:

```text
invalid config
```

Likely causes:

- `manual_approval` has no configured operator;
- allowed paths are empty for a build-capable room;
- raw transcripts are enabled without explicit opt-in;
- external side effects are enabled without policy;
- mutation target is unavailable;
- blocked path defaults are missing;
- Telegram chat/thread is configured as identity instead of route evidence.

Check:

```text
anthroclaw buildroom status
anthroclaw buildroom validate
```

Fix:

- edit config through explicit config command or manual operator action;
- validate before running stages;
- keep `killSwitchActive: true` if execution should remain stopped;
- do not let Builder modify Buildroom config.

## Symptom: Policy Blocked

What you see:

```text
policy blocked
trust: BLOCKED
```

Likely causes:

- changed file outside approved scope;
- blocked path touched;
- deletion not explicitly approved;
- symlink escape;
- external side-effect attempt;
- Builder network access attempted;
- Buildroom config or approval policy touched.

Check:

```text
anthroclaw buildroom show <build_id>
anthroclaw buildroom show <error_receipt_id>
```

Look for:

- `preRunPolicyResult`;
- `postRunPolicyResult`;
- changed files;
- violations;
- allowed paths;
- blocked paths.

Fix:

- reject the chain if the work should not proceed;
- create a narrower proposal if scope was wrong;
- run a new approved loop if the desired change is valid;
- keep the policy violation receipt.

Do not:

- force `trust.clean`;
- delete the violation receipt;
- widen scope after the fact without new approval.

## Symptom: Path Violation

What you see:

```text
Changed file outside allowed scope
```

or:

```text
Blocked path modified
```

Check:

```text
anthroclaw buildroom show <build_id>
```

Look for:

```text
postRunPolicyResult
changedFiles
violations
```

Common examples:

- `agents/**` changed;
- `config.yml` changed;
- `.env` touched;
- generated file outside allowed paths;
- symlink in allowed dir points outside scope.

Expected trust:

```text
blocked
```

or at minimum not `clean`.

Fix by creating a new proposal with explicit scope if the change is actually desired.

If the violation happened inside a worktree/sandbox, prefer abandoning or archiving the worktree diff rather than applying those changes.

Keep the receipts that explain the violation.

## Symptom: Runtime Failed

What you see:

```text
runtime failed
```

or:

```text
error_receipt created
```

Likely causes:

- native Agent SDK runtime error;
- timeout;
- cancellation;
- worktree setup failure;
- permission issue;
- native runtime requested approval;
- model/tool failure;
- redaction failure.

Check:

```text
anthroclaw buildroom show <error_receipt_id>
anthroclaw buildroom show <approval_id>
```

Important question:

```text
Was approval consumed?
```

If failure happened before execution boundary:

```text
approval may remain unconsumed
```

If native runtime start was attempted:

```text
approval is consumed and retry must be explicit
```

If status cannot determine whether runtime start was attempted, treat approval as consumed until inspected.

If retry is implemented:

```text
anthroclaw buildroom retry <error_receipt_id>
```

Use retry only when scope is unchanged and the prior `error_receipt` is referenced.

If retry is not implemented:

```text
create a new reviewed and approved proposal
```

or follow the documented manual recovery path.

Do not retry by silently changing scope.

Do not use ambiguous retry targets such as:

```text
anthroclaw buildroom retry latest
```

Deprecated ambiguous form:

```text
anthroclaw buildroom retry <error_or_build_id>
```

## Symptom: Native Runtime Asked For Approval

Meaning:

The native runtime or tool layer requested its own approval.

Buildroom approval is not a blanket native tool approval.

Expected v0.1 behavior:

```text
block and surface operator action
```

Check:

```text
anthroclaw buildroom show <error_receipt_id>
```

Fix:

- inspect exact requested tool/action/path;
- decide whether it was inside approved scope;
- if not explicitly approved, reject or create new scope;
- do not auto-grant from prior Buildroom approval.

## Symptom: Worktree Or Sandbox Failed

Likely causes:

- git worktree unavailable;
- dirty repo baseline not allowed;
- untracked required files not handled;
- sandbox root missing;
- permissions issue.

Check:

```text
anthroclaw buildroom status
anthroclaw buildroom show <error_receipt_id>
```

Fix:

- clean or record dirty baseline;
- include approved untracked files explicitly;
- repair worktree support;
- use deterministic non-mutating fixture mode only if real mutation is not required.

Do not silently fall back to in-place mutation unless config explicitly allows it.

## Symptom: Missing Artifact

What you see:

```text
Receipt not found
```

or:

```text
missing artifact
```

Likely causes:

- typo in ID;
- wrong room;
- artifact not created;
- storage corruption;
- index stale;
- report references a missing parent.

Check:

```text
anthroclaw buildroom status
anthroclaw buildroom show <known_parent_id>
```

Confirm the current room ID in status. If the CLI supports room selection, retry with:

```text
anthroclaw buildroom status --room <roomId>
anthroclaw buildroom show <id> --room <roomId>
```

If available:

```text
anthroclaw buildroom validate
```

Fix:

- use exact ID from status/report;
- rebuild derived indexes if supported;
- inspect artifact files directly only if needed;
- leave chain blocked/investigate if required parent is missing.

Do not treat a stage as complete if the receipt is missing.

## Symptom: Artifact Hash Mismatch

Meaning:

An artifact may have been corrupted or edited after persistence.

Check:

```text
anthroclaw buildroom validate
anthroclaw buildroom show <artifact_id>
```

Expected behavior:

- derived state should fail closed;
- reports should not trust corrupted artifacts;
- operator should see blocked/investigate.

Fix:

- inspect whether the artifact was manually edited;
- restore from backup if available;
- supersede with a new valid artifact only through supported path;
- do not silently recompute hash over changed content.

A superseding artifact can record correction or repair, but it must not pretend to be the original receipt. The trust chain should remain investigate or blocked until the operator accepts the repair path.

## Symptom: Index Or Status Looks Wrong

Meaning:

Derived state may be stale.

Remember:

```text
artifact JSON + transition logs are source of truth
indexes/state/cache are derived
```

Check:

```text
anthroclaw buildroom validate
anthroclaw buildroom status --json
```

Fix:

- rebuild derived state if supported;
- trust artifacts over index;
- inspect transition logs.

Do not edit derived state to make the UI look right.

Do not manually edit `state.json` to unblock a run.

## Symptom: QA Failed

What you see:

```text
QA status: fail
```

or:

```text
QA status: blocked
```

Likely causes:

- acceptance criteria not met;
- command failed;
- evidence missing;
- changed files differ from Builder claims;
- path policy issue;
- QA could not safely inspect.

Check:

```text
anthroclaw buildroom show <qa_id>
anthroclaw buildroom show <delta_id>
```

Fix:

- create an improve follow-up;
- reject if the work is invalid;
- investigate if evidence is unclear;
- run a new approved build if changes are required.

Do not let Builder claim override QA.

## Symptom: Trust Is WATCH

This is not automatically a failure.

Meaning:

```text
useful work is proven, but not everything is proven
```

Check:

```text
anthroclaw buildroom show <trust_id>
```

Look for:

- unconfirmed claims;
- missing evidence;
- risks;
- next action.

Good operator response:

- accept `watch` for docs/test improvements when remaining risk is known;
- create follow-up if missing evidence matters;
- do not force `clean`.

## Symptom: Trust Is INVESTIGATE

Meaning:

Something important needs human inspection.

Likely causes:

- rejected high claim;
- surprising diff;
- QA notes conflict with Builder claims;
- report inconsistency;
- missing non-critical but important evidence.

Check:

```text
anthroclaw buildroom show <trust_id>
anthroclaw buildroom show <delta_id>
anthroclaw buildroom show <qa_id>
```

Fix:

- inspect changed files;
- decide whether to reject, improve, or run new approved build;
- leave the trust state as investigate until resolved.

## Symptom: Trust Is BLOCKED

Meaning:

Policy, safety, runtime, config, or critical evidence prevents trust progression.

Common causes:

- path violation;
- unresolved error receipt;
- missing QA;
- missing Delta;
- missing critical safety evidence;
- invalid config;
- native runtime approval request.

Check:

```text
anthroclaw buildroom status
anthroclaw buildroom show <trust_id>
anthroclaw buildroom show <error_receipt_id>
```

Fix:

- resolve config/policy/runtime blocker;
- create new proposal if scope must change;
- run a new approved loop if mutation is needed;
- preserve blocked receipts.

Do not rely on blocked work as complete.

## Symptom: Trust Is CLEAN But Evidence Looks Missing

Treat this as a release-blocking bug.

Check:

```text
anthroclaw buildroom show <trust_id>
anthroclaw buildroom show <delta_id>
anthroclaw buildroom show <qa_id>
```

Look for missing:

- QA report;
- Verification Delta;
- high/critical claim evidence;
- policy results;
- runtime refs if needed.

Immediate action:

```text
anthroclaw buildroom pause
```

Then open an implementation bug. False `clean` is worse than conservative `watch`.

## Symptom: Report Disagrees With Artifacts

Meaning:

The rendered report may be stale or generated from an old chain.

Check:

```text
anthroclaw buildroom show <summary_id>
anthroclaw buildroom show <trust_id>
```

Look for:

- `renderedFromIds`;
- renderer version;
- trust state at render time;
- superseded artifacts.

Fix:

```text
anthroclaw buildroom report --save
```

Artifacts win over reports.

## Symptom: Secret Or Raw Transcript Appears

This is a safety incident.

Immediate action:

```text
anthroclaw buildroom pause
```

Check:

```text
anthroclaw buildroom show <artifact_id>
anthroclaw buildroom validate
```

Likely causes:

- redaction failure;
- raw transcript watching enabled incorrectly;
- runtime logs persisted raw;
- CLI/Telegram/report renderer leaked a value.

Fix:

- stop new stages;
- identify where the leak occurred;
- rotate the secret if real;
- patch redaction;
- add regression fixture;
- supersede or quarantine leaked artifact according to policy.

Do not paste leaked content into issue descriptions or chat.

Protect the secret first.

Depending on incident policy, quarantine or redact the unsafe artifact, but leave a redacted incident receipt, error receipt, or tombstone so the audit chain records that a leak occurred without exposing the value.

Do not blindly delete the artifact without leaving safe audit evidence unless an explicit incident policy requires it.

## Symptom: Telegram Approval Rejected

Likely causes:

- sender is not configured operator;
- route is not an approval route;
- command used idea ID instead of review ID;
- message was forwarded;
- reply text was not a full `/buildroom approve <review_id>` command;
- notification topic is not an approval route.

Check:

```text
/buildroom status
```

or use CLI:

```text
anthroclaw buildroom status
anthroclaw buildroom show <review_id>
```

Fix:

- use exact `/buildroom approve <review_id>`;
- send from configured operator user;
- send from configured approval route;
- use CLI if route identity is unclear.

Do not approve with:

```text
yes
ok
approve
reaction
forwarded message
```

## Symptom: Telegram Notification Did Not Arrive

Likely causes:

- Telegram surface not included in v0.1;
- notification route not configured;
- route points to wrong topic;
- bot lacks permission;
- command response succeeded but async notification failed.

Check CLI first:

```text
anthroclaw buildroom status
anthroclaw buildroom report
```

CLI/artifacts are canonical.

Fix Telegram routing after verifying the artifact chain exists.

Missing notification does not mean the Buildroom stage failed. Verify the artifact chain through CLI before retrying or rerunning a stage.

## Symptom: Retention Wants To Delete Something

Retention in v0.1 should recommend, not erase audit evidence.

Allowed:

- `keep`;
- `improve`;
- `park`;
- `prune_recommended`;
- `ghost`;
- `reopen`.

Not allowed by default:

- deleting approval artifacts;
- deleting error receipts;
- deleting policy violation records;
- deleting trust reports;
- mutating memory/skills/config automatically.

If retention appears to delete receipts, pause rollout and treat it as a safety bug.

## Symptom: Learning Candidate Mutated Behavior Automatically

This should not happen in v0.1.

Learning candidates may propose follow-up work. They must not automatically mutate:

- memory;
- skills;
- agent prompts;
- Buildroom policy;
- approval routes;
- runtime config.

Fix:

- pause the room;
- inspect retention/learning artifacts;
- revert behavioral mutation through normal git/config workflow;
- create a new approved Buildroom loop if the learning is actually desired.

## Rollback

Rollback implementation changes through normal git workflow.

Do not delete Buildroom receipts to make history look clean.

Preferred rollback approach:

1. pause Buildroom;
2. inspect latest trust/error receipts;
3. revert code/docs changes if needed;
4. leave receipt chain intact;
5. create follow-up proposal if corrective work is needed.

Artifacts should be:

- superseded;
- archived;
- marked blocked/investigate;
- or referenced by correction receipts.

They should not be silently edited or deleted.

## When To File A Bug

File an implementation bug if:

- build runs without explicit approval;
- approval starts build automatically in v0.1;
- Builder produces QA/Delta/Trust;
- path violation is missed;
- trust becomes `clean` without QA/Delta;
- secret/raw transcript is persisted;
- duplicate build mutates twice;
- Telegram chat/thread grants approval without operator identity;
- report invents trust state;
- receipts are missing for completed actions;
- runtime mutation bypasses native Agent SDK runtime.

## Quick Diagnostic Checklist

For any issue, answer:

- What is the room state?
- What is the latest trust state?
- What is the exact artifact ID?
- Is there a receipt?
- Was approval granted?
- Was approval consumed?
- Did build run through native runtime?
- What changed according to independent diff?
- Did path policy pass?
- Did QA run?
- Did Delta classify every Builder claim?
- Did Trust overclaim?
- Are secrets/redaction safe?
- What is the next explicit operator command?

## Acceptance Criteria

Troubleshooting is good enough for v0.1 when an operator can use this document to:

- diagnose approval-required failures;
- avoid accidental duplicate builds;
- understand paused/kill switch states;
- handle path/policy violations;
- inspect runtime failures;
- diagnose missing/corrupt artifacts;
- understand QA/trust failures;
- respond to false `clean`;
- handle Telegram route/identity issues;
- preserve receipts during rollback;
- know when to file an implementation bug.
