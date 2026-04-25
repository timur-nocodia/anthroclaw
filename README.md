# AnthroClaw

Local-first control plane for Claude agents in real chat channels: Telegram, WhatsApp, and web.

<p align="center">
  <img src="ui/public/anthroClaw-logo.svg" alt="AnthroClaw" width="116" />
</p>

<p align="center">
  <strong>A Claude Agent SDK-native control plane for personal, multi-agent assistants.</strong>
</p>

<p align="center">
  <a href="https://github.com/timur-nocodia/anthroclaw/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-f59e0b.svg"></a>
  <img alt="Version" src="https://img.shields.io/github/package-json/v/timur-nocodia/anthroclaw?color=111827">
  <img alt="Node.js 22+" src="https://img.shields.io/badge/node-22%2B-3b82f6.svg">
  <img alt="Claude Agent SDK native" src="https://img.shields.io/badge/Claude_Agent_SDK-native-111827.svg">
  <img alt="Telegram and WhatsApp" src="https://img.shields.io/badge/channels-Telegram_%2B_WhatsApp-10b981.svg">
</p>

AnthroClaw is a local-first gateway for running multiple Claude-powered agents across real chat channels, with a web control surface for sessions, agents, skills, channels, logs, fleet status, metrics, and deploy operations.

The important part: AnthroClaw does **not** wrap Claude as a generic provider. User-facing LLM execution is routed through the **Claude Agent SDK / Claude Code path**. Permissions, hooks, sessions, checkpoints, subagents, skills, MCP tools, sandbox options, and retry/fallback behavior are intentionally aligned with the native SDK surface.

If you want a personal assistant platform that feels like an operator console instead of a toy chatbot, this is the shape of it.

## What It Is

AnthroClaw gives every agent its own workspace, prompt, skills, memory, tools, routes, policies, and runtime settings. The gateway receives messages from channels, routes them to the right agent, executes Claude through the Agent SDK, records sessions and telemetry, and exposes the whole system through a Next.js control UI.

It is designed for one person or a small trusted team running their own assistant fleet.

Current first-class channels:

- Telegram
- WhatsApp
- Web chat through the control UI

Current first-class runtime:

- Claude Agent SDK / Claude Code for user-facing LLM calls
- OpenAI only for optional memory embeddings
- Native `.claude/skills` layout
- MCP tools and SDK `tool()` definitions
- SDK SessionStore-backed sessions
- SDK hooks, permissions, subagents, checkpoints, and partial events

## Why It Exists

Most assistant frameworks become provider routers with a chat UI bolted on top. AnthroClaw is intentionally narrower and more opinionated:

- **Native Claude execution** instead of generic LLM abstraction.
- **Agents as folders** instead of database-only configuration.
- **Real channels** instead of a demo chat box.
- **Persistent memory and sessions** instead of one-off prompts.
- **Fleet and runtime telemetry** instead of blind background processes.
- **Strict separation between product UI and fake controls**: if a button is visible, it should map to a real backend path or be clearly read-only.

## Highlights

### Claude Agent SDK-native runtime

AnthroClaw uses `@anthropic-ai/claude-agent-sdk` as the core execution surface. The runtime intentionally keeps SDK concepts visible:

- explicit SDK options and setting sources
- SDK-native permission mode and tool allow/deny policy
- SDK hooks for lifecycle and tool events
- SDK SessionStore-backed session persistence
- SDK checkpoints, rewind, fork, and session reads
- SDK subagents with explicit capabilities
- SDK-compatible `.claude/skills/*/SKILL.md`
- prompt suggestions, partial messages, progress summaries, and hook events

### Agents as workspaces

Each agent is a directory:

```text
agents/
  example/
    agent.yml
    CLAUDE.md
    soul.md
    .claude/
      skills/
        example-skill/
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

- persistent SDK sessions
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

AnthroClaw keeps a thin compatibility/admin layer, but the canonical layout stays Claude-native.

### Control UI

The web UI gives you an operator-grade control surface:

- fleet overview
- agent list and editor
- chat with session controls
- chat debug rail with SDK session, route decision, hook, and subagent runtime details
- per-agent Runs tab for SDK run history and route decisions
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
- SDK run records with source/channel/session provenance
- route decision history with outcomes, winning agent, access result, queue action, and candidates
- session/tool/subagent lifecycle events
- query latency
- memory/media store size
- system CPU, memory, disk, Node, platform, and Git status

## Quick Start

### Requirements

- Node.js `>= 22`
- `pnpm`
- authenticated Claude Code CLI
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
# On the server, one-time auth (uses your Claude Max/Pro subscription):
npm i -g @anthropic-ai/claude-code
claude setup-token   # → CLAUDE_CODE_OAUTH_TOKEN

# Deploy:
git clone https://github.com/timur-nocodia/anthroclaw.git && cd anthroclaw
cp .env.example .env   # add CLAUDE_CODE_OAUTH_TOKEN, TELEGRAM_BOT_TOKEN
docker compose up -d --build
```

