# Runtime Integration

Status: Draft

Purpose: explain how Auto-Buildroom orchestrates around the native Agent SDK runtime without replacing permissions, sessions, tool semantics, approvals, cancellation, or logs.

## Runtime Integration Thesis

Auto-Buildroom is a control plane, not a runtime.

It decides:

- which stage should run;
- what context is approved;
- what artifact should be produced;
- what policy gates apply;
- what receipts must be saved;
- what the operator should see.

It must not replace the native AnthroClaw Agent SDK runtime.

The hard boundary:

```text
Buildroom orchestrates work.
Native runtime executes agent runs.
```

## Responsibilities

### Buildroom Orchestrator Owns

- room state;
- artifact chain;
- policy gates;
- approval checks;
- role prompt assembly;
- allowed context selection;
- stage selection;
- receipt persistence;
- report rendering;
- retry policy;
- fail-closed transitions.

### Native Runtime Owns

- model calls;
- tool calls;
- tool permissions;
- runtime approvals;
- sessions;
- streaming events;
- cancellation;
- sandbox/tool execution semantics;
- logs;
- final run status;
- runtime errors.

## Forbidden Runtime Behavior

Auto-Buildroom must not:

- implement a parallel tool loop;
- bypass native tool permissions;
- spoof assistant/user/tool messages;
- mutate runtime session state outside official APIs;
- treat Markdown as runtime success;
- reinterpret runtime failure as success;
- run Builder shell/code execution outside configured sandbox;
- intercept secrets from runtime internals;
- rewrite runtime config from inside a Buildroom run;
- create hidden external side effects outside runtime policy.

If the native runtime reports failure, cancellation, approval block, or policy violation, Buildroom must preserve that status.

## Runtime Adapter

Auto-Buildroom should depend on a narrow adapter rather than importing runtime details throughout the plugin.

Conceptual interface:

```ts
export interface NativeAgentRuntimeAdapter {
  startRun(input: RuntimeRunInput): Promise<RuntimeRunHandle>;
  getRunStatus(runId: string): Promise<RuntimeRunStatus>;
  cancelRun(runId: string, reason: string): Promise<void>;
  readRunEvents(runId: string): AsyncIterable<RuntimeEvent>;
  readRunResult(runId: string): Promise<RuntimeRunResult>;
}
```

Input:

```ts
export interface RuntimeRunInput {
  roomId: string;
  role: BuildroomRole;
  stage: BuildroomStage;
  sessionName: string;
  workingDirectory: string;
  prompt: string;
  allowedPaths: string[];
  blockedPaths: string[];
  parentArtifactIds: string[];
  permissions: {
    runtimeApprovalMode: 'native' | 'require_human';
    externalSideEffects: 'deny' | 'allow_with_approval';
  };
  metadata: {
    traceId: string;
    buildroomRunId: string;
    idempotencyKey: string;
    risk: 'low' | 'medium' | 'high' | 'critical';
  };
}
```

Result:

```ts
export interface RuntimeRunResult {
  runId: string;
  status:
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'blocked_by_approval'
    | 'policy_violation';
  finalText?: string;
  toolEvents: RuntimeEvent[];
  changedFiles?: string[];
  error?: string;
}
```

This interface is conceptual. The implementation must match the actual AnthroClaw Agent SDK integration points.

Passing path constraints to the native runtime is advisory unless the runtime enforces them. Buildroom must still perform its own pre-run and post-run filesystem policy checks.

`workingDirectory` must be inside the configured repo root or approved sandbox/worktree root. Path traversal and symlink escape must be rejected before runtime start.

## Role Runs

Every Buildroom role run must have:

- role;
- stage;
- run ID;
- trace ID;
- parent artifacts;
- approved input refs;
- output artifact type;
- runtime result;
- policy result.

Role runs may be LLM-backed or deterministic.

Examples:

| Role | Runtime-backed? | Notes |
| --- | --- | --- |
| Research | yes or deterministic fixture | v0.1 may start with deterministic repo/docs summary |
| Dreamer | yes or deterministic fixture | produces `idea_contract` |
| Main Review | yes or deterministic fixture | locks scope |
| Builder | yes | uses native runtime and approved scope |
| QA | yes or deterministic checks | must be separate from Builder |
| Verification Delta | deterministic preferred | compares claims and QA |
| Trust | yes or deterministic | summarizes evidence |

