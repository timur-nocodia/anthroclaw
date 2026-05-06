# Upstream Adoption Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver four upstream-inspired upgrades for AnthroClaw - plugin lifecycle, runtime hot-path trimming, learning loop v2, and a safe file-transfer plugin - without breaking the Claude Agent SDK-native runtime model.

**Architecture:** Build on existing AnthroClaw seams instead of importing foreign abstractions. Introduce a plugin catalog/install-state layer on top of the current plugin loader, lazy-load only enabled plugins into runtime, upgrade the existing learning subsystem with Hermes-inspired review mechanics, and ship file transfer as a first-party plugin with strict path policy.

**Tech Stack:** TypeScript, Node 22+, Zod, better-sqlite3, vitest, Next.js App Router, `@anthropic-ai/claude-agent-sdk`, existing AnthroClaw plugin framework.

**Spec:** `docs/superpowers/specs/2026-05-04-upstream-adoption-program-design.md`

---

## Working rules

- Keep all user-facing LLM execution on the current SDK path.
- Do not add provider-routing abstractions.
- Do not add channel-expansion work.
- Ship each milestone as its own PR series.
- Reuse existing UI/API surfaces where they already exist.

## Upstream preread

Read these before touching code:

1. OpenClaw `v2026.5.3`
   - `Plugins/file-transfer`
   - `Plugins/install`
   - `Gateway/performance`
2. OpenClaw `v2026.5.2`
   - external plugin lifecycle and dependency-state sections
   - startup/runtime trimming sections
3. Hermes `v0.12.0`
   - `Autonomous Curator & Self-Improvement Loop`
   - `Self-improvement loop (background review fork)`
   - cold-start performance notes

## File map by epic

### Epic A - Plugin lifecycle

**Core files**

- `src/plugins/loader.ts`
- `src/plugins/registry.ts`
- `src/plugins/types.ts`
- `src/gateway.ts`
- `src/cli/doctor.ts`
- `package.json`
- `ui/app/api/plugins/route.ts`
- `ui/app/api/agents/[agentId]/plugins/[name]/route.ts`
- `ui/app/api/agents/[agentId]/plugins/[name]/config/route.ts`
- `ui/components/plugins/PluginsPanel.tsx`
- `ui/lib/plugin-schema.ts`

**New files expected**

- `src/plugins/catalog.ts`
- `src/plugins/install-store.ts`
- `src/plugins/discovery.ts`
- `src/plugins/installers/npm.ts`
- `src/plugins/installers/local.ts`
- `src/plugins/doctor.ts`
- `src/cli/plugins.ts`
- `src/plugins/__tests__/catalog.test.ts`
- `src/plugins/__tests__/install-store.test.ts`
- `src/plugins/__tests__/discovery.test.ts`
- `src/cli/__tests__/plugins.test.ts`
- `ui/__tests__/api/plugins-admin.test.ts`

### Epic B - Runtime trimming

**Core files**

- `src/gateway.ts`
- `src/plugins/loader.ts`
- `ui/app/api/plugins/route.ts`
- `ui/lib/plugin-schema.ts`

**New files expected if needed**

- `src/plugins/runtime-cache.ts`
- `src/plugins/startup-plan.ts`
- `src/plugins/__tests__/startup-plan.test.ts`

### Epic C - Learning loop v2

**Core files**

- `src/learning/runner.ts`
- `src/learning/reviewer.ts`
- `src/learning/store.ts`
- `src/sdk/headless-review.ts`
- `src/gateway.ts`
- `src/cli/learning.ts`
- `ui/app/api/agents/[agentId]/learning/route.ts`

**New files expected**

- `src/learning/rubric.ts`
- `src/learning/skill-artifacts.ts`
- `src/learning/__tests__/rubric.test.ts`
- `src/learning/__tests__/skill-artifacts.test.ts`

### Epic D - File-transfer plugin

**Core files**

- `plugins/__example/`
- `src/sdk/permissions.ts`
- `src/security/approval-broker.ts`
- `ui/components/plugins/PluginsPanel.tsx`

**New files expected**

