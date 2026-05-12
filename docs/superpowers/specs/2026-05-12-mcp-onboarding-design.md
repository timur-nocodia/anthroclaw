# MCP Onboarding — Design

**Date:** 2026-05-12
**Status:** Draft for review
**Owner:** TBD
**Tracking PR:** TBD

## Problem

Adding a remote MCP server to an AnthroClaw agent today requires a non-technical user to fill four raw fields (`Transport`, `URL`, `Headers`, `Allowed tools`), supply an `Authorization=Bearer …` token they obtained out of band, and then see a red **BLOCKED** badge that says "MCP server is not recognized as an AnthroClaw-managed server." The flow is not usable by a "normie":

- The user has no way to authorize a server that uses OAuth — there is no redirect dance, just a header field expecting an already-obtained token.
- The hardcoded `Calendar` / `Gmail` preset buttons inject `npx`-driven stdio configs that demand `GOOGLE_REFRESH_TOKEN` etc. to be pasted manually, which is identical UX-failure mode in different clothes.
- The `BLOCKED` badge fires for every external HTTP/SSE server because preflight only marks `in-process` or `anthroclaw-local-node` packages as managed. There is no notion of "managed by virtue of credential lifecycle controlled by AnthroClaw."
- The encrypted credential store (`EncryptedFilesystemCredentialStore`) is present in the codebase but not wired into MCP loading. A source comment notes: "v0.9.0 layers the agent-driven OAuth chat flow on top of this interface — that work intentionally stays out of v0.8.0." This spec executes that v0.9.0 follow-up.
- There is no agent-facing tool for connecting an MCP from a chat conversation. The user explicitly wants both surfaces: "и в админке кнопочно, и в чате с агентом, форвардит auth-ссылку если надо."

## Goals

1. A normie can onboard an OAuth-protected remote MCP server (e.g. `https://mcp.postmypost.io/mcp`) from the admin panel with three clicks: paste URL → click **Authorize** → click **Save**.
2. The same flow is invokable from chat: the agent receives a URL, forwards a one-shot auth link to the user, and confirms in chat when authorization completes.
3. Servers that do not implement MCP OAuth discovery (RFC 9728 / RFC 8414) but accept a static Bearer token are onboardable via a paste-token step — but the token is captured through a one-shot link, not pasted into chat history.
4. The `BLOCKED` badge stops firing for servers whose credentials are managed by AnthroClaw.
5. Authentication tokens are stored in the existing `EncryptedFilesystemCredentialStore` with refresh-on-expiry handled by the gateway before each agent run.
6. The legacy raw-fields editor remains accessible under an `Advanced` disclosure for stdio MCPs, custom-header use cases, and power users.

## Non-Goals

- Replacing the credential store implementation. (We extend it with two new credential kinds; we do not redesign storage.)
- Building a "known services registry" with curated logos/scopes/hints. (Possible follow-up; not in this PR.)
- Supporting OAuth flows on AnthroClaw instances with no public HTTPS URL (e.g. dev-only `localhost` deployments). The OAuth callback requires the configured `ui_base_url` to be reachable from the OAuth provider. Local-only support can be added later via a copy-paste-code fallback ("device flow style").
- Auto-retry of failed tool calls after a runtime 401. The user is surfaced a re-auth banner; retries are explicit.

## High-Level Solution

A new module `src/integrations/mcp-onboarding/` implements three operations:

1. **Probe.** Open a connection to the URL, parse the MCP server's auth advertisement, and return a structured discriminated union (`{ authMode: 'none' | 'oauth' | 'apikey' | 'manual', … }`).
2. **Connect.** Run either an OAuth 2.1 client (RFC 6749 + 7591 Dynamic Client Registration + PKCE) or an API-key paste flow. State for in-flight connections lives in a new SQLite database `data/mcp.sqlite` keyed by cryptographically random `pendingId` and `state` tokens with a 10-minute TTL.
3. **Finalize.** On success, write the obtained credential to the encrypted credential store under a stable key (`mcp:<serverId>`), call `tools/list` against the server, and write a record to `agent.yml` referencing the credential by `credential_ref` instead of raw headers.

