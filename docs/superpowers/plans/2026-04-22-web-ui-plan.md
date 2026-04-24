# AnthroClaw Control UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AnthroClaw Control UI — a Fleet orchestrator for managing multiple AnthroClaw gateway servers, plus per-server admin (agent CRUD, live chat, skills, channels, logs).

**Architecture:** Next.js 15 App Router monolith. Local Gateway runs as a singleton. Fleet layer proxies API calls to remote instances via HTTPS + Bearer tokens. SSH-based deploys. SSE for streaming (chat, logs, QR, fleet commands, deploy progress).

**Tech Stack:** Next.js 15, React 19, Tailwind CSS 4, shadcn/ui (dark only), TypeScript, jose (JWT), bcrypt, qrcode.react, react-markdown, @tanstack/react-virtual, ssh2

**Spec:** `docs/superpowers/specs/2026-04-22-web-ui-design.md`
**Page specs:** `docs/ui-specs/00-global.md` through `docs/ui-specs/15-fleet-api.md`
**Prototype (PIXEL-PERFECT reference):** `reference-projects/frontend-prototype/` — all 16 screens implemented. Every page must visually match the prototype exactly. Read `src/theme.jsx` for design tokens, `src/{page}.jsx` for each screen. Specs define behavior; prototype defines appearance.

---

## File Structure

```
ui/
├── package.json
├── next.config.ts
├── tsconfig.json
├── app/
│   ├── layout.tsx
│   ├── globals.css
│   ├── (auth)/login/
│   │   ├── page.tsx
│   │   └── reset/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx                              # Sidebar + auth guard
│   │   ├── page.tsx                                # Redirects to /fleet
│   │   ├── fleet/
│   │   │   └── page.tsx                            # Fleet overview (landing)
│   │   │   └── [serverId]/
│   │   │       ├── page.tsx                        # Server dashboard
│   │   │       ├── agents/
│   │   │       │   ├── page.tsx
│   │   │       │   └── [agentId]/page.tsx
│   │   │       ├── chat/[agentId]/page.tsx
│   │   │       ├── channels/
│   │   │       │   ├── page.tsx
│   │   │       │   └── whatsapp/pair/page.tsx
│   │   │       ├── logs/page.tsx
│   │   │       └── settings/page.tsx
│   │   ├── agents/page.tsx                         # Local shortcut → /fleet/local/agents
│   │   ├── chat/[agentId]/page.tsx                 # Local shortcut
│   │   ├── channels/page.tsx                       # Local shortcut
│   │   ├── logs/page.tsx                           # Local shortcut
│   │   └── settings/page.tsx                       # Local shortcut
│   └── api/
│       ├── auth/{login,logout,password,forgot,reset}/route.ts
│       ├── gateway/{status,restart}/route.ts
│       ├── metrics/route.ts                        # NEW: metrics endpoint
│       ├── agents/route.ts
│       ├── agents/[agentId]/route.ts
│       ├── agents/[agentId]/files/{route,[filename]/route}.ts
│       ├── agents/[agentId]/skills/{route,upload/route,git/route,[skillName]/route}.ts
│       ├── agents/[agentId]/chat/{route,[sessionId]/route}.ts
│       ├── channels/{route,telegram/[accountId]/routes/route}.ts
│       ├── channels/whatsapp/{pair/route,[accountId]/route}.ts
│       ├── logs/stream/route.ts
│       ├── config/route.ts
│       ├── fleet/
│       │   ├── servers/route.ts                    # NEW: fleet CRUD
│       │   ├── servers/[serverId]/route.ts
│       │   ├── status/route.ts                     # NEW: aggregated status
│       │   ├── alerts/route.ts                     # NEW: alerts
│       │   ├── alerts/[alertId]/ack/route.ts
│       │   ├── alert-rules/route.ts
│       │   ├── commands/execute/route.ts           # NEW: fleet commands SSE
│       │   ├── deploy/route.ts                     # NEW: deploy SSE
│       │   ├── deploy/dry-run/route.ts
│       │   └── [serverId]/[...path]/route.ts       # NEW: proxy
├── lib/
│   ├── gateway.ts
│   ├── auth.ts
│   ├── require-auth.ts
│   ├── sse.ts
│   ├── agents.ts
│   ├── skills.ts
│   ├── log-buffer.ts
│   ├── fleet.ts                                    # NEW: fleet manager
│   ├── fleet-alerts.ts                             # NEW: alert engine
│   ├── fleet-proxy.ts                              # NEW: API proxy
│   └── deploy.ts                                   # NEW: SSH deploy runner
└── components/
    ├── ui/                                         # shadcn
    ├── sidebar.tsx
    ├── status-indicator.tsx
    ├── server-card.tsx                             # NEW: fleet card
    ├── resource-bar.tsx                            # NEW: CPU/MEM/DISK bar
    └── deploy-wizard/                              # NEW: wizard steps
        ├── step-identity.tsx
        ├── step-target.tsx
        ├── step-networking.tsx
        ├── step-release.tsx
        ├── step-agents.tsx
        ├── step-policies.tsx
        └── step-review.tsx

src/
├── metrics/collector.ts                            # NEW: counters, gauges, histograms
├── web/pair-whatsapp.ts                            # NEW: extracted QR pairing
├── cli/reset-password.ts                           # NEW: CLI tool
├── gateway.ts                                      # MODIFIED: getStatus, dispatchWebUI, metrics hooks
├── logger.ts                                       # MODIFIED: log subscriber
├── agent/agent.ts                                  # MODIFIED: getSessionCount
```