- `plugins/file-transfer/.claude-plugin/plugin.json`
- `plugins/file-transfer/package.json`
- `plugins/file-transfer/src/index.ts`
- `plugins/file-transfer/src/config.ts`
- `plugins/file-transfer/src/policy.ts`
- `plugins/file-transfer/src/tools/file-fetch.ts`
- `plugins/file-transfer/src/tools/dir-list.ts`
- `plugins/file-transfer/src/tools/dir-fetch.ts`
- `plugins/file-transfer/src/tools/file-write.ts`
- `plugins/file-transfer/tests/*.test.ts`

---

## Milestone 1 - Plugin lifecycle foundation

### Task 1: Add a catalog/install-state layer separate from runtime-loaded plugins

**Files:**
- Create: `src/plugins/catalog.ts`
- Create: `src/plugins/install-store.ts`
- Create: `src/plugins/discovery.ts`
- Modify: `src/plugins/loader.ts`
- Modify: `src/gateway.ts`
- Test: `src/plugins/__tests__/catalog.test.ts`
- Test: `src/plugins/__tests__/install-store.test.ts`
- Test: `src/plugins/__tests__/discovery.test.ts`

- [ ] Define a `PluginCatalogEntry` type that distinguishes `bundled` vs `managed` plugin sources and carries root path, manifest metadata, loadability, and dependency state.
- [ ] Implement a JSON-backed `PluginInstallStore` at `data/plugin-installs.json` with atomic write semantics.
- [ ] Split discovery into manifest discovery over two roots:
  - bundled root: repo `plugins/`
  - managed root: `data/plugins-installed/`
- [ ] Keep the current runtime `loadPlugin()` function, but move root scanning out of it so discovery can be reused by the UI without loading modules.
- [ ] Refactor gateway startup so manifest discovery happens before runtime load decisions.
- [ ] Ensure duplicate plugin names across roots fail closed with a clear error in logs and doctor output.
- [ ] Add tests for:
  - empty store bootstrap
  - bundled + managed discovery
  - duplicate-name rejection
  - corrupted install-store recovery behavior

Run:

```bash
npx vitest run src/plugins/__tests__/catalog.test.ts src/plugins/__tests__/install-store.test.ts src/plugins/__tests__/discovery.test.ts
```

Expected:

- catalog/discovery tests pass
- no runtime plugin loading required for pure catalog tests

- [ ] Commit

```bash
git add src/plugins src/gateway.ts
git commit -m "feat(plugins): add catalog and managed install state"
```

### Task 2: Implement plugin lifecycle CLI for list/install/update/remove/doctor

**Files:**
- Create: `src/cli/plugins.ts`
- Create: `src/plugins/installers/npm.ts`
- Create: `src/plugins/installers/local.ts`
- Create: `src/plugins/doctor.ts`
- Modify: `package.json`
- Modify: `src/cli/doctor.ts`
- Test: `src/cli/__tests__/plugins.test.ts`
- Test: `src/plugins/__tests__/doctor.test.ts`

- [ ] Implement `pnpm plugins list` backed by the catalog rather than `pluginRegistry.listPlugins()`.
- [ ] Implement `pnpm plugins install <spec>` for:
  - local path install
  - npm package install
- [ ] Install managed plugins into `data/plugins-installed/<pluginName>/`.
- [ ] Validate installed packages:
  - `.claude-plugin/plugin.json` exists
  - manifest parses
  - compiled `entry` exists
  - dependencies are present
- [ ] Implement `pnpm plugins update <name>` using stored source metadata from `PluginInstallStore`.
- [ ] Implement `pnpm plugins remove <name>` for managed plugins only.
- [ ] Extend `doctor` so plugin checks report:
  - missing install root
  - missing manifest
  - missing entry
  - dependency install failure
  - duplicate plugin names
- [ ] Add CLI tests covering successful install, validation failure, reinstall/update, and remove.

Run:

```bash
npx vitest run src/cli/__tests__/plugins.test.ts src/plugins/__tests__/doctor.test.ts
```

Expected:

- lifecycle commands work against temp directories
- `doctor` reports plugin install problems clearly

- [ ] Commit

```bash
git add src/cli src/plugins package.json
git commit -m "feat(plugins): add install update remove and doctor commands"
```

### Task 3: Expand plugin admin API and UI to expose catalog state

