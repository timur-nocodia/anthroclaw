# Page: Channels

## Route
`/channels`

## Purpose
View and manage Telegram and WhatsApp channel connections. Bind agents to channels. Pair new WhatsApp accounts via QR code.

## Data Sources
- `GET /api/gateway/status` → channel statuses
- `GET /api/channels` → full channel config (accounts, routes)
- `GET /api/agents` → for agent selection in binding
- POST `/api/channels/whatsapp/pair` (SSE) → QR pairing stream
- PUT `/api/channels/telegram/{accountId}/routes` → update Telegram routes
- DELETE `/api/channels/whatsapp/{accountId}` → disconnect WhatsApp

## Content

### Telegram Section

For each Telegram account in config:

**Display:**
- Bot username (e.g. @mybot)
- Status: connected (green) / error (red) with error message if applicable
- Bound agents: list of agents with routes to this account, showing scope (DM/group/any)

**Actions:**
- **Edit Routes** — opens a dialog/inline editor:
  - Shows existing routes for this account (from all agents)
  - Can add new route: select agent, scope, peers, topics, mentionOnly
  - Can remove routes
  - Save: updates agent.yml files for affected agents
  - Gateway auto-reloads
- **Note:** Telegram bot tokens are configured in config.yml — not editable from UI (security). Show a hint: "Bot token is configured in config.yml"

### WhatsApp Section

For each WhatsApp account:

**Display:**
- Phone number
- Status: connected (green) / disconnected (red) / reconnecting (yellow)
- Bound agent name + scope
- Connection uptime

**Actions:**
- **Edit binding** — change which agent handles this account (select dropdown, save)
- **Disconnect** — confirmation dialog → DELETE `/api/channels/whatsapp/{accountId}`
  - Removes auth state, routes, and config entry
  - Warning: "This will disconnect the WhatsApp session. You'll need to re-pair."

### Pair New WhatsApp

Button: "Pair WhatsApp Account"

**Flow (opens as a page or large dialog):**

Step 1 — Select agent:
- Dropdown of available agents
- "This agent will handle all messages from the new WhatsApp account"
- Next button

Step 2 — QR Code:
- POST `/api/channels/whatsapp/pair` with `{ agentId }` — opens SSE stream
- SSE events:
  - `{ type: 'status', message }` — show as status text below QR (e.g. "Generating QR code...", "Waiting for scan...")
  - `{ type: 'qr', code }` — render QR code image using a QR library (e.g. `qrcode.react`)
  - QR refreshes every ~20 seconds (new `qr` event). Show countdown or "QR expires soon" indicator.
  - `{ type: 'paired', accountId, phone }` — success!
  - `{ type: 'error', message }` — show error, offer "Retry" button

- Display: large QR code centered, status text below, "Scan with WhatsApp on your phone" instruction
- Cancel button to abort pairing (closes SSE stream)

Step 3 — Success:
- Show: "Connected! Phone: +7900XXXXXXX"
- Confirm: "Agent '{name}' is now handling this WhatsApp account"
- "Done" button → navigate to `/channels`
- Backend has already updated config.yml with the new account + route

### Empty States
- No Telegram accounts: "No Telegram bots configured. Add a bot token to config.yml to get started."
- No WhatsApp accounts: "No WhatsApp accounts paired." + "Pair WhatsApp Account" button

## Route Editing Details

When editing routes (Telegram or WhatsApp), the form fields:

| Field | Type | Description |
|-------|------|-------------|
| Agent | select | Which agent handles matched messages |
| Scope | select | dm, group, any |
| Peers | text | Comma-separated user/chat IDs. Empty = all |
| Topics | text | Comma-separated forum topic IDs. Empty = all. Only for Telegram groups |
| Mention only | checkbox | Only respond to @mentions in groups |

Validation:
- One route per unique {account, scope, peer, topic} combination
- If conflict detected: show error "This route conflicts with agent '{x}'"
