# Runtime migration execution plan

Date: 2026-05-16

## Decision summary

AnthroClaw should own the agentic harness/control plane. External runtimes should provide the model/tool loop substrate, but AnthroClaw remains authoritative for sessions, routing, policy, approvals, tools, MCP proxying, observability, checkpoints, learning, and operator UX.

The migration track is **Pi-first**:

- Pi is the best near-term replacement because it is small enough to embed and modify like a set of composable parts.
- OpenCode remains a parity benchmark, not the primary migration, unless Pi hits a hard runtime limitation.
- OpenAI Agents SDK and Copilot SDK remain strategic/vendor-backed references, but they are not the immediate path for replacing Claude Agent SDK inside AnthroClaw.

The migration should not be a big-bang swap. The correct path is to keep Claude Agent SDK as the production baseline while moving every AnthroClaw dependency behind a runtime contract, proving Pi against that contract, canarying per agent, then flipping the default only after real smoke evidence and production canary evidence are both clean.

## Current state

The current stack already has the hard foundation:

- runtime boundary around Claude Agent SDK behavior;
- normalized runtime events;
- `HeadlessRuntime` contract;
- Pi adapter as an optional dependency;
- Pi model/auth storage plumbing;
- Pi event normalization;
- Pi `RuntimeRunHandle`;
- Gateway opt-in Pi path;
- AnthroClaw permission broker wired into Pi tool policy;
- AnthroClaw local tools exposed through Pi custom tools;
- external MCP proxying through AnthroClaw-owned wrappers;
- active-run, interrupt, session alias, checkpoint-control registry parity;
- AnthroClaw-owned workspace snapshot rewind for Pi Gateway runs;
- local real Pi smoke probes;
- aggregate `smoke:pi-all`;
- manual GitHub Actions Pi smoke workflow with artifacts;
- per-agent runtime override for canary rollout;
- cleanup for Pi runtime prewarm and learning queue shutdown paths.

Current PR stack:

- PR #67: Pi default model registry and legacy model id normalization.
- PR #68: optional Pi auth/model storage path config.
- PR #69: manual GitHub Actions Pi smoke gate.
- PR #70: Pi smoke summary and artifact capture.
- PR #71: per-agent Gateway runtime override.
- PR #72: Pi runtime shutdown cleanup.

The current contract matrix says Pi passes the required v0 scenarios. That does **not** mean migration is done. It means Pi is ready for real canary and hardening work.

## Non-negotiable migration rules

- Do not replace Claude behavior and introduce a new candidate in the same PR.
- Do not let Pi/OpenCode-specific event shapes leak into Gateway.
- Do not let candidate runtimes own AnthroClaw policy decisions.
- Do not store provider credentials in repo, config examples, PR bodies, logs, or test artifacts.
- Do not switch the global default before per-agent canaries pass.
- Do not remove Claude Agent SDK until rollback has been exercised and documented.
- Every runtime path must have unit coverage, contract coverage, and at least one real smoke path when credentials are available.

## Definition of complete migration

Migration is complete only when all of this is true:

1. A clean install can run AnthroClaw without requiring Claude Agent SDK for normal Gateway traffic.
2. Pi is the default runtime for user-facing Gateway agent turns.
3. Claude Agent SDK remains either absent or an optional fallback adapter with no hard imports in Gateway/headless/warm paths.
4. Runtime contract tests pass for the default runtime.
5. Real Pi aggregate smoke passes locally and in the manual CI gate.
6. At least one real agent has completed a canary window on Pi without policy/session/tool regressions.
7. Documentation, README, config examples, and operator guides no longer describe Claude Agent SDK as the required production kernel.
8. Rollback from Pi to Claude or to a safe disabled state is documented and tested.

## Phase 0: Stack hygiene and merge runway

Goal: make the current PR stack reviewable and mergeable without burying runtime risk in unrelated changes.

Tasks:

- Keep PRs #67-#72 stacked and small.
- Make every PR body state its base branch, validation, and runtime risk.
- Re-run `pnpm test`, `pnpm build`, `pnpm smoke:pi-all` before merging the stack.
- Preserve the real Pi smoke artifact from local/manual CI runs as the decision record.
- Keep branch names and docs using the AnthroClaw project name consistently.

Exit criteria:

- #67-#72 are green and reviewable.
- Current branch has no leaked API key fragments.
- Manual Pi smoke workflow is runnable with repository secrets.

## Phase 1: Freeze runtime contract v1

Goal: turn the current v0 contract into the actual migration contract that blocks production rollout.

Tasks:

- Review `src/runtime/contract.ts`, `research/runtime-contract-v0.md`, and `research/runtime-contract-v1.md`.
- Promote required scenarios from v0 into the v1 feature-contract atlas.
- Add any missing production scenarios:
  - channel dispatch text streaming;
  - tool progress events;
  - approval request/resolution lifecycle;
  - protected path denial;
  - public-agent `send_message` peer binding;
  - external MCP credential/header resolution;
  - session alias persistence across process restart;
  - checkpoint dry-run and restore;
  - learning review after Gateway shutdown;
  - usage/cost event normalization.