**Files:**
- Modify: `ui/app/api/plugins/route.ts`
- Modify: `ui/app/api/agents/[agentId]/plugins/[name]/route.ts`
- Modify: `ui/app/api/agents/[agentId]/plugins/[name]/config/route.ts`
- Modify: `ui/components/plugins/PluginsPanel.tsx`
- Modify: `ui/lib/plugin-schema.ts`
- Test: `ui/__tests__/api/plugins.test.ts`
- Test: `ui/__tests__/components/plugins-panel.test.tsx`
- Test: `ui/__tests__/api/plugins-admin.test.ts`

- [ ] Change `/api/plugins` to return catalog-backed items, not only runtime-loaded entries.
- [ ] Add response fields for:
  - `sourceType`
  - `sourceSpec`
  - `installRoot`
  - `managed`
  - `loaded`
  - `dependencyState`
  - `status`
- [ ] Update `PluginsPanel` to show installed-but-disabled plugins and managed metadata.
- [ ] Add action buttons for list/refresh/doctor states first; install/update/remove buttons may land in a second pass if the panel becomes too large.
- [ ] Update `ui/lib/plugin-schema.ts` to resolve plugin directories from catalog-aware roots instead of assuming only `../plugins`.
- [ ] Preserve current per-agent enable and config editing flows.

Run:

```bash
pnpm --dir ui test
```

Expected:

- plugin panel tests pass
- API tests pass with new metadata fields

- [ ] Commit

```bash
git add ui
git commit -m "feat(ui): expose plugin catalog lifecycle state"
```

---

## Milestone 2 - Runtime startup and hot-path trimming

### Task 4: Load only enabled plugins into runtime

**Files:**
- Modify: `src/gateway.ts`
- Modify: `src/plugins/loader.ts`
- Create: `src/plugins/startup-plan.ts`
- Test: `src/plugins/__tests__/startup-plan.test.ts`
- Test: `src/plugins/__tests__/loader.test.ts`

- [ ] Build a startup plan from:
  - agent plugin config in `agent.yml`
  - known bundled plugins
  - known managed installs
- [ ] Refactor gateway startup so it loads only plugins enabled by at least one agent.
- [ ] Keep manifest/catalog data available even when the plugin module is not loaded.
- [ ] Preserve hot-add/hot-remove behavior for managed root and bundled root.
- [ ] Ensure enabling a plugin through the UI can load it on demand if it is catalog-present but not yet runtime-loaded.
- [ ] Add tests for:
  - disabled plugins remain unloaded
  - enabled plugins load correctly
  - UI toggle can bring a managed plugin live without full restart

Run:

```bash
npx vitest run src/plugins/__tests__/startup-plan.test.ts src/plugins/__tests__/loader.test.ts
```

Expected:

- loader tests continue to pass
- startup-plan tests prove disabled plugins do not incur module load work

- [ ] Commit

```bash
git add src/gateway.ts src/plugins
git commit -m "perf(plugins): lazy-load only enabled plugins"
```

### Task 5: Trim repeat work in plugin admin and startup paths

**Files:**
- Modify: `src/gateway.ts`
- Modify: `ui/app/api/plugins/route.ts`
- Modify: `ui/lib/plugin-schema.ts`
- Optional create: `src/plugins/runtime-cache.ts`
- Test: `src/plugins/__tests__/notify-agent-config-changed.test.ts`
- Test: `ui/__tests__/api/plugin-config.test.ts`

- [ ] Avoid repeated manifest/schema path resolution when serving plugin config-schema requests.
- [ ] Cache pure catalog responses briefly if profiling shows repeated expensive scans.
- [ ] Keep `notifyAgentConfigChanged()` and `refreshAgentPluginTools()` semantics unchanged.
- [ ] Delay any non-essential startup work until after route table and channels are ready if that change is low-risk.
- [ ] Document any measurement method used to justify these trims.

Run:

```bash
npx vitest run src/plugins/__tests__/notify-agent-config-changed.test.ts
pnpm --dir ui test -- --runInBand
```

Expected:

- plugin config invalidation behavior still works
- no regression in plugin admin APIs

- [ ] Commit

```bash
git add src/gateway.ts src/plugins ui
git commit -m "perf(runtime): trim plugin admin and startup hot paths"
```

---

## Milestone 3 - Learning loop v2

### Task 6: Introduce rubric-based review protocol

