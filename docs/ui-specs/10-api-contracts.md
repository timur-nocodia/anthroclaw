# API Contracts

Complete request/response contracts for all API routes. All routes are server-only Next.js Route Handlers.

All routes except `/api/auth/login`, `/api/auth/forgot`, `/api/auth/reset` require authentication (JWT in HttpOnly cookie). Unauthenticated requests return `401 { error: "unauthorized" }`.

---

## Auth

### POST /api/auth/login
```
Request:  { email: string, password: string, remember?: boolean }
Response: 200 { ok: true }  (sets HttpOnly cookie "session")
          401 { error: "invalid_credentials" }
          429 { error: "rate_limited", retryAfter: number }
```

### POST /api/auth/logout
```
Response: 200 { ok: true }  (clears cookie)
```

### PUT /api/auth/password
```
Request:  { currentPassword: string, newPassword: string }
Response: 200 { ok: true }
          400 { error: "password_too_short" }
          401 { error: "wrong_password" }
```

### POST /api/auth/forgot
```
Request:  { email: string }
Response: 200 { ok: true, method: "email" | "cli" }
```
Always returns 200 (no email enumeration). `method` tells UI what message to show.

### POST /api/auth/reset
```
Request:  { token: string, password: string }
Response: 200 { ok: true }
          400 { error: "invalid_token" | "expired_token" | "password_too_short" }
```

---

## Gateway

### GET /api/gateway/status
```
Response: 200 {
  uptime: number,
  agents: string[],
  activeSessions: number,
  nodeVersion: string,
  platform: string,
  channels: {
    telegram: [{ accountId, botUsername, status }],
    whatsapp: [{ accountId, phone, status }]
  }
}
```

### POST /api/gateway/restart
```
Response: 200 { ok: true, restartedAt: string }
          500 { error: "restart_failed", message: string }
```

---

## Agents

### GET /api/agents
```
Response: 200 AgentSummary[]
```

### POST /api/agents
```
Request:  { id: string, model?: string, template?: "blank" | "example" }
Response: 201 { id: string }
          400 { error: "invalid_id" | "already_exists" }
```

### GET /api/agents/[agentId]
```
Response: 200 AgentConfig
          404 { error: "not_found" }
```

### PUT /api/agents/[agentId]
```
Request:  { yaml: string }  (raw YAML content)
          OR { config: object }  (structured, server serializes to YAML)
Response: 200 { ok: true }
          400 { error: "invalid_yaml", message: string, line?: number }
          404 { error: "not_found" }
```

### DELETE /api/agents/[agentId]
```
Response: 200 { ok: true }
          404 { error: "not_found" }
```

---

## Agent Files

### GET /api/agents/[agentId]/files
```
Response: 200 AgentFile[]
```

### GET /api/agents/[agentId]/files/[filename]
```
Response: 200 { name: string, content: string, updatedAt: string }
          404 { error: "not_found" }
```

### PUT /api/agents/[agentId]/files/[filename]
```
Request:  { content: string }
Response: 200 { ok: true }
          404 { error: "agent_not_found" }
```
Creates file if it doesn't exist.

### DELETE /api/agents/[agentId]/files/[filename]
```
Response: 200 { ok: true }
          400 { error: "cannot_delete", message: "CLAUDE.md is required" }
          404 { error: "not_found" }
```

---

## Skills

### GET /api/agents/[agentId]/skills
```
Response: 200 SkillSummary[]
```

### GET /api/agents/[agentId]/skills/[skillName]
```
Response: 200 { name: string, content: string, frontmatter: object }
          404 { error: "not_found" }
```

### POST /api/agents/[agentId]/skills/upload
```
Request:  multipart/form-data { file: File, overwrite?: "true" }
Response: 200 { name: string, ok: true }
          400 { error: "no_skill_md" | "invalid_archive" | "already_exists" }
          413 { error: "file_too_large" }
```

### POST /api/agents/[agentId]/skills/git
```
Request:  { url: string, ref?: string, name?: string }
Response: 200 { name: string, ok: true }
          400 { error: "clone_failed", message: string }
          400 { error: "no_skill_md" }
```

### DELETE /api/agents/[agentId]/skills/[skillName]
```
Response: 200 { ok: true }
          404 { error: "not_found" }
```

---

## Channels

### GET /api/channels
```
Response: 200 {
  telegram: [{
    accountId: string,
    botUsername: string,
    status: string,
    routes: RouteEntry[]
  }],
  whatsapp: [{
    accountId: string,
    phone: string,
    status: string,
    routes: RouteEntry[]
  }]
}
```

### PUT /api/channels/telegram/[accountId]/routes
```
Request:  { routes: RouteEntry[] }
Response: 200 { ok: true }
          400 { error: "route_conflict", message: string }
```

### POST /api/channels/whatsapp/pair
```
Request:  { agentId: string }
Response: SSE stream of PairEvent
```

### DELETE /api/channels/whatsapp/[accountId]
```
Response: 200 { ok: true }
          404 { error: "not_found" }
```

---

## Chat

### POST /api/agents/[agentId]/chat
```
Request:  { message: string, sessionId?: string, context?: { channel: string, chatType: string } }
Response: SSE stream of ChatEvent
```

### DELETE /api/agents/[agentId]/chat/[sessionId]
```
Response: 200 { ok: true }
```

---

## Logs

### GET /api/logs/stream
```
Query:    ?level=info&source=gateway
Response: SSE stream of LogEntry
```

---

## Config

### GET /api/config
```
Response: 200 { raw: string, masked: true }
```
Sensitive values (tokens, passwords, API keys) are replaced with "****".

### PUT /api/config
```
Request:  { yaml: string }
Response: 200 { ok: true }
          400 { error: "invalid_yaml", message: string }
```
Server preserves masked values — only updates fields that changed.
