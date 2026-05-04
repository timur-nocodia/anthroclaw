# Changelog

All notable changes to AnthroClaw are documented here.

> **Looking for a specific feature?** The **channel binding wizard** (mouse-driven 5-step UI for connecting an agent to channels/groups/topics) shipped in **[v0.7.0](#070---2026-05-01)** below. The **Operator Control Plane** (auto-pause on human takeover, generic notifications emitter, cross-agent admin tools) and **self-configuration tools** (configure agents via chat) shipped in **[v0.6.0](#060---2026-05-01)**. Most other major capabilities (Plugin framework, **LCM** lossless context management, **Safety profiles**, **Learning loop**, **Scheduled tasks**, **chat_like_openclaw**) shipped in **[v0.5.0](#050---2026-04-30)**. Earlier releases focused on Sessions UI (0.4.0) and persistent session/channel reliability (0.3.0).

## [Unreleased]

## [0.8.0] - 2026-05-04

Capability-cutoff release. Closes a multi-tenant credential leak (one
agent could reach Claude.ai-bound MCP servers like Google Calendar,
Notion, Linear, Gmail bound to the host Claude account) and two
related production bugs found 2026-05-04.

### Added

- **Capability cutoff** (`src/sdk/cutoff.ts` → `applyCutoffOptions`).
  Every agent's SDK invocation now runs with `enabledMcpjsonServers: []`,
  `settingSources: []`, `additionalDirectories: []`, scrubbed
  `process.env`, and an agent-scoped `cwd`. A composed `canUseTool`
  gate denies any tool the agent has not declared in its
  `mcp_tools` / `external_mcp_servers`. Cutoff is the LAST step in
  `buildSdkOptions` and applies to both normal and `trustedBypass`
  paths — capability != permission.
  - Built-in agent tool whitelist: `Read, Write, Edit, Bash, Glob,
    Grep, TodoWrite`. Anything else (WebFetch, WebSearch,
    NotebookEdit, Task, Claude.ai built-in MCP tools) requires
    explicit per-agent declaration.
  - Env scrub: case-insensitive denylist + prefix denylist covers
    Anthropic / Claude / Google / Notion / Linear / Gmail / OpenAI /
    AWS / GCP / Azure / Vault / GitHub plus project-internal
    secrets (`JWT_SECRET`, `ADMIN_PASSWORD`, `DATABASE_URL` family,
    `OC_AGENTS_DIR` / `OC_DATA_DIR`, `ANTHROCLAW_MASTER_KEY`).

- **Filesystem sandbox** (`src/agent/sandbox/agent-workspace.ts`).
  Canonical `agentWorkspaceDir(agentId)` resolved independently of
  the loader-supplied `agent.workspacePath` so cutoff catches loader
  regressions. Agent-id regex `^[a-z0-9][a-z0-9_-]*$` enforced both
  in the helper and in `Gateway.discoverAgentDirs`.
  - **Bash sibling-dir denylist** + cwd-guard wrapper: Bash commands
    that substring-match a sibling agent's absolute workspace path
    are denied; allowed commands are rewritten with a `cd "<ws>" ||
    exit 1` preamble. Sibling paths are normalised with a trailing
    `/` to prevent prefix-collision self-DoS (`agent_b` ⊂
    `agent_bc`).

- **Credential storage** (`src/agent/credentials/`).
  - `master-key.ts` — `loadMasterKey()` validates
    `ANTHROCLAW_MASTER_KEY` (32 bytes / 64 hex chars exactly).
  - `audit.ts` — append-only JSONL audit log
    (`<OC_DATA_DIR>/credential-access.jsonl`, mode `0o640`).
    Concurrent writes serialized through a chain that survives
    transient write failures.
  - `encrypted-fs-store.ts` — `EncryptedFilesystemCredentialStore`.
    AES-256-GCM with HKDF-SHA256-derived per-(agentId, service)
    key. File layout `[version=1 | iv (12) | auth tag (16) |
    ciphertext]` at `agents/<id>/credentials/<service>.enc` (mode
    `0o600`, parent dir `0o700`). Cross-agent decryption fails;
    tampering fails AES-GCM auth.
  - `index.ts` — `CredentialStore` interface for future Vault
    migration.

- **Cron→DM session continuity** (`src/gateway.ts:handleCronJob`).
  Cron dispatches with `deliverTo` now mirror the captured SDK
  session id under the user-shaped sessionKey, so a follow-up user
  reply resumes the same conversation. Background cron (no
  `deliverTo`) stays isolated.

- **`escalate` MCP tool** (`src/agent/tools/escalate.ts`). Universal
  tool for routing client questions to a human operator when the
  agent genuinely cannot fulfill the request. Writes structured
  events to `<OC_DATA_DIR>/escalations/<agentId>.jsonl`.

- **Customer-facing agent template**
  (`docs/customer-facing-agent-template.md`). Anti-hallucination
  addendum (don't invent technical excuses involving internal
  architecture; refusal must be plain) plus instructions for adding
  `escalate` to the agent's `mcp_tools`. Operators of customer-facing
  agents (e.g. `leads_agent`/Amina) apply this at deploy time.

- **`escalate` in example agent** — `agents/example/agent.yml`
  ships with `escalate` registered.

### Changed

- `buildSdkOptions` wraps both return paths through
  `applyCutoffOptions`. Profile-supplied `settingSources` is
  overridden to `[]` (cutoff is ground truth).
- `summarizeSessionRecallWithSdk` (`src/agent/agent.ts`) extracted
  into `buildSessionRecallSdkOptions` and hardened with `settingSources:
  []`, `additionalDirectories: []`, `env: scrubAgentEnv(process.env)`
  even though all tools are denied — `.mcp.json` discovery still
  fires at startup otherwise.
- `composeToolGates` threads upstream's `updatedInput` into the
  cutoff invocation and preserves it when cutoff allows without
  supplying its own. Cutoff retains final say.

### Required action for operators upgrading from 0.7.x

1. **Set canonical agent / data paths in prod `.env`** (REQUIRED):
   ```env
   OC_AGENTS_DIR=/app/agents
   OC_DATA_DIR=/app/data
   ```
   The cutoff layer resolves each agent's SDK `cwd` via
   `agentWorkspaceDir(agentId)`, which falls back to
   `<process.cwd()>/agents`. In our docker-compose `working_dir` is
   `/app/ui` (Next.js host), so the fallback resolves to
   `/app/ui/agents/<id>` — a non-existent path, causing spawned SDK
   processes to die instantly with a misleading
   "Claude Code native binary not found" error. Set explicitly.

2. Generate the credential-store master key (optional for v0.8.0,
   required from v0.9.0):
   ```bash
   openssl rand -hex 32 > /tmp/master-key
   echo "ANTHROCLAW_MASTER_KEY=$(cat /tmp/master-key)" >> /path/to/prod/.env
   shred /tmp/master-key
   ```
   v0.8.0 ships the encrypted store but no agent reads it yet (that's
   v0.9.0 agent-driven OAuth). Set the env var now anyway so the v0.9
   deploy doesn't surprise.

3. **Disable cron jobs that relied on inherited Claude.ai MCP
   servers.** After deploy, `mcp__claude_ai_*` tools return deny
   from the cutoff gate. Most affected: `morning-standup` for
   `timur_agent` (calendar reads). Disable in
   `data/dynamic-cron.json` (set `enabled: false`) until v0.9.0
   ships agent-driven OAuth.

4. **Customer-facing agents:** apply the addendum from
   `docs/customer-facing-agent-template.md` to the agent's
   `CLAUDE.md` (or its first `@./*.md` import) and add `escalate`
   to the agent's `mcp_tools`. Hardens against the
   operator-console hallucination found 2026-05-04.

### Bug fixes

- **Bug #1 (cron amnesia):** cron-fired briefing went to one SDK
  session, follow-up user message started a different session.
  Fixed by mirroring the captured session id to the user-shaped
  sessionKey in `handleCronJob`.
- **Bug #2 (cross-tenant calendar leak):** Klavdia (`timur_agent`)
  read Roman's Google Calendar via the inherited Claude.ai MCP
  server. Closed structurally by the cutoff (Subsystem 1).
- **Bug #3 (Amina hallucination):** `leads_agent` invented an
  "operator console is disabled" excuse to refuse a client.
  Mitigated by the customer-facing addendum + `escalate` tool.
- **Bug #4 (cross-agent MCP credential leak):** parent of #2;
  same fix.

### Removed

- Implicit access to Claude account-bound MCP servers from agent
  runtime. (Was a security hazard, not a feature.)

### Known limitations

- **`mcp__claude_ai_*` names still appear in `deferred_tools_delta`.**
  The Claude Code native binary reads its own `~/.claude/` settings on
  startup and announces those tool names to the model regardless of
  `enabledMcpjsonServers: []`. The cutoff `canUseTool` gate denies the
  actual call (whitelist), and the names are not in `--allowedTools`
  the SDK passes, so the model cannot directly invoke them; `ToolSearch`
  is now in HARNESS_BLOCKLIST as additional defence-in-depth. End
  result is structurally safe but the names leak at the
  "model-knows-they-exist" layer. A clean closure requires moving the
  OAuth-token storage out of `~/.claude/` so the bind-mount is no
  longer needed — deferred to v0.9.0.
- **Bug #3 behavioural discipline (Amina) only partially fixed.** The
  structural cause (hallucinated technical excuses about internal
  architecture) is closed by the cutoff + `escalate` tool. But the
  customer-facing addendum's hard rules (no competitor names, no
  markdown in WhatsApp, plain refusals) are imperfectly followed by
  Opus 4.6 with adaptive thinking — the model still drifts toward
  "helpful" comparisons. A second-pass critique agent (review the
  pre-send response, regenerate if it violates rules) is the fix —
  scheduled for v0.9.0.