**Files:**
- Create: `src/learning/rubric.ts`
- Modify: `src/learning/runner.ts`
- Modify: `src/learning/reviewer.ts`
- Test: `src/learning/__tests__/reviewer.test.ts`
- Test: `src/learning/__tests__/rubric.test.ts`

- [ ] Define an explicit rubric model for learning review:
  - evidence strength
  - durability
  - reusability
  - safety
  - recommended action class
- [ ] Move prompt-building logic in `runner.ts` into a dedicated rubric-oriented helper.
- [ ] Preserve strict JSON output parsing and existing safety validations.
- [ ] Add tests for:
  - rubric prompt content
  - parser compatibility
  - malformed or overscoped output rejection

Run:

```bash
npx vitest run src/learning/__tests__/reviewer.test.ts src/learning/__tests__/rubric.test.ts
```

Expected:

- existing reviewer safety still passes
- rubric tests validate prompt structure and action normalization

- [ ] Commit

```bash
git add src/learning
git commit -m "feat(learning): add rubric-based review protocol"
```

### Task 7: Capture active skill context and expand artifacts with `references/` and `templates/`

**Files:**
- Create: `src/learning/skill-artifacts.ts`
- Modify: `src/gateway.ts`
- Modify: `src/learning/runner.ts`
- Modify: `src/learning/store.ts` only if new metadata fields require indexing helpers
- Test: `src/learning/__tests__/runner.test.ts`
- Test: `src/learning/__tests__/skill-artifacts.test.ts`
- Test: `src/learning/__tests__/gateway-wiring.test.ts`

- [ ] Capture which skills were active during a run and include them in learning job metadata.
- [ ] Expand exported learning artifacts so active skills can contribute:
  - `SKILL.md`
  - `references/*`
  - `templates/*`
- [ ] Limit expansion to active skill neighborhoods; do not export broad workspace trees.
- [ ] Update review prompt input to bias toward recently active skills first.
- [ ] Keep artifact size limits enforced.

Run:

```bash
npx vitest run src/learning/__tests__/runner.test.ts src/learning/__tests__/skill-artifacts.test.ts src/learning/__tests__/gateway-wiring.test.ts
```

Expected:

- learning artifacts include skill-side context for active skills
- no unbounded artifact export regression

- [ ] Commit

```bash
git add src/gateway.ts src/learning
git commit -m "feat(learning): bias review toward active skills and skill artifacts"
```

### Task 8: Tighten headless review runtime inheritance and tool scope

**Files:**
- Modify: `src/sdk/headless-review.ts`
- Modify: `src/learning/runner.ts`
- Modify: `ui/app/api/agents/[agentId]/learning/route.ts` if config needs to surface new knobs
- Test: `src/learning/__tests__/runner.test.ts`
- Test: `src/cli/__tests__/learning.test.ts`

- [ ] Make headless review inherit the parent agent's effective model/runtime defaults where safe.
- [ ] Keep tool scope denied or explicitly restricted; do not open shell/web/file-edit loops.
- [ ] Ensure shutdown and error behavior remain clean for review jobs.
- [ ] Preserve `private` auto-apply semantics and current approval model.

Run:

```bash
npx vitest run src/learning/__tests__/runner.test.ts src/cli/__tests__/learning.test.ts
```

Expected:

- learning CLI still works
- runner tests still show safe headless execution behavior

- [ ] Commit

```bash
git add src/sdk/headless-review.ts src/learning ui/app/api/agents/[agentId]/learning/route.ts
git commit -m "feat(learning): inherit runtime safely for headless review"
```

---

## Milestone 4 - File-transfer plugin

### Task 9: Scaffold file-transfer plugin with config schema and policy layer

**Files:**
- Create: `plugins/file-transfer/.claude-plugin/plugin.json`
- Create: `plugins/file-transfer/package.json`
- Create: `plugins/file-transfer/src/index.ts`
- Create: `plugins/file-transfer/src/config.ts`
- Create: `plugins/file-transfer/src/policy.ts`
- Test: `plugins/file-transfer/tests/config.test.ts`
- Test: `plugins/file-transfer/tests/policy.test.ts`

