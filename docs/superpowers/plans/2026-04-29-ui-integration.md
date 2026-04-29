# Plan 3 — UI integration for Plugin Framework + LCM

**Date:** 2026-04-29
**Branch:** `feat/ui-integration`
**Worktree:** `.worktrees/ui-integration`
**Predecessor:** Plan 2 (LCM core port) — merged to main as `6a3034c`

## Goal

Surface plugin admin and LCM-specific tooling in the existing Next.js dashboard so operators can:

1. Enable/disable plugins per agent without editing YAML.
2. Inspect a session's compressed DAG and drill back to byte-exact source messages.
3. Run health checks and see context-pressure at a glance.

## Constraints

- **Native SDK only** — the UI imports backend via `@backend/*` alias; no `@anthropic-ai/sdk`.
- **No new auth surfaces** — reuse existing `withAuth` wrapper from `lib/route-handler.ts`.
- **OC dark-only theme** — use `--oc-*` tokens for custom UI, shadcn primitives elsewhere.
- **Hot reload preserved** — plugin enable/disable writes to runtime overlay (`overlay.ts`); gateway picks up via existing watcher.
- **Read-only LCM access** — Phase B reads the agent's SQLite directly via `SummaryDAG`/`MessageStore` constructors. No new write paths.

## Phase A — Plugin admin (4 tasks)

| # | Task | Files |
|---|------|-------|
| A1 | Plugin list/toggle API | `ui/app/api/plugins/route.ts`, `ui/app/api/agents/[agentId]/plugins/route.ts`, `ui/app/api/agents/[agentId]/plugins/[name]/route.ts`, tests |
| A2 | Config schema + CRUD API | `ui/app/api/plugins/[name]/config-schema/route.ts`, `ui/app/api/agents/[agentId]/plugins/[name]/config/route.ts`, tests |
| A3 | Plugins tab UI | `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/plugins/PluginsPanel.tsx` (or merged into existing detail page), Zod-driven form helper |
| A4 | @e2e plugin admin flow | `ui/__tests__/plugin-admin-e2e.test.ts` |

**Backend hooks already present:**
- `gateway.pluginRegistry.listPlugins()` — manifest catalog
- `gateway.pluginRegistry.isEnabledFor(agentId, name)` — per-agent state
- `getOverlayPath` / `readRuntimeOverlay` / `writeRuntimeOverlay` from `src/config/overlay.ts` — runtime-mutable config
- `getAgentConfig(agentId)` — current agent.yml (already merged with overlay)

## Phase B — LCM Sessions surface (5 tasks)

| # | Task | Files |
|---|------|-------|
| B1 | DAG list + drill-down API | `ui/app/api/agents/[agentId]/lcm/dag/route.ts`, `ui/app/api/agents/[agentId]/lcm/nodes/[nodeId]/route.ts`, tests |
| B2 | lcm_grep bridge API | `ui/app/api/agents/[agentId]/lcm/grep/route.ts`, tests |
| B3 | DAG visualizer panel | `ui/components/lcm/DagPanel.tsx`, integrated into `fleet/[serverId]/sessions/[agentId]/[sessionId]/page.tsx` |
| B4 | Byte-exact message viewer | `ui/components/lcm/MessageDrillModal.tsx`, reuses `MessageBubble` from `chat-message/` |
| B5 | @e2e LCM sessions surface | `ui/__tests__/lcm-sessions-e2e.test.ts` |

**Direct LCM access pattern** (Phase B APIs):

```ts
// ui/lib/lcm.ts (new helper)
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { SummaryDAG } from '@backend/../plugins/lcm/src/dag.js';
import { MessageStore } from '@backend/../plugins/lcm/src/store.js';

export function openLcmReadOnly(agentId: string) {
  const path = resolve(process.cwd(), '..', 'data', 'lcm-db', `${agentId}.sqlite`);
  const db = new Database(path, { readonly: true });
  return { db, store: new MessageStore(db), dag: new SummaryDAG(db) };
}
```

This avoids re-routing through the running gateway plugin instance — UI gets read-only access to the same persistent state.

## Phase C — Diagnostics + polish (2 tasks)

| # | Task | Files |
|---|------|-------|
| C1 | lcm_status + doctor bridge APIs | `ui/app/api/agents/[agentId]/lcm/status/route.ts`, `ui/app/api/agents/[agentId]/lcm/doctor/route.ts`, tests |
| C2 | Context-pressure chip + doctor panel | `ui/components/lcm/ContextPressureChip.tsx`, `ui/components/lcm/DoctorPanel.tsx` |

Doctor cleanup MUST keep the double-gate (UI confirm dialog + `{confirm: true}` body), matching the tool's existing safety semantics.

## Tempo

**Variant 1** — full review chain per task (implementer + spec reviewer + quality reviewer + fix iterations). Same as Plan 2.

## Test bar

- 100% test coverage on new APIs.
- Plugin admin and sessions surface each get an @e2e test (A4, B5).
- Zero regressions on existing UI test suite (run `pnpm -C ui test`).
- Zero regressions on gateway suite (1035 baseline).

## Out-of-scope (deferred)

- Plugin marketplace / install-from-URL — Phase D, not in this plan.
- Multi-server fleet aggregation of plugin state — keep per-server.
- Real-time WebSocket updates of context pressure — polling is fine for v1.
- Plugin sandboxing UI — security work, separate plan.

---

## Task IDs (TaskCreate)

| Task | ID | Phase |
|------|-----|-------|
| A1 | 52 | A |
| A2 | 53 | A |
| A3 | 54 | A |
| A4 | 55 | A |
| B1 | 56 | B |
| B2 | 57 | B |
| B3 | 58 | B |
| B4 | 59 | B |
| B5 | 60 | B |
| C1 | 61 | C |
| C2 | 62 | C |
