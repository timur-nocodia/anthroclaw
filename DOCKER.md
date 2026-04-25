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
| `./agents:/app/agents`      | YAML configs, CLAUDE.md prompts, per-agent memory     |
| `./config.yml:/app/config.yml:ro` | Global gateway config                          |

## Prerequisites on the server

```bash
# Node + Claude Code CLI (only needed once, to mint the OAuth token)
curl -fsSL https://nodejs.org/install.sh | bash   # or your preferred install
npm i -g @anthropic-ai/claude-code

# Docker engine + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker
```

## One-time auth setup

```bash
claude setup-token
# Opens a browser link → log in → paste callback → token printed.
# Long-lived (~1 year). Stored as sk-ant-oat01-...
```

This is the **official Anthropic headless auth path**. The Agent SDK reads
`CLAUDE_CODE_OAUTH_TOKEN` from env and uses your existing Claude
Max/Pro subscription — no separate API billing.

## Deploy

```bash
git clone <repo> anthroclaw && cd anthroclaw

cp .env.example .env
# Edit .env:
#   CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...   (from setup-token above)
#   TELEGRAM_BOT_TOKEN=...
#   plus any optional providers you use

cp config.yml.example config.yml   # if not already present
mkdir -p data agents
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

OAuth token does not need re-issuing. Refresh annually via `claude setup-token`
on the host.

## Troubleshooting

**`Error: ANTHROPIC_API_KEY not set`** — the SDK didn't see your OAuth token.
Check `docker compose exec app env | grep CLAUDE_CODE_OAUTH_TOKEN`. The
`.env` file must sit next to `docker-compose.yml`.

**`Error loading SQLite database`** — host UID/GID mismatch. The container
runs as uid 1000 (`node` user). Either run as that user on the host or
`sudo chown -R 1000:1000 data agents`.

**WhatsApp drops connection** — `data/whatsapp-auth/` lost or corrupted.
Re-run `docker compose run --rm app pnpm whatsapp:pair`.

**Image build fails on `better-sqlite3` / `bcrypt`** — the build stage needs
network for native compilation. If you're behind a corporate proxy, set
`HTTP_PROXY` / `HTTPS_PROXY` build args.

## Notes on auth methods

This setup uses the SDK-native `CLAUDE_CODE_OAUTH_TOKEN` path. Two
alternatives exist but aren't recommended for Docker:

1. **Bind-mount `~/.claude`** — works but requires the `claude` CLI inside
   the image to refresh the short-lived (~8h) session token, plus UID
   alignment. More moving parts.
2. **`ANTHROPIC_API_KEY`** — separate billing from your Claude
   subscription, no Opus access on Max plan tier.

`setup-token` is the path Anthropic ships for CI / GitHub Actions / Docker
and is read by the Agent SDK with no extra wiring.
