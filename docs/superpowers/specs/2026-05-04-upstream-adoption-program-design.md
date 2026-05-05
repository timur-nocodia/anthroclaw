# Upstream Adoption Program - Design Spec

**Status:** Draft for review
**Date:** 2026-05-04
**Scope type:** Multi-epic product + runtime program

## Goal

Adopt the highest-value ideas from the latest upstream OpenClaw and Hermes releases without breaking AnthroClaw's defining contract:

- user-facing execution must stay on the native Claude Agent SDK path
- no generic provider-router refactor
- no new channel expansion
- all changes must land as mergeable vertical slices

The accepted program for AnthroClaw is:

1. external plugin lifecycle
2. startup/runtime performance trimming
3. learning loop v2
4. operator-safe file transfer as a plugin, not a core runtime primitive

## Why this program exists

AnthroClaw already has strong coverage in the areas that would normally tempt blind upstream copying:

- plugin framework already exists
- learning loop already exists
- heartbeat already exists
- sessions, routing, dashboards, and operator control plane already exist

The right move is therefore not "copy features", but "upgrade the seams AnthroClaw already has":

- make plugins distributable and operable
- make runtime startup and hot paths lighter
- make learning more structured and less heuristic
- add one tightly scoped operator capability that fits the local-first model

## Non-goals

- No transport or provider abstraction layer.
- No new channels or channel parity work beyond what current AnthroClaw already supports.
- No replacement of the Claude Agent SDK query path with custom LLM orchestration.
- No direct port of Hermes Curator as an unbounded autonomous maintenance agent in v1.
- No remote paired-node file transport in v1.
- No redesign of LCM, operator-console, heartbeat, or sessions beyond what is necessary to integrate the four epics.

## Upstream Reading List

This is the exact reading list the implementing agent should use for inspiration.

### Primary sources

| Upstream | Version | Date | What to study | Why it matters to AnthroClaw |
| --- | --- | --- | --- | --- |
| OpenClaw | `v2026.5.3` | 2026-05-04 | release highlights for `Plugins/file-transfer`, `Plugins/install`, `Gateway/performance`, `Channels/streaming`, `/steer` | newest statement of OpenClaw's plugin operations model, file-transfer policy model, and lazy-load direction |
| OpenClaw | `v2026.5.2` | 2026-05-02 | release highlights for external plugin install/update/doctor/dependency reporting and gateway hot-path trimming | clearest prior release for lifecycle/admin surfaces before `v2026.5.3` polish |
| Hermes Agent | `v0.12.0` | 2026-04-30 | `Autonomous Curator & Self-Improvement Loop`, plus cold-start performance notes | best current reference for rubric-based review, active-update bias, skill-side artifacts, and reviewer runtime hygiene |

Direct links:

- OpenClaw `v2026.5.3`: `https://github.com/openclaw/openclaw/releases/tag/v2026.5.3`
- OpenClaw `v2026.5.2`: `https://github.com/openclaw/openclaw/releases/tag/v2026.5.2`
- Hermes `v0.12.0`: `https://github.com/NousResearch/hermes-agent/blob/main/RELEASE_v0.12.0.md`

### Exact sections to inspect

- OpenClaw `v2026.5.3`
  - `Plugins/file-transfer`
  - `Plugins/install`
  - `Gateway/performance`
  - `Channels/streaming`
  - `Agents/commands: /steer`
- OpenClaw `v2026.5.2`
  - `External plugin installation, update, doctor repair, dependency reporting`
  - `Gateway and agent hot paths are leaner`
  - `Plugins/runtime`
  - `Plugins/CLI`
- Hermes `v0.12.0`
  - `Autonomous Curator & Self-Improvement Loop`
  - `Curator - autonomous skill maintenance`
  - `Self-improvement loop (background review fork)`
  - `Cold-start performance`
  - `Configurable prompt cache TTL`

### Rules for inspiration

- Copy shape, not stack.
- Prefer AnthroClaw-native extensions over literal ports.
- If upstream assumes a broader platform model than AnthroClaw has, reduce scope rather than importing the broader abstraction.

## Current AnthroClaw anchors

These are the current code seams the implementation must build on.

### Plugin framework

- `src/plugins/types.ts`
- `src/plugins/loader.ts`
- `src/plugins/registry.ts`
- `src/gateway.ts`
  - startup plugin discovery/load path
  - hot-reload watcher wiring
  - `loadAndRegisterPlugin`
  - `refreshAgentPluginTools`
  - `notifyAgentConfigChanged`
