# Page: Fleet

## Route
`/fleet` (landing page when authenticated)

## Purpose
Control plane for all AnthroClaw gateway servers. Overview of the entire fleet with health, metrics, alerts, and quick actions.

## Data Sources
- `GET /api/fleet/servers` → list of registered servers with metadata
- `GET /api/fleet/status` → aggregated fleet status (polls each server's `/api/gateway/status` + `/api/metrics`)
- `GET /api/fleet/alerts` → active alerts across fleet

## Header

**Title row:**
- "Fleet" title
- Status summary badge: "{N} healthy · {N} degraded · {N} offline" with colored dot
- Alerts badge: "{N} alerts" (clickable → opens alerts panel)
- Action buttons: "Alerts (N)", "Fleet commands" (opens command dialog), "+ Deploy gateway" (opens deploy wizard)

**Description:**
"Control plane for all AnthroClaw gateway servers across your regions."

## Summary Cards Row

Six metric cards in a horizontal row:

| Card | Value | Subtitle |
|------|-------|----------|
| GATEWAYS | total count | "{N} healthy" |
| AGENTS | sum across fleet | "across fleet" |
| LIVE SESSIONS | sum across fleet | "now" |
| MSGS / 24H | sum across fleet | "inbound" |
| TOKENS / 24H | sum across fleet | "input + output" (formatted: 6.30M) |
| EST. COST / 24H | calculated from tokens | "at current pricing" (formatted: $54.82) |

Token pricing: use Anthropic's published pricing per model. Each server reports token counts per model.

## Filter Bar

**Environment tabs:** All (N), Prod, Staging, Dev — filters server cards. Count in parentheses.

**Quick actions:** "Sync heartbeats", "Backup all", "Sync agent..." — inline buttons that trigger fleet-wide operations on visible (filtered) servers.

**View modes:** Grid (default), List, Map — toggle button group.

## Server Cards (Grid View)

Each server renders as a card. Cards are sorted: unhealthy first, then by environment (prod > staging > dev), then alphabetically.

### Card Content

**Header:**
- Status dot (green = healthy, yellow = degraded, red = offline)
- Server name + city (e.g. "prod-eu · Helsinki")
- Tags: "primary" (cyan badge, optional), environment badge (production/staging/development)
- Hostname (e.g. "gw-prod-eu.anthroclaw.acme.internal")
- Region (e.g. "eu-north-1") — right-aligned

**Alert banner (conditional):**
- Shown only when server is degraded or has active warnings
- Yellow/amber background
- Warning icon + message (e.g. "disk 91% · p50 elevated", "socket timeout · last seen 14m ago")
- Multiple alerts joined with " · "

**Metrics row:**
Four key numbers in a row:
- UPTIME: formatted duration (3d 14h). "—" if offline.
- AGENTS: count of loaded agents
- LIVE: count of active sessions. Highlighted in accent color if > 10.
- P50: query latency in ms. Highlighted in red/warning if > 1000ms. "—" if offline.

**Resource bars:**
Three progress bars:
- CPU: percentage with color (green < 50%, yellow 50-80%, red > 80%)
- MEM: percentage with same color scheme
- DISK: percentage with same color scheme

**Footer:**
- Channel badges: "N TG | N WA" as small inline badges
- SSL warning badge: "SSL {N}d" in warning color if SSL expires within 14 days
- Version: "v1.8.2" or "v1.9.0-rc.3 dirty" (dirty in warning color)
- Navigate arrow ">" — clicking the card or arrow goes to `/fleet/{serverId}/`

### Card States

**Healthy (green dot):**
- Normal rendering, green left border accent

**Degraded (yellow dot):**
- Yellow left border accent
- Alert banner shown
- Elevated metrics highlighted (P50 in warning, bars in warning/red)

**Offline (red dot):**
- Red left border accent
- Alert banner: "socket timeout · last seen {time} ago"
- Metrics show "—" for dynamic values
- Bars show last known values or 0%
- Card slightly dimmed

### Card Click
Navigates to `/fleet/{serverId}/` — the full dashboard for that server (proxied through fleet API).

## List View

Table format with columns: Status, Name, Environment, Region, Uptime, Agents, Live, P50, CPU, MEM, Disk, Version. Sortable by any column. Same data as cards but denser.

## Map View

Geographic visualization of servers on a world map.
- Dots positioned by region (approximate lat/lng from region codes like eu-north-1, us-east-1, etc.)
- Dot color = status (green/yellow/red)
- Dot size = relative to agent count or session count
- Hover: shows tooltip with server name, status, key metrics
- Click: navigates to server dashboard

Implementation: lightweight — use a simple SVG world map or a minimal map library. Not a full GIS solution.

## Server Status Determination

Each server's status is determined by the orchestrator based on health checks:

| Status | Condition |
|--------|-----------|
| **healthy** | Responds to heartbeat, no critical alerts, all channels connected |
| **degraded** | Responds to heartbeat but has warnings: high CPU/MEM/disk, elevated P50, channel errors, SSL expiring |
| **offline** | No heartbeat response within 60 seconds |

## Heartbeat

The orchestrator polls each server every 30 seconds:
- `GET {server.url}/api/gateway/status` — basic health
- `GET {server.url}/api/metrics` — detailed metrics

If a server doesn't respond within 10 seconds, mark as offline.

## Empty State
"No gateways in fleet. Deploy your first AnthroClaw gateway." + "Deploy gateway" button.

## Auto-refresh
Fleet status refreshes every 30 seconds (aligned with heartbeat). Summary cards and server card metrics update in place without full page reload.
