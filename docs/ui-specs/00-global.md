# AnthroClaw Control UI — Global Spec

## Stack

- Next.js 15 (App Router, Server Components by default)
- React 19
- Tailwind CSS 4
- shadcn/ui (latest, dark theme only)
- TypeScript 5.x

## Pixel-Perfect Prototype

A complete frontend prototype exists at `reference-projects/frontend-prototype/`. All 16 screens are fully implemented as interactive React components with inline styles.

**CRITICAL:** The final UI MUST be pixel-perfect reproductions of these prototypes. Every page in this spec has a corresponding prototype component. When implementing any page, the prototype is the authoritative visual reference — the spec describes behavior and data, the prototype defines appearance.

### Prototype → Spec Mapping

| Prototype File | Spec |
|----------------|------|
| `src/fleet.jsx` | `11-fleet.md` |
| `src/fleet-actions.jsx` (AlertsModal) | `12-fleet-alerts.md` |
| `src/fleet-actions.jsx` (BulkCommandModal) | `13-fleet-commands.md` |
| `src/fleet-actions.jsx` (DeployWizard) | `14-deploy-wizard.md` |
| `src/fleet-detail.jsx` | `11-fleet.md` (gateway detail panel) |
| `src/dashboard.jsx` | `02-dashboard.md` |
| `src/agents-list.jsx` | `03-agents-list.md` |
| `src/agent-editor.jsx` | `04-agent-editor.md` |
| `src/chat.jsx` | `05-chat.md` |
| `src/channels.jsx` | `06-channels.md` |
| `src/logs.jsx` | `07-logs.md` |
| `src/settings.jsx` | `08-settings.md` |
| `src/settings.jsx` (LoginPage) | `01-login.md` |
| `src/account.jsx` | (new — account/profile page) |
| `src/shell.jsx` | Sidebar + page header |
| `src/theme.jsx` | Design tokens + primitives |
| `src/data.jsx` | Mock data for all screens |

### Design Token System (from prototype)

**Background Scale (Cool)**
- `bg0`: `#0b0d12` (app background)
- `bg1`: `#0f121a` (panel/card)
- `bg2`: `#131722` (raised/hover)
- `bg3`: `#1a1f2e` (input focus)
- `bg4`: `#232a3b` (border-strong)

**Text**
- `text`: `#e7ebf3` (primary)
- `textDim`: `#9aa3b8` (secondary)
- `textMuted`: `#6b7389` (tertiary)
- `textFaint`: `#4d5467` (disabled)

**Borders**
- `border`: `#1e2330`
- `borderMid`: `#252b3b`
- `borderHi`: `#323a50`

**Semantic Colors**
- `green`: `#4ade80`, `greenDim`: `rgba(74,222,128,0.15)`
- `yellow`: `#fbbf24`, `yellowDim`: `rgba(251,191,36,0.15)`
- `red`: `#f87171`, `redDim`: `rgba(248,113,113,0.15)`
- `blue`: `#7c9cff`, `blueDim`: `rgba(124,156,255,0.15)`

**Accent (default: indigo)**
- `accent`: `#7c9cff`
- `accentDim`: `#4256a6`
- `accentSoft`: `rgba(124,156,255,0.12)`

**Channel Colors**
- Telegram: `#60a5fa`
- WhatsApp: `#34d399`

These tokens must be mapped to Tailwind CSS custom properties or shadcn theme variables. See `reference-projects/frontend-prototype/src/theme.jsx` for the complete token set.

## Theme

Dark theme only. No light mode, no toggle. Configure shadcn with dark as the sole theme.

Use the exact color palette from the prototype's design token system (above). Map prototype tokens to shadcn CSS variables in `globals.css`. All backgrounds, text colors, borders, and semantic colors must match the prototype pixel-for-pixel.

Typography: Inter for UI text, monospace for code/logs.

## Auth Context

Single-user app. One email+password stored server-side. JWT in HttpOnly cookie. Every page except `/login` requires auth — redirect to `/login` if no valid session.

