# Component: Deploy Gateway Wizard

## Trigger
Clicking "+ Deploy gateway" button in Fleet header. Opens as a full-screen overlay/modal.

## Header
- Icon (deploy/rocket, green/cyan)
- "Deploy gateway" title
- "Provision a new AnthroClaw gateway and join it to this fleet."
- Current gateway name preview (top right, updates as you type)
- "X Cancel" button (top right)

## Wizard Steps

7-step horizontal stepper. Steps are numbered circles with labels below. Active step is highlighted (cyan). Completed steps show checkmark. Future steps are dimmed.

Steps: 1. Identity → 2. Target host → 3. Networking → 4. Release → 5. Agents → 6. Policies → 7. Review

Navigation: "Back" and "Next" buttons at bottom. "Next" validates current step before advancing. Step 7 has "Deploy" instead of "Next".

---

### Step 1: Identity

**Fields:**

**GATEWAY NAME** (text input, required)
- Placeholder: "gw-prod-jp"
- Helper: "Used as hostname & slug. Must be unique within the fleet."
- Validation: lowercase alphanumeric + hyphens, 3-40 chars, unique across fleet
- Auto-prefixed to hostname: `{name}.anthroclaw.{domain}`

**ENVIRONMENT** (toggle button group, required)
- Options: Production | Staging | Development
- Default: Production
- Affects: default policies, alert thresholds, visual badge on Fleet page

**REGION** (text input, required)
- Placeholder: "ap-northeast-1"
- Helper: "Primarily informational — used for map, sorting, and latency routing hints."
- Optional dropdown with common regions (us-east-1, eu-west-1, etc.)

**CITY** (text input, optional)
- Placeholder: "Tokyo"
- Helper: "Displayed alongside server name in fleet overview."

**TAGS** (multi-input/chips, optional)
- Free-form tags like "primary", "canary", "gpu"
- Displayed as badges on fleet cards

---

### Step 2: Target Host

**Fields:**

**HOST TYPE** (radio buttons)
- SSH (direct) — connect via SSH to an existing VPS
- Docker — deploy as Docker container (future, disabled for MVP)
- Cloud provider — AWS/GCP/Hetzner provisioning (future, disabled for MVP)

**SSH configuration (shown when SSH selected):**

**HOST** (text input, required)
- IP address or hostname
- Validation: valid IP or FQDN

**PORT** (number input)
- Default: 22

**USER** (text input, required)
- Default: "root"
- Helper: "Must have sudo access"

**AUTH METHOD** (radio)
- SSH key (paste or upload)
- Password (text input, not recommended)

**SSH KEY** (textarea, shown when key selected)
- Paste private key content
- Or: file upload button for .pem/.key file
- Helper: "This key is stored encrypted and used only for deployments."

**TEST CONNECTION** button
- Attempts SSH connection
- Shows: "Connected as root@203.0.113.1 (Ubuntu 24.04, 4 cores, 8GB RAM, 160GB disk)"
- Or error: "Connection failed: Permission denied"

---

### Step 3: Networking

**Fields:**

**PUBLIC DOMAIN** (text input, optional)
- Placeholder: "gw-prod-jp.internal.example"
- Helper: "If set, Caddy will be configured with automatic TLS."
- If empty: gateway accessible only via IP:port

**HTTP PORT** (number input)
- Default: 3000
- Helper: "Internal port for the Next.js server"

**INBOUND PORTS** (checklist)
- 443 (HTTPS) — enabled by default if domain is set
- 80 (HTTP → redirect to HTTPS) — enabled if domain is set
- 3000 (direct, for dev) — enabled for development environment
- Helper: "Firewall rules will be configured via ufw"

**WEBHOOK MODE** (select, for Telegram)
- Long polling (default) — no public URL needed
- Webhook — requires public domain + TLS
- Helper: "Webhook mode is recommended for production. Long polling is simpler for dev."

---

### Step 4: Release

**Fields:**

**VERSION** (select + custom input)
- Latest stable (default) — fetches latest tag from git
- Latest RC — latest release candidate
- Specific version — text input for tag (e.g. "v1.8.2")
- Specific branch — text input (e.g. "main", "feat/fleet")
- Current fleet majority — matches most common version in fleet

**GIT REPOSITORY** (text input)
- Default: "https://github.com/{org}/anthroclaw.git"
- Override for private forks

**UPGRADE POLICY** (select)
- Manual — only update via fleet commands
- Auto-minor — auto-update on minor releases (1.8.x → 1.9.x)
- Auto-patch — auto-update on patch releases only (1.8.2 → 1.8.3)
- Auto-latest — always track latest (for dev/staging)
- Helper: "Auto-updates run at 3am server local time"