The container uses the SDK-native `CLAUDE_CODE_OAUTH_TOKEN` env var — Anthropic's official headless auth path. No Keychain mounts, no `~/.claude` bind, no separate API billing.

Docker is intended for Linux servers only. On macOS, run `pnpm dev` directly.

## Common Commands

```bash
# Gateway dev loop
pnpm dev

# Build TypeScript
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
```

## Configuration Shape

Minimal agent example:

```yaml
model: claude-sonnet-4-6
timezone: UTC

routes:
  - channel: telegram
    scope: dm
    peers: ["TELEGRAM_USER_ID"]
    mention_only: false

pairing:
  mode: code
  code: "CHANGE_ME"

allowlist:
  telegram: ["YOUR_TELEGRAM_ID"]

mcp_tools:
  - memory_search
  - session_search
  - memory_write
  - send_message
  - list_skills
  - manage_skills

queue_mode: collect
session_policy: never

auto_compress:
  enabled: true
  threshold_messages: 30

iteration_budget:
  max_tool_calls: 30
  timeout_ms: 120000
  grace_message: true

subagents:
  allow: ["research"]
```

## Built-in Tools

| Tool | Purpose |
| --- | --- |
| `memory_search` | Search agent memory using FTS/vector retrieval |
| `memory_write` | Write durable memory entries |
| `memory_wiki` | Create, read, update, and delete wiki pages |
| `session_search` | Search prior SDK session transcripts |
| `send_message` | Send text back through configured channels |
| `send_media` | Send media files through channels |
| `access_control` | Manage allowlists and pending access |
| `list_skills` | Inspect available/attached skills |
| `manage_skills` | Create, update, attach, detach, and remove skills |
| `manage_cron` | Create and control scheduled agent jobs |
| `web_search_brave` | Search the web through Brave |
| `web_search_exa` | Search the web through Exa |

## Security Model

AnthroClaw connects Claude to real tools, files, channels, and users. Treat inbound messages as untrusted input.

Core defaults and design goals:

- unknown users should pair or be approved before an agent processes their messages
- agent tools should be explicitly configured
- dangerous Bash/file operations should route through SDK permission policy
- context references are guarded by SSRF, prompt-injection, budget, and workspace-root checks
- OpenAI is not used for user-facing agent LLM calls
- remote/channel access should be reviewed before exposing an agent publicly
- secrets belong in `.env`, not in `agent.yml`, prompts, skills, or commits

Before adding powerful tools to an agent, verify:

- who can reach the agent
- what files it can read/write
- whether it can call shell commands
- which MCP tools it can access
- whether the session is personal, group, or channel-facing

## Project Layout

```text
.
├── agents/
│   └── example/                 # Example agent workspace
├── config.yml                   # Gateway/channel/runtime defaults
├── docs/                        # Public guide
├── Dockerfile                   # Multi-stage Linux server image
├── docker-compose.yml           # gateway + ui services
├── DOCKER.md                    # Linux server deployment guide
├── src/                         # Gateway, runtime, tools, channels, memory
│   ├── agent/
│   ├── channels/
│   ├── config/
│   ├── memory/
│   ├── metrics/
│   ├── sdk/
│   ├── security/
│   └── session/
├── test/                        # Backend test suite
├── ui/                          # Next.js control UI
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── __tests__/
├── package.json
└── pnpm-workspace.yaml
```

Runtime data is created under `data/` and intentionally ignored by Git.

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

- Keep Claude Agent SDK native behavior intact.
- Do not add alternate user-facing LLM providers.
- Do not hide SDK concepts behind generic abstractions when the SDK already provides the primitive.
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

The original SDK-native migration scope is complete. The next useful work is product hardening:

- deeper subagent steering UX
- richer observability dashboards beyond the current agent Runs tab and chat debug rail
- stricter reference policies
- more channel setup polish
- better deploy/fleet ergonomics
- more high-quality example agents and skills

## Inspiration and Compatibility

AnthroClaw is inspired by two projects:

- [OpenClaw](https://github.com/openclaw/openclaw), for the broader idea of a personal assistant gateway.
- Hermes-style agent infrastructure patterns, especially around operational discipline, memory, sessions, routing, and runtime visibility.

This repository is a separate implementation focused on a stricter Claude Agent SDK-native runtime and a smaller set of first-class channels.

The goal is not to support every provider and every surface. The goal is to make the Claude-native path excellent.

### Anthropic subscription usage

AnthroClaw is designed so user-facing LLM execution goes through the native Claude Agent SDK / Claude Code path, rather than a custom provider wrapper. That is intentional: it keeps the runtime aligned with Anthropic's native agent tooling and makes the project suitable for personal use with Anthropic subscription plans where that usage is allowed by Anthropic's current terms.

OpenAI is only used for optional memory embeddings, not for user-facing agent responses.

You should still review Anthropic's current plan terms for your own use case. AnthroClaw does not bypass login, hide usage, proxy other users through your account, or replace Claude Code with a disguised API client.

## License

AnthroClaw is released under the [MIT License](LICENSE).
