# AnthroClaw

Local-first control plane for Pi-backed agents in real chat channels: Telegram,
WhatsApp, and web.

AnthroClaw originally shipped as a Claude Agent SDK experiment. The project has
since moved to a Pi-native Runtime v1 architecture: AnthroClaw owns the harness,
while provider adapters are replaceable implementation details. The legacy
Claude path remains available only as fallback/diagnostics for existing
installations.

<p align="center">
  <img src="ui/public/anthroClaw-logo.svg" alt="AnthroClaw" width="116" />
</p>

<p align="center">
  <strong>A Pi-native control plane for personal, multi-agent assistants.</strong>
</p>

<p align="center">
  <a href="https://github.com/timur-nocodia/anthroclaw/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-f59e0b.svg"></a>
  <img alt="Version" src="https://img.shields.io/github/package-json/v/timur-nocodia/anthroclaw?color=111827">
  <img alt="Node.js 22+" src="https://img.shields.io/badge/node-22%2B-3b82f6.svg">
  <img alt="Pi native runtime" src="https://img.shields.io/badge/runtime-Pi_native-111827.svg">
  <img alt="Telegram and WhatsApp" src="https://img.shields.io/badge/channels-Telegram_%2B_WhatsApp-10b981.svg">
</p>

AnthroClaw is a local-first gateway for running multiple Pi-backed agents across real chat channels, with a web control surface for sessions, agents, skills, channels, logs, fleet status, metrics, and deploy operations.

The important part: AnthroClaw owns the harness. User-facing LLM execution is routed through the **Runtime v1 / Pi path** by default, while sessions, permissions, hooks, checkpoints, skills, MCP tools, channels, dashboard, memory, learning, and rollback remain AnthroClaw-owned product surfaces.

Runtime replacement work is tracked as a Pi-native Runtime v1 harness, not as one-off agent ports or Claude Agent SDK 1:1 compatibility. New Pi/runtime migration code must follow [Runtime Migration Rules](docs/runtime-migration-rules.md): reusable primitives first, agent-specific evidence only as thin fixtures or expansion-packet documentation.

If you want a personal assistant platform that feels like an operator console instead of a toy chatbot, this is the shape of it.

## What It Is

AnthroClaw gives every agent its own workspace, prompt, skills, memory, tools, routes, policies, and runtime settings. The gateway receives messages from channels, routes them to the right agent, executes the selected Pi model through Runtime v1, records sessions and telemetry, and exposes the whole system through a Next.js control UI.

It is designed for one person or a small trusted team running their own assistant fleet.

Current first-class channels:

- Telegram
- WhatsApp
- Web chat through the control UI

Current first-class runtime:

- Runtime v1 / Pi for user-facing LLM calls
- Claude Agent SDK only as legacy fallback/diagnostics
- OpenAI only for optional memory embeddings
- Skills, MCP tools, sessions, hooks, permissions, subagents, checkpoints, and events through AnthroClaw-owned runtime contracts

## Why It Exists

Most assistant frameworks become provider routers with a chat UI bolted on top. AnthroClaw is intentionally narrower and more opinionated:

- **Pi-native execution** with AnthroClaw-owned harness semantics.
- **Agents as folders** instead of database-only configuration.
- **Real channels** instead of a demo chat box.
- **Persistent memory and sessions** instead of one-off prompts.
- **Fleet and runtime telemetry** instead of blind background processes.
- **Strict separation between product UI and fake controls**: if a button is visible, it should map to a real backend path or be clearly read-only.

## Highlights

### Pi-native runtime

AnthroClaw uses Runtime v1 with Pi as the primary execution surface. The runtime intentionally keeps product concepts visible instead of copying provider SDK internals:

- explicit runtime, model, and provider settings
- AnthroClaw permission mode and tool allow/deny policy
- normalized lifecycle and tool events
- AnthroClaw-owned session persistence
- AnthroClaw checkpoints, rewind, fork, and session reads
- portable subagents with explicit capabilities
- runtime-neutral skills and MCP tools
- prompt suggestions, partial messages, progress summaries, and hook events

### Safety profiles (4 profiles, secure-by-default)

Every agent declares a `safety_profile` that controls system prompt mode, tool surface, sandbox defaults, allowlist shape, rate-limit floors, and approval flow:

