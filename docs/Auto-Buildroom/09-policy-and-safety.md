# Policy And Safety

Status: Draft

Purpose: document the non-negotiable safety model: no self-approval, no self-QA, path boundaries, operator approval, secret redaction, side-effect controls, and fail-closed behavior.

## Safety Thesis

Auto-Buildroom is useful only if autonomy stays bounded.

The core rule:

```text
Agents may suggest.
Buildroom requires approval before execution.
```

The policy system exists to prevent five failure modes:

1. self-approval;
2. scope creep;
3. false trust;
4. secret leakage;
5. uncontrolled side effects.

If policy is uncertain, the Buildroom must fail closed.

## Non-Negotiables

These are required for v0.1:

- no self-approval;
- no self-QA;
- no build without approval;
- no approval outside Buildroom operator surface;
- no trust.clean without QA evidence;
- no writes outside approved paths;
- no external side effects by default;
- no raw transcript watching by default;
- no secret persistence in artifacts;
- no silent failure;
- no runtime fork.

## Role Separation Policy

No role may approve or verify its own output.

Retention may recommend lifecycle treatment, but destructive cleanup requires explicit policy and must not erase audit evidence.

Minimum separation rules:

| Producer | Forbidden follow-up |
| --- | --- |
| Research | approval, build, QA, trust |
| Dreamer | approval of own idea |
| Main Review | build execution |
| Builder | QA, Verification Delta, Trust |
| QA | silent build fixes or scope expansion |
| Trust | mutation of build artifacts |
| Retention | deletion without explicit policy |
| Operator Summary | approval authority |

Required checks:

- compare `producer.role`;
- compare `producer.runId`;
- compare parent artifact producer identity;
- reject same-run approval;
- reject Builder-produced QA/Delta/Trust artifacts.

Allowed:

- same model/provider may be used for different roles if run IDs and role contracts differ;
- different profile/model is recommended for higher assurance;
- deterministic non-LLM comparison may produce `verification_delta`.

For v0.1, role separation is logical and artifact-enforced, not cryptographic independence.

This means separate role contracts, run IDs, artifacts, and policy checks. It does not guarantee independent model cognition if the same model/provider is used for multiple roles.

## Approval Policy

Approval is an authority boundary, not a conversational hint.

Allowed approval routes in v0.1:

```text
anthroclaw buildroom approve <id>
/buildroom approve <id>
```

Not allowed:

```text
ordinary agent chat approval
watched session approval
handoff approval
implicit approval from "yes"
reaction approval
forwarded-message approval
approval by non-operator
```

Approval requirements:

- target must be a `main_review` with `decision: approved_for_operator`;
- scope must be locked;
- allowed paths must be defined;
- blocked paths must be defined;
- operator identity must be recorded;
- approval route must be recorded;
- timestamp must be recorded;
- approval artifact must be persisted before build starts.

Rules:

```text
Approval grants authority.
Build consumes authority.
Approval does not execute the build by itself.
```

For v0.1, approval is consumed when the first build attempt starts. Retry must be explicit and must reference the consumed approval plus the previous `error_receipt`.

## Operator Identity Policy

Operator identity must be treated as data, not text.

Approval artifacts must record:

- `approvedBy`;
- `approvalRoute`;
- `approvedAt`;
- identity evidence;
- target review ID;
- source idea ID;
- approved scope.

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

Telegram chat ID and thread ID are route evidence, not operator identity. Approval identity should use the Telegram user ID when available.

The policy engine must reject:

- unknown operator IDs;
- forwarded Telegram messages;
- ambiguous chat replies;
- approvals outside the Buildroom operator surface;
- approvals that cannot be tied to a configured operator.

Future UI routes must follow the same identity contract.

## Path Boundary Policy

Builder may only modify approved paths.

Every build must have:

- allowed paths;
- blocked paths;
- pre-run policy check;
- post-run policy check;
- changed file list;
- path policy result in `coder_receipt`.