Both surfaces (admin panel wizard and in-chat tool) call the same fasade. Admin-initiated pendings redirect the user back to the wizard upon callback. Chat-initiated pendings deliver a synthetic `[system] mcp_connected: …` message into the originating agent session, so the agent can respond naturally in the conversation.

## Architecture

### New module: `src/integrations/mcp-onboarding/`

| File | Role |
|------|------|
| `index.ts` | Public facade: `startConnection(url, requester)`, `completeOAuth(state, code)`, `attachApiKey(pendingId, token)`, `finalize(pendingId, allowedTools)`, `cancel(pendingId)`. |
| `probe.ts` | Issues MCP `initialize` POST to the URL, classifies the response, returns `ProbeResult`. |
| `oauth-client.ts` | Implements RFC 7591 Dynamic Client Registration, RFC 8414 Authorization Server Metadata fetch, PKCE generation, authorization-URL construction, code-for-token exchange, refresh. |
| `pending-store.ts` | SQLite-backed CRUD over `mcp_pending_connections`. Atomic `consumeByState()` returns rowcount so callers detect replay/expired states. |
| `cleanup.ts` | Internal cron callback that sweeps expired pending rows (marks `expired` → emits synthetic message if chat-initiated → deletes row on next pass). |

### Modified files

| Path | Change |
|------|--------|
| `src/config/schema.ts` | Add optional `display_name` and `credential_ref` to `http` and `sse` variants of `ExternalMcpServerSchema`. Add `.refine()` blocking the conflict `credential_ref` + `headers.Authorization`. |
| `src/agent/credentials/index.ts` | Add `McpOAuthCredential` and `McpApiKeyCredential` interfaces; extend the discriminated union accepted by `set()`/`get()`. |
| `src/sdk/external-mcp.ts` | New helper `resolveExternalMcpHeaders(spec, credentialStore, { agentId })` that materializes `credential_ref` into a fresh `Authorization` header, refreshing the token if expiry is within 5 minutes. |
| `src/gateway.ts` | Call `resolveExternalMcpHeaders` at MCP wire-up; install cleanup cron for `mcp_pending_connections`; subscribe to credential-store refresh events to dispatch synthetic `[system] mcp_reauth_required` messages. |
| `src/integrations/mcp-preflight.ts` | New decision rule: `credential_ref` resolvable → `approved` with `source: 'anthroclaw-managed-credential'`. |
| `src/agent/tools/connect-mcp.ts` | New built-in MCP tool registered in `src/agent/tools/index.ts`; operations `connect | apikey | finalize | check | cancel`. |
| `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx` | Replace inline "External MCP servers" section (~520 lines) with `<McpServersSection />`. |
| `ui/components/mcp/` | New directory with `McpServersSection.tsx`, `McpServerCard.tsx`, `AddMcpWizard.tsx`, `ReauthBanner.tsx`, `McpServerAdvancedEditor.tsx`. |
| `ui/app/api/mcp/` | New route files: `probe/route.ts`, `connect/start/route.ts`, `connect/apikey/route.ts`, `connect/finalize/route.ts`, `oauth/start/[pendingId]/route.ts`, `oauth/callback/route.ts`. |

### Persistence

**New SQLite DB: `data/mcp.sqlite`**

```sql
CREATE TABLE mcp_pending_connections (
  id              TEXT PRIMARY KEY,         -- pendingId, 32-byte base64url
  state           TEXT UNIQUE NOT NULL,     -- OAuth state token, 32-byte base64url
  agent_id        TEXT NOT NULL,
  agent_session_key TEXT,                   -- for chat-initiated; null otherwise
  mcp_url         TEXT NOT NULL,
  auth_mode       TEXT NOT NULL,            -- 'oauth' | 'apikey'
  code_verifier   TEXT,                     -- PKCE (oauth only)
  client_id       TEXT,                     -- DCR-registered client
  client_secret   TEXT,                     -- encrypted-at-rest if present
  metadata_json   TEXT,                     -- discovered AS metadata
  requested_by    TEXT NOT NULL,            -- 'admin:<userId>' | 'agent:<sessionKey>'
  status          TEXT NOT NULL DEFAULT 'pending',
                                            -- pending | exchanging | completed
                                            -- | failed | cancelled | expired
  failure_reason  TEXT,                     -- populated on failed/cancelled/expired
  created_at      INTEGER NOT NULL,         -- unix ms
  expires_at      INTEGER NOT NULL          -- created_at + 10 min
);
CREATE INDEX idx_mcp_pending_state   ON mcp_pending_connections(state);
CREATE INDEX idx_mcp_pending_expires ON mcp_pending_connections(expires_at);
```