---

## Phase 1: Foundation (Tasks 1-4)

### Task 1: Next.js Project Scaffolding

**Files:** Create `ui/` directory with package.json, next.config.ts, tsconfig.json, globals.css, postcss.config.mjs, layout.tsx, placeholder pages.

- [ ] Create `ui/package.json` with deps: next 15, react 19, jose, bcrypt, ssh2, yaml, qrcode.react, react-markdown, rehype-highlight, @tanstack/react-virtual
- [ ] Create `ui/next.config.ts` with `serverExternalPackages`: better-sqlite3, pino, @whiskeysockets/baileys, grammy, @anthropic-ai/claude-agent-sdk, ssh2
- [ ] Create `ui/tsconfig.json` with paths: `@/*` → `./*`, `@backend/*` → `../src/*`
- [ ] Create `ui/app/globals.css` with `@import "tailwindcss"`
- [ ] Create `ui/postcss.config.mjs`
- [ ] Create `ui/app/layout.tsx` — dark html class, bg-background, antialiased
- [ ] Create placeholder pages: login, dashboard, fleet
- [ ] Run `cd ui && pnpm install && npx shadcn@latest init` — dark theme only
- [ ] Install shadcn components: button, input, label, card, toast, alert-dialog, badge, collapsible, dialog, dropdown-menu, scroll-area, select, separator, skeleton, tabs, textarea, sonner, progress, sheet, table, tooltip
- [ ] Verify `pnpm dev` starts on localhost:3000
- [ ] Commit: `feat(ui): scaffold Next.js 15 project with Tailwind + shadcn`

### Task 2: Auth Module + Login API + Bearer Token Support

**Files:** Create `ui/lib/auth.ts`, `ui/lib/require-auth.ts`, auth API routes, `src/cli/reset-password.ts`

- [ ] Create `ui/lib/auth.ts` — manages `data/auth.json`: initAuth(), verifyCredentials(), createSessionToken(), verifySessionToken(), changePassword(), createResetToken(), resetPassword(), getAdminEmail(), generateApiKey(). Uses jose for JWT, bcrypt for hashing.
- [ ] Create `ui/lib/require-auth.ts` — `requireAuth()` checks BOTH HttpOnly cookie `session` AND `Authorization: Bearer {token}` header. Cookie for browser UI, Bearer for fleet-to-fleet API calls. Returns `{ email, authMethod: 'cookie' | 'bearer' }`.
- [ ] Create `ui/app/api/auth/login/route.ts` — POST, validates credentials, sets cookie
- [ ] Create `ui/app/api/auth/logout/route.ts` — POST, clears cookie
- [ ] Create `ui/app/api/auth/password/route.ts` — PUT, change password
- [ ] Create `ui/app/api/auth/forgot/route.ts` — POST, create reset token, SMTP or CLI fallback
- [ ] Create `ui/app/api/auth/reset/route.ts` — POST, validate token, update password
- [ ] Create `src/cli/reset-password.ts` — interactive CLI, updates data/auth.json directly
- [ ] Add `"reset-password": "tsx src/cli/reset-password.ts"` to root package.json
- [ ] Commit: `feat(ui): auth module with cookie + bearer token support`

