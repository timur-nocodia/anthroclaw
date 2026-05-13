# Docker deployment (Linux server)

Production deployment on a Linux VPS (Hetzner, Fly.io, OVH, self-hosted, etc.).
Local development on macOS does **not** use Docker — run `pnpm dev` directly.

## Architecture

Single container (`anthroclaw:local`) running Next.js, which **embeds**
the Gateway runtime in-process:

- UI served on `127.0.0.1:3000`
- Telegram + WhatsApp polling, MCP tools, sessions, cron — same process
- One Gateway instance, one source of truth for `/api/gateway/status`

This matches the local `pnpm ui` flow. Running a separate `pnpm dev`
process would create a second Gateway that competes for the same
Telegram bot token, so we don't.

Persistent state is mounted from host:

| Mount                       | Contents                                              |
|-----------------------------|-------------------------------------------------------|
| `./data:/app/data`          | SQLite memory DBs, WhatsApp auth, dynamic cron, media |
| `./data/claude:/home/node/.claude` | Claude Code subscription auth managed from the UI |
| `./agents:/app/agents`      | YAML configs, CLAUDE.md prompts, per-agent memory     |
| `./config.yml:/app/config.yml:ro` | Global gateway config                          |

## Prerequisites on the server

```bash
# Docker engine + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker
```

## Claude auth setup

Use the admin UI: **Settings → Claude subscription auth → Connect Claude
subscription**. The UI starts the official `claude auth login --claudeai`
flow inside the container, against the same `/home/node` runtime home that
agent turns use. Credentials persist in `./data/claude` across container
recreates.

This uses the existing Claude Max/Pro subscription through Claude Code auth;
it does not require `ANTHROPIC_API_KEY` and does not bill a separate Console
API key.

## Deploy

```bash
git clone <repo> anthroclaw && cd anthroclaw

cp .env.example .env
# Edit .env:
#   TELEGRAM_BOT_TOKEN=...
#   plus any optional providers you use

cp config.yml.example config.yml   # if not already present
mkdir -p data/claude agents
# Copy/clone your agent configs into ./agents/

docker compose up -d --build
docker compose logs -f app
```

## WhatsApp pairing (first run)

Baileys pairing is interactive (QR code in terminal). Run once:

```bash
docker compose run --rm app pnpm whatsapp:pair
```

Auth state lands in `./data/whatsapp-auth/` and is reused on subsequent
container restarts.

## UI access

UI binds to `127.0.0.1:3000` inside the container's host network namespace.
Put a reverse proxy in front for TLS + auth:

```nginx
# /etc/nginx/sites-enabled/anthroclaw
server {
    listen 443 ssl http2;
    server_name claw.example.com;
    ssl_certificate     /etc/letsencrypt/live/claw.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/claw.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Reset admin password if needed:

```bash
docker compose run --rm app pnpm reset-password
```

## Updating

```bash
git pull
docker compose up -d --build
```

Claude auth does not need re-issuing on ordinary app rebuilds because
`./data/claude` is persistent. If Claude reports authentication failures,
refresh it from the Settings auth panel.

## Troubleshooting

**`Failed to authenticate` / 401 from Claude** — open Settings → Claude
subscription auth, click **Verify**, then **Connect Claude subscription** if
the panel is not connected. The runtime home should be `/home/node`, and
credentials should show as present.

**`Error loading SQLite database`** — host UID/GID mismatch. The container
runs as uid 1000 (`node` user). Either run as that user on the host or
`sudo chown -R 1000:1000 data agents`.

**WhatsApp drops connection** — `data/whatsapp-auth/` lost or corrupted.
Re-run `docker compose run --rm app pnpm whatsapp:pair`.

**Image build fails on `better-sqlite3` / `bcrypt`** — the build stage needs
network for native compilation. If you're behind a corporate proxy, set
`HTTP_PROXY` / `HTTPS_PROXY` build args.

## Notes on auth methods

Recommended production path: keep `./data/claude:/home/node/.claude` mounted
and manage auth from the UI. This keeps credentials in the same runtime home
used by AnthroClaw, avoids root-shell auth drift, and survives Docker
recreates.

Alternative paths:

1. **`CLAUDE_CODE_OAUTH_TOKEN` env var** — useful for CI or immutable
   deployments, but do not pass it into agent tool environments.
2. **Host `~/.claude` bind mount** — acceptable when host Claude Code auth is
   intentionally the source of truth, but keep the mount pointed at
   `/home/node/.claude` and avoid logging in as root by accident.
3. **`ANTHROPIC_API_KEY`** — separate Console API billing, not the Claude
   subscription path.