The schema is intentionally separate from per-agent memory DBs because pending connections are global to the AnthroClaw instance, not per-agent. The same DB file is reserved for future MCP-related tables (`mcp_discovered_tools` cache, `mcp_audit`); only the table above is created in this PR.

**Encrypted credential store extension:**

Two new credential variants stored under the `service` key pattern `mcp:<serverId>`:

```ts
interface McpOAuthCredential {
  kind: 'mcp_oauth';
  service: string;             // 'mcp:postmypost'
  mcpUrl: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;          // unix ms
  scopes?: string[];
  tokenEndpoint?: string;      // for refresh
  authorizationServer?: string;
  clientId?: string;           // DCR-registered
  clientSecret?: string;       // encrypted at rest if confidential client
  createdAt: number;
  lastRefreshAt?: number;
}

interface McpApiKeyCredential {
  kind: 'mcp_apikey';
  service: string;             // 'mcp:postmypost'
  mcpUrl: string;
  token: string;
  scheme?: 'Bearer' | 'Token' | string;   // default 'Bearer'
  createdAt: number;
}
```

`<serverId>` is the URL hostname's first label (`postmypost` for `mcp.postmypost.io`). On collision the next free `-2`/`-3` suffix is appended.

### Schema diff

`src/config/schema.ts` — only `http` and `sse` variants change:

```ts
z.object({
  type: z.literal('http'),
  url: z.string().url(),
  display_name: z.string().optional(),         // NEW
  credential_ref: z.string().optional(),       // NEW
  headers: z.record(z.string(), z.string()).optional(),
  allowed_tools: z.array(z.string()).optional(),
}).refine(
  v => !(v.credential_ref && v.headers?.Authorization),
  { message: 'Cannot set both credential_ref and Authorization header' }
)
```

The same fields and `refine` are added to the `sse` variant. The `stdio` variant is unchanged.

Backward compatibility: existing `agent.yml` entries without `credential_ref` continue to load and behave exactly as today.

## Data Flow

### Scenario A — OAuth via admin panel

1. User clicks **+ Add server** → wizard opens at step 1.
2. User enters `https://mcp.postmypost.io/mcp`, clicks **Continue**.
3. Frontend POSTs `/api/mcp/probe { url }`.
4. Backend `probe()` issues MCP `initialize`. On `401`:
   - Reads `WWW-Authenticate: Bearer resource_metadata="…"`.
   - Fetches resource metadata (RFC 9728), then authorization-server metadata (RFC 8414).
   - Returns `{ authMode: 'oauth', server: {...}, oauth: { authorizationEndpoint, tokenEndpoint, registrationEndpoint, scopesSupported } }`.
5. Wizard advances to step 2 "Auth", renders **Authorize with postmypost.io** button.
6. User clicks → frontend POSTs `/api/mcp/connect/start { url, agentId }`.
7. Backend:
   - DCR registration → obtains `client_id` (and possibly `client_secret`).
   - PKCE: generates 32-byte `code_verifier`, derives `code_challenge`.
   - Inserts row in `mcp_pending_connections` with `state`, `code_verifier`, `client_id`, `metadata_json`, `requested_by='admin:<userId>'`.
   - Returns `{ pendingId, authUrl }` where `authUrl` is the provider's authorization endpoint with `client_id`, `redirect_uri={ui_base}/api/mcp/oauth/callback`, `state`, `code_challenge`, requested scopes.