- [ ] Mirror the existing plugin layout from `plugins/lcm` or `plugins/__example`.
- [ ] Define per-agent config for:
  - named roots
  - read/write permissions
  - `max_bytes_per_call`
  - `follow_symlinks`
- [ ] Implement canonical path validation and root containment checks in `policy.ts`.
- [ ] Reject symlink traversal by default.
- [ ] Reject paths outside allowlisted roots before any filesystem read/write.

Run:

```bash
npx vitest run plugins/file-transfer/tests/config.test.ts plugins/file-transfer/tests/policy.test.ts
```

Expected:

- config parsing works
- policy checks fail closed on traversal/symlink cases

- [ ] Commit

```bash
git add plugins/file-transfer
git commit -m "feat(file-transfer): scaffold plugin config and path policy"
```

### Task 10: Implement `dir_list`, `file_fetch`, `dir_fetch`, and `file_write`

**Files:**
- Create: `plugins/file-transfer/src/tools/dir-list.ts`
- Create: `plugins/file-transfer/src/tools/file-fetch.ts`
- Create: `plugins/file-transfer/src/tools/dir-fetch.ts`
- Create: `plugins/file-transfer/src/tools/file-write.ts`
- Modify: `plugins/file-transfer/src/index.ts`
- Test: `plugins/file-transfer/tests/dir-list.test.ts`
- Test: `plugins/file-transfer/tests/file-fetch.test.ts`
- Test: `plugins/file-transfer/tests/dir-fetch.test.ts`
- Test: `plugins/file-transfer/tests/file-write.test.ts`

- [ ] Implement read/list/fetch/write tools using the policy layer, not ad hoc checks.
- [ ] Enforce `max_bytes_per_call` before returning payloads.
- [ ] For write operations, mark them as destructive from the AnthroClaw safety perspective and integrate with existing approval semantics through the runtime's normal tool-permission path.
- [ ] Keep the tool output operator-readable and auditable.
- [ ] Do not add remote transport, host pairing, or network fetch semantics.

Run:

```bash
npx vitest run plugins/file-transfer/tests
```

Expected:

- all tool tests pass
- traversal and oversize cases fail closed

- [ ] Commit

```bash
git add plugins/file-transfer
git commit -m "feat(file-transfer): add safe file transfer tools"
```

### Task 11: Wire file-transfer plugin into UI/plugin admin and live runtime

**Files:**
- Modify: `ui/components/plugins/PluginsPanel.tsx`
- Modify: `ui/__tests__/components/plugins-panel.test.tsx`
- Modify: `ui/app/api/plugins/route.ts` if new metadata must surface
- Optional docs: `README.md`

- [ ] Ensure file-transfer plugin config is editable through existing plugin config UI.
- [ ] Confirm live enable/disable and config invalidation behave like other plugins.
- [ ] Add a small operator-focused README example if the plugin ships in-tree.

Run:

```bash
pnpm --dir ui test
```

Expected:

- plugin panel can render and save file-transfer config

- [ ] Commit

```bash
git add ui README.md
git commit -m "feat(ui): expose file-transfer plugin configuration"
```

---

## Final verification

### Task 12: Program-level regression pass

**Files:**
- Modify only as needed to fix failures discovered below

- [ ] Run backend test suites for touched areas.

```bash
npx vitest run src/plugins/__tests__ src/learning/__tests__ src/cli/__tests__ plugins/file-transfer/tests
```

- [ ] Run UI tests relevant to plugin and learning surfaces.

```bash
pnpm --dir ui test
```

- [ ] Run type/build validation.

```bash
pnpm build
pnpm ui:build
```

- [ ] Manually verify these flows in a dev environment:
  - install a managed plugin
  - list plugins in UI
  - enable a plugin for an agent
  - run a learning review and inspect proposals
  - exercise file-transfer root policy with one allowed and one denied path

- [ ] Write down any measured startup/perf delta from before/after if that work landed.

- [ ] Final commit or PR split per milestone, not one giant merge commit.

## Handoff order

If one agent is implementing this program, the order is fixed:

1. Milestone 1
2. Milestone 2
3. Milestone 3
4. Milestone 4

If multiple agents are parallelized, only Milestones 3 and 4 may run in parallel after Milestone 1 is complete. Milestone 2 should still happen before wide rollout because it changes runtime load semantics for the same plugin system Milestone 1 touches.