## [0.7.1] - 2026-05-02

Patch release with UX polish and small fixes shipped after v0.7.0 production
deploy. No schema changes; safe to upgrade.

### Fixed

- BindingTestPanel placeholders no longer leak operator-specific identifiers.
  Previously the Sender ID hint hardcoded the project owner's actual Telegram
  user ID and the Message text hardcoded a specific bot username — both
  visible to every operator regardless of context. Replaced with generic
  `123456789` / `@your_bot some message` patterns.
- Plugin Configure panel returned **Schema fetch failed (404)** for plugins
  with a kebab-case name (e.g. `operator-console`). The schema loader was
  building candidate export keys with literal hyphens (invalid JS
  identifiers). Now splits on `-` and joins as PascalCase, so
  `operator-console` resolves the canonical `OperatorConsoleConfigSchema`
  export.
- Memory tab inline content view stayed on "Loading…" forever when expanding
  any entry whose path contained slashes (memory entries are stored at
  `memory/YYYY/MM/DD.md`). The previous implementation routed through
  `/api/agents/[id]/files/[filename]`, whose `safeFilePath` rejects any
  filename containing path separators. New dedicated
  `GET /api/agents/[id]/memory-file?path=...` endpoint takes the path as a
  query parameter, resolves it under the agent directory, and verifies the
  resolved path doesn't traverse outside.