- Separate "required for default runtime" from "nice to have".
- Make the contract matrix explicit about evidence source: unit, shared acceptance test, real smoke, or production canary.

Exit criteria:

- Pi has no `fail` in required v1 scenarios.
- Any `partial` scenario has a named owner and a PR planned.
- OpenCode remains documented as benchmark-only unless it passes the same v1 scenarios.

## Phase 2: Real smoke gate hardening

Goal: make real Pi execution reproducible and safe for every future migration PR.

Tasks:

- Run `pnpm smoke:pi-auth -- --model anthropic/claude-sonnet-4-6 --json`.
- Run `pnpm smoke:pi-all -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000`.
- Run the manual GitHub Actions **Pi smoke** workflow using `PI_AUTH_JSON_B64`.
- Verify artifacts redact secrets and preserve enough logs to debug runtime failures.
- Make smoke output classify failures:
  - auth/model setup failure;
  - package load failure;
  - provider runtime failure;
  - AnthroClaw policy denial failure;
  - workspace verification failure;
  - cleanup/shutdown failure.
- Keep `--auth-path` and `--models-path` support so CI/staging does not read personal local Pi files.

Exit criteria:

- Local aggregate Pi smoke passes.
- Manual CI Pi smoke passes and uploads artifact.
- Smoke failure messages point to the failing layer, not only to secondary file verification.

## Phase 3: Canary configuration and operator controls

Goal: make Pi rollout an operational switch, not a code edit.

Tasks:

- Keep global default on `claude-agent-sdk`.
- Enable Pi per agent through `agent.yml`:

```yaml
runtime:
  headless:
    provider: pi
```

- Support explicit per-agent opt-out when global config later moves to Pi:

```yaml
runtime:
  headless:
    provider: claude-agent-sdk
```

- Add UI/API visibility for effective runtime:
  - configured provider;
  - resolved provider after global/per-agent merge;
  - Pi auth path/model path redacted;
  - last runtime smoke/canary result if available.
- Add operator docs for enabling Pi on one agent and rolling it back.
- Add a startup warning when Pi is configured but auth/model preflight fails.

Exit criteria:

- A non-developer can see which runtime an agent uses.
- A non-developer can flip one agent to Pi and back through documented config/UI.
- Bad Pi auth does not silently fall back to Claude for an explicitly Pi-enabled agent unless fallback is explicitly configured.

## Phase 4: Production parity audit

Goal: prove Pi is not only answering prompts, but preserving AnthroClaw's product behavior.

Audit areas:

- Routing:
  - Telegram/Web/private/group dispatch;
  - session key to runtime session id mapping;
  - channel delivery and error handling.
- Tools:
  - built-in read/write/edit/bash policy;
  - local AnthroClaw tools;
  - `send_message`;
  - `send_media`;
  - `manage_cron`;
  - `connect_mcp`;
  - Buildroom tools if enabled.
- Permissions:
  - allow;
  - ask;
  - deny;
  - approval timeout;
  - sender-authenticated approval;
  - protected path denial;
  - dangerous Bash denial;
  - public-agent restrictions.
- Sessions:
  - continuation;
  - resume after process restart;
  - title generation;
  - session mirror;
  - Web UI history.
- Runtime control:
  - active-run registry;
  - interrupt;
  - timeout abort;
  - checkpoint dry-run;
  - checkpoint restore.
- Observability:
  - text deltas;
  - tool lifecycle;
  - usage/cost;
  - run completion/failure;
  - hook/plugin emissions.
- Learning:
  - post-run memory extraction;
  - learning queue drain on shutdown;
  - no writes after store close.

Exit criteria:

- Every area has either automated coverage or a documented manual canary script.
- Any known Pi difference is documented as accepted behavior or blocking.
- No product-critical behavior depends on raw Claude SDK event shapes.

## Phase 5: First real canary

Goal: run one low-risk real AnthroClaw agent on Pi without changing the global default.

Candidate agent requirements:

- low traffic;
- private or trusted route;
- simple workspace;
- limited tool scope;
- no critical external side effects;
- easy rollback owner.

Canary procedure:

1. Run local and CI Pi smoke.
2. Enable Pi only for the canary agent.
3. Send scripted canary prompts:
   - text-only response;
   - read file;
   - edit file with approval;
   - denied tool call;
   - session continuation;
   - interrupt long run;
   - checkpoint dry-run and restore.
4. Observe logs and UI:
   - runtime provider;
   - session id mapping;
   - approvals;
   - tool progress;
   - usage/cost;
   - learning actions.
5. Keep canary active for a defined window.
6. Roll back to Claude Agent SDK and verify the same agent still works.

Exit criteria:

- Canary window completes with no P0/P1 regressions.
- Rollback works.
- All observed gaps are filed into the migration tracker.

## Phase 6: Harden Pi as default-capable runtime

Goal: close gaps discovered by smoke/canary and prepare Pi for broader rollout.

Expected work:

- Error taxonomy:
  - provider auth;
  - model resolution;
  - runtime session failure;
  - event stream failure;
  - tool execution failure;
  - policy denial;
  - workspace verification.
