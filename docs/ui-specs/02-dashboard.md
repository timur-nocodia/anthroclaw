# Page: Dashboard

## Route
`/`

## Purpose
At-a-glance overview of the entire system. The first thing the user sees after login.

## Data Sources
- `GET /api/gateway/status` — uptime, agent list, session count, channel statuses
- `GET /api/agents` — agent summaries

## Content Blocks

### System Health
- Gateway uptime (formatted: "3d 14h 22m")
- Active sessions count
- Restart button (with confirmation dialog → POST `/api/gateway/restart`)

### Agents Summary
- Count of loaded agents
- For each agent: name, model, route count, skill count
- Each agent is clickable → navigates to `/agents/{id}`
- Quick action: "Test" button → navigates to `/chat/{id}`

### Channel Status
- Telegram accounts: bot username + status indicator (green dot = connected, red = error)
- WhatsApp accounts: phone number + status indicator
- "Pair WhatsApp" shortcut button → navigates to `/channels/whatsapp/pair`

### Recent Activity (optional, low priority)
- Last 5 log entries (from `/api/logs/stream`, close after receiving 5)
- Clickable → navigates to `/logs`

## Refresh
- Auto-refresh gateway status every 10 seconds (polling)
- Manual refresh button

## Empty States
- No agents: "No agents configured" + "Create an agent" CTA
- No channels: "No channels connected" + "Set up a channel" CTA