- `ui/app/api/plugins/route.ts`
- `ui/app/api/agents/[agentId]/plugins/[name]/route.ts`
- `ui/app/api/agents/[agentId]/plugins/[name]/config/route.ts`
- `ui/components/plugins/PluginsPanel.tsx`
- `ui/lib/plugin-schema.ts`

### Learning loop

- `src/learning/runner.ts`
- `src/learning/reviewer.ts`
- `src/learning/store.ts`
- `src/sdk/headless-review.ts`
- `src/cli/learning.ts`
- `ui/app/api/agents/[agentId]/learning/route.ts`

### Runtime and performance

- `src/gateway.ts`
  - startup sequencing
  - query path
  - plugin discovery and enabling
  - heartbeat wiring
  - learning queue wiring
- `src/cli/doctor.ts`

### Relevant product constraints

- Plugin config is persisted through `agent.yml`, not database-only state.
- Runtime state is a mix of JSON/JSONL and SQLite.
- AnthroClaw is intentionally local-first and Claude Agent SDK-native.

## Design principles

1. **Do not broaden the runtime abstraction.**
   Every epic must plug into existing AnthroClaw runtime seams.

2. **Separate runtime loading from administrative catalog state.**
   AnthroClaw currently treats "discovered on disk" and "loaded into runtime" as almost the same thing. Plugin lifecycle requires those to diverge cleanly.

3. **Prefer operator-visible state over hidden magic.**
   If plugin installs, learning proposals, or file writes happen, there must be an inspectable record.

4. **Each epic must ship independently.**
   The program is one roadmap, but implementation is four mergeable PR series.

## Program Overview

### Epic A - External plugin lifecycle

#### Product outcome

Operators can install, update, inspect, diagnose, and remove external plugins without manually unpacking directories into the repository.

#### Why now

This is the biggest leverage point from OpenClaw `v2026.5.2` and `v2026.5.3`. AnthroClaw already has a plugin runtime, but not a plugin operations layer.

#### Current gap

Today AnthroClaw:

- discovers plugins from one root
- loads them eagerly at gateway startup
- has no install/update/uninstall CLI
- exposes only loaded plugins in the UI
- has no install-record or dependency-health model

#### v1 design

Introduce a distinct **plugin catalog + install state layer** above the current loader.

##### Plugin roots

AnthroClaw should support two runtime plugin roots:

- bundled root: repository `plugins/`
- managed installs root: `data/plugins-installed/`

Do not install managed packages into the repository `plugins/` directory.

##### Catalog model

Add a catalog layer that can answer:

- which plugins are bundled
- which plugins were externally installed
- where they live on disk
- what source installed them
- whether their dependencies are healthy
- whether they are currently runtime-loaded

Recommended storage for v1:

- `data/plugin-installs.json`

This file should be written atomically and hold records such as:

```json
{
  "name": "file-transfer",
  "sourceType": "npm",
  "sourceSpec": "@vendor/plugin-file-transfer@1.2.3",
  "installRoot": "data/plugins-installed/file-transfer",
  "installedVersion": "1.2.3",
  "manifestVersion": "1.2.3",
  "installedAt": 1777881600000,
  "updatedAt": 1777881600000,
  "dependencyState": "ok",
  "status": "installed"
}
```

##### Discovery split

Refactor plugin discovery into:

- manifest discovery
- runtime loading

Startup should:

1. discover manifests from both roots
2. build a catalog
3. load only plugins that are actually enabled by at least one agent
4. keep manifest/catalog data available to the UI even for plugins that are not loaded

##### Supported sources

`v1` must support:

- bundled plugins
- local path installs
- npm installs

`git` installs are acceptable only if they share the same install flow and do not materially delay `v1`. If they complicate package verification or update semantics, defer them.

##### Admin surfaces

Add:

- CLI: `pnpm plugins list|install|update|remove|doctor`
- UI/API lifecycle actions under existing plugin admin surfaces

The UI must show:

- source type
- installed version
- manifest version
- dependency state
- loaded vs unloaded
- bundled vs managed
- last install/update time

##### Safety rules

- Only operator CLI/UI may mutate plugin installation state.
- No agent-facing tool should install or update plugins in `v1`.
- Reject packages missing `.claude-plugin/plugin.json`.
- Reject packages whose compiled entry cannot be loaded.
- Reject source-only packages in `v1`.
- Duplicate plugin names across roots must fail closed until manually resolved.