### Task 3: Metrics Collector + Gateway Public Methods

**Files:** Create `src/metrics/collector.ts`, modify `src/gateway.ts`, `src/agent/agent.ts`, `src/logger.ts`

- [ ] Create `src/metrics/collector.ts`:

```typescript
class MetricsCollector {
  private counters = new Map<string, number>();
  private queryDurations: number[] = [];
  private tokenCounts = { input: 0, output: 0, byModel: new Map() };
  private startedAt = Date.now();

  increment(name: string, value?: number): void
  recordQueryDuration(ms: number): void
  recordTokens(model: string, input: number, output: number): void
  snapshot(): MetricsSnapshot
  getSystemMetrics(): { cpu_percent, mem_percent, mem_rss_bytes, disk_percent, disk_used_bytes, disk_total_bytes, node_version, platform, git_version, git_dirty, ssl_expiry_days }
}
export const metrics = new MetricsCollector();
```

System metrics: `process.cpuUsage()` for CPU (calculate % over interval), `process.memoryUsage().rss` for memory, `execSync('df -k /')` for disk, `execSync('git describe --tags --dirty')` for git version.

- [ ] Modify `src/gateway.ts`:
  - Add `getStatus()` public method (uptime, agents, sessions, channels)
  - Add `getAgent(id)`, `getAgentList()`, `getGlobalConfig()`, `getAgentsDir()`, `getDataDir()` accessors
  - Add `dispatchWebUI(agentId, message, sessionId, context, callbacks)` — streaming chat for web UI
  - Instrument `dispatch()`: `metrics.increment('messages_received')`, `metrics.recordQueryDuration()`, `metrics.recordTokens()`
  - Instrument `queryAgent()`: wrap SDK call with duration tracking
  - Add `getAccountInfo()` to TelegramChannel and WhatsAppChannel
- [ ] Modify `src/agent/agent.ts`: add `getSessionCount()`, `getSessionIdByValue()`
- [ ] Modify `src/logger.ts`: add `logEmitter` EventEmitter, custom write stream that emits parsed JSON logs
- [ ] Commit: `feat: metrics collector + gateway public methods for web UI`

### Task 4: Gateway Singleton + Core API Routes

**Files:** Create `ui/lib/gateway.ts`, `ui/lib/sse.ts`, `ui/lib/agents.ts`, `ui/lib/skills.ts`, `ui/lib/log-buffer.ts`, all per-instance API routes

- [ ] Create `ui/lib/gateway.ts` — lazy singleton, `getGateway()`, `restartGateway()`, resolves config/agents/data paths relative to `..`
- [ ] Create `ui/lib/sse.ts` — `createSSEStream(handler)` helper
- [ ] Create `ui/lib/agents.ts` — filesystem CRUD: listAgents, getAgentConfig, updateAgentConfig, createAgent, deleteAgent, listAgentFiles, getAgentFile, writeAgentFile, deleteAgentFile. NotFoundError, ValidationError classes.
- [ ] Create `ui/lib/skills.ts` — listSkills, getSkill, deleteSkill, installSkillFromArchive (zip/tar.gz/.skill extraction + SKILL.md validation), installSkillFromGit (git clone --depth 1)
- [ ] Create `ui/lib/log-buffer.ts` — subscribeToLogs(callback, filter) using logEmitter
- [ ] Create API routes:
  - `api/gateway/status/route.ts` — GET
  - `api/gateway/restart/route.ts` — POST
  - `api/metrics/route.ts` — GET, returns metrics.snapshot() + metrics.getSystemMetrics()
  - `api/agents/route.ts` — GET list, POST create
  - `api/agents/[agentId]/route.ts` — GET, PUT, DELETE
  - `api/agents/[agentId]/files/route.ts` — GET list
  - `api/agents/[agentId]/files/[filename]/route.ts` — GET, PUT, DELETE
  - `api/agents/[agentId]/skills/route.ts` — GET list
  - `api/agents/[agentId]/skills/upload/route.ts` — POST multipart
  - `api/agents/[agentId]/skills/git/route.ts` — POST
  - `api/agents/[agentId]/skills/[skillName]/route.ts` — GET, DELETE
  - `api/agents/[agentId]/chat/route.ts` — POST SSE
  - `api/agents/[agentId]/chat/[sessionId]/route.ts` — DELETE
  - `api/channels/route.ts` — GET
  - `api/channels/telegram/[accountId]/routes/route.ts` — PUT
  - `api/channels/whatsapp/pair/route.ts` — POST SSE
  - `api/channels/whatsapp/[accountId]/route.ts` — DELETE
  - `api/logs/stream/route.ts` — GET SSE
  - `api/config/route.ts` — GET (masked), PUT
