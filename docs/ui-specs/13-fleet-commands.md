# Component: Fleet-wide Commands

## Trigger
Clicking "Fleet commands" button in Fleet header. Opens as a centered modal dialog.

## Header
- "Fleet-wide command" title
- "Choose an action to run across multiple gateways."
- Close button (X)

## Commands Grid

Seven command cards in a 2-column grid. Each card:
- Icon (colored, left side)
- Title (bold)
- Description (muted text, 1-2 lines)
- Clickable → opens command execution flow

### Command: Rolling Restart
- **Icon:** Refresh/rotate (cyan)
- **Title:** Rolling restart
- **Description:** Restart each gateway in series, draining sessions.
- **Flow:**
  1. Select gateways (checkboxes, pre-selected based on current filter)
  2. Confirm: "This will restart {N} gateways one at a time. Active sessions will be drained before each restart."
  3. Execute: SSE stream showing progress per server
  4. Each server: drain sessions (wait for active queries) → restart → wait for healthy → next
  5. Progress: "Restarting gw-prod-eu... ✓ done (12s)" per line
  6. Summary: "{N}/{N} restarted successfully"

### Command: Hot-reload Config
- **Icon:** Lightning bolt (yellow)
- **Title:** Hot-reload config
- **Description:** Re-read agent & channel config without downtime.
- **Flow:**
  1. Select gateways
  2. Confirm
  3. Execute: `POST {server.url}/api/gateway/reload` on each server (parallel)
  4. Progress per server

### Command: Pull & Redeploy
- **Icon:** Git pull (yellow/orange)
- **Title:** Pull & redeploy
- **Description:** git pull → build → restart across selected gateways.
- **Flow:**
  1. Select gateways
  2. Optional: specify branch/tag (default: current branch on each server)
  3. Confirm: "This will pull latest code and restart {N} gateways."
  4. Execute per server (serial, like rolling restart):
     - SSH → `cd /app && git pull`
     - SSH → `pnpm install && pnpm build`
     - SSH → `systemctl restart anthroclaw`
     - Wait for healthy
  5. Progress with detailed output per server

### Command: Sync All Agents
- **Icon:** Upload/sync (cyan)
- **Title:** Sync all agents
- **Description:** Push canonical agent versions to selected gateways.
- **Flow:**
  1. Select source gateway (where canonical agents live)
  2. Select target gateways
  3. Select which agents to sync (checkbox list from source)
  4. Confirm: "This will overwrite agents on {N} gateways with versions from {source}."
  5. Execute: for each target server, upload agent dirs via API (`PUT /api/agents/{id}/files/*`)
  6. Trigger hot-reload on each target
  7. Summary: agents synced, any conflicts

### Command: Backup Now
- **Icon:** Download (cyan)
- **Title:** Backup now
- **Description:** Trigger on-demand snapshots. Fans out in parallel.
- **Flow:**
  1. Select gateways
  2. Confirm
  3. Execute: `POST {server.url}/api/backup` on each server (parallel)
  4. Each server creates: tar.gz of agents/ + data/ (excluding media)
  5. Progress per server
  6. Download links when complete (or stored on server)

### Command: Rotate API Keys
- **Icon:** Key (orange/pink)
- **Title:** Rotate API keys
- **Description:** Rotate Anthropic + channel tokens across the fleet.
- **Flow:**
  1. Select what to rotate: Anthropic API key, TG bot tokens, WA sessions, JWT secrets
  2. Select gateways
  3. Input new values (or auto-generate for JWT)
  4. Confirm: "This will update keys on {N} gateways and restart them."
  5. Execute: update .env on each server via SSH → restart
  6. Verify each server comes back healthy

### Command: Stop Fleet
- **Icon:** Power off (red)
- **Title:** Stop fleet
- **Description:** Halt all selected gateways. Disconnects channels.
- **Flow:**
  1. Select gateways (all pre-selected)
  2. Confirm with prominent warning: "This will stop {N} gateways. All channels will disconnect. Are you sure?"
  3. Execute: `POST {server.url}/api/gateway/stop` on each (parallel)
  4. Progress per server
  5. Status updates to "offline" for each

## Execution Pattern

All commands follow the same execution UI:

1. **Select targets:** Checkbox list of gateways with status indicators
2. **Configure:** Command-specific options (if any)
3. **Confirm:** Summary of what will happen + confirmation button
4. **Execute:** Live progress view:
   - Server list with status per line
   - Spinner → checkmark (success) or X (failure)
   - Elapsed time per server
   - Log output expandable per server
5. **Summary:** Total success/failure count + "Close" button

If any server fails, the command continues for remaining servers (unless it's a serial operation like rolling restart, where failure stops the sequence with option to "Skip and continue" or "Abort").

## Cancel
"Cancel" button at dialog bottom — dismisses without action.
During execution: "Abort" button replaces cancel — stops remaining operations (already-completed ones are not rolled back).