Default blocked paths:

```text
.env
**/.env
**/*secret*
**/*token*
**/credentials*
config.yml unless explicitly approved
config.yaml unless explicitly approved
**/config.yml unless explicitly approved
**/config.yaml unless explicitly approved
agents/** unless explicitly approved
production cron/config surfaces unless explicitly approved
```

Rules:

- path policy applies to repository filesystem paths, not code blocks inside documentation files;
- blocked paths override allowed paths;
- path traversal is rejected;
- symlink escape is rejected;
- generated files are checked like any other file;
- changed files outside allowed scope block trust progression;
- path violation requires `blocked` trust or unresolved `error_receipt`.

Example policy result:

```yaml
preRunPolicyResult:
  allowed: true
  checkedPaths:
    - docs/**
    - tests/**
  blockedPaths:
    - .env
    - config.yml
postRunPolicyResult:
  allowed: false
  changedFiles:
    - docs/Auto-Buildroom/04-operator-ux.md
    - src/gateway.ts
  violations:
    - path: src/gateway.ts
      reason: "outside approved scope"
```

## External Side-Effect Policy

External side effects are blocked by default in v0.1.

Read-only external access may be allowed as research if configured. Mutating external systems is blocked by default.

Blocked unless explicitly approved:

- deploy;
- release;
- publish;
- post to social media;
- send email;
- make purchases;
- modify production config;
- rotate credentials;
- delete remote resources;
- mutate issue trackers or PRs;
- write to external APIs.

Allowed in v0.1 without special approval:

- local filesystem reads inside configured repo;
- artifact writes under `.anthroclaw/auto-buildroom`;
- docs/test changes inside approved paths;
- local verification commands approved by build plan.

If external side effects are later enabled, they must require:

- explicit operator approval;
- target system;
- action type;
- rollback plan;
- receipt;
- post-action verification.

## Runtime Boundary Policy

Auto-Buildroom is not a runtime fork.

The Buildroom orchestrator may:

- assemble role prompts;
- choose next stage;
- pass approved context;
- store artifacts;
- enforce pre-run and post-run policies;
- render reports.

The native Agent SDK runtime owns:

- model calls;
- tool execution;
- permissions;
- approvals;
- sessions;
- cancellation;
- logs;
- error semantics.

Forbidden:

- bypassing native runtime permissions;
- spoofing tool messages;
- mutating runtime session state outside official APIs;
- treating a Markdown receipt as success when runtime reports failure;
- running Coder shell/code execution outside configured sandbox;
- rewriting runtime config from inside a Buildroom run.

## Secret And PII Redaction Policy

Artifacts must be redacted before persistence.

The scanner must detect at minimum:

```text
API keys
Anthropic API keys
OpenAI API keys
Bearer tokens
GitHub tokens
Slack tokens
Telegram bot tokens
OAuth refresh tokens
X/Twitter cookies or auth tokens
cookies
SSH private keys
database connection strings
raw .env values
session secrets
```

Examples:

```text
sk-...
sk-ant-...
ghp_...
xoxb-...
AIza...
123456789:ABC...
Bearer ...
-----BEGIN PRIVATE KEY-----
postgres://user:pass@host/db
cookie: auth_token=...
```

Rules:

- secrets are replaced with `[REDACTED]`;
- redacted fields are recorded;
- raw env values are never persisted;
- raw transcripts are not watched by default;
- high-confidence secret in required field fails closed;
- redaction failure creates blocked state and no unsafe artifact persistence.

## Fixture And Demo Policy

Deterministic fixtures used in tests or demos must still produce artifacts and pass the same parent/approval checks unless explicitly marked as non-executing demo data.

Rules:

- fixture-generated research, idea, review, approval, QA, delta, and trust artifacts must validate against schemas;
- fixture workflows must not bypass approval requirements if they simulate execution;
- non-executing demo artifacts must be marked as demo data;
- demo data must not be used to authorize real build execution.

## Trust Policy