8. Frontend `window.location = authUrl`. User authorizes at `postmypost.io`.
9. Provider redirects to `GET /api/mcp/oauth/callback?state=…&code=…`.
10. Callback:
    - Atomic `UPDATE mcp_pending_connections SET status='exchanging' WHERE state=? AND status='pending'`.
    - If 0 rows updated → 410 Gone.
    - Token exchange (with PKCE `code_verifier`) → `{ access_token, refresh_token?, expires_in, scope }`.
    - Writes `McpOAuthCredential` to credential store under `mcp:<serverId>`.
    - Calls `tools/list` against MCP with the new token → list of `{ name, description, inputSchema }`.
    - `UPDATE mcp_pending_connections SET status='completed', metadata_json=jsonb('{tools:[…]}')`.
    - Redirects to `{ui_base}/fleet/.../agents/.../mcp-wizard?step=tools&pendingId=…`.
11. Wizard step 3 renders tool checkboxes (all checked by default).
12. User clicks **Save** → frontend POSTs `/api/mcp/connect/finalize { pendingId, allowed_tools }`.
13. Backend writes the new entry to `agent.yml`:
    ```yaml
    external_mcp_servers:
      postmypost:
        type: http
        url: https://mcp.postmypost.io/mcp
        display_name: postmypost
        credential_ref: mcp:postmypost
        allowed_tools: [post_create, post_list, post_publish]
    ```
14. Hot-reload watcher picks up the change. Gateway rebuilds `mcpServers` with `Authorization: Bearer <token>` injected by `resolveExternalMcpHeaders`.

### Scenario B — OAuth via agent in chat

1. User in Telegram: "подключи postmypost — `https://mcp.postmypost.io/mcp`".
2. Agent calls `connect_mcp({ url, op: 'connect' })`.
3. Tool dispatches `startConnection(url, { kind: 'agent', sessionKey })`, returns `{ status: 'authorize', pendingId, authUrl, serverName, message }`. `authUrl` is now `{ui_base}/api/mcp/oauth/start/{pendingId}` — a one-shot internal URL keyed by the pending row (no admin-panel login required).
4. Agent forwards to user (Telegram-formatted): "Открой ссылку и авторизуйся: \<authUrl\>. Я подтвержу когда закончится."
5. User clicks → `/api/mcp/oauth/start/{pendingId}` looks up the pending row, builds the provider authorization URL, redirects.
6. User authorizes; callback runs identically to Scenario A through step 10. Difference at step 11:
7. Callback renders `{ui_base}/mcp/done` ("You can close this tab") because pending was chat-initiated.
8. After the credential is written and `tools/list` resolves, callback dispatches a synthetic `InboundMessage` into the agent's session:
   ```
   [system] mcp_connected: postmypost
   server_id: postmypost
   url: https://mcp.postmypost.io/mcp
   pending_id: pnd_<id>
   tools: post_create, post_list, post_publish
   awaiting: finalize (call connect_mcp with op='finalize' and allowed_tools=...)
   ```
   The message is dispatched via the existing `Gateway.dispatch()` path with `meta.source='mcp_oauth_callback'`. `QueueManager` orders it correctly relative to user messages.
9. Agent calls `connect_mcp({ op: 'finalize', pendingId, allowed_tools: ['*'] })` (or narrows by user direction).
10. Agent replies to user: "`postmypost` подключен. Доступно: post_create, post_list, post_publish."

### Scenario C — API key (no OAuth discovery)

Two branches; admin and chat.

**Admin:** wizard step 2 renders an `API key` input. User pastes, clicks **Continue** → `POST /api/mcp/connect/apikey { pendingId, token }`. Backend probes `initialize` with `Authorization: Bearer <token>`. On 200 it writes `McpApiKeyCredential`, lists tools, advances to step 3. On 401 it surfaces "Invalid key, try again" inline (pending kept alive up to 3 retries).

**Chat:** `connect_mcp({ url, op: 'connect' })` returns `{ status: 'awaiting_apikey', pendingId, apikeyUrl, serverName, message }` where `apikeyUrl` is `{ui_base}/mcp/connect/{pendingId}/apikey` — a one-shot HTML form that takes the key, POSTs to `/api/mcp/connect/apikey`, then shows a "done" page. The agent forwards the URL the same way it forwards an OAuth URL; the token never appears in chat history. Synthetic `[system] mcp_connected` arrives in the session the same way.