## Navigation

The app has these top-level sections (order as listed):

1. **Fleet** — multi-server orchestrator (landing page)
2. **Dashboard** — single-server overview (contextual to selected server)
3. **Agents** — list → agent detail (config, files, skills)
4. **Chat** — test agent via live conversation
5. **Channels** — Telegram and WhatsApp management
5. **Logs** — realtime log stream
6. **Settings** — global config, password, restart

The navigation should show connection status for: Gateway, Telegram (per account), WhatsApp (per account). These are fetched from `GET /api/gateway/status`.

## Common Patterns

### API Fetching
- Use `fetch()` from Client Components to `/api/*` routes
- SSE (Server-Sent Events) for streaming: chat responses, logs, WhatsApp QR
- All API calls include credentials (cookies auto-sent)
- Show toast on error (shadcn Toast)

### Loading States
- Use shadcn Skeleton for initial page loads
- Inline spinners for button actions (save, delete, restart)
- Disable buttons during pending operations

### Confirmation
- Destructive actions (delete agent, delete skill, disconnect channel, restart gateway) require a confirmation dialog (shadcn AlertDialog)

### Empty States
- Every list view needs an empty state with a call-to-action
- Example: "No agents yet" + "Create your first agent" button

### Responsive
- Optimized for desktop (1280px+). Functional on tablet. Mobile is nice-to-have but not required.

## Data Types Reference

These are the shapes returned by API routes. Use them to inform what the UI needs to display.

```typescript
// GET /api/gateway/status
interface GatewayStatus {
  uptime: number; // seconds
  agents: string[]; // loaded agent IDs
  activeSessions: number;
  channels: {
    telegram: { accountId: string; botUsername: string; status: 'connected' | 'error' }[];
    whatsapp: { accountId: string; phone: string; status: 'connected' | 'disconnected' }[];
  };
}

// GET /api/agents
interface AgentSummary {
  id: string;
  model: string;
  routeCount: number;
  skillCount: number;
  sessionPolicy: string;
  queueMode: string;
}

// GET /api/agents/[agentId]
interface AgentConfig {
  id: string;
  raw: string; // raw YAML content
  parsed: {
    model: string;
    timezone: string;
    queue_mode: 'collect' | 'steer' | 'interrupt';
    session_policy: 'never' | 'hourly' | 'daily' | 'weekly';
    auto_compress: number;
    iteration_budget: { tool_call_limit: number; timeout_ms: number };
    pairing: { mode: 'off' | 'open' | 'code' | 'approve'; code?: string };
    routes: RouteEntry[];
    mcp_tools: string[];
  };
}

interface RouteEntry {
  channel: 'telegram' | 'whatsapp';
  account: string;
  scope: 'dm' | 'group' | 'any';
  peers: string[] | null;
  topics: string[] | null;
  mentionOnly: boolean;
}

// GET /api/agents/[agentId]/files
interface AgentFile {
  name: string; // e.g. "CLAUDE.md", "soul.md"
  size: number; // bytes
  updatedAt: string; // ISO date
}

// GET /api/agents/[agentId]/skills
interface SkillSummary {
  name: string;
  description: string;
  platforms: string[];
  tags: string[];
}

// SSE from POST /api/agents/[agentId]/chat
type ChatEvent =
  | { type: 'text'; chunk: string }
  | { type: 'tool_call'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; name: string; output: string }
  | { type: 'done'; sessionId: string; totalTokens: number }
  | { type: 'error'; message: string };

// SSE from GET /api/logs/stream
interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string; // "gateway", "telegram", "whatsapp", agent ID
  message: string;
  data?: Record<string, unknown>;
}

// SSE from POST /api/channels/whatsapp/pair
type PairEvent =
  | { type: 'qr'; code: string } // QR string for rendering
  | { type: 'status'; message: string } // "Connecting...", "Waiting for scan..."
  | { type: 'paired'; accountId: string; phone: string }
  | { type: 'error'; message: string };
```
