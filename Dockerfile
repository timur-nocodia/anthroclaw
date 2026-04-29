# syntax=docker/dockerfile:1.7

# Multi-stage build: compile TS gateway + Next.js UI in build stage,
# copy artifacts into a slim runtime image.
# Targets Linux server deployment (amd64/arm64).

ARG NODE_IMAGE=node:22-bookworm-slim

# ── Stage 1: build ─────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Native deps (better-sqlite3, bcrypt) need build toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY ui/package.json ./ui/
# Plugin workspace package.jsons are needed before `pnpm install` so the
# workspace resolver registers them — without this, `pnpm --filter
# "@anthroclaw/plugin-*" build` matches nothing and the UI's runtime imports
# of `plugins/lcm/dist/*` 404 at next build time.
COPY plugins/lcm/package.json ./plugins/lcm/
COPY plugins/__example/package.json ./plugins/__example/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# The Claude Agent SDK ships per-arch native binaries (linux-x64/arm64 in
# both glibc and musl flavors). pnpm installs both variants; when the SDK
# loader picks the musl one on a glibc base image (bookworm-slim), the binary
# silently fails to exec and the SDK reports "binary not found". Removing the
# musl copy forces the loader onto glibc and saves ~230MB.
RUN rm -rf /app/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-linux-*-musl@*

COPY tsconfig.json ./
COPY src ./src
COPY ui ./ui
COPY plugins ./plugins

# Local dev uses ui/.env.local symlinked to ../.env. The image doesn't
# bake secrets, but Next.js expects the file to exist during build.
RUN : > ui/.env.local

RUN pnpm build && pnpm ui:build

# ── Stage 2: runtime ───────────────────────────────────────────
# We don't run `pnpm prune --prod` because it nukes workspace child
# node_modules in pnpm workspaces (ui/node_modules ends up empty), and
# Next.js needs typescript at runtime to load next.config.ts. Skipping
# prune costs ~150MB but keeps the workspace structure intact.
FROM ${NODE_IMAGE}
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tini curl \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Common Python deps used by agent helper scripts (Google APIs, HTTP, sheets).
# Agent /scripts/*.py can `import` these without each agent shipping its own venv.
# --break-system-packages: Debian's PEP 668 guard — fine inside an isolated container image.
RUN pip3 install --no-cache-dir --break-system-packages \
    google-auth==2.* \
    google-api-python-client==2.* \
    requests==2.*

ENV NODE_ENV=production \
    HOME=/home/node

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/ui/package.json ./ui/package.json
COPY --from=build --chown=node:node /app/ui/node_modules ./ui/node_modules
COPY --from=build --chown=node:node /app/ui/.next ./ui/.next
COPY --from=build --chown=node:node /app/ui/public ./ui/public
COPY --from=build --chown=node:node /app/ui/next.config.ts ./ui/next.config.ts
COPY --from=build --chown=node:node /app/ui/tsconfig.json ./ui/tsconfig.json
# Plugin runtime artifacts: package.json, manifest, dist (compiled JS), skills,
# and per-plugin node_modules (workspace symlinks live here).
COPY --from=build --chown=node:node /app/plugins ./plugins

# Persistent state mount points (overridden by compose volumes).
# Only chown the directories we just created — the COPY --from=build above
# already set node:node on everything else. A recursive chown over /app
# walks the entire 1.3 GB tree and adds ~5 minutes to every build.
RUN mkdir -p /app/data /app/agents && chown node:node /app/data /app/agents

USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