Deterministic fixtures still must produce artifacts and pass policy unless explicitly marked as non-executing demo data.

Hard rule:

```text
Any Builder stage that changes repository files must go through the native runtime.
```

Deterministic Builder fixtures are allowed only for non-executing demos/tests that do not mutate the repo.

## Idempotency And Run Locks

Buildroom must prevent duplicate stage execution.

Before starting a Builder run, Buildroom must acquire a lock scoped to:

```text
roomId + approvalId + buildPlanId
```

Runtime input should include an idempotency key:

```text
buildroom:<roomId>:<stage>:<approvalId>:<buildPlanId>
```

Rules:

- starting the same stage twice with the same idempotency key must not create two Builder runs;
- duplicate starts should return the existing run status;
- approval consumption and Builder start must be atomic, or protected by the same lock;
- cron, CLI, and Telegram triggers must share the same lock path;
- lock release must be recorded on completion, cancellation, or error receipt.

This protects the v0.1 rule:

```text
one approval -> one build plan -> one build attempt
```

## Session Policy

Buildroom role sessions should not silently merge with ordinary user chat sessions.

Recommended v0.1 session naming:

```text
buildroom:<roomId>:<role>:<stage>:<traceId>
```

Examples:

```text
buildroom:anthroclaw-core:research:collect:trace_20260511_operator_summary
buildroom:anthroclaw-core:builder:build:trace_20260511_operator_summary
buildroom:anthroclaw-core:qa:verify:trace_20260511_operator_summary
```

Rules:

- role sessions are scoped to Buildroom runs;
- ordinary agent chat history is not automatically injected;
- watched ordinary-agent context enters through sanitized session summaries;
- raw transcripts require explicit opt-in beyond v0.1;
- session IDs should be recorded in artifacts or runtime refs.

## Context Passing Policy

Buildroom should pass only approved context into role runs.

Allowed by default:

- parent artifact payloads required for the stage;
- typed input refs;
- sanitized session summaries;
- approved source files;
- approved build plan;
- policy constraints;
- relevant operator decision artifacts.

Not allowed by default:

- raw private transcripts;
- `.env` contents;
- secrets;
- unrelated sessions;
- full repo dump when narrow refs are sufficient;
- untrusted web content as instructions.

Web or external content must be treated as evidence, not as policy.

Hard rule:

```text
Untrusted external content may inform evidence.
It must not override Buildroom policy, role instructions, or approval rules.
```

## Tool And Permission Policy

Runtime tools remain controlled by the native runtime.

Buildroom may request a role run with:

- allowed paths;
- blocked paths;
- approval mode;
- metadata;
- role prompt.

Buildroom must not:

- grant tools by editing runtime internals mid-run;
- bypass tool approval;
- add external side-effect tools without policy approval;
- directly execute shell commands that Builder should run through the configured runtime/sandbox.

For v0.1, Builder tool permissions should be narrow:

```text
read repo
write approved docs/tests paths
run approved local verification commands
write Buildroom artifacts
```

Buildroom path checks remain mandatory even if the native runtime accepts `allowedPaths` and `blockedPaths`.

## Run Lifecycle

Conceptual lifecycle:

```text
prepare stage
-> load parent artifacts
-> run pre-policy checks
-> start native runtime run
-> stream/read runtime events
-> collect result
-> run post-policy checks
-> create expected artifact or error_receipt
-> update room state
-> render operator summary
```

Important:

```text
runtime success is required but not sufficient
```

Even if the native runtime reports `completed`, Buildroom must still run post-policy checks before advancing.

Examples:

- runtime completed, but changed blocked path -> blocked;
- runtime completed, but no coder receipt -> error receipt;
- runtime failed -> error receipt;
- runtime blocked by approval -> blocked or awaiting operator action;
- runtime cancelled -> error receipt or cancelled state.

## Runtime Events And Receipts

Runtime events are evidence, not automatically proof.

Buildroom may store references or redacted excerpts from:

- tool calls;
- command outputs;
- file changes;
- runtime errors;
- cancellation events;
- approval blocks.

Rules:

