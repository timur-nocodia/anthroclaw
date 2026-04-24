# Page: Settings

## Route
`/settings`

## Purpose
Global platform configuration, password management, and gateway controls.

## Sections

### Gateway Controls

**Status display:**
- Uptime: formatted duration
- Loaded agents count
- Active sessions count
- Node.js version, platform

**Restart button:**
- "Restart Gateway" — prominent, with warning color
- Confirmation dialog: "This will restart the gateway. Active sessions will be interrupted. Continue?"
- POST `/api/gateway/restart`
- During restart: show spinner + "Restarting..." status
- After restart: show "Gateway restarted successfully" toast
- If restart fails: show error with details

### Global Config (config.yml)

Read-only view of the current config.yml with these sections highlighted:
- Telegram accounts (bot usernames, webhook settings)
- WhatsApp accounts
- Defaults (model, embedding provider, debounce_ms)
- Rate limiting settings

**Raw edit mode:**
- Toggle to show full config.yml in an editable textarea
- Save: PUT `/api/config` — validates YAML, writes to config.yml
- Warning banner: "Editing config.yml directly. Invalid changes may break the system."
- Gateway auto-reloads on config change

**Sensitive fields:** bot tokens and API keys are masked (shown as `****`). Only revealed on explicit click "Show". Not included in the PUT payload if unchanged (server preserves original values).

### Change Password

Form:
- Current password (required)
- New password (min 8 chars)
- Confirm new password (must match)
- Save button

PUT `/api/auth/password` with `{ currentPassword, newPassword }`
- On success: toast "Password updated". Session remains valid.
- On wrong current password: inline error
- On validation error: inline error per field

### Account Info
- Display current admin email (from config, read-only)
- "The admin email is configured server-side and cannot be changed from the UI"

## Data Sources
- `GET /api/gateway/status` → uptime, counts
- `GET /api/config` → config.yml content (masked secrets)
- PUT `/api/config` → update config.yml
- PUT `/api/auth/password` → change password
- POST `/api/gateway/restart` → restart