---

### Step 5: Agents

**Fields:**

**AGENT SOURCE** (radio)
- Blank — start with no agents, configure later
- From template — select a source gateway, copy its agents
- From git — clone agents from a git repository

**When "From template" selected:**
- Source gateway dropdown (list of fleet servers)
- Agent checklist — select which agents to copy
- Shows: agent name, model, route count, skill count

**When "From git" selected:**
- Git URL for agents directory
- Branch/tag

**CHANNEL TOKENS** (shown for copied agents that have routes)
- For each Telegram bot referenced: input field for bot token
- Helper: "Agents reference specific bot accounts. Provide tokens for bots that should run on this gateway."
- For WhatsApp: "WhatsApp accounts must be paired after deployment"

---

### Step 6: Policies

**Fields:**

**BACKUP SCHEDULE** (select)
- Disabled
- Daily at 3am (default for production)
- Weekly on Sunday
- Custom cron expression

**BACKUP DESTINATION** (text input, shown when backup enabled)
- Local (default) — stored on server
- S3-compatible URL — "s3://bucket/path"
- Helper: "Requires AWS credentials in .env"

**MONITORING** (checklist)
- Enable heartbeat monitoring (default: on) — fleet checks every 30s
- Enable alert notifications (default: on)
- Notification channel: Telegram chat ID or email (input)

**LOG RETENTION** (select)
- 7 days (default)
- 30 days
- 90 days
- Unlimited
- Helper: "Applies to pino log files, not agent memory"

**MAX MEDIA STORAGE** (number input + unit)
- Default: 5 GB
- Helper: "Auto-cleanup oldest media files when limit reached"

---

### Step 7: Review

Full summary of all configuration in a read-only view:

**Identity:** gw-prod-jp · Production · ap-northeast-1 · Tokyo

**Target:** root@203.0.113.1:22 (SSH key)

**Networking:** gw-prod-jp.internal.example · HTTPS (Caddy) · Webhook mode

**Release:** v1.8.2 · Manual upgrades

**Agents:** 3 agents from gw-prod-eu (example, support, ops)

**Policies:** Daily backup (local) · Monitoring on · 30d log retention · 5GB media limit

**Dry-run output:**
Before deploying, system runs a dry-run check:
- SSH connectivity ✓
- Disk space available ✓ (42GB free)
- Node.js 22 available ✓ (or will be installed)
- Port 3000 available ✓
- Domain DNS resolves ✓ (or ✗ if misconfigured)

Each check shows ✓ or ✗ with details.

**"Deploy" button** — starts deployment.

## Deployment Execution

After clicking Deploy, the wizard transitions to a live progress view:

```
Deploying gw-prod-jp...

[1/8] Connecting via SSH                          ✓  2s
[2/8] Installing Node.js 22                       ✓  45s
[3/8] Installing pnpm                             ✓  8s
[4/8] Cloning repository (v1.8.2)                 ✓  12s
[5/8] Installing dependencies                     ✓  38s
[6/8] Configuring .env and config.yml             ✓  1s
[7/8] Setting up systemd service + Caddy          ✓  5s
[8/8] Starting gateway and verifying health       ✓  15s

✓ Gateway deployed successfully!
  URL: https://gw-prod-jp.internal.example
  Admin: deployment-configured admin account / (password in .env)

[Open gateway]  [Back to Fleet]
```

Each step shows a spinner while in progress. On failure: shows error, offers "Retry step" or "Abort deployment" options. Already-completed steps are not rolled back (cleanup is manual or via "Destroy" command later).

## Config Storage

Deployed server config saved to `data/fleet.json`:
```json
{
  "servers": [
    {
      "id": "gw-prod-jp",
      "name": "gw-prod-jp",
      "city": "Tokyo",
      "environment": "production",
      "region": "ap-northeast-1",
      "tags": [],
      "url": "https://gw-prod-jp.internal.example",
      "apiKey": "fleet-generated-token",
      "ssh": {
        "host": "203.0.113.1",
        "port": 22,
        "user": "root",
        "keyEncrypted": "..."
      },
      "release": {
        "version": "v1.8.2",
        "repo": "https://github.com/example/anthroclaw.git",
        "upgradePolicy": "manual"
      },
      "policies": {
        "backup": { "schedule": "0 3 * * *", "destination": "local" },
        "monitoring": true,
        "logRetention": "30d",
        "maxMediaGB": 5
      },
      "deployedAt": "2026-04-22T12:00:00Z",
      "deployedBy": "deployment-configured admin"
    }
  ]
}
```