## Surfaces

### Admin: `<McpServersSection />`

Replaces the inline section in `agents/[agentId]/page.tsx`. Renders:

- Heading "External MCP servers" with `+ Add server` button.
- List of `<McpServerCard />` per configured entry.
- Disclosure "⚙ Advanced — manually edit raw fields" wrapping `<McpServerAdvancedEditor />`.

The legacy `Calendar` and `Gmail` preset buttons are removed. They are non-functional as shipped (require manual `GOOGLE_REFRESH_TOKEN`) and their replacement is the wizard.

### `<McpServerCard />` (managed view)

```
┌──────────────────────────────────────────────┐
│ 🟢 postmypost              http · 3 tools    │
│    https://mcp.postmypost.io/mcp             │
│    [ Edit allowed tools ] [ Re-auth ] [ ⋯ ]  │
└──────────────────────────────────────────────┘
```

Status dot:

- 🟢 **Connected** — credential valid, expiry > 5 min away.
- 🟡 **Refreshing** — refresh in progress.
- 🟠 **Re-auth required** — refresh failed / token revoked; `<ReauthBanner />` rendered above the card.
- ⚫ **Disabled** — `credential_ref` present but credential missing in store.

Tooltip on the dot shows token expiry time and last refresh time.

### `<AddMcpWizard />`

Three-step modal:

**Step 1 — URL.** Single field, **Continue** triggers probe.

**Step 2 — Auth.** Three render branches:

- OAuth: "Authorize with \<server\>" button, scope list, brief security note ("Token stored encrypted in this AnthroClaw instance").
- API key: masked input, show/hide toggle, optional "where to get this" link if `probe` returned a hint URL.
- None: skipped automatically.

**Step 3 — Tools.** Master "Allow all (recommended)" checkbox, then per-tool checkboxes with description tooltips. **Save & Connect** finalizes.

### `<ReauthBanner />`

Appears at the top of `<McpServerCard />` when credential is `needs_reauth`:

```
⚠ Token for postmypost expired — re-authorize  [ Re-authorize ]
```

Clicking the button reopens the wizard with `step=auth` for that server.

### Agent tool: `connect_mcp`

A built-in MCP tool registered in `src/agent/tools/index.ts`. One tool, four operations selected via the `op` field:

| op | Inputs | Output |
|----|--------|--------|
| `connect` | `url`, optional `display_name` | `{ status: 'authorize' \| 'awaiting_apikey' \| 'connected', pendingId?, authUrl?, apikeyUrl?, serverName?, tools?, message }` |
| `finalize` | `pendingId`, `allowed_tools` (array of names or `['*']`) | `{ status: 'connected', server, tools }` |
| `check` | `pendingId` | `{ status, age_seconds, expires_in_seconds }` |
| `cancel` | `pendingId` | `{ status: 'cancelled' }` |

The `message` field in `connect` responses carries explicit usage instructions for the agent (e.g. "Forward this auth URL to the user. After they click and authorize you will receive a `[system] mcp_connected` message in this session. Do not poll unless the user explicitly asks for status."). This keeps the contract self-describing so we do not have to edit every agent's `CLAUDE.md` to teach this flow.

### Synthetic system messages

The gateway emits `[system]`-prefixed messages into the originating agent session for four events:

| Trigger | Payload prefix |
|---------|----------------|
| OAuth callback completed | `[system] mcp_connected: <serverId>` |
| User cancelled (provider `error=access_denied`) | `[system] mcp_connect_declined: <serverId>` |
| Pending expired (10 min sweep) | `[system] mcp_connect_timeout: <serverId>` |
| Runtime refresh failed | `[system] mcp_reauth_required: <serverId>` |

These messages are dispatched through `Gateway.dispatch()` exactly like a user message, with `meta.source` set to a corresponding tag so logs and the operator UI can distinguish them. The `[system]` prefix in the message body lets the agent's model recognise the event as a non-user signal.

## Error Handling

