# AnthroClaw Control UI — Design Spec

## Overview

Web UI for managing the AnthroClaw agent platform. Two-tier architecture: a **Fleet orchestrator** that manages multiple AnthroClaw gateway servers across regions, and per-server management (agent CRUD, live chat testing, skill management, channel bindings, log viewing, gateway control).

## Architecture Decision

**Monolith + Fleet approach:** The local instance runs Next.js App Router with the Gateway as a singleton (for managing the local server). The Fleet layer proxies API calls to remote AnthroClaw instances via their REST APIs over HTTPS, authenticated with per-server API keys.

**Rationale:** Each AnthroClaw instance already exposes all necessary API routes. The orchestrator doesn't need a separate protocol — it just calls the same REST/SSE endpoints on remote servers. For the local instance, calls go directly to the Gateway singleton (zero-latency). For remote instances, they're proxied through `/api/fleet/{serverId}/...`.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router, RSC) |
| UI | React 19 |
| Styling | Tailwind CSS 4 |
| Components | shadcn/ui (dark theme only) |
| Language | TypeScript 5.x |
| Streaming | Server-Sent Events (SSE) |
| Auth | JWT in HttpOnly cookie |
| QR rendering | qrcode.react |
| Markdown | react-markdown + rehype-highlight |
| Virtualization | @tanstack/react-virtual (logs) |

## Frontend Prototype (Pixel-Perfect Reference)

A complete interactive prototype with all 16 screens lives at `reference-projects/frontend-prototype/`. Built with vanilla React + inline styles, it defines the exact visual design for every page, component, animation, and color value.

**The final Next.js UI must be pixel-perfect reproductions of these prototypes.** Specs describe behavior and data flow; prototypes define appearance. When implementing any page, always read the corresponding prototype component file first (`src/theme.jsx` for design tokens, `src/{page}.jsx` for the specific screen).

Key prototype files:
- `src/theme.jsx` — complete design token system (colors, typography, spacing, icons, primitives)
- `src/data.jsx` — mock data structures that define the shape of UI state
- `src/shell.jsx` — sidebar, page header, user menu
- `src/fleet.jsx` + `src/fleet-actions.jsx` + `src/fleet-detail.jsx` — fleet overview + commands/alerts/deploy

## Project Location

`ui/` directory at the repo root, separate `package.json`, references `../src` via tsconfig paths.

## Gateway Integration

Gateway initializes lazily on first API request as a module-level singleton (`ui/lib/gateway.ts`). All Route Handlers call `getGateway()` to access it. A `restartGateway()` function stops and re-creates the instance.

A new `dispatchWebUI()` method will be added to Gateway to handle chat messages from the web channel with streaming callbacks (onText, onToolCall, onToolResult, onDone, onError).

## Authentication

Single-user, credentials from `.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`). On first run, password is hashed and stored in `data/auth.json`. All subsequent auth checks read from `data/auth.json`.

JWT cookie (`session`, HttpOnly, 7-day expiry). Every API route calls `requireAuth()`. Dashboard layout middleware redirects to `/login` if unauthenticated.

Password change updates `data/auth.json`. Forgot-password sends reset token via SMTP (if configured) or falls back to CLI command `pnpm reset-password`.

## Pages

### Fleet (`/fleet`) — LANDING PAGE
Multi-server orchestrator. Grid of server cards showing health, metrics, alerts. Each card: status dot, name + city, environment/region tags, 4 key metrics (uptime, agents, live sessions, P50 latency), CPU/MEM/DISK bars, channel badges, version. Summary cards row: total gateways, agents, sessions, msgs/24h, tokens/24h, est. cost/24h. Filter by environment (Prod/Staging/Dev). Three view modes: Grid, List, Map. Fleet commands dialog (rolling restart, hot-reload, pull & redeploy, sync agents, backup, rotate keys, stop fleet). Deploy gateway wizard (7-step: identity, target host, networking, release, agents, policies, review). Alerts panel (critical/warning with ack/open actions, configurable rules).

### Login (`/login`)
Email + password form. Forgot password flow with email reset or CLI fallback. Reset password page at `/login/reset?token=xxx`.

### Dashboard (`/fleet/{serverId}/`)
Per-server overview: gateway uptime, agent count, active sessions, channel statuses. Agent list with quick-links to edit and test. Channel status indicators. Auto-refreshes every 10s. All data comes through fleet proxy or direct (for local).

### Agents List (`/agents`)
Table of agents showing name, model, routes, skills, queue mode. Create new agent (dialog: ID, model, template). Delete agent (with confirmation).

### Agent Editor (`/agents/[agentId]`)
Three tabs:

**Config tab:** Visual form for agent.yml fields (model, timezone, queue_mode, session_policy, routes table, pairing, iteration budget, MCP tools). Toggle to raw YAML editor. Save validates and writes agent.yml — Gateway auto-reloads.