- [ ] Create `src/web/pair-whatsapp.ts` — async generator yielding PairEvent (extracted from CLI)
- [ ] Commit: `feat(ui): all per-instance API routes`

---

## Phase 2: Fleet Backend (Tasks 5-7)

### Task 5: Fleet Manager + Config

**Files:** Create `ui/lib/fleet.ts`, `ui/app/api/fleet/servers/route.ts`, `ui/app/api/fleet/servers/[serverId]/route.ts`, `ui/app/api/fleet/status/route.ts`

- [ ] Create `ui/lib/fleet.ts`:

```typescript
const FLEET_FILE = resolve(process.cwd(), '..', 'data', 'fleet.json');

interface FleetServer {
  id: string; name: string; city?: string;
  environment: 'production' | 'staging' | 'development';
  region: string; tags: string[]; url: string; apiKey: string;
  primary?: boolean; ssh?: { host, port, user, keyEncrypted };
  release?: { version, repo, upgradePolicy };
  policies?: { backup, monitoring, logRetention, maxMediaGB };
  deployedAt?: string; deployedBy?: string;
}

export function loadFleet(): FleetServer[]
export function saveFleet(servers: FleetServer[]): void
export function addServer(server: FleetServer): void
export function removeServer(id: string): void
export function updateServer(id: string, patch: Partial<FleetServer>): void
export function getServer(id: string): FleetServer | undefined

// Auto-register local instance on first load
export function ensureLocalServer(): FleetServer
```

Auto-registers local instance with `id: 'local'`, `url: 'http://localhost:3000'`, `apiKey: 'self'` if not present.

- [ ] Create `ui/app/api/fleet/servers/route.ts` — GET list, POST add server
- [ ] Create `ui/app/api/fleet/servers/[serverId]/route.ts` — GET, PUT, DELETE
- [ ] Create fleet status aggregator in `ui/lib/fleet.ts`:

```typescript
export async function fetchFleetStatus(): Promise<FleetStatus> {
  const servers = loadFleet();
  const results = await Promise.allSettled(
    servers.map(async s => {
      if (s.apiKey === 'self') {
        const gw = await getGateway();
        return { id: s.id, status: gw.getStatus(), metrics: metrics.snapshot() };
      }
      const [statusRes, metricsRes] = await Promise.allSettled([
        fetch(`${s.url}/api/gateway/status`, { headers: { Authorization: `Bearer ${s.apiKey}` }, signal: AbortSignal.timeout(10000) }),
        fetch(`${s.url}/api/metrics`, { headers: { Authorization: `Bearer ${s.apiKey}` }, signal: AbortSignal.timeout(10000) }),
      ]);
      // Parse responses, determine healthy/degraded/offline
    })
  );
  // Aggregate summary: total gateways, agents, sessions, msgs/24h, tokens/24h, est cost
}
```

- [ ] Create `ui/app/api/fleet/status/route.ts` — GET, calls fetchFleetStatus()
- [ ] Commit: `feat(ui): fleet manager + status aggregation`

### Task 6: Fleet Alerts Engine

**Files:** Create `ui/lib/fleet-alerts.ts`, alert API routes

- [ ] Create `ui/lib/fleet-alerts.ts`:

