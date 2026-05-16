# Runtime v1 integration strategy

Date: 2026-05-16

## Current State

PR #95 is the cumulative Runtime v1 / Pi integration candidate rebased onto current `main`.

Local evidence on PR #95:

- `pnpm build` passed.
- `pnpm test` passed: 285 files, 2478 tests.
- Full `pnpm smoke:pi-v1-canary -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` passed all ten scenarios with existing local Pi auth storage.
- Local `pnpm runtime:pi-decision` generated `BLOCKED` only for the expected operational gates: `production-canary-window` and `pr-stack-merged`.

The older draft stack remains open and useful as review history, but the bottom PR in that chain conflicted with current `main` before the PR #95 rebase work.

## Options

### Option A: Merge PR #95 as the integration PR

Use PR #95 as the merge vehicle for the Runtime v1 / Pi stack.

Pros:

- Already rebased onto current `main`.
- Already validated as one coherent cumulative state.
- Avoids force-pushing and revalidating roughly fifty draft PR branches.
- Keeps the migration from stalling on stack maintenance.

Costs:

- Large diff, harder to review commit-by-commit in GitHub UI.
- Original stacked PRs should be treated as historical context rather than merge units.

Recommended if the goal is to land the Runtime v1 contract and Pi canary infrastructure quickly while keeping default rollout gated.

### Option B: Restack the existing draft PR chain

Replay each existing draft PR branch onto current `main` in order.

Pros:

- Preserves granular PR review units.
- Easier to reason about each implementation slice independently.

Costs:

- High mechanical overhead: every downstream branch must be rewritten after the bottom conflict is resolved.
- Requires revalidating the chain repeatedly as each branch moves.
- Risk of spending migration time on branch choreography rather than runtime evidence.

Recommended only if repository policy requires small independently merged PRs for this work.

## Recommendation

Prefer Option A: merge PR #95 as a single integration PR after review.

Reasoning:

- PR #95 is not a default-runtime flip. It lands the contract, adapter, smoke/canary harness, decision workflow, docs, and rollback evidence path.
- Default Pi rollout is still blocked by the same explicit gates: durable Runtime v1 decision workflow artifact, first production canary window, and post-merge canary evidence.
- The local rebase already resolved the only observed production-fix conflicts:
  - `manage_cron` agents continue to use warm queries.
  - Pi Gateway runtime agents avoid Claude warm prewarm.
  - Gateway cold Claude runs route through the Runtime v1 Claude adapter.
  - Runtime-normalized web UI events and v1.1.7 high-confidence memory auto-approval coverage both remain in tests.

## Merge Readiness Checklist

- [x] PR #95 is mergeable against `main`.
- [x] Local `pnpm build` passed on PR #95.
- [x] Local `pnpm test` passed on PR #95.
- [x] Local full Runtime v1 canary passed on PR #95.
- [x] Local decision package generated and blocked only on operational gates.
- [x] PR #95 is marked ready for review or merge.
- [ ] Reviewer accepts the large integration PR shape.
- [ ] Durable **Pi Runtime v1 decision** workflow artifact is captured from the chosen target branch.
- [ ] First production canary window is completed for one low-risk real agent.
- [ ] Default runtime decision is recorded after the durable artifact and production canary pass.

## Immediate Next Steps

1. Review PR #95 as the integration vehicle.
2. If accepted, merge PR #95 into `main`.
3. Run **Pi Runtime v1 decision** from the merged target branch with `production_canary=pending`, `pr_stack=merged`, and `fail_on_blocked=false`.
4. Attach the durable workflow artifact to the migration status.
5. Execute `docs/pi-production-canary-runbook.md` for one low-risk real agent.
6. Rerun **Pi Runtime v1 decision** with `production_canary=passed`.
7. Only then decide whether to flip any default runtime setting.