**Files tab:** Split view — file list on one side, monospace text editor on the other. CRUD for .md files. CLAUDE.md is undeletable. Cmd+S to save.

**Skills tab:** List of installed skills with view/delete. Upload zone for zip/tarball/.skill archives. Git clone dialog (URL + optional branch). Backend validates SKILL.md presence.

### Chat (`/chat/[agentId]`)
Live agent testing through Claude Agent SDK. SSE streaming of responses. Agent selector dropdown. Tool calls rendered as collapsible cards inline. New session button. Channel context emulation (web/telegram/whatsapp, dm/group). Markdown rendering of agent responses. Auto-scroll with jump-to-bottom.

### Channels (`/channels`)
Telegram section: accounts with status, bound agents, route editor. WhatsApp section: accounts with status, bound agents, disconnect option.

WhatsApp pairing flow: select agent → generate QR (SSE stream from Baileys) → scan → auto-bind agent to new account. QR refreshes automatically.

### Logs (`/logs`)
Realtime pino log stream via SSE. Terminal-style monospace rendering. Filters: level (debug/info/warn/error), source (agent/component), text search. Pause/resume, clear, auto-scroll. Virtualized list (max 2000 entries).

### Settings (`/settings`)
Gateway controls (status, restart with confirmation). Global config.yml viewer/editor (sensitive values masked). Change password form. Account info display.

## API Routes

Full contracts documented in `docs/ui-specs/10-api-contracts.md`. Summary:

| Group | Routes |
|-------|--------|
| Auth | login, logout, password change, forgot, reset |
| Gateway | status, restart |
| Agents | list, create, get, update, delete |
| Agent Files | list, get, update, delete |
| Skills | list, get, upload, git clone, delete |
| Chat | send message (SSE), delete session |
| Channels | list, status, edit routes, WA pair (SSE), WA disconnect |
| Logs | stream (SSE) |
| Config | get (masked), update |

## Backend Changes Required

1. **Gateway singleton wrapper** (`ui/lib/gateway.ts`) — lazy init, restart support
2. **`gateway.dispatchWebUI()`** — new method for web channel chat with streaming callbacks
3. **Pino log capture** — custom pino transport or destination that buffers recent logs and streams to SSE subscribers
4. **WhatsApp pairing as library** — extract QR generation from CLI (`src/cli/whatsapp-pair.ts`) into a reusable function that yields QR events
5. **Auth module** (`ui/lib/auth.ts`) — JWT sign/verify, password hash/compare, `data/auth.json` management
6. **Config write** — function to safely update config.yml preserving comments and structure (or accept full YAML overwrite)
7. **Agent CRUD** — filesystem operations: create agent directory from template, delete agent directory, list agents by scanning `agents/` dir
8. **Skill install** — archive extraction (zip, tar.gz) with SKILL.md validation; git clone with depth=1
9. **Reset password CLI** (`src/cli/reset-password.ts`) — updates `data/auth.json` directly
10. **Metrics collector** (`src/metrics/collector.ts`) — counters, gauges, histograms for query duration, token usage, message counts. Exposed via `GET /api/metrics`.
11. **Fleet manager** (`ui/lib/fleet.ts`) — manages `data/fleet.json`, heartbeat polling, alert evaluation, API proxy to remote servers
12. **SSH deploy runner** (`ui/lib/deploy.ts`) — SSH connection to VPS, runs install script, configures systemd, reports progress via SSE
13. **Bearer token auth** — API routes accept both cookie (local UI) and `Authorization: Bearer` header (fleet orchestrator calling remote instances)
14. **System metrics** — CPU, memory, disk usage collection via `os` module + `fs.statSync` for disk

## Detailed Page Specs

All page-level functional specs are in `docs/ui-specs/`:

- `00-global.md` — stack, theme, data types, common patterns
- `01-login.md` — login, forgot/reset password
- `02-dashboard.md` — system overview
- `03-agents-list.md` — agent list + CRUD
- `04-agent-editor.md` — config, files, skills tabs
- `05-chat.md` — live chat testing
- `06-channels.md` — Telegram/WhatsApp + QR pairing
- `07-logs.md` — realtime log viewer
- `08-settings.md` — global settings, password, restart
- `09-components.md` — shared components
- `10-api-contracts.md` — complete API contracts (per-instance)
- `11-fleet.md` — fleet overview page
- `12-fleet-alerts.md` — alerts panel + rules
- `13-fleet-commands.md` — fleet-wide command dialog
- `14-deploy-wizard.md` — 7-step deploy gateway wizard
- `15-fleet-api.md` — fleet API contracts + metrics endpoint

## Out of Scope

- Light theme
- Multi-user / roles
- Skill hub / marketplace
- Mobile-first design (desktop primary, tablet functional)
- Agent memory viewer/editor
- Cron job management UI
- Cloud provider auto-provisioning (AWS/GCP/Hetzner) — SSH deploy only for MVP
- Docker deploy mode