```typescript
const ALERTS_FILE = resolve(process.cwd(), '..', 'data', 'fleet-alerts.json');

export function evaluateAlerts(serverStatuses: FleetServerStatus[]): void
// Runs after each heartbeat. Checks thresholds from alert rules.
// Creates new alerts, auto-resolves cleared conditions.

export function getAlerts(filter?: { status: 'open' | 'acknowledged' | 'all' }): FleetAlert[]
export function acknowledgeAlert(alertId: string): void
export function getAlertRules(): AlertRules
export function updateAlertRules(patch: Partial<AlertRules>): void
```

Built-in rules: server_offline (>60s), high_cpu (>80% for 5min), high_memory (>80%), high_disk (>90%), elevated_p50 (>1000ms), ssl_expiring (<14 days), channel_disconnected (>5min).

- [ ] Create `ui/app/api/fleet/alerts/route.ts` — GET with ?status filter
- [ ] Create `ui/app/api/fleet/alerts/[alertId]/ack/route.ts` — PUT
- [ ] Create `ui/app/api/fleet/alert-rules/route.ts` — GET, PUT
- [ ] Wire alert evaluation into status polling: after fetchFleetStatus(), call evaluateAlerts()
- [ ] Commit: `feat(ui): fleet alert engine with configurable rules`

### Task 7: Fleet Proxy + Commands + Deploy

**Files:** Create `ui/lib/fleet-proxy.ts`, `ui/lib/deploy.ts`, command/deploy/proxy API routes

- [ ] Create `ui/lib/fleet-proxy.ts`:

