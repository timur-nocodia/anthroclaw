# OpenClaw Agent SDK Edition

Lightweight multi-agent AI assistant framework built on [Anthropic Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk). Telegram + WhatsApp channels.

## Features

- **Agent-as-folder** — each agent = directory with `agent.yml` + `CLAUDE.md` + skills + memory
- **Multi-agent routing** — priority-based routing with topic-specific agents
- **Access control** — allowlist, pairing (code/approve/open), per-agent isolation
- **Memory system** — daily files, wiki, hybrid search (FTS5 + vector), auto-consolidation (dreaming)
- **Skills** — SDK-native `.claude/skills/*/SKILL.md` with compatibility discovery for legacy `skills/*/SKILL.md`
- **MCP tools** — memory_search, session_search, memory_write, send_message, send_media, access_control, list_skills, manage_skills, web_search
- **Cron scheduler** — 5-field cron with channel delivery
- **Telegram commands** — /start, /newsession (auto-summary), /skills, /pending, /whoami
- **Queue modes** — collect (debounce), steer (interrupt + restart), interrupt (cancel)
- **Hooks** — webhook/script hooks on lifecycle events (message, query, session reset, cron)
- **Rate limiting** — sliding window with lockout, allowlist bypass, persistent state
- **Session pruning** — LRU eviction + hourly cleanup
- **Session reset policies** — auto-reset hourly/daily/weekly with summary saved to memory
- **Auto context compression** — auto-newsession when message count exceeds threshold
- **Iteration budget** — limit tool calls and query duration, grace message on budget exceeded
- **Memory context fencing** — `<memory-context>` tags prevent prompt injection from recalled memory
- **Tool output pruning** — truncated search results with snippet limits
- **YAML frontmatter in skills** — metadata, platform filtering, tags, descriptions in SKILL.md
- **Agent self-scheduling** — create/list/delete/toggle cron jobs from chat via `manage_cron` tool
- **Background memory prefetch** — async pre-fetch relevant memory after each response
- **Hot reload** — agent config changes detected automatically, no restart needed
- **Subagents** — delegate tasks to other agents via SDK
- **Media enrichment** — audio transcription (AssemblyAI), PDF text extraction

## Quick Start

```bash
# Install
pnpm install

# Configure
cp .env.example .env
# Edit .env with your tokens

# Edit config.yml and agents/example/agent.yml

# Run
npx tsx src/index.ts
```

## Requirements

- Node.js >= 22
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) authenticated (SDK uses OAuth)
- Telegram bot token (from [@BotFather](https://t.me/BotFather))

## Project Structure

```
project/
├── config.yml              # Global config (channels, defaults, rate limits)
├── .env                    # Secrets (tokens, API keys)
├── agents/                 # Agents (each = folder)
│   └── example/
│       ├── agent.yml       # Agent config (routes, pairing, tools, cron, hooks)
│       ├── CLAUDE.md       # System prompt (@include support)
│       ├── soul.md         # Persona file
│       ├── .claude/
│       │   └── skills/
│       │       └── example-skill/
│       │           └── SKILL.md
│       └── memory/         # Agent memory (daily files, wiki)
├── data/                   # Runtime data (auto-created)
│   ├── access.json         # Approved/pending users
│   ├── skill-catalog/      # Instance-wide skill source of truth
│   ├── memory-db/          # SQLite FTS5 databases
│   └── media/              # Downloaded media
└── src/                    # Source code
```

## Agent Configuration

### agent.yml

```yaml
model: claude-sonnet-4-6
timezone: UTC

routes:
  - channel: telegram
    scope: dm                    # dm | group | any
    peers: ["TELEGRAM_USER_ID"]  # optional: specific users
    topics: ["123"]              # optional: forum thread IDs
    mention_only: false          # group-only: respond only to @mentions

pairing:
  mode: code                     # off | code | approve | open
  code: "SECRET_CODE"

allowlist:
  telegram: ["YOUR_ID"]

mcp_tools:
  - memory_search
  - session_search
  - memory_write
  - send_message
  - list_skills
  - manage_skills

queue_mode: collect              # collect | steer | interrupt

session_policy: never            # never | hourly | daily | weekly

auto_compress:
  enabled: true
  threshold_messages: 30         # auto-reset after N exchanges

iteration_budget:
  max_tool_calls: 30             # max tool_use events per query
  timeout_ms: 120000             # max query duration
  grace_message: true            # notify when budget exceeded

hooks:
  - event: on_after_query
    action: webhook
    url: "https://example.com/hook"

subagents:
  allow: ["other-agent"]

maxSessions: 100

cron:
  - id: daily-check
    schedule: "0 9 * * *"
    prompt: "Daily check."
    deliver_to:
      channel: telegram
      peer_id: "YOUR_ID"
    enabled: true
```

### MCP Tools

| Tool | Purpose |
|------|---------|
| `memory_search` | Hybrid search (FTS5 + vector) |
| `session_search` | Search prior SDK session transcripts |
| `memory_write` | Write to daily file + index |
| `memory_wiki` | CRUD for wiki pages |
| `send_message` | Send text to any channel |
| `send_media` | Send files (image, video, document) |
| `access_control` | Manage user access |
| `list_skills` | Thin compatibility/admin view over workspace skills |
| `manage_skills` | Safely create/update/read/remove `.claude/skills/*/SKILL.md` |
| `web_search_brave` | Brave web search |
| `web_search_exa` | Exa neural search |
| `manage_cron` | Create/list/delete/toggle cron jobs from chat |

### Hook Events

| Event | When |
|-------|------|
| `on_message_received` | After routing, before query |
| `on_before_query` | Before Claude SDK call |
| `on_after_query` | After response |
| `on_session_reset` | On /newsession |
| `on_cron_fire` | When cron job fires |
| `on_tool_use` | SDK tool invocation starts |
| `on_tool_result` | SDK tool invocation completes |
| `on_tool_error` | SDK tool invocation fails |
| `on_permission_request` | SDK requests approval |
| `on_sdk_notification` | SDK emits notification |
| `on_subagent_start` | SDK subagent run starts |
| `on_subagent_stop` | SDK subagent run stops |

## Development

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Type check
npx tsc --noEmit

# Dev with auto-restart
npx tsx watch src/index.ts
```

## Full Guide

See [docs/guide.md](docs/guide.md) for the complete user guide.

## License

MIT