#### Acceptance criteria

- Operators can install a plugin from npm or local path into `data/plugins-installed/`.
- The plugin appears in `/api/plugins` even before it is enabled for an agent.
- Enabling a plugin updates live runtime state without restart.
- `doctor` can flag missing manifests, missing entrypoints, and missing dependencies.
- Startup no longer has to load every discoverable plugin just so the UI can list it.

#### Upstream references

- OpenClaw `v2026.5.2`: external plugin installation/update/doctor/dependency reporting
- OpenClaw `v2026.5.3`: harder install/update/onboarding paths and "externalized plugins behave like first-class package installs"

### Epic B - Startup and runtime hot-path trimming

#### Product outcome

Gateway startup, plugin admin, and steady-state query preparation become lighter without changing user-visible behavior.

#### Why now

This is the lowest-risk high-value adoption from both OpenClaw and Hermes. AnthroClaw already has the right runtime model; it just does too much eagerly.

#### Current gap

Current startup in `src/gateway.ts`:

- creates stores
- loads agents
- discovers plugins
- loads every plugin
- starts watchers
- applies per-agent enables
- prewarms agents

This is correct, but not selective.

#### v1 design

Focus on three concrete optimizations:

1. **Load only enabled plugins into runtime**
2. **Keep catalog/manifests separate from loaded modules**
3. **Avoid repeated schema or manifest resolution in UI plugin paths**

Optional if cheap:

- memoize plugin config-schema resolution
- memoize `/api/plugins` response over a short TTL
- delay agent prewarming until channels and route table are ready

Do not add a broad internal caching framework. Keep optimizations local and auditable.

#### Acceptance criteria

- Startup time is measurably reduced on instances with many discoverable plugins.
- Disabled plugins remain visible in UI but are not runtime-loaded.
- Plugin lifecycle admin calls do not require full gateway restart.
- Existing plugin hot-reload and per-agent config invalidation semantics remain intact.

#### Upstream references

- OpenClaw `v2026.5.2`: gateway and agent hot paths; `Plugins/runtime`
- OpenClaw `v2026.5.3`: `Gateway/performance`
- Hermes `v0.12.0`: cold-start performance/lazy init

### Epic C - Learning loop v2

#### Product outcome

AnthroClaw's learning loop becomes more selective, more explainable, and better at updating the exact skill context that was actually active during the run.

#### Why now

Hermes `v0.12.0` contains the cleanest current set of ideas for turning a background review loop from "vague suggestion generator" into "controlled maintenance assistant".

#### Current gap

Current AnthroClaw learning:

- exports a small artifact set
- prompts the reviewer with free-form rules
- persists typed proposals safely
- can auto-apply in `private` mode

But it does not yet:

- use a rubric-first review prompt
- bias toward the skill just used
- understand `references/` and `templates/` files for a skill
- clearly separate "review candidate selection" from "proposal generation"
- inherit richer runtime context into headless review

#### v1 design

##### Review prompt

Replace the current free-form reviewer framing with a rubric-based protocol:

- evidence strength
- durability
- reusability
- safety
- scope of change

The reviewer should still return strict JSON, but the prompt should guide action ranking through explicit classes instead of generic heuristics.

##### Skill activity capture

AnthroClaw should capture which skills were actually active in the run and pass them into the learning job metadata. That metadata should become the main driver of "what to inspect first".

##### Artifact expansion

For active skills only, export:

- `SKILL.md`
- sibling `references/` files
- sibling `templates/` files

Do not recursively export the entire workspace.

##### Runtime inheritance

The headless review path should inherit the same effective model/runtime defaults as the parent agent where safe to do so. Keep tools denied or tightly scoped.

##### Tool scope

Reviewer tool access should stay minimal:

- memory actions
- skill inspection/update actions

No shell, no web, no broad file editing loop.

##### Curator decision

Do **not** implement full Hermes-style autonomous Curator in `v1`.

Instead, define a **Curator-lite follow-up seam**:

- periodic ranking/report generation
- propose-only summaries
- no autonomous unbounded skill rewrites

This follow-up should reuse LearningStore rather than invent a second maintenance stack.

#### Acceptance criteria