### Changed

- Memory tab default status filter is now `all` (was `pending`). With
  auto-extracted memory the default state is `approved`, so the previous
  default showed an empty list and operators couldn't see what was actually
  stored.
- MemoryEntryRow is click-expandable: clicking a row toggles a panel that
  fetches the file content via the new memory-file endpoint and renders it
  inline as a scrollable preformatted block. Lazy-loaded — content is fetched
  only when the row is first expanded. Failures surface inline.

## [0.7.0] - 2026-05-01

This release replaces the flat-row Routes editor with a wizard-driven UI for
channel binding. Operators can now mouse-drive the full flow (channel → account
→ where → target → behavior → preview) without knowing peer/topic-ID formats
or YAML field names. Includes an offline binding verification endpoint so
operators can confirm a binding matches before sending a real message.

### Added
- **Channel binding wizard** (#8): new "Where this agent listens" section in
  agent settings replaces the flat-row Routes editor with a 5-step wizard
  (Channel → Account → Where → Target → Behavior → Preview). Plain-language
  summaries on each binding card; Edit pre-populates; Remove confirms;
  Test panel verifies bindings against `RouteTable.resolve` without dispatching.
- `POST /api/agents/[id]/route-test` — offline binding verification endpoint;
  reuses RouteTable.resolve + access-control checks (mention, pairing,
  allowlist) and returns matched/agent_id/session_key/blockers without
  dispatching the message.

### Changed
- "Channel behavior" section renamed to "Per-chat customization (optional)"
  and collapsed by default — operators were mistaking it for the binding
  config.
- Old flat-row Routes editor moved behind an "Advanced (raw routes table)"
  expandable for power users.

## [0.6.0] - 2026-05-01

This release adds the **Operator Control Plane** — three orthogonal off-by-default
subsystems that let one agent manage another agent's runtime behavior across
channels, packaged as YAML configuration so any agent can become an operator
for any other agent without code changes. The motivating case (lead-bot
double-replies when operator types from their phone) is solved end-to-end.
Heartbeat routines, an SDK-native periodic wake loop driven by per-agent
`HEARTBEAT.md` task files, also lands in this release.

### Added

- Self-configuration tools (#7): `manage_notifications`, `manage_human_takeover`,
  `manage_operator_console`, `show_config` MCP tools — operators configure
  Operator Control Plane subsystems via natural-language conversation in any
  channel instead of editing YAML or using the UI.
- `AgentConfigWriter` core service: comment-preserving YAML mutation, per-agent
  lock, atomic rename, schema validation, automatic backups (last 10).
- Config audit log at `data/config-audit/<agentId>.jsonl` with rotation; "Last
  modified" indicators on Handoff tab cards plus a timeline panel.
- `cross-agent-perm.canManageAgent` extracted from operator-console plugin for
  reuse by the new self-config tools.
- **Operator control plane** (PR #6) — three independent off-by-default
  subsystems composed via YAML, packaged so any agent can become an operator
  for any other agent without code changes:
  - **`human_takeover`** — WhatsApp `fromMe` detection auto-pauses the agent
    for that conversation with a sliding-window TTL, so operator and agent
    no longer reply to clients in parallel. Persisted to
    `data/peer-pauses.json`.
  - **`notifications`** — generic event emitter dispatching subscribed events
    (`peer_pause_started`, `peer_pause_ended`,
    `peer_pause_intervened_during_generation`, `peer_pause_summary_daily`,
    `agent_error`, `iteration_budget_exhausted`, `escalation_needed`) to a
    configured operator route via existing `send_message` infrastructure,
    with cron-scheduled events honoring per-agent timezone and Telegram
    `parseMode: markdown` wired end-to-end.
  - **`operator-console` plugin** — built-in plugin under `plugins/operator-console/`
    exposing 5 cross-agent admin tools: `peer_pause`, `delegate_to_peer`
    (synthesizes inbound to managed agent's session — preserves session
    continuity), `list_active_peers`, `peer_summary`, `escalate`. Permission
    via manager-side `manages: [agent_ids] | "*"` whitelist.
- **Handoff tab** in agent settings (`ui/components/handoff/`): four sections —
  Auto-pause settings (`HumanTakeoverCard`), Notifications routes &
  subscriptions (`NotificationsCard`), live Active pauses with per-row
  unpause (`ActivePausesTable`), Activity log (`ActivityLogPanel`).
- API endpoints under `withAuth()`:
  `GET/POST /api/agents/[id]/pauses`,
  `DELETE /api/agents/[id]/pauses/[peerKey]`,
  `GET /api/agents/[id]/pause-events`,
  `POST /api/notifications/test`.
- **Heartbeat routines**: per-agent `heartbeat` config plus `HEARTBEAT.md`
  task files create a Gateway-managed periodic wake loop through the native
  Claude Agent SDK query path.
- Heartbeat task parsing with `interval`, `prompt`, optional `script`, `skills`,
  and `timeout_ms` fields.
- Workspace-local heartbeat scripts with path traversal protection, timeout
  handling, stdout/stderr injection, and `{"wakeAgent": false}` wake gates that
  skip unnecessary model calls.
- Durable heartbeat state, last-chat delivery target capture, response output
  history under `data/heartbeat-output/`, and JSONL run history in
  `data/heartbeat-runs.jsonl`.
- Agent UI **Routines** tab for heartbeat settings, `HEARTBEAT.md` editing, and
  recent run history.
- Manual heartbeat runs from the Routines tab, plus last-target/status summary
  and run detail output preview for operators.

### Changed

- UI save endpoints for OCP config (`PATCH /api/agents/[id]/config`) now go
  through `AgentConfigWriter` — unified write path with chat-driven changes,
  single audit log.
- Agent run/session source filters now include `heartbeat`.
- Safety validation rejects `heartbeat.enabled=true` on `safety_profile=public`
  unless explicitly opened with `safety_overrides.allow_tools: ["heartbeat"]`.

## [0.5.0] - 2026-04-30

This release is the large post-0.4.1 integration release: plugin framework,
Lossless Context Management, secure-by-default safety profiles, the
`chat_like_openclaw` conversational profile, SDK-native learning loop, and
the corresponding UI surfaces. It also finalizes Gateway-managed scheduled
tasks for chat agents, including context-bound delivery and model-driven
fire-time execution. Internal planning docs were removed from the public docs
tree; the maintained operator reference is now `docs/guide.md`.

### BREAKING

- `safety_profile` is now required in every `agents/<id>/agent.yml`. Existing
  configs without it fail to load. Run `pnpm migrate:safety-profile --apply`
  and review the result before deploying.
- Tool permission defaults are now profile-driven. The old broad
  `DEFAULT_ALLOWED_TOOLS` behavior no longer implicitly exposes `Bash`,
  `Write`, `Edit`, `MultiEdit`, or `WebFetch` to every agent.
- The default SDK prompt/settings behavior is no longer one global
  `claude_code` preset. `buildSdkOptions()` now resolves system prompt,
  setting sources, sandbox defaults, and tool policy from the agent's
  `safety_profile`.

### Added

- **Plugin framework** using the Claude Code plugin layout:
  `plugins/<name>/.claude-plugin/plugin.json`, typed `register(ctx)`, hooks,
  context engines, config schemas, per-agent enablement, and MCP tool
  auto-namespacing.
- **LCM plugin (`plugins/lcm`)** for lossless hierarchical context management:
  immutable per-agent SQLite log, FTS5/LIKE search, D0/D1/D2+ summary DAG,
  source-lineage recovery, L1/L2/L3 summarization escalation, carry-over
  across session resets, and optional large-output externalization.
- **Six LCM tools**: `lcm_grep`, `lcm_describe`, `lcm_expand`,
  `lcm_expand_query`, `lcm_status`, and `lcm_doctor`.
- **LCM UI surfaces** in agent/session views: context-pressure chip, DAG panel,
  node/message drill-down, grep bridge, and doctor panel with double-gated
  cleanup.
- **Safety profiles**: `public`, `trusted`, `private`, and
  `chat_like_openclaw`, backed by tool metadata, validation, rate-limit floors,
  sandbox defaults, hard blacklists, and profile-aware SDK options.
- **Interactive approval flow** for destructive tool calls where the profile
  and channel support it, including Telegram callback handling.
- **`chat_like_openclaw` profile** for personal conversational bots: warm
  pure-string baseline prompt, optional `personality` override, wildcard
  allowlists accepted, all configured tools allowed, and no approval flow.
- **Learning loop** with SDK-native headless reviewer, artifact export,
  durable proposal store, memory/skill action types, CLI review/apply commands,
  observability counters, and a dashboard Learning tab.
- **Native learning skill** at `.claude/skills/anthroclaw-learning/SKILL.md`
  so the reviewer has stable guidance for memory-vs-skill improvements.
- **Gateway-managed scheduled tasks for chat agents.** `manage_cron` can create
  durable one-shot or recurring jobs whose payload is a saved prompt. When a
  job fires, AnthroClaw sends a synthetic cron turn through the model and then
  delivers the final assistant response back to the originating chat.
- **Migration tooling**: `pnpm migrate:safety-profile` dry-run/apply, including
  profile inference and chat-profile suggestions.
- **Production Docker support for Agent SDK sandboxing**, including bubblewrap,
  socat, plugin workspace build/copy, and runtime compose settings needed for
  SDK tool execution in containers.

### Changed

- New agents scaffold with `safety_profile: chat_like_openclaw` by default.
- `agents/example` (Klavdia) moved to `chat_like_openclaw` with warmer prompt
  files and learning rollout config.
- `buildSdkOptions()` and `canUseTool()` are profile-aware and short-circuit
  chat profile permissions while preserving explicit deny tools.
- Plugin MCP handlers receive `agentId`, making per-agent plugin state and
  LCM databases reliable.
- Auto-compression can delegate to plugin context engines; prompt assembly can
  inject plugin-managed context before `query()`, with size caps, soft
  timeouts, and silent fallback to native SDK behavior.
- Gateway post-query payloads now include `newMessages`, enabling reliable
  plugin mirroring and learning review triggers.
- Plugin config UI now reads Zod-derived JSON schema and persists per-agent
  overlay config while preserving YAML comments.
- Dynamic cron `manage_cron` no longer accepts model-controlled `deliver_to`.
  Delivery is bound by the Gateway from the inbound dispatch context
  (`channel`, `peer_id`, `account_id`, and creator metadata), which keeps
  Telegram/WhatsApp routing outside the model's control.
- One-shot dynamic cron jobs now carry explicit run-once metadata and are
  removed after firing; pre-existing concrete day/month jobs are inferred as
  one-shot and expired reminders are retired on reload.
- `docs/guide.md` is the consolidated public operator guide for safety
  profiles, plugin/LCM operation, learning loop rollout, and production
  deployment notes.

### Fixed

- Docker production builds now include plugin workspaces and compiled LCM
  assets, preventing missing runtime imports in Next.js.
- Dynamic plugin imports use `webpackIgnore`, so production builds do not try
  to prebundle arbitrary plugin entry files.
- LCM SQLite path resolution now matches plugin `pluginDataDir` scoping in
  production.
- Context-engine failures and overlarge assembled prompts fall back safely
  instead of breaking dispatch.
- LCM doctor/cleanup paths close SQLite handles correctly and back up before
  mutation.
- Plugin hot reload now invalidates per-agent caches and reconciles disabled
  plugins without leaving stale tools attached.
- `public` and `trusted` profiles block harness primitives and unsafe tool
  combinations that previously leaked through broad MCP/tool defaults.
- Scheduled task creation no longer fails on the first live message after
  startup due to an unbound SDK warm query; agents exposing `manage_cron`
  bypass warm-query reuse so each dispatch gets its context-bound MCP tools.
- Telegram reminders no longer persist bad string/email chat targets supplied
  by the model. Existing invalid targets are repaired or rejected in favor of
  Gateway-derived numeric chat IDs.
- Cron delivery responses include a delivery contract in the synthetic prompt,
  preventing the model from calling `send_message` or asking users for
  `peer_id`/`chat_id` when AnthroClaw will deliver the final response itself.

### Removed

- Internal implementation plans/specs were removed from the public docs tree.
- The standalone safety-profile reference was folded into `docs/guide.md`.

## [0.4.1] - 2026-04-28

Polish pass on the Sessions surface shipped in 0.4.0: shape-matched
loading skeletons, faster detail-page open, plus a small reliability
fix and a favicon. Also includes a config-mutation fix for Docker
deployments and a UX fix for the WhatsApp pair flow.

### Added

- **Skeleton loaders for Sessions UI.** The list page now renders 8
  shape-matched row skeletons while the first fetch is in flight (was
  blank); the detail page renders 4 skeleton bubbles in place of the
  thin "Loading transcript..." line, and the title shows a skeleton
  bar instead of the long raw `sessionId` string before metadata
  arrives. No layout shift when data lands (caf709e).
- **Favicon.** Real favicon shipped under `ui/app/favicon.ico` —
  Next.js auto-detects and serves at `/favicon.ico` (2529214).

### Performance

- **Session detail open is one fetch instead of two.** Opening a
  session previously dispatched the detail fetch *and* a list of up
  to 200 sibling sessions (only to find the meta — title, labels,
  provenance, activeKeys, messageCount — for the one being opened).
  `getAgentSessionDetails()` now returns those fields directly, and
  the full session list (used solely as autocomplete source for "Add
  label") is fetched lazily on first input focus. Noticeable on
  agents with long history (dfb1aaf).

### Fixed

- **`/api/fleet/status` no longer 500s on a zero-byte
  `fleet-alerts.json` / `fleet.json`.** A half-written or
  externally-truncated JSON file made `loadFleet()` / `loadStore()`
  throw "Unexpected end of JSON input" inside the route handler,
  which surfaced as the empty "No gateways in fleet" state on the
  Fleet page even though the gateway itself was healthy. Empty file
  is now treated as default state (3ede5cb).
- **WhatsApp Disconnect and config edits no longer fail with
  `EROFS` in Docker.** The production compose file mounts
  `config.yml` read-only, but the UI's `DELETE /api/channels/whatsapp/[accountId]`
  and `PUT /api/config` handlers tried to `writeFileSync` to it. New
  runtime overlay (`data/runtime-overrides.yml`) is deep-merged with
  the base `config.yml` at gateway startup; UI mutations write to the
  overlay only, with `null` values acting as tombstones to suppress
  base entries. The base file stays read-only as the operator-edited
  source of truth (60bed6d).
- **WhatsApp pair page no longer dead-ends on `loggedOut`.** Previously
  the page showed "Logged out by WhatsApp. Clear credentials and try
  again." with a perpetually pulsing "Generating QR…" spinner and no
  affordance to clear. Now an error panel renders with a "Clear
  credentials & retry" button that wipes the auth dir via the pair
  endpoint's new `reset:true` flag and restarts the SSE stream.
  Account ID is echoed up front so the retry targets the right
  directory even when it was derived from the agent's route (60bed6d).

### Docs

- README "Control UI" section now lists the dedicated Sessions
  browser; `docs/guide.md` "Session Lifecycle" corrected to reflect
  on-disk persistence (`data/sdk-sessions/...main.jsonl` for SDK
  transcripts, `data/session-mappings/{agentId}.json` for sessionKey
  ↔ sessionId mapping) instead of the stale "in-memory only" claim
  (035ead7).


## [0.4.0] - 2026-04-27

This release ships a dedicated **Sessions** section in the UI: full read /
manage / export / bulk surface for stored agent sessions, with rendering
unified across live Test Chat and saved-history views.

### Added

- **Sessions section** (`/fleet/[serverId]/sessions/[agentId]` and
  `/[sessionId]`). List page with search + source/status filters, agent
  picker, time-ago, message count, label chips, active-session indicator;
  detail page with editable title, label editor, transcript renderer,
  metadata strip, and action bar (Open in Test Chat / Fork / Export /
  Delete with two-step confirm).
- **Sidebar entries.** `Chat` renamed to `Test Chat`; new `Sessions` entry
  with `History` icon between Test Chat and Channels.
- **Unified message rendering for stored sessions.** New
  `storedEntriesToChatMessages()` reconstructs `ChatMessage[]` (with
  `toolCalls[]` and `output` paired by `tool_use_id`) from persisted
  Anthropic content blocks, so resumed history renders identical to the
  live SSE stream — same `MessageBubble` and `ToolCallCard` components.
  Fixes the lossy `openSession()` path that previously stringified raw
  `message` JSON when text was empty, dropping all tool calls.
- **Per-session export.** `GET /api/agents/[agentId]/sessions/[sessionId]/export?format=md|jsonl`
  with `Content-Disposition`. Markdown formatter emits role-labelled
  sections, fenced JSON for tool inputs, fenced output blocks for tool
  results, with dynamic-length fences so embedded triple-backticks don't
  break the document.
- **Bulk operations.** New `POST /api/agents/[agentId]/sessions/bulk` with
  `{action: 'delete' | 'addLabels' | 'removeLabels', sessionIds, labels}`.
  List-page UI supports multi-select (checkbox per row, shift-click range,
  selection highlight), bulk-action bar with Delete (two-step confirm) and
  Tag (add/remove labels with autocomplete from agent's known labels),
  sonner toasts on result.
- **Inline label editor on detail page.** Click chip's `×` to remove,
  `+ Add label` opens an autocomplete input (datalist of existing labels).
- **`gw.getAgentSessionLabels(agentId, sessionId)`** — public gateway
  accessor used by the bulk endpoint to compute label diffs.
- **Keyboard shortcuts on the list page.** `/` focuses search,
  `j` / `k` / `↓` / `↑` move row focus (with auto-scroll and accent
  ring), `Enter` opens, `x` toggles selection of focused row,
  `a` selects all visible, `⌫` / `Delete` triggers bulk-delete confirm,
  `Esc` clears selection / closes cheatsheet / blurs input,
  `?` toggles a cheatsheet modal listing every binding. Listener is
  inert while typing in `INPUT` / `TEXTAREA` / `SELECT` / contentEditable
  and skips modifier-key combinations.

### Changed

- Test Chat's `openSession()` now delegates to the shared normalizer, so
  the rendering of resumed history is byte-identical to the live stream.
- **`display.toolProgress` now actually wired** to per-tool chat status
  surfacing (was a dead config field). When set to `all` the gateway posts
  a short `▶ <toolName>: <preview>` line per tool call (preview length
  governed by `display.toolPreviewLength`); `new` posts only the first
  occurrence of each tool name; `off` (default) stays silent. Default is
  now `off` on every platform — including Telegram, where the previous
  unwired default was `all` and would have spammed group chats once
  surfacing landed. Opt in per-agent for dev/debug surfaces.

### Fixed

- **Verbose tool-call visibility in logs.** Each `tool_use` event now
  emits a `logger.debug({ agentId, sessionKey, toolName }, 'agent: tool_use')`
  line. Without this, a long-running query (extended thinking, slow tool,
  hung subagent) was indistinguishable from a working one — the only
  signals were `Querying agent` at the start and `Memory prefetch
  completed` at the end. Run with `LOG_LEVEL=debug` to see what a stuck
  agent is actually doing.

## [0.3.0] - 2026-04-27

This release fixes the WhatsApp pair → reply path end-to-end, makes sessions
survive restart, plugs framework debug-string leaks to end users, and adds
conventional building blocks (NO_REPLY sentinel, serial queue mode, Python
runtime, opt-in task notifications).

### Added

- **Persistent session mappings.** `sessionKey ↔ sessionId` is now written to
  `data/session-mappings/{agentId}.json` on every change and reloaded on
  startup. Gateway restarts (deploys, container recreate, OOM) no longer make
  the bot "forget" ongoing chats — the next inbound message resumes the same
  SDK session with the full transcript intact (4069332).
- **`NO_REPLY` sentinel.** Conventional pattern for conversational agents:
  emit `NO_REPLY` when the model judges the turn doesn't warrant a reply
  (blocked sender, ack-only follow-up, operator handoff). Gateway recognizes
  the marker — both as the whole response and as a trailing line tacked onto
  a real reply — and suppresses delivery (b4dd853).
- **Serial queue mode.** New `queue_mode: serial` runs each buffered message
  as its own turn in arrival order, instead of folding them into one merged
  follow-up like `collect` does (b483d4e).
- **`display.taskNotifications` flag.** Forwarding SDK task lifecycle
  notifications (`Task completed: …`) to the user channel is now opt-in via
  agent.yml. Off by default — these are framework-internal progress events
  that look like debug output in a real chat (fb6f71b).
- **Python + curl + common Python deps in runtime image.** `python3`,
  `python3-pip`, `curl`, plus `google-auth`, `google-api-python-client`, and
  `requests`. Agents shipping Python helper scripts (Calendar booking,
  Sheets logging, Gmail follow-ups) no longer need to bundle their own venv
  (d08c0a0).

### Fixed

- **WhatsApp `@lid` outbound now actually delivers.** Baileys 7.0.0-rc.9
  throws `Cannot read properties of undefined (reading 'undefined')` inside
  `generateWAMessageFromContent` for bare `@lid` JIDs whose participant
  device list is partially resolved. Resolve LID → phone-number JID via
  `signalRepository.lidMapping.getPNForLID`, then strip the device suffix
  with `jidNormalizedUser`. Falls back to the original LID if no mapping
  exists yet (da140bc).
- **WhatsApp quoted-reply no longer crashes the send.** The synthetic
  `{quoted: {key: {…}}}` we built for replies omitted the `message` body,
  which made Baileys call `getContentType(undefined)` and throw the same
  `'undefined'` error. Drop the quoted option entirely — bots don't really
  benefit from quote-replies anyway (da140bc).
- **Empty agent responses no longer leak `Agent X processed your message
  but produced no text response`** to end users. When the model emits no
  text this turn (only tool calls, hits iteration budget, or chooses
  silence), the gateway returns empty and skips delivery instead of
  inventing a synthetic placeholder (fb6f71b).
- **WhatsApp `auth_dir` resolves against workspace root, not cwd.** The
  Next.js host runs from `/app/ui`, which made relative `auth_dir`
  resolve to `/app/ui/data/whatsapp/...` (empty) instead of the mounted
  `/app/data/whatsapp/...`. Pair-then-restart silently broke the
  WhatsApp connection on every deploy (a9c2934).
- **WhatsApp pair UI now actually works end-to-end.** Unified Baileys
  `browser` tuple between pair-whatsapp and the gateway socket (different
  tuples = different "linked devices" to WhatsApp); pair UI accepts both
  legacy SSE field names; resolves accountId from the selected agent's
  whatsapp route (e034720). Bind button opens the pair flow scoped to the
  selected account (0d9f047). Trash button on the channels page wired to
  the DELETE endpoint (413b342).
- **WhatsApp typing-presence failures stop blocking actual sends.**
  Baileys throws on `sendPresenceUpdate('composing', '@lid')` for some
  device-list states. Wrapped in `.catch` so the typing indicator can fail
  without aborting the message that follows (87e535a).
- **Queue `collect` mode buffers and drains follow-up messages instead of
  silently dropping them.** During an active turn, additional messages are
  now folded into a merged follow-up turn — as documented (ebc6fc3).
- **Drain-dispatch failures no longer crash the worker.** Errors when
  delivering a buffered turn (e.g. Baileys `@lid` throw) are caught,
  logged, and continue draining (ba60616).
- **Steer-aborted runs don't leak a stub reply.** When a follow-up message
  cancels an in-flight query, the original turn now exits silently so the
  follow-up's reply is the only thing the user sees (79c331e).
- **`pairing.mode = "off"` warns once.** Counter-intuitive default that
  silently denies everyone unless allowlisted now emits a one-time warn
  log per (agentId, channel) explaining the footgun (87e535a).
- **Group access defaults open + multi-line channel rule editor fixed.**
  Dropping a bot into a group with `@`-mention no longer requires
  per-group config; UI editor for channel rules accepts multi-line input
  again (88bc614).

### Docs

- Queue modes guide and UI picker now explain all four modes
  (`always`, `interrupt`, `collect`, `serial`) and when to pick each
  (ab3404b).

### Verified

- Full test suite: 92 files passed, 899 tests passed.
- Root TypeScript check and UI TypeScript check passed.
- End-to-end WhatsApp pair → message → reply confirmed in production.


## [0.2.1] - 2026-04-26

### Changed
- docs: document new bot commands, in-thread typing, eye reaction, .claude bind-mount (995576b)
- feat(telegram): bot UX upgrades — eye reaction, in-thread typing, /compact, /model (f74331d)
- merge: bring in v0.2.0 from origin/main (1c497e8)
- fix: chat header layout and gateway uptime drift (aba7b61)
- feat: add Docker deployment for Linux servers (8f8b12a)


## [0.2.0] - 2026-04-25

### Added

- Operator diagnostics bundle with redacted metadata export, run scoping, debug-rail download links, and run sidecars for interrupts, integration audit, and memory influence.
- Memory quality workflow: provenance, review queue/API/UI, review notes, memory doctor, influence tracing, post-run memory candidates, and review-gated local note proposals.
- Runtime reliability surfaces for activity timeouts, SDK task notifications, active run/debug visibility, durable interrupt records, direct webhook delivery, and webhook delivery logs.
- Agentic control UX for session mailbox filters, labels, rename, summary rows, reconnect-safe active run controls, subagent policy controls, subagent tool summaries, and file ownership visibility.
- Integration capability matrix, MCP preflight/status/audit UI, integration audit filters/run links, copyable permission snippets, Google/Gmail external MCP presets, and local notes MCP quick enable.
- Speech-to-text provider interface with automatic provider selection for AssemblyAI, OpenAI, and ElevenLabs.

### Changed

- Kept harness additions outside Claude Agent SDK transcript internals: no transcript surgery, synthetic SDK tool results, custom provider router, or SDK history rewriting.
- Made native in-flight steer behavior explicit: production active-run steering remains disabled and the supported fallback is interrupt-and-restart.
- Improved sandbox-aware test coverage so `fs.watch` and local HTTP webhook specs skip only when the current environment cannot provide those system capabilities.

### Verified

- Full test suite: 92 files passed, 876 tests passed, 8 environment-dependent tests skipped in the current sandbox.
- Root TypeScript check, UI TypeScript check, and production build passed.

## [0.1.0] - 2026-04-24

### Added

- Initial public AnthroClaw release.
- Claude Agent SDK-native gateway runtime.
- Telegram and WhatsApp channels.
- Agent workspaces with prompts, skills, MCP tools, memory, sessions, and cron jobs.
- Next.js Web UI for agents, chat, channels, logs, settings, and fleet control.
- Fleet deployment, telemetry, command execution, and public guide documentation.