| Failure | Behavior |
|---------|----------|
| Probe network/DNS/TLS/5xx/non-MCP response | UI: "Couldn't reach this server" + Retry. Pending row not created. |
| Probe 401 with non-standard `WWW-Authenticate` (not Bearer, no resource_metadata) | `authMode: 'manual'`. Wizard surfaces a link to Advanced editor. Pending not created. |
| User abandons OAuth (no callback) | After 10 min, cleanup cron marks pending `expired`. Chat-initiated → synthetic `mcp_connect_timeout`. Admin-initiated → wizard reopens with retry button. |
| Provider returns `error=access_denied` in callback | Pending → `cancelled`. UI: "Authorization declined". Chat → `mcp_connect_declined`. |
| State token replay / consumed | Atomic UPDATE returns 0 rows → 410 Gone with generic message. |
| State expired | 410 Gone with link "Start over from the wizard". |
| Dynamic Client Registration fails | Pending → `failed` with reason `dcr_unsupported`. UI: "This server requires manual setup — use Advanced editor". Chat → `mcp_connect_failed` with reason. |
| Token exchange fails after code received | Pending → `failed`. UI: "Authorization failed: \<reason\>". Chat → `mcp_connect_failed`. |
| `tools/list` fails after valid token | Credential is still saved (it's valid). Wizard step 3 shows "No tools discovered" + a **Skip / Save without allowlist** button (writes `allowed_tools: []`). User can re-discover later. |
| API-key probe 401 (invalid key) | UI inline error "Invalid key, try again". Pending kept alive for up to 3 retries, then dropped with helpful message. |
| `agent.yml` write fails | Roll back: delete credential, drop pending. UI: "Couldn't save — retry". |
| Concurrent finalize, same URL | Second hits "server already connected: \<name\>" during YAML write. UI: "Already connected". Pending dropped. |
| Runtime: refresh fails (revoked refresh token) | Credential flagged `needs_reauth=true`. `Authorization` is NOT injected. Server temporarily unavailable. Banner appears in UI. Synthetic `mcp_reauth_required` to agent on next message. |
| Runtime: mid-session 401 from MCP | SDK reports tool-call error. Gateway intercepts, flags `needs_reauth=true`, surfaces to agent's current turn as "Tool failed — server needs re-auth". No auto-retry. |
| Credential store unavailable (disk error) | Server skipped at load. Gateway logs and emits notification to operator. Agent informed via system notification. |
| `pendingId` / `state` guessing attack | Both are 32-byte base64url (~256 bits of entropy). Brute force infeasible. 10-min TTL further reduces window. |

## Security Considerations

- All credentials are stored in `EncryptedFilesystemCredentialStore` (AES-256-GCM). No bearer tokens land in `agent.yml`, logs (beyond audit refs), or chat transcripts.
- For chat-initiated pendings, the `authUrl` and `apikeyUrl` are one-shot URLs keyed by `pendingId` (32-byte random). Anyone holding the URL can complete the flow — which is intentional, because the link is sent privately to the user via the same chat channel that initiated the request. No admin-panel login is required, so the flow works for non-admin users (e.g. a normal Telegram user whose agent is helping them set up a tool).
- The `state` token is bound to a single pending row and consumed atomically. Replay is detected by the rowcount of the UPDATE.
- DCR client secrets, when issued by the authorization server, are stored encrypted alongside the rest of the credential.
- The `[system]` synthetic messages carry no secrets — only the server name, server id, pending id, and tool names. The credential never appears in the transcript.
- The `Authorization` header is materialized at MCP wire-up time per agent run; the SDK only ever sees the current valid token. Expired tokens are refreshed before they reach the SDK.

## Testing

### Unit tests

- `probe.test.ts` — table-driven: 200, 401-oauth (three forms of `WWW-Authenticate`), 401-apikey, 401-manual, 5xx, network error, non-MCP response.
- `oauth-client.test.ts` — PKCE generation (deterministic via injected RNG), DCR success/failure, token exchange success/failure, refresh, expired-refresh-token handling.
- `pending-store.test.ts` — insert, atomic `consumeByState` race (10 concurrent consumes; exactly one wins), expire sweep, cleanup.
- `credential-store.test.ts` — roundtrip for `McpOAuthCredential` and `McpApiKeyCredential`, encryption at rest verified, audit log entries written.
- `schema.test.ts` — valid `credential_ref` configs accepted, `refine()` rejects `credential_ref` + `headers.Authorization` conflict, legacy configs without new fields still parse.
- `mcp-preflight.test.ts` — new `anthroclaw-managed-credential` rule marks `approved`; missing-credential case still marks unmanaged.

### Integration tests (`src/__tests__/integration/`)

- `mcp-onboarding-oauth.test.ts` — fake MCP server fixture (Express) implementing `initialize`, `tools/list`, `WWW-Authenticate`, DCR, token endpoint. Full backend flow: probe → start → simulated browser redirect → callback → finalize → assert `agent.yml` contents and credential-store contents.
- `mcp-onboarding-apikey.test.ts` — same shape for API-key flow.
- `mcp-runtime-refresh.test.ts` — preload an expired-soon credential; assert `resolveExternalMcpHeaders` refreshes and injects fresh Bearer.
- `mcp-reauth-flow.test.ts` — simulate refresh failure; assert `needs_reauth` flag flips, `ReauthBanner` data appears in UI mock, agent receives synthetic message.
- `connect-mcp-tool.test.ts` — built-in tool returns correct status payloads for all three branches plus `finalize`/`check`/`cancel`.

### UI tests (`ui/__tests__/components/`)

- `AddMcpWizard.test.tsx` — all three steps render, transitions work, errors surface, mocked fetch.
- `McpServerCard.test.tsx` — status states (connected, refreshing, reauth_required, disabled), action buttons wired.
- `ReauthBanner.test.tsx` — banner appears for `needs_reauth=true`, clicking reopens wizard at step `auth`.

### Fixtures (`test/fixtures/mcp/`)

- `oauth-server.ts` — minimal MCP server implementing `initialize` + `tools/list` + `WWW-Authenticate` + DCR + token endpoint + protected resource.
- `apikey-server.ts` — same shape, Bearer-only.

Both fixtures are reusable across unit and integration tests. No live network calls in any test.

### Out-of-scope for tests

- Real-browser E2E (too expensive; UI is exercised via React Testing Library with mocked fetch).
- Real OAuth providers (a real `postmypost.io` round-trip is not run in CI; manual verification is performed once before merge).

## Open Questions

- **Local-only deployments without a public callback URL.** Currently the design requires `ui_base_url` to be reachable from the OAuth provider. For users running AnthroClaw on a laptop or LAN, OAuth is impossible. A future PR can add a device-code-style fallback (display a code to paste back into the wizard). Not in scope here.
- **Credential rotation across multiple AnthroClaw instances.** If an operator runs two AnthroClaw instances against the same agent directory (e.g. for failover), each one will independently refresh tokens, causing race conditions. Out of scope; documented in code.
- **Stdio MCP servers requiring OAuth.** The schema-side change only adds `credential_ref` to `http`/`sse`. Stdio MCPs that require env-var-injected tokens (Calendar, Gmail) remain a manual-config story. A follow-up could extend `credential_ref` to stdio, materializing into `env` at launch time.

## Sequencing Inside the PR

Although shipped as a single PR, the implementation is staged so that intermediate commits keep the test suite green:

1. Schema + credential-store extensions + preflight rule (no UI / runtime change).
2. Probe module + pending store + SQLite migration.
3. API-key flow end-to-end (admin wizard + one-shot apikey URL + agent tool API-key path).
4. OAuth client + admin OAuth wizard path + callback route.
5. Chat path: agent tool, synthetic message dispatch, one-shot OAuth-start route.
6. Re-auth and refresh handling, runtime 401 trap, ReauthBanner.
7. Removal of Calendar/Gmail preset buttons; rewrite of `<McpServersSection />` markup.
8. Documentation updates (`docs/guide.md`, agent example `CLAUDE.md` snippet).

Each stage carries its own tests so that any individual commit on the branch is reviewable in isolation.