- Retry/fallback policy:
  - decide when retry is safe;
  - decide whether fallback to Claude is allowed per agent;
  - avoid fallback masking explicit Pi configuration failures.
- Runtime metrics:
  - per runtime/provider/model latency;
  - token/cost fields where available;
  - tool count;
  - approval wait time;
  - interrupt latency.
- Resource cleanup:
  - no dangling session subscriptions;
  - no unclosed stores;
  - no pending learning work after shutdown.
- Security:
  - env scrubbing;
  - workspace cwd enforcement;
  - path normalization;
  - MCP credential redaction;
  - artifact redaction.
- Docs:
  - Pi setup;
  - auth storage;
  - model registry;
  - per-agent runtime config;
  - smoke gate;
  - rollback.

Exit criteria:

- Pi has stable failure modes.
- Operator can distinguish AnthroClaw policy denial from provider failure.
- Runtime cleanup is quiet under repeated smoke runs.

## Phase 7: OpenCode benchmark decision

Goal: keep ourselves honest without derailing the Pi-first path.

Run this phase only if one of these is true:

- Pi canary exposes a hard SDK/runtime limitation.
- OpenCode's server boundary appears likely to replace several Pi hardening tasks.
- We need evidence for a final architecture decision before default flip.

Benchmark scope:

- Gateway path, not just headless prompt.
- Permission broker integration.
- Custom AnthroClaw tools.
- External MCP proxy.
- Active-run interrupt.
- Session continuation.
- Checkpoint/revert mapping.
- Smoke script comparable to `smoke:pi-gateway`.

Decision criteria:

- Choose OpenCode only if it reduces total migration complexity across policy, tools, sessions, and checkpointing.
- Keep Pi if OpenCode requires adopting/forking too much of its server/product surface.

Exit criteria:

- Written decision record: Pi remains primary, or OpenCode becomes primary with concrete blockers and migration cost.

## Phase 8: Broader staged rollout

Goal: move from one canary agent to production confidence.

Rollout rings:

- Ring 0: local smoke agents only.
- Ring 1: one private low-risk real agent.
- Ring 2: several private/trusted agents with different tool profiles.
- Ring 3: public or externally facing agents with strict approval/tool limits.
- Ring 4: Pi becomes global default for new agents.
- Ring 5: Pi becomes global default for existing agents.

For every ring:

- run aggregate smoke first;
- enable per-agent;
- collect runtime metrics;
- verify rollback;
- review policy/tool/session logs;
- document any runtime-specific differences.

Exit criteria:

- Ring 3 passes without critical regressions.
- Operators trust the runtime switch and rollback path.
- New agent creation can default to Pi.

## Phase 9: Flip global default

Goal: make Pi the normal path while preserving explicit rollback.

Tasks:

- Change global default runtime from Claude Agent SDK to Pi.
- Keep per-agent `claude-agent-sdk` override for rollback.
- Update config schema docs and examples.
- Update README positioning: AnthroClaw is runtime-contract-native / Pi-backed by default, not Claude Agent SDK-native.
- Update smoke/CI expectations so Pi smoke is the default real-runtime gate.
- Add release note with migration steps for existing installs.

Exit criteria:

- Existing agents either inherit Pi safely or have explicit Claude override.
- Fresh install docs configure Pi path first.
- No direct Gateway/headless/warm dependency assumes Claude Agent SDK.

## Phase 10: Claude SDK de-risk and decommission

Goal: remove Claude Agent SDK from the critical path.

Tasks:

- Search for direct imports of `@anthropic-ai/claude-agent-sdk`.
- Move remaining imports behind the Claude adapter or remove them.
- Decide final Claude role:
  - optional fallback adapter; or
  - dev/test-only adapter; or
  - fully removed.
- Remove warm-query behavior that only makes sense for Claude if no fallback remains.
- Remove Claude-specific docs from default setup.
- Keep migration notes for historical installs.
- Verify packaging still works without Claude SDK if it is no longer required.

Exit criteria:

- AnthroClaw can build and run normal Gateway traffic without Claude Agent SDK installed, if final decision is removal.
- If Claude remains, it is a clearly optional adapter with no hidden hard dependency.

## Phase 11: Final acceptance release

Goal: ship the migration as a coherent release, not a pile of runtime patches.

Release checklist:

- Contract matrix green for default runtime.
- Full unit suite green.
- Build green.
- Local real Pi smoke green.
- Manual CI Pi smoke green with artifact.
- Canary evidence attached or summarized.
- Rollback exercised.
- README updated.
- Config examples updated.
- Operator docs updated.
- Security notes updated.
- Changelog/release notes written.

Exit criteria:

- A new operator can install AnthroClaw, configure Pi, run smoke, enable an agent, understand failures, and roll back without reading the migration PR history.

## Immediate next 5 steps

1. Finish review/merge readiness for PRs #67-#72.
2. Keep `runtime-contract-v1` current as the feature-contract atlas and attach evidence labels as smoke/canary proof lands.
3. Run manual GitHub Actions Pi smoke with real repository secrets and attach artifact link to the migration docs.
4. Add operator-visible runtime status for per-agent Pi canary.
5. Pick one low-risk real agent and execute the Phase 5 canary script.