- default to storing references and bounded redacted excerpts, not full raw logs;
- do not store secrets from event output;
- cap long outputs;
- redact before persistence;
- store event refs in `inputRefs`, `outputRefs`, `runtimeRefs`, or `error_receipt`;
- do not reinterpret tool events as success unless runtime status and policy checks agree.
- avoid sending raw runtime event streams into later LLM prompts.

## Cancellation

Cancellation should preserve runtime semantics.

Buildroom may request cancellation:

```ts
cancelRun(runId, reason)
```

But the native runtime decides how cancellation is executed.

Cancellation outcomes:

```text
runtime cancelled -> error_receipt or cancelled transition
runtime already completed -> post-policy checks still run
runtime cancellation failed -> blocked with error_receipt
```

Pause is not cancellation. Pause prevents new stages; it does not automatically cancel active native runtime.

## Error Mapping

Runtime statuses map into Buildroom outcomes:

| Runtime status | Buildroom outcome |
| --- | --- |
| `completed` | create expected artifact, then run post-policy |
| `failed` | `error_receipt`, `blocked` |
| `cancelled` | `error_receipt` or cancelled artifact state |
| `blocked_by_approval` | `blocked` or operator action required |
| `policy_violation` | `error_receipt`, `blocked` |

All runtime errors must be redacted before persistence.

If the native runtime returns `blocked_by_approval`, Buildroom must surface the request to the operator or block the stage. It must not convert prior Buildroom approval into native tool approval unless that exact tool/action was included in the approved scope and routed through the correct approval surface.

## Builder Runtime Requirements

Builder is the highest-risk role.

Before Builder starts:

- approval artifact exists;
- approval is unrevoked and unexpired;
- approval is consumed by this attempt;
- build plan exists;
- scope is unchanged;
- allowed paths and blocked paths are present;
- pre-run path policy passes;
- external side effects are disabled unless approved.

After Builder finishes:

- changed files are collected;
- post-run path policy runs;
- runtime status is recorded;
- `coder_receipt` or `error_receipt` is created;
- path violations block trust progression.

## QA Runtime Requirements

QA must be independent from Builder at the artifact and run level.

Before QA starts:

- `coder_receipt` exists;
- QA role/run differs from Builder role/run;
- changed files and Builder claims are available;
- approved scope is available.

QA must produce:

- confirmed claims;
- rejected claims;
- missing evidence;
- commands run;
- files inspected;
- risks.

QA must not silently fix code in the same role.

## Trust Runtime Requirements

Trust consumes Verification Delta and QA.

Trust must not:

- inspect Builder claims alone;
- mark clean with missing high/critical evidence;
- mark clean with path policy violations;
- alter build artifacts;
- hide uncertainty.

Trust may be deterministic for v0.1 if the delta logic is sufficient.

## Compatibility Tests

Implementation must prove:

- Buildroom calls the native runtime adapter, not an alternate executor;
- native `blocked_by_approval` is preserved;
- native approval blocks are not auto-granted by Buildroom;
- native cancellation propagates into Buildroom state;
- native failure cannot produce `trust.clean`;
- runtime success plus path violation still blocks trust;
- tool events are stored as receipts/evidence but not treated as success by themselves;
- allowed paths and blocked paths are passed to runtime input;
- post-run changed files are re-checked by Buildroom policy;
- role sessions do not merge with ordinary agent chat sessions;
- raw ordinary-agent transcripts are not passed by default;
- runtime errors are redacted before artifacts are saved.
- duplicate Builder starts with the same idempotency key do not create multiple runs.

## v0.1 Acceptance Criteria

Runtime integration is good enough for v0.1 when:

- every role run has a trace ID and runtime run ID or deterministic fixture marker;
- Builder execution goes through native runtime or explicitly marked non-executing fixture;
- Builder fixtures that mutate the repo are forbidden;
- Buildroom never runs its own tool loop for LLM execution;
- Buildroom never bypasses native permissions;
- Builder start is protected by a per-room/per-approval/per-plan lock;
- runtime failure creates `error_receipt`;
- runtime success still requires post-policy checks;
- cancellation and approval-block states are preserved;
- ordinary agent sessions are not silently mixed into role runs;
- operator reports can link runtime refs without exposing secrets.