- Learning proposals include stronger rationale and fewer weak/noisy patches.
- Reviewers can target the skill that was actually active during the run.
- Skill proposals can reference adjacent `references/` and `templates/` context.
- Headless review remains SDK-native and tool-restricted.
- No new security regression is introduced in review output parsing or application.

#### Upstream references

- Hermes `v0.12.0`: `Self-improvement loop (background review fork)`
- Hermes `v0.12.0`: `Curator - autonomous skill maintenance`

### Epic D - Local-safe file transfer plugin

#### Product outcome

Operators get a tightly scoped file transfer utility through the plugin system for allowlisted local paths, with explicit limits and approvals.

#### Why now

OpenClaw `v2026.5.3` validates the product value of a file-transfer shape, but AnthroClaw should adapt only the policy model, not the paired-node transport model.

#### Current gap

AnthroClaw has no operator-safe binary/file movement plugin today. Adding it as a plugin exercises the lifecycle work and creates one concrete high-value external capability.

#### v1 design

Implement a first-party plugin under `plugins/file-transfer/` with tool names inspired by OpenClaw:

- `file_fetch`
- `dir_list`
- `dir_fetch`
- `file_write`

But the scope is AnthroClaw-local:

- no remote nodes
- no paired host protocol
- no generic network transport

##### Policy model

Plugin config should be per-agent and default deny:

```yaml
plugins:
  file-transfer:
    enabled: true
    roots:
      workspace:
        path: "."
        read: true
        write: false
      exports:
        path: "./exports"
        read: true
        write: true
    max_bytes_per_call: 16777216
    follow_symlinks: false
```

Rules:

- all paths must resolve under an allowlisted root
- symlink traversal is denied unless explicitly enabled
- writes require approval whenever the active safety profile would require approval for destructive actions
- binary payloads over the configured ceiling are rejected

##### Product stance

This is an operator tool, not a general-purpose filesystem abstraction.

#### Acceptance criteria

- Plugin can read and write only under allowlisted roots.
- Attempts to escape root via `..` or symlinks fail closed.
- Large payloads are rejected before read/write.
- UI can configure roots and limits through the plugin config surface.
- The plugin works cleanly with existing approval semantics.

#### Upstream references

- OpenClaw `v2026.5.3`: `Plugins/file-transfer`

## Release sequencing

This program should ship as four PR series in this order:

### Milestone 1 - Plugin lifecycle foundation

- catalog
- multi-root discovery
- managed install store
- CLI skeleton
- UI/API metadata expansion

### Milestone 2 - Runtime trimming

- load-only-enabled plugins
- startup and admin hot-path simplification
- plugin schema/catalog caching where justified

### Milestone 3 - Learning loop v2

- rubric prompt
- skill activity metadata
- artifact expansion
- scoped inherited headless runtime

### Milestone 4 - File transfer plugin

- policy schema
- read/list/fetch/write tools
- UI config
- approval integration

## Deferred backlog

These are intentionally out of scope for this document:

- `/steer`-style session nudging
- streaming progress mode polish
- Hermes-style autonomous Curator with unbounded iterations
- remote file transfer or paired-node abstractions
- provider catalog expansion
- new channels

## Risks and mitigations

### Risk: plugin lifecycle grows into a package manager

Mitigation:

- keep `v1` to local + npm
- install into a managed root only
- require valid plugin manifest and compiled entry

### Risk: performance work becomes invisible refactor churn

Mitigation:

- tie optimizations to explicit startup and admin-path measurements
- do not merge "cleanup only" performance changes without measurable before/after evidence

### Risk: learning loop becomes noisier, not better

Mitigation:

- ship rubric prompt and artifact expansion behind current `learning` config
- compare proposal quality on real runs before widening auto-apply behavior

### Risk: file-transfer plugin weakens safety posture

Mitigation:

- default deny
- per-root explicit permissions
- size ceilings
- approval reuse
- no remote transport in `v1`

## Success metrics

- Plugin install/update/remove can be completed from AnthroClaw CLI/UI without manual filesystem surgery.
- Disabled plugins no longer pay full runtime load cost at startup.
- Learning proposals show fewer low-confidence generic edits and more targeted skill maintenance.
- File transfer is useful to operators while remaining visibly bounded and auditable.

## Final recommendation

Build the program exactly in this order:

1. plugin lifecycle
2. runtime/performance trim
3. learning loop v2
4. file-transfer plugin

That order preserves AnthroClaw's current identity, closes the biggest product gaps first, and keeps each PR series reviewable in isolation.