- **`chat_like_anthroclaw`** (default for new agents) — friendly conversational, all tools auto-allowed, wildcard allowlist OK, no sandbox. Pure-string system prompt with editable per-agent `personality` baseline. Best for personal single-user bots.
- **`public`** — anonymous-user threat model. Read-only tools, no code-tool preset, no project settings, rate-limited.
- **`trusted`** — known users with optional approval flow for destructive operations (Telegram inline buttons).
- **`private`** — single-owner mode, exactly one peer per channel, all tools available with optional bypass.

Profile is required in `agent.yml`; missing → hard-fail at load. Migration helper (`pnpm migrate:safety-profile`) infers a sensible profile for existing configs. See [Safety Profiles](docs/guide.md#safety-profiles) in the guide.

### Plugin framework

First-class plugin system using the `.claude-plugin` manifest layout (`plugins/<name>/.claude-plugin/plugin.json`):

- typed `register(ctx)` entrypoint with hooks, MCP tools, ContextEngine, and config schema
- per-agent enablement via `agent.yml::plugins.<name>.enabled`
- MCP tool auto-namespacing (`mcp__<plugin>__<tool>`)
- hot-reload on filesystem changes
- isolated per-plugin data directory (`data/<plugin-name>/`)
- Zod-derived JSON schema for UI-driven config with comment-preserving YAML writes

### Lossless Context Management (LCM plugin)

A first-party plugin (`plugins/lcm`) for **immutable per-agent context with hierarchical summaries**:

- per-agent SQLite log of every message, with FTS5 full-text + LIKE search
- D0/D1/D2+ summary DAG that compresses older context without erasing it (full source-lineage recovery on demand)
- L1/L2/L3 summarization escalation when token pressure rises
- carry-over across `/newsession` resets — agent's long-term memory survives session boundaries
- optional large-output externalization (tool results that don't fit a context window get stored as artifacts and referenced by ID)
- six tools: `lcm_grep`, `lcm_describe`, `lcm_expand`, `lcm_expand_query`, `lcm_status`, `lcm_doctor`
- UI: context-pressure chip, DAG visualizer, node/message drill-down, doctor panel with double-gated cleanup + automatic backups

### Learning loop

Runtime v1 headless reviewer that proposes memory or skill updates after agent runs:

- triggers on `on_after_query` hook every N turns or after M tool calls
- runs a separate review prompt against the run transcript (artifacts exported to `data/learning-artifacts/<agent>/<job>/`)
- emits **typed proposals** (memory write, skill create/update) into a durable queue
- two modes: `propose` (review-only, requires operator approval) or `auto_private` (auto-apply, only allowed in `private` profile)
- Decision Center turns learning actions into durable approvals: user-scoped memory asks the originating messenger user; skill/curator/tool decisions require admin approval
- Telegram renders inline buttons; WhatsApp and future text-only channels render `/learn approve CODE`, `/learn reject CODE`, and numbered replies
- CLI to review/apply proposals: `pnpm learning`
- dashboard Learning tab to inspect decisions, delivery attempts, audit history, and raw proposals
- runtime-neutral learning skill at `.claude/skills/anthroclaw-learning/SKILL.md` for stable reviewer guidance

### Scheduled tasks (cron) as a runtime primitive

`manage_cron` MCP tool creates durable one-shot or recurring jobs whose payload is a saved prompt:

- delivery target is **bound by the gateway** from the inbound dispatch context (channel/peer/account) — model cannot inject arbitrary chat IDs
- on fire, gateway sends a synthetic cron turn through the model and delivers the assistant response back to the originating chat
- one-shot jobs auto-retire after firing; concrete day/month patterns are detected and treated as one-shot
- silent suppression via `[SILENT]` response prefix
- jobs persist in `data/dynamic-cron.json`, survive restart
- dashboard Scheduled Tasks panel for static (yml) jobs

### Heartbeat routines

Per-agent `heartbeat` config plus `HEARTBEAT.md` adds a lightweight, Runtime v1
wake loop for recurring agent work:

- gateway reads due tasks from `HEARTBEAT.md` and sends a synthetic heartbeat turn through the normal Runtime v1 path
- optional workspace scripts can gate whether the model should wake and can feed fresh metrics/docs into the prompt
- meaningful responses are delivered back to the last chat; `HEARTBEAT_OK` and `[SILENT]` stay quiet
- Routines UI covers settings, `HEARTBEAT.md`, manual runs, last-target/status, and output preview

See [Heartbeat Routines](docs/guide.md#heartbeat-routines) for the full contract.

### Operator control plane

Three independent off-by-default subsystems plus four self-config MCP tools that let an
operator agent (e.g. a personal Telegram assistant) manage other agents (e.g. a
WhatsApp lead bot) entirely through configuration:

- **`human_takeover`** — WhatsApp `fromMe` detection auto-pauses the agent for that
  conversation with a sliding-window TTL, so operator and bot stop replying to clients
  in parallel
- **`notifications`** — generic event emitter with cron-scheduled events, per-agent
  timezone, throttle, and Telegram `parseMode: markdown` end-to-end
- **`operator-console` plugin** — five cross-agent admin tools (`peer_pause`,
  `delegate_to_peer`, `list_active_peers`, `peer_summary`, `escalate`) with
  manager-side `manages` whitelist
- **Self-config tools** — `manage_notifications`, `manage_human_takeover`,
  `manage_operator_console`, `show_config` — operators configure all of the above by
  natural-language conversation in any channel; mutations go through `AgentConfigWriter`
  (comment-preserving YAML, atomic rename, audit log) so chat and UI saves share one
  write path
- **Handoff tab** in the control UI: live active-pauses table with unpause, notifications
  routes/subscriptions editor, activity log, config audit timeline

See [Operator Control Plane](docs/guide.md#operator-control-plane) for the full contract.

### Agents as workspaces

Each agent is a directory:

```text
agents/
  example/
    agent.yml          # config: safety_profile, routes, mcp_tools, learning, cron, ...
    CLAUDE.md          # main system prompt (with @./soul.md style imports)
    soul.md            # persona (imported via @./)
    memory/            # daily memory + MEMORY.md long-term
    .claude/
      skills/          # workspace skill layout
        my-skill/
          SKILL.md
```

That makes agents reviewable, portable, and easy to version. A prompt change is a diff. A skill is a folder. A policy is YAML.

### Multi-agent routing

AnthroClaw can route messages by channel, peer, group, topic, and agent policy. Agents can operate independently while sharing the same gateway.

Supported routing patterns include:

- personal DMs
- group chats with mention-only behavior
- topic-specific Telegram forum threads
- per-agent allowlists
- pairing-code or approval-based access
- queue modes for collect, steer, and interrupt behavior

### Memory that survives the chat

Agents can search and write memory through MCP tools:

- daily memory files
- wiki pages
- SQLite FTS5 search
- optional vector search
- background memory prefetch
- automatic memory consolidation
- prompt-injection fencing for recalled memory

### Sessions, checkpoints, and search

AnthroClaw treats sessions as operational data, not hidden SDK internals:

- persistent runtime sessions
- transcript indexing
- `session_search`
- focused summaries
- fork and rewind
- title generation
- session pruning
- reset policies
- context compression

### Skills as native folders

Skills live in `.claude/skills`. They can be attached, detached, uploaded, cloned, inspected, and managed from the UI and tools.

AnthroClaw keeps a thin compatibility/admin layer, but the canonical layout stays runtime-neutral.

### Control UI

The web UI gives you an operator-grade control surface:

- fleet overview
- agent list and editor
- Test Chat with session controls
- chat debug rail with runtime session, route decision, hook, and subagent runtime details
- dedicated Sessions browser: list with search and filters (source / status / channel / labels / period), multi-select with shift-range, bulk delete and bulk tagging, per-session export (Markdown / raw JSONL), inline title and label editor with autocomplete, transcript renderer that mirrors live chat byte-for-byte (same tool-call cards), keyboard navigation with `?` cheatsheet
- per-agent Runs tab for runtime run history and route decisions
- subagent visibility and scoped interrupt
- channel pairing and routing
- runtime metrics
- lifecycle telemetry
- logs
- settings
- deploy wizard
- fleet commands

### Fleet and runtime telemetry

Runtime metrics are persisted and surfaced in the UI:

- uptime
- active sessions
- messages and tokens over 24h
- model and tool usage
- runtime run records with source/channel/session provenance
- route decision history with outcomes, winning agent, access result, queue action, and candidates
- session/tool/subagent lifecycle events
- query latency
- memory/media store size
- system CPU, memory, disk, Node, platform, and Git status

## Quick Start

### Requirements

- Node.js `>= 22`
- `pnpm`
- Pi/provider credentials for the models you plan to use
- Telegram bot token if using Telegram
- WhatsApp pairing if using WhatsApp
- optional OpenAI API key for memory embeddings

### Install

```bash
git clone https://github.com/timur-nocodia/anthroclaw.git
cd anthroclaw
pnpm install
```

### Configure

```bash
cp .env.example .env
```

Edit:

- `.env` for secrets
- `config.yml` for gateway/channel defaults
- `agents/example/agent.yml` for the example agent
- `agents/example/CLAUDE.md` for the agent prompt

### Run the gateway

```bash
pnpm dev
```

### Pair WhatsApp

```bash
pnpm whatsapp:pair
```

### Run the control UI

```bash
pnpm ui
```

The UI is a Next.js app under `ui/`.

## Deploy with Docker

For Linux server deployment (VPS, Hetzner, Fly.io, self-hosted) — see **[DOCKER.md](DOCKER.md)** for the full guide. Short version:

```bash
# On the server, configure runtime provider auth:
# use the Runtime UI or set provider env vars supported by your Pi model/provider

# Deploy:
git clone https://github.com/timur-nocodia/anthroclaw.git && cd anthroclaw
cp .env.example .env   # add TELEGRAM_BOT_TOKEN and runtime provider credentials
docker compose up -d --build
```

The container reads runtime credentials from the configured Runtime v1/Pi provider storage or environment. Legacy Claude auth remains available only for fallback diagnostics.

Docker is intended for Linux servers only. On macOS, run `pnpm dev` directly.

## Common Commands

```bash
# Gateway dev loop
pnpm dev

# Build TypeScript (root + plugin workspaces)
pnpm build

# Backend tests
pnpm test

# Backend tests in watch mode
pnpm test:watch

# Control UI dev server
pnpm ui

# Control UI production build
pnpm ui:build

# Reset local admin password
pnpm reset-password

# WhatsApp pairing helper
pnpm whatsapp:pair

# Migration: infer safety_profile for legacy agent configs (dry-run)
pnpm migrate:safety-profile

# Migration: apply inferred profiles
pnpm migrate:safety-profile --apply

# Learning loop CLI: review and apply pending proposals
pnpm learning           # list pending
pnpm learning review    # interactive review
pnpm learning apply     # apply approved proposals
```

## Configuration Shape

Minimal agent example (chat profile, single-user personal bot):

```yaml
model: claude-sonnet-4-6
timezone: UTC

# Required since 0.5.0. New agents default to chat_like_anthroclaw.
# Run `pnpm migrate:safety-profile --apply` to add this to legacy configs.
safety_profile: chat_like_anthroclaw

# Optional: per-agent personality override (chat profile only).
# Empty/missing = uses the project-wide CHAT_PERSONALITY_BASELINE.
# personality: |
#   You are a formal British butler. Address the user as "Sir."

routes:
  - channel: telegram
    scope: dm

allowlist:
  telegram: ["YOUR_TELEGRAM_ID"]

mcp_tools:
  - memory_search
  - memory_write
  - send_message
  - list_skills
  - manage_skills
  - manage_cron

queue_mode: steer

iteration_budget:
  max_tool_calls: 30
  timeout_ms: 120000
  grace_message: true

auto_compress:
  enabled: true
  threshold_messages: 15

# Optional: enable plugins (e.g. LCM for lossless context).
plugins:
  lcm:
    enabled: true

# Optional: configure the propose-only learning loop.
# learning:
#   enabled: true
#   mode: propose
#   review_interval_turns: 10
#   approvals:
#     admin:
#       notify: true
#       routes:
#         - channel: telegram
#           account_id: main
#           peer_id: "ADMIN_CHAT_ID"
#       senders:
#         telegram:
#           main:
#             - "ADMIN_USER_ID"
#       notify_admin_for:
#         - learning_skill
#         - curator_action
#         - tool_approval
```

For other profiles (`public`, `trusted`, `private`), see the [agent.yml reference](docs/guide.md#agentyml-reference) in the guide.

## Built-in Tools

### Core MCP tools (registered per agent)

| Tool | Purpose |
| --- | --- |
| `memory_search` | Search agent memory using FTS5 + optional vector retrieval |
| `memory_write` | Write durable daily memory entries |
| `memory_wiki` | Create, read, update, and delete wiki pages |
| `session_search` | Search prior runtime session transcripts |
| `send_message` | Send text back through configured channels (gateway-bound delivery in `public`) |
| `send_media` | Send media files through channels |
| `access_control` | Manage allowlists and pending access |
| `list_skills` | Inspect available/attached skills |
| `manage_skills` | Create, update, attach, detach, and remove skills |
| `manage_cron` | Create durable scheduled tasks; delivery target is gateway-bound from dispatch context (model cannot inject arbitrary chat IDs) |
| `web_search_brave` | Search the web through Brave |
| `web_search_exa` | Search the web through Exa |

### LCM plugin tools (when `plugins.lcm.enabled`)

| Tool | Purpose |
| --- | --- |
| `lcm_grep` | Search across all session messages and DAG nodes (FTS5 + LIKE) |
| `lcm_describe` | Describe a node/message by ID with full source lineage |
| `lcm_expand` | Expand a summary node into its source children (recursive recovery) |
| `lcm_expand_query` | Expand a summary node filtered by a query |
| `lcm_status` | Context pressure metrics (tokens, depth, threshold, ratio) |
| `lcm_doctor` | Health check + double-gated cleanup with automatic backup |

### Built-in runtime tools (profile-gated)

`Read`, `Write`, `Edit`, `MultiEdit`, `Glob`, `Grep`, `LS`, `Bash`, `WebFetch`, `WebSearch`, `NotebookEdit`, `TodoWrite` — availability depends on `safety_profile`. `chat_like_anthroclaw` and `private` allow all; `trusted` requires approval for destructive; `public` allows only read-only set.

## Security Model

AnthroClaw connects the selected Runtime v1 provider to real tools, files,
channels, and users. Treat inbound messages as untrusted input.

Core defaults and design goals:

- unknown users should pair or be approved before an agent processes their messages
- agent tools should be explicitly configured
- dangerous Bash/file operations should route through AnthroClaw permission policy
- context references are guarded by SSRF, prompt-injection, budget, and workspace-root checks
- user-facing agent LLM calls use the selected Runtime v1 / Pi provider configuration
- remote/channel access should be reviewed before exposing an agent publicly
- secrets belong in `.env`, not in `agent.yml`, prompts, skills, or commits

Before adding powerful tools to an agent, verify:

- who can reach the agent
- what files it can read/write
- whether it can call shell commands
- which MCP tools it can access
- whether the session is personal, group, or channel-facing

Available profiles:

- **`chat_like_anthroclaw`** (default) — friendly conversational, all tools, single-user.
- **`public`** — anonymous-user threat model, read-only tools, rate-limited.
- **`trusted`** — known users, approval flow for destructive operations.
- **`private`** — single owner, all tools, optional bypass.

See the [Safety Profiles section](docs/guide.md#safety-profiles) for how `safety_profile` controls tool access and system prompt selection.

## Project Layout

```text
.
├── agents/
│   └── example/                 # Example agent workspace
│       ├── agent.yml            # safety_profile, routes, mcp_tools, plugins, learning, cron, ...
│       ├── CLAUDE.md            # main system prompt (with @./soul.md imports)
│       ├── soul.md              # persona
│       ├── memory/              # daily memory + MEMORY.md long-term
│       └── .claude/skills/      # native skill layout
├── plugins/                     # First-party plugin workspace (pnpm)
│   ├── lcm/                     # Lossless Context Management plugin
│   └── __example/               # Example plugin scaffold
├── config.yml                   # Gateway/channel/runtime defaults
├── docs/
│   ├── guide.md                 # Operator guide (the canonical reference)
│   └── safety-profiles.md       # Profile reference
├── scripts/
│   ├── migrate-safety-profile.ts
│   └── release.mjs
├── Dockerfile                   # Multi-stage Linux server image
├── docker-compose.yml           # gateway + ui services
├── DOCKER.md                    # Linux server deployment guide
├── src/                         # Gateway, runtime, tools, channels, memory, security
│   ├── agent/
│   ├── channels/
│   ├── config/
│   ├── learning/                # Runtime v1 learning loop (reviewer, store, applier)
│   ├── memory/
│   ├── metrics/
│   ├── plugins/                 # Plugin loader + registry + ContextEngine
│   ├── sdk/
│   ├── security/                # safety_profiles, builtin/MCP tool meta, validators
│   └── session/
├── test/                        # Backend test suite (vitest)
├── ui/                          # Next.js 15 control UI
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── __tests__/
├── package.json
└── pnpm-workspace.yaml          # root + ui + plugins/* workspaces
```

Runtime data is created under `data/` and intentionally ignored by Git:

```text
data/
├── auth.json                    # UI admin credentials
├── memory-db/{agent}.sqlite     # per-agent memory FTS5 + optional vectors
├── transcript-db/{agent}.sqlite # session transcript index
├── session-mappings/{agent}.json # sessionKey ↔ runtime sessionId
├── runtime-sessions/            # runtime transcript store
├── lcm/lcm-db/{agent}.sqlite    # LCM plugin: messages + summary DAG
├── lcm/lcm-backups/             # LCM doctor backups
├── learning-artifacts/{agent}/  # learning loop run inputs (frozen)
├── dynamic-cron.json            # gateway-managed scheduled tasks
├── runtime-overrides.yml        # config overlay (UI-mutated, deep-merged)
├── rate-limits-{agent}.json
├── whatsapp/                    # Baileys auth state
└── media/                       # downloaded inbound media
```

## Development Workflow

Use small, reviewable changes:

```bash
pnpm build
pnpm test
pnpm ui:build
cd ui && pnpm test --run
```

For UI-only work, at minimum run:

```bash
pnpm ui:build
cd ui && pnpm test --run
```

For runtime or SDK changes, run backend build/tests as well.

## Releases

AnthroClaw uses SemVer tags: `vMAJOR.MINOR.PATCH`.

The canonical version is stored in three places that must stay in sync:

- `package.json`
- `ui/package.json`
- `VERSION`

Release notes live in `CHANGELOG.md`.

Use the release scripts from a clean worktree:

```bash
npm run release:check
npm run release:dry
npm run release:patch   # 0.1.0 -> 0.1.1
npm run release:minor   # 0.1.0 -> 0.2.0
npm run release:major   # 0.1.0 -> 1.0.0
git push && git push --tags
```

`scripts/release.mjs` updates all version files, appends a changelog entry from git commits since the latest `v*` tag, creates `chore(release): vX.Y.Z`, and creates an annotated git tag.

## Contributing

Contributions are welcome, but AnthroClaw has a few strong rules because the runtime can control real accounts, files, tools, and infrastructure.

### Contribution Principles

- Keep Runtime v1 / Pi behavior intact.
- Keep provider additions behind the Runtime v1 contract and Runtime UI.
- Do not copy provider SDK concepts into public product surfaces when AnthroClaw owns the primitive.
- Do not introduce fake UI states, simulated success, or buttons without backend behavior.
- Prefer small PRs with clear scope.
- Add or update tests for behavior changes.
- Update docs when user-facing behavior changes.
- Treat channel input, file references, URLs, and tool output as untrusted.

### Before Opening a PR

Run the relevant checks:

```bash
pnpm build
pnpm test
pnpm ui:build
cd ui && pnpm test --run
```

If a check cannot be run locally, say exactly why in the PR description.

### PR Format

Please include:

- what changed
- why it changed
- how it was tested
- screenshots or short screen recordings for UI changes
- security notes for channel/tool/permission changes
- migration notes if config shape changed

### Good First Areas

- UI empty states and operator flows
- tests around fleet/deploy/channel behavior
- documentation examples
- agent templates
- skills that use the native `.claude/skills` layout
- observability and metrics views
- channel-specific troubleshooting docs

### Changes That Need Extra Care

- permission behavior
- shell/file tools
- reference parsing
- channel access control
- deploy/fleet commands
- memory retrieval and injection handling
- session persistence
- subagent capabilities

If in doubt, open an issue or draft PR before implementing a large change.

## Roadmap

The Pi-native Runtime v1 migration and first product-hardening pass are
complete. Next product candidates:

- deeper runtime provider evaluation and model-routing policy;
- operator-facing approval queue UI;
- richer deploy rollback controls and fleet release history;
- public-profile abuse monitoring and rate-limit analytics;
- managed plugin marketplace packaging.

The v1.3.0 implementation plan remains archived at
[`docs/superpowers/plans/2026-05-20-v1.3-runtime-product-hardening.md`](docs/superpowers/plans/2026-05-20-v1.3-runtime-product-hardening.md).

## Inspiration and Compatibility

AnthroClaw is inspired by two projects:

- Agent gateway research and production operator workflows that informed the Runtime v1 control-plane shape.
- Hermes-style agent infrastructure patterns, especially around operational discipline, memory, sessions, routing, and runtime visibility.

This repository is a separate implementation focused on a Pi-native Runtime v1 harness and a smaller set of first-class channels.

The goal is not to support every provider and every surface. The goal is to make the Pi-native AnthroClaw path excellent.

### Runtime usage

AnthroClaw is designed so user-facing LLM execution goes through Runtime v1 with Pi by default. Claude Agent SDK is retained only as legacy fallback/diagnostics, not as the implementation target.

Provider API keys and model choices are configured through the Runtime UI/control plane. OpenAI may also be used for optional memory embeddings when configured.

You should still review current provider terms for your own use case. AnthroClaw does not bypass login, hide usage, or proxy other users through your account.

## License

AnthroClaw is released under the [MIT License](LICENSE).