```typescript
export async function proxyRequest(serverId: string, path: string, init: RequestInit): Promise<Response> {
  const server = getServer(serverId);
  if (!server) throw new NotFoundError('server');
  if (server.apiKey === 'self') {
    // Local: rewrite to local API call
    return fetch(`http://localhost:3000/api/${path}`, init);
  }
  return fetch(`${server.url}/api/${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${server.apiKey}` },
  });
}
```

- [ ] Create `ui/app/api/fleet/[serverId]/[...path]/route.ts` — catch-all proxy for GET, POST, PUT, DELETE. SSE passthrough for streaming endpoints.
- [ ] Create `ui/app/api/fleet/commands/execute/route.ts` — POST, SSE stream. Implements: rolling_restart (serial with drain), hot_reload (parallel), pull_redeploy (serial SSH), sync_agents (parallel file copy), backup (parallel), rotate_keys (serial SSH), stop_fleet (parallel).

For SSH-based commands (pull_redeploy, rotate_keys, stop_fleet):
```typescript
import { Client } from 'ssh2';
function sshExec(server: FleetServer, command: string): Promise<string>
```

- [ ] Create `ui/lib/deploy.ts`:

```typescript
export async function* deployGateway(config: DeployConfig): AsyncGenerator<DeployEvent> {
  yield { type: 'step', index: 1, total: 8, label: 'Connecting via SSH', status: 'running' };
  await sshConnect(config.target);
  yield { type: 'step', index: 1, total: 8, label: 'Connecting via SSH', status: 'done', elapsed: 2 };

  yield { type: 'step', index: 2, total: 8, label: 'Installing Node.js 22', status: 'running' };
  await sshExec('curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs');
  // ... steps 3-8: pnpm, git clone, pnpm install, configure .env + config.yml, systemd + caddy, start + verify

  yield { type: 'done', url: `https://${config.networking.domain}`, credentials: { email, note: 'see .env' } };
}
```

- [ ] Create `ui/app/api/fleet/deploy/route.ts` — POST, SSE stream from deployGateway() generator
- [ ] Create `ui/app/api/fleet/deploy/dry-run/route.ts` — POST, runs pre-flight checks (SSH connectivity, disk, Node.js, port, DNS)
- [ ] Add `ssh2` to ui/package.json dependencies
- [ ] Commit: `feat(ui): fleet proxy, commands, and SSH deploy`

---

## Phase 3: UI Pages (Tasks 8-13)

### Task 8: Login Page

**Files:** Create/update `ui/app/(auth)/login/page.tsx`, `ui/app/(auth)/login/reset/page.tsx`

- [ ] Implement login page per spec `docs/ui-specs/01-login.md`: email input, password input, submit, error display, forgot password inline form
- [ ] Implement reset page: token from URL, new password + confirm, validation
- [ ] Commit: `feat(ui): login and password reset pages`

### Task 9: Sidebar + Dashboard Layout

**Files:** Create `ui/components/sidebar.tsx`, `ui/components/status-indicator.tsx`, update layouts

- [ ] Create `ui/components/status-indicator.tsx` — colored dot by status
- [ ] Create `ui/components/sidebar.tsx` per spec:
  - Navigation: Fleet, Dashboard, Agents, Chat, Channels, Logs, Settings
  - Fleet nav item is top-level, others are contextual to current server
  - CONNECTIONS section at bottom: aggregated channel status across fleet (or current server)
  - User info at very bottom
- [ ] Update `ui/app/(dashboard)/layout.tsx` — auth guard (cookie check), sidebar, Toaster
- [ ] Create `ui/app/(dashboard)/page.tsx` — redirect to `/fleet`
- [ ] Commit: `feat(ui): sidebar with fleet navigation + dashboard layout`

### Task 10: Fleet Page

**Files:** Create `ui/app/(dashboard)/fleet/page.tsx`, `ui/components/server-card.tsx`, `ui/components/resource-bar.tsx`

- [ ] Create `ui/components/resource-bar.tsx` — progress bar with color thresholds (green < 50%, yellow 50-80%, red > 80%), label (CPU/MEM/DISK), percentage text
- [ ] Create `ui/components/server-card.tsx` per spec `docs/ui-specs/11-fleet.md`:
  - Status dot + name + city
  - Environment/region tags
  - Alert banner (conditional)
  - Metrics row: uptime, agents, live, P50
  - Three resource bars: CPU, MEM, DISK
  - Footer: channel badges, SSL warning, version, navigate arrow
  - Card click → `/fleet/{serverId}/`
- [ ] Create `ui/app/(dashboard)/fleet/page.tsx`:
  - Header: title, status badge, alerts badge, "Fleet commands" button, "+ Deploy gateway" button
  - Summary cards row: 6 metric cards (gateways, agents, sessions, msgs/24h, tokens/24h, est cost/24h)
  - Filter tabs: All, Prod, Staging, Dev
  - Quick actions: Sync heartbeats, Backup all, Sync agent...
  - View toggle: Grid (default), List, Map
  - Grid view: server cards in 2-column grid
  - List view: table with sortable columns
  - Map view: SVG world map with positioned dots (use region→coords lookup)
  - Auto-refresh every 30s via polling
  - Empty state
- [ ] Commit: `feat(ui): fleet overview page with server cards and summary metrics`

### Task 11: Fleet Alerts Panel + Commands Dialog + Deploy Wizard

**Files:** Create alert panel, commands dialog, deploy wizard components and pages

- [ ] Create alerts panel (Sheet/slide-over) per spec `docs/ui-specs/12-fleet-alerts.md`:
  - Open/Acknowledged/All tabs
  - Alert cards with severity badges, messages, ack/open actions
  - Alert rules link → inline config form
- [ ] Create fleet commands dialog per spec `docs/ui-specs/13-fleet-commands.md`:
  - 7 command cards in grid
  - Click → target selection → confirm → SSE execution progress
  - Per-server progress lines with spinner/checkmark
  - Summary on completion
- [ ] Create deploy wizard per spec `docs/ui-specs/14-deploy-wizard.md`:
  - Full-screen modal with 7-step stepper
  - Step components: `deploy-wizard/step-identity.tsx` through `step-review.tsx`
  - Step 2: SSH "Test connection" button
  - Step 7: dry-run checks + Deploy button
  - Deploy execution: live SSE progress with 8 steps
  - Success screen with URL + credentials
- [ ] Commit: `feat(ui): fleet alerts, commands, and deploy wizard`

### Task 12: Per-Server Pages (Dashboard through Settings)

**Files:** Create all pages under `ui/app/(dashboard)/fleet/[serverId]/`

All these pages fetch data through the fleet proxy: `/api/fleet/{serverId}/agents` etc. For local server, the proxy calls local API directly.

- [ ] Create `ui/app/(dashboard)/fleet/[serverId]/page.tsx` — server dashboard per spec `docs/ui-specs/02-dashboard.md`. Shows gateway status, agent list, channel status for this specific server.
- [ ] Create `ui/app/(dashboard)/fleet/[serverId]/agents/page.tsx` — agents list per spec `docs/ui-specs/03-agents-list.md`. Table, create dialog, delete confirmation.
- [ ] Create `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx` — agent editor per spec `docs/ui-specs/04-agent-editor.md`. Config/Files/Skills tabs.
- [ ] Create `ui/app/(dashboard)/fleet/[serverId]/chat/[agentId]/page.tsx` — chat per spec `docs/ui-specs/05-chat.md`. SSE streaming, tool cards, markdown rendering.
- [ ] Create `ui/app/(dashboard)/fleet/[serverId]/channels/page.tsx` — channels per spec `docs/ui-specs/06-channels.md`. TG/WA status, route editing.
- [ ] Create `ui/app/(dashboard)/fleet/[serverId]/channels/whatsapp/pair/page.tsx` — QR pairing flow.
- [ ] Create `ui/app/(dashboard)/fleet/[serverId]/logs/page.tsx` — logs per spec `docs/ui-specs/07-logs.md`. SSE stream, filters, virtual list.
- [ ] Create `ui/app/(dashboard)/fleet/[serverId]/settings/page.tsx` — settings per spec `docs/ui-specs/08-settings.md`. Config viewer, password change, restart.
- [ ] Create local shortcut pages (`/agents`, `/chat`, `/channels`, `/logs`, `/settings`) that redirect to `/fleet/local/...`
- [ ] Commit: `feat(ui): all per-server pages — dashboard, agents, chat, channels, logs, settings`

### Task 13: Integration Testing + Polish

- [ ] Start dev server: `cd ui && pnpm dev`
- [ ] Test auth flow: login → dashboard → logout → redirect to login
- [ ] Test Fleet page: shows local server card, summary metrics
- [ ] Test Agent CRUD: create → edit config → edit files → add skill → delete
- [ ] Test Chat: send message → see streaming response → tool calls → new session
- [ ] Test Channels: view status, WA QR pairing flow
- [ ] Test Logs: streaming, level filter, pause/resume
- [ ] Test Settings: view config, change password, restart gateway
- [ ] Test Fleet commands: hot-reload on local server
- [ ] Fix SSE streaming issues (Next.js buffering, headers)
- [ ] Fix any `serverExternalPackages` issues with native modules
- [ ] Add `"ui": "cd ui && pnpm dev"` and `"ui:build": "cd ui && pnpm build"` to root package.json
- [ ] Commit: `feat(ui): integration testing and polish`

---

## Task Summary

| # | Task | Phase | Key Deliverables |
|---|------|-------|------------------|
| 1 | Next.js scaffolding | Foundation | Project setup, shadcn, dark theme |
| 2 | Auth module | Foundation | JWT cookies + Bearer tokens, login/logout/password/reset |
| 3 | Metrics collector | Foundation | Counters, histograms, system metrics, gateway methods |
| 4 | Core API routes | Foundation | All per-instance REST + SSE endpoints |
| 5 | Fleet manager | Fleet Backend | fleet.json, server CRUD, status aggregation |
| 6 | Fleet alerts | Fleet Backend | Alert engine, rules, ack/resolve lifecycle |
| 7 | Fleet proxy + commands + deploy | Fleet Backend | API proxy, 7 fleet commands, SSH deploy runner |
| 8 | Login page | UI | Login form, forgot/reset password |
| 9 | Sidebar + layout | UI | Navigation, status indicators, auth guard |
| 10 | Fleet page | UI | Server cards, summary metrics, Grid/List/Map, filters |
| 11 | Alerts + commands + deploy wizard | UI | Alert panel, command dialog, 7-step deploy wizard |
| 12 | Per-server pages | UI | Dashboard, agents, chat, channels, logs, settings |
| 13 | Integration testing | Polish | E2E verification, fixes |

**Dependencies:** 1 → 2 → 3 → 4 → 5 → 6 → 7 (backend chain). 8, 9 can start after 2. 10, 11 need 5-7. 12 needs 4, 9.