Trust is derived from QA and Verification Delta, not from Builder claims.

Trust states:

```text
clean
watch
investigate
blocked
```

Rules:

- missing QA prevents `trust.clean`;
- missing high/critical evidence prevents `trust.clean`;
- rejected high/critical claims prevent `trust.clean`;
- rejected critical safety/scope claims require `trust.blocked`;
- unresolved `error_receipt` prevents `trust.clean`;
- path policy violation prevents `trust.clean`;
- trust report must explain operator action needed when not `clean`.

Builder claims are inputs, not evidence.

## Error And Fail-Closed Policy

Failures must leave receipts when possible.

Examples requiring `error_receipt`:

- runtime timeout;
- permission denied;
- native runtime blocked;
- Builder fails before receipt;
- QA fails before report;
- hash mismatch;
- policy violation;
- path violation;
- redaction failure.

Policy checks may be embedded in stage artifacts for v0.1. If a policy check blocks a transition before the next expected artifact can be created, create an `error_receipt` with:

```yaml
errorType: policy_violation
```

If artifact storage itself is unavailable, the operator output must say:

```text
No durable receipt was created.
```

Fail-closed conditions:

- missing parent artifact;
- invalid artifact schema;
- content hash mismatch;
- unknown producer role;
- unknown operator identity;
- missing approval;
- expired or revoked approval;
- changed paths outside approved scope;
- high-confidence secret in artifact;
- runtime failure with no success result.

## Block Scope Policy

Blocked state must record `blockScope`.

Allowed values:

```text
job
room
```

`job` means the current chain cannot proceed, but other research may continue.

`room` means no new autonomous stages may run until resolved.

Examples:

| Condition | blockScope |
| --- | --- |
| QA rejected a Builder claim | `job` |
| Builder modified blocked path | `job` or `room` depending severity |
| artifact hash corruption | `room` |
| redaction failure with possible secret exposure | `room` |
| missing approval for one build | `job` |

## Pause And Kill Switch Policy

Pause is a soft stop.

When paused:

- no new builds start;
- no new scheduled autonomous stages start;
- status/show/report remain available;
- existing artifacts remain untouched;
- active native runtime is not cancelled unless operator explicitly cancels it.

Resume:

- does not auto-run pending builds;
- returns to a safe decision state;
- must show the next required operator action.

Kill switch state:

```yaml
killSwitchActive: true
```

When active, the kill switch should:

- stop scheduled stages;
- block new builds;
- keep reports readable;
- preserve artifacts;
- not delete state.

## Retention Safety Policy

Retention may recommend:

```text
keep
improve
park
prune_recommended
ghost
reopen
```

Retention must not:

- delete receipts by default;
- erase audit trail;
- remove evidence needed for trust reports;
- prune artifacts without explicit retention policy.

Archive is preferred over delete.

## Security Test Requirements

v0.1 must include tests for:

- Dreamer cannot approve its own idea;
- Builder cannot QA own build;
- approval requires `main_review`;
- approval outside Buildroom operator surface is rejected;
- build without approval is blocked;
- revoked/expired approval cannot start build;
- path violation blocks trust;
- missing QA prevents `trust.clean`;
- rejected high/critical claims prevent `trust.clean`;
- unresolved error receipt prevents `trust.clean`;
- secrets are redacted before persistence;
- raw session transcript is not watched by default;
- artifact hash tampering is detected;
- pause prevents new build execution;
- resume does not auto-run pending build.

## v0.1 Acceptance Criteria

The policy model is good enough for v0.1 when:

- every build path requires explicit operator approval;
- approval identity is verified and persisted;
- every role transition checks separation of duties;
- every build has pre-run and post-run path policy results;
- external side effects are blocked by default;
- secret redaction fails closed;
- trust state cannot be clean without QA evidence;
- errors produce durable `error_receipt` when possible;
- policy decisions are visible in operator reports;
- ordinary agents can provide signals but cannot approve or build by default.
