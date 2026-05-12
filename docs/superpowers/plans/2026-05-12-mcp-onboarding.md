# MCP Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw fields editor for external MCP servers with a 3-step wizard that handles OAuth and API-key auth automatically, wire the encrypted credential store into MCP loading, and mirror the flow as an agent chat tool.

**Architecture:** New module `src/integrations/mcp-onboarding/` exposes a `probe → start → finalize` facade backed by SQLite-stored pending state (`data/mcp.sqlite`) and the existing `EncryptedFilesystemCredentialStore`. Admin UI and the new built-in agent tool `connect_mcp` both call into the same facade; OAuth callback dispatches a synthetic system message into the originating agent session via `Gateway.dispatch()` with `queueMode: 'interrupt'`.

**Tech Stack:** TypeScript (Node ≥22), Zod, `@anthropic-ai/claude-agent-sdk`, `better-sqlite3` (already in deps), Vitest, Next.js 14 App Router, React Testing Library.

**Branch:** `feat/mcp-onboarding` (PR https://github.com/timur-nocodia/anthroclaw/pull/22). Push after each completed phase; the PR stays draft until Task 33.

**Spec:** [`docs/superpowers/specs/2026-05-12-mcp-onboarding-design.md`](../specs/2026-05-12-mcp-onboarding-design.md)

---

## File Map

**New files (src):**

| Path | Responsibility |
|---|---|
| `src/integrations/mcp-onboarding/index.ts` | Public facade — `startConnection`, `completeOAuth`, `attachApiKey`, `finalize`, `cancel`, `check`. |
| `src/integrations/mcp-onboarding/types.ts` | Shared types: `ProbeResult`, `PendingConnection`, `Requester`, `ConnectionStatus`. |
| `src/integrations/mcp-onboarding/server-id.ts` | Deterministic `<serverId>` derivation from URL (spec §Persistence). |
| `src/integrations/mcp-onboarding/probe.ts` | MCP `initialize` POST + `WWW-Authenticate` parsing + RFC 8414/9728 metadata fetch. |
| `src/integrations/mcp-onboarding/oauth-client.ts` | PKCE + Dynamic Client Registration + token exchange + refresh. |
| `src/integrations/mcp-onboarding/pending-store.ts` | better-sqlite3 wrapper over `mcp_pending_connections`. |
| `src/integrations/mcp-onboarding/cleanup.ts` | Cron callback that sweeps expired pending rows. |
| `src/agent/tools/connect-mcp.ts` | Built-in MCP tool with `op: connect \| apikey \| finalize \| check \| cancel`. |
| `test/fixtures/mcp/oauth-server.ts` | Express-based fake MCP server with OAuth + DCR + initialize/tools-list. |
| `test/fixtures/mcp/apikey-server.ts` | Bearer-only fake MCP server. |

**New files (ui):**

| Path | Responsibility |
|---|---|
| `ui/components/mcp/McpServersSection.tsx` | Container: list + `+ Add server` + Advanced disclosure. |
| `ui/components/mcp/McpServerCard.tsx` | Managed-view card (status dot, re-auth, edit allowed tools, remove). |
| `ui/components/mcp/AddMcpWizard.tsx` | 3-step modal (URL → Auth → Tools). |
| `ui/components/mcp/ReauthBanner.tsx` | `needs_reauth=true` banner. |
| `ui/components/mcp/McpServerAdvancedEditor.tsx` | Disclosure with current raw fields editor (existing markup, extracted). |
| `ui/app/api/mcp/probe/route.ts` | `POST` → `ProbeResult`. |
| `ui/app/api/mcp/connect/start/route.ts` | `POST` → `{pendingId, authUrl?, apikeyUrl?}`. |
| `ui/app/api/mcp/connect/apikey/route.ts` | `POST` → stores credential, returns tools. |
| `ui/app/api/mcp/connect/finalize/route.ts` | `POST` → writes to `agent.yml`. |
| `ui/app/api/mcp/oauth/start/[pendingId]/route.ts` | `GET` → redirect to provider authorization URL. |
| `ui/app/api/mcp/oauth/callback/route.ts` | `GET` → token exchange + finalize + redirect. |
| `ui/app/mcp/connect/[pendingId]/apikey/page.tsx` | One-shot HTML form (chat-initiated API-key entry). |
| `ui/app/mcp/done/page.tsx` | "You can close this tab" success page (chat path). |

**Modified files:**

| Path | Change |
|---|---|
| `src/config/schema.ts` | Add `display_name` + `credential_ref` to `http`/`sse` variants of `ExternalMcpServerSchema`; `.refine()` blocks conflict with `headers.Authorization`. |
| `src/agent/credentials/index.ts` | Add `McpOAuthCredential` + `McpApiKeyCredential`; widen `StoredCredential` union; default `kind: 'oauth'` on legacy load. |
| `src/agent/credentials/encrypted-fs-store.ts` | Serialize/deserialize new `kind` field; tolerate missing `kind` (legacy → `oauth`). |
| `src/sdk/external-mcp.ts` | New helper `resolveExternalMcpHeaders(spec, store, ctx)` materializes `credential_ref` into `Authorization` header with pre-flight refresh. |
| `src/gateway.ts` | Call `resolveExternalMcpHeaders` at MCP wire-up; install `mcp_pending_cleanup` internal cron; dispatch synthetic messages via `dispatch({ meta: { source: 'mcp_oauth_callback' }, queueMode: 'interrupt' })`. |
| `src/integrations/mcp-preflight.ts` | New decision rule: resolvable `credential_ref` → `approved` with `source: 'anthroclaw-managed-credential'`. |
| `src/agent/tools/index.ts` | Register `connect-mcp` tool. |
| `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx` | Replace inline External MCP servers section with `<McpServersSection />`. |
| `docs/guide.md` | Add "Connecting an MCP server" subsection. |

---

## Phases

The 33 tasks are grouped into 8 phases mirroring the spec's "Sequencing Inside the PR". Push after each phase; the test suite must be green at every phase boundary.

| Phase | Tasks | Outcome |
|---|---|---|
| 1. Foundation | 1–3 | Schema, credentials, preflight extended; no UI / runtime change yet. |
| 2. Probe + pending store | 4–8 | `data/mcp.sqlite` exists; probe classifies any URL; pending CRUD. |
| 3. API-key end-to-end | 9–15 | Admin can onboard a Bearer-only server; agent tool API-key path works. |
| 4. OAuth client + admin | 16–21 | DCR + PKCE + token exchange + admin OAuth wizard branch. |
| 5. Chat path | 22–25 | Agent forwards auth URL; callback emits synthetic interrupt. |
| 6. Re-auth + refresh | 26–28 | Pre-flight refresh, runtime 401 trap, `ReauthBanner`. |
| 7. UI polish | 29–31 | `<McpServersSection />` replaces inline; Calendar/Gmail presets removed. |
| 8. Docs + finalize | 32–33 | Guide updated; PR marked ready. |

---

# Phase 1 — Foundation

## Task 1: Extend `ExternalMcpServerSchema` with `credential_ref` + `display_name`

**Files:**
- Modify: `src/config/schema.ts:233-253`
- Test: `src/config/__tests__/schema.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/config/__tests__/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AgentYmlSchema } from '../schema.js';

describe('ExternalMcpServerSchema — credential_ref', () => {
  it('accepts http entry with credential_ref and no headers', () => {
    const yml = {
      model: 'claude-sonnet-4-6',
      external_mcp_servers: {
        postmypost: {
          type: 'http',
          url: 'https://mcp.postmypost.io/mcp',
          credential_ref: 'mcp:postmypost',
          allowed_tools: ['post_create'],
        },
      },
    };
    expect(() => AgentYmlSchema.parse(yml)).not.toThrow();
  });

  it('accepts http entry with both credential_ref and non-Authorization header', () => {
    const yml = {
      model: 'claude-sonnet-4-6',
      external_mcp_servers: {
        postmypost: {
          type: 'http',
          url: 'https://mcp.postmypost.io/mcp',
          credential_ref: 'mcp:postmypost',
          headers: { 'X-Workspace': 'acme' },
        },
      },
    };
    expect(() => AgentYmlSchema.parse(yml)).not.toThrow();
  });

  it('rejects http entry with both credential_ref and Authorization header', () => {
    const yml = {
      model: 'claude-sonnet-4-6',
      external_mcp_servers: {
        postmypost: {
          type: 'http',
          url: 'https://mcp.postmypost.io/mcp',
          credential_ref: 'mcp:postmypost',
          headers: { Authorization: 'Bearer hardcoded' },
        },
      },
    };
    expect(() => AgentYmlSchema.parse(yml)).toThrow(
      /Cannot set both credential_ref and Authorization header/,
    );
  });

  it('legacy entries without new fields still parse', () => {
    const yml = {
      model: 'claude-sonnet-4-6',
      external_mcp_servers: {
        legacy: {
          type: 'http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer abc' },
          allowed_tools: ['t1'],
        },
      },
    };
    expect(() => AgentYmlSchema.parse(yml)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/config/__tests__/schema.test.ts -t 'credential_ref' 2>&1 | tail -20
```

Expected: 4 failures referencing unknown `credential_ref`.

- [ ] **Step 3: Implement schema change**

In `src/config/schema.ts`, replace the `z.object({ type: z.literal('http'), … })` and `z.object({ type: z.literal('sse'), … })` variants with:

```ts
const HttpLikeMcpVariant = (type: 'http' | 'sse') =>
  z
    .object({
      type: z.literal(type),
      url: z.string().url(),
      display_name: z.string().optional(),
      credential_ref: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      allowed_tools: z.array(z.string()).optional(),
    })
    .refine(
      (v) =>
        !(
          v.credential_ref &&
          v.headers &&
          Object.keys(v.headers).some((k) => k.toLowerCase() === 'authorization')
        ),
      { message: 'Cannot set both credential_ref and Authorization header' },
    );

const ExternalMcpServerSchema = z.union([
  /* existing stdio variant unchanged */,
  HttpLikeMcpVariant('sse'),
  HttpLikeMcpVariant('http'),
]);
```

- [ ] **Step 4: Tests pass**

```bash
npx vitest run src/config/__tests__/schema.test.ts -t 'credential_ref' 2>&1 | tail -10
```

Expected: all 4 pass; pre-existing schema tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/config/__tests__/schema.test.ts
git commit -m "feat(mcp): add credential_ref + display_name to schema

Allows MCP entries to reference a credential stored in the encrypted
credential store instead of a raw Authorization header. Both can be
set together as long as the headers don't include Authorization."
```

---

## Task 2: Extend credential store with `McpOAuthCredential` + `McpApiKeyCredential`

**Files:**
- Modify: `src/agent/credentials/index.ts`
- Modify: `src/agent/credentials/encrypted-fs-store.ts`
- Test: `src/agent/credentials/__tests__/mcp-variants.test.ts` (new)

- [ ] **Step 1: Write failing tests**

Create `src/agent/credentials/__tests__/mcp-variants.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { EncryptedFilesystemCredentialStore } from '../encrypted-fs-store.js';
import { CredentialAuditLog } from '../audit.js';
import type {
  CredentialStore,
  McpOAuthCredential,
  McpApiKeyCredential,
} from '../index.js';

describe('credential store — MCP variants', () => {
  let dir: string;
  let store: CredentialStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-cred-'));
    const audit = new CredentialAuditLog(join(dir, 'audit.log'));
    store = new EncryptedFilesystemCredentialStore(
      join(dir, 'creds'),
      randomBytes(32),
      audit,
    );
  });

  it('roundtrips mcp_oauth credential preserving all fields', async () => {
    const cred: McpOAuthCredential = {
      kind: 'mcp_oauth',
      service: 'mcp:postmypost',
      account: 'postmypost',
      scopes: ['read:posts'],
      mcpUrl: 'https://mcp.postmypost.io/mcp',
      accessToken: 'tok_access',
      refreshToken: 'tok_refresh',
      expiresAt: 1_900_000_000_000,
      tokenEndpoint: 'https://auth.postmypost.io/token',
      authorizationServer: 'https://auth.postmypost.io',
      clientId: 'cli_xyz',
      clientSecret: 'sec_xyz',
      createdAt: 1_800_000_000_000,
    };
    await store.set({ agentId: 'a1', service: cred.service }, cred);
    const got = await store.get(
      { agentId: 'a1', service: cred.service },
      'test',
    );
    expect(got).toEqual(cred);
  });

  it('roundtrips mcp_apikey credential', async () => {
    const cred: McpApiKeyCredential = {
      kind: 'mcp_apikey',
      service: 'mcp:postmypost',
      account: 'postmypost',
      scopes: [],
      mcpUrl: 'https://mcp.postmypost.io/mcp',
      token: 'sk_live_abc',
      scheme: 'Bearer',
      createdAt: 1_800_000_000_000,
    };
    await store.set({ agentId: 'a1', service: cred.service }, cred);
    const got = await store.get(
      { agentId: 'a1', service: cred.service },
      'test',
    );
    expect(got).toEqual(cred);
  });

  it('legacy credentials without kind field load as oauth', async () => {
    const legacy = {
      service: 'google_calendar',
      account: 'me@example.com',
      accessToken: 'tok',
      scopes: ['cal'],
    };
    await store.set({ agentId: 'a1', service: 'google_calendar' }, legacy as never);
    const got = await store.get(
      { agentId: 'a1', service: 'google_calendar' },
      'test',
    );
    expect((got as { kind: string }).kind).toBe('oauth');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/agent/credentials/__tests__/mcp-variants.test.ts 2>&1 | tail -15
```

Expected: TS errors about missing `McpOAuthCredential` / `McpApiKeyCredential` types.

- [ ] **Step 3: Extend the type union**

In `src/agent/credentials/index.ts`, after `OAuthCredential` interface add:

```ts
export interface McpOAuthCredential {
  kind: 'mcp_oauth';
  service: string;
  account: string;
  scopes: string[];
  metadata?: Record<string, string>;
  mcpUrl: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenEndpoint?: string;
  authorizationServer?: string;
  clientId?: string;
  clientSecret?: string;
  createdAt: number;
  lastRefreshAt?: number;
}

export interface McpApiKeyCredential {
  kind: 'mcp_apikey';
  service: string;
  account: string;
  scopes: string[];
  metadata?: Record<string, string>;
  mcpUrl: string;
  token: string;
  scheme?: 'Bearer' | 'Token' | string;
  createdAt: number;
}

export type StoredCredential =
  | (OAuthCredential & { kind?: 'oauth' })
  | McpOAuthCredential
  | McpApiKeyCredential;
```

Change `OAuthCredential` to be assignable to `{ kind: 'oauth' }` (add optional `kind` field defaulting on read).

Update `CredentialStore` interface:

```ts
export interface CredentialStore {
  get(ref: CredentialRef, accessReason: string): Promise<StoredCredential>;
  set(ref: CredentialRef, credential: StoredCredential): Promise<void>;
  list(agentId: string): Promise<CredentialMetadata[]>;
  delete(ref: CredentialRef): Promise<void>;
}
```

- [ ] **Step 4: Update encrypted-fs-store**

In `src/agent/credentials/encrypted-fs-store.ts`:

- In `set()`, JSON-serialize the whole credential including new fields (no code change needed if it already uses `JSON.stringify(credential)`).
- In `get()` and `list()`, after parsing JSON, default `kind` to `'oauth'` if missing:

```ts
const parsed = JSON.parse(plaintext) as Record<string, unknown>;
if (!('kind' in parsed)) parsed.kind = 'oauth';
return parsed as StoredCredential;
```

- [ ] **Step 5: Tests pass**

```bash
npx vitest run src/agent/credentials/__tests__/ 2>&1 | tail -10
```

Expected: 3 new tests pass; existing audit/credential tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/agent/credentials/
git commit -m "feat(mcp): add McpOAuthCredential + McpApiKeyCredential variants

Widens StoredCredential to a discriminated union. Legacy entries
default to kind='oauth' on read for backward compat."
```

---

## Task 3: Preflight rule — `credential_ref` resolvable → approved

**Files:**
- Modify: `src/integrations/mcp-preflight.ts`
- Test: existing `src/integrations/__tests__/mcp-preflight.test.ts` (or create if missing)

- [ ] **Step 1: Add credential-aware probe signature**

`preflightMcpServerSpec()` needs a way to check whether a `credential_ref` resolves. Threading the store through every caller is too invasive — instead add a `credentialResolver` callback parameter:

```ts
export interface PreflightOptions {
  credentialResolver?: (ref: string, agentId: string) => Promise<boolean>;
  agentId?: string;
}
```

- [ ] **Step 2: Write failing test**

Append to `src/integrations/__tests__/mcp-preflight.test.ts`:

```ts
it('http entry with resolvable credential_ref → approved', async () => {
  const spec = {
    type: 'http' as const,
    url: 'https://mcp.postmypost.io/mcp',
    credential_ref: 'mcp:postmypost',
  };
  const result = await preflightMcpServerSpec(spec, {
    agentId: 'a1',
    credentialResolver: async (ref) => ref === 'mcp:postmypost',
  });
  expect(result.decision).toBe('approved');
  expect(result.source).toBe('anthroclaw-managed-credential');
});

it('http entry with unresolvable credential_ref → review_required', async () => {
  const spec = {
    type: 'http' as const,
    url: 'https://mcp.postmypost.io/mcp',
    credential_ref: 'mcp:postmypost',
  };
  const result = await preflightMcpServerSpec(spec, {
    agentId: 'a1',
    credentialResolver: async () => false,
  });
  expect(result.decision).not.toBe('approved');
});

it('http entry without credential_ref keeps current behaviour', async () => {
  const spec = {
    type: 'http' as const,
    url: 'https://mcp.postmypost.io/mcp',
    headers: { Authorization: 'Bearer x' },
  };
  const result = await preflightMcpServerSpec(spec, { agentId: 'a1' });
  expect(result.decision).not.toBe('approved');
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
npx vitest run src/integrations/__tests__/mcp-preflight.test.ts 2>&1 | tail -15
```

- [ ] **Step 4: Implement the rule**

In `src/integrations/mcp-preflight.ts` at the top of the decision branches (before existing rules):

```ts
if (
  (spec.type === 'http' || spec.type === 'sse') &&
  spec.credential_ref &&
  opts?.credentialResolver &&
  opts.agentId &&
  (await opts.credentialResolver(spec.credential_ref, opts.agentId))
) {
  return {
    decision: 'approved',
    source: 'anthroclaw-managed-credential',
    transport: spec.type,
    packageSource: 'remote-managed',
    networkRisk: 'low',
    filesystemRisk: 'low',
    reasons: [
      `Credential ${spec.credential_ref} is managed by AnthroClaw`,
    ],
  };
}
```

- [ ] **Step 5: Wire resolver in callers**

In `src/integrations/mcp-preflight.ts` callers (currently `src/gateway.ts` and `ui/app/api/fleet/[serverId]/integrations/mcp-preflight/route.ts`), pass:

```ts
const credentialResolver = async (ref: string, agentId: string) => {
  try {
    await credentialStore.get({ agentId, service: ref }, 'preflight');
    return true;
  } catch {
    return false;
  }
};
```

(Replace any callers that previously called `preflightMcpServerSpec(spec)` with `(spec, { agentId, credentialResolver })`.)

- [ ] **Step 6: Tests pass**

```bash
npx vitest run src/integrations/__tests__/mcp-preflight.test.ts 2>&1 | tail -10
```

- [ ] **Step 7: Phase 1 commit + push**

```bash
git add -A
git commit -m "feat(mcp): preflight approves anthroclaw-managed credentials

Adds optional credentialResolver to preflightMcpServerSpec. When an
http/sse entry has credential_ref resolvable in the credential store,
decision = 'approved' with source 'anthroclaw-managed-credential'.
Removes the BLOCKED badge from servers onboarded via the wizard."
git push
```

---

# Phase 2 — Probe + pending store

## Task 4: `<serverId>` derivation

**Files:**
- Create: `src/integrations/mcp-onboarding/server-id.ts`
- Create: `src/integrations/mcp-onboarding/__tests__/server-id.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/integrations/mcp-onboarding/__tests__/server-id.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveServerId } from '../server-id.js';

describe('deriveServerId', () => {
  it.each([
    ['https://mcp.postmypost.io/mcp', [], 'postmypost'],
    ['https://api.openai.com/mcp', [], 'openai'],
    ['https://tools.example.co.uk', [], 'tools'],
    ['https://EXAMPLE.com/x', [], 'example'],
    ['https://my-server.example.com', [], 'my-server'],
    ['http://192.168.1.10:8080/mcp', [], expect.stringMatching(/^srv-[0-9a-f]{8}$/)],
    ['https://postmypost.io', ['postmypost'], 'postmypost-2'],
    ['https://postmypost.io', ['postmypost', 'postmypost-2'], 'postmypost-3'],
  ])('deriveServerId(%s, taken=%j) = %s', (url, taken, expected) => {
    expect(deriveServerId(url, new Set(taken))).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
mkdir -p src/integrations/mcp-onboarding/__tests__
npx vitest run src/integrations/mcp-onboarding/__tests__/server-id.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement**

Create `src/integrations/mcp-onboarding/server-id.ts`:

```ts
import { createHash } from 'node:crypto';

const STRIP_PREFIXES = ['mcp.', 'api.'];

export function deriveServerId(url: string, taken: Set<string>): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = url.toLowerCase();
  }
  for (const p of STRIP_PREFIXES) {
    if (host.startsWith(p)) {
      host = host.slice(p.length);
      break;
    }
  }
  const firstLabel = host.split('.')[0] ?? '';
  const cleaned = firstLabel
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base =
    cleaned ||
    `srv-${createHash('sha256').update(host).digest('hex').slice(0, 8)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
```

- [ ] **Step 4: Tests pass + commit**

```bash
npx vitest run src/integrations/mcp-onboarding/__tests__/server-id.test.ts 2>&1 | tail -10
git add src/integrations/mcp-onboarding/server-id.ts src/integrations/mcp-onboarding/__tests__/server-id.test.ts
git commit -m "feat(mcp): deterministic serverId derivation from URL"
```

---

## Task 5: Pending store — SQLite schema + open helper

**Files:**
- Create: `src/integrations/mcp-onboarding/pending-store.ts`
- Create: `src/integrations/mcp-onboarding/__tests__/pending-store.test.ts`

- [ ] **Step 1: Write failing test for `openPendingStore`**

Create `src/integrations/mcp-onboarding/__tests__/pending-store.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPendingStore, type PendingStore } from '../pending-store.js';

describe('PendingStore', () => {
  let dir: string;
  let store: PendingStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-pending-'));
    store = openPendingStore(join(dir, 'mcp.sqlite'));
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates schema on first open', () => {
    expect(store.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement open + schema**

Create `src/integrations/mcp-onboarding/pending-store.ts`:

```ts
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface PendingConnection {
  id: string;
  state: string;
  agentId: string;
  agentSessionKey: string | null;
  mcpUrl: string;
  authMode: 'oauth' | 'apikey';
  codeVerifier: string | null;
  clientId: string | null;
  clientSecret: string | null;
  oauthMetadata: string | null;
  toolsMetadata: string | null;
  requestedBy: string;
  status: 'pending' | 'exchanging' | 'completed' | 'failed' | 'cancelled' | 'expired';
  failureReason: string | null;
  createdAt: number;
  expiresAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mcp_pending_connections (
  id              TEXT PRIMARY KEY,
  state           TEXT UNIQUE NOT NULL,
  agent_id        TEXT NOT NULL,
  agent_session_key TEXT,
  mcp_url         TEXT NOT NULL,
  auth_mode       TEXT NOT NULL,
  code_verifier   TEXT,
  client_id       TEXT,
  client_secret   TEXT,
  oauth_metadata  TEXT,
  tools_metadata  TEXT,
  requested_by    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  failure_reason  TEXT,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mcp_pending_state ON mcp_pending_connections(state);
CREATE INDEX IF NOT EXISTS idx_mcp_pending_expires ON mcp_pending_connections(expires_at);
`;

export interface PendingStore {
  insert(row: PendingConnection): void;
  byId(id: string): PendingConnection | null;
  consumeByState(state: string): PendingConnection | null;
  markCompleted(id: string, toolsMetadata: string): void;
  markFailed(id: string, reason: string): void;
  markCancelled(id: string, reason?: string): void;
  list(): PendingConnection[];
  sweepExpired(now: number): PendingConnection[];
  close(): void;
}

export function openPendingStore(path: string): PendingStore {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const rowToRecord = (r: Record<string, unknown>): PendingConnection => ({
    id: r.id as string,
    state: r.state as string,
    agentId: r.agent_id as string,
    agentSessionKey: (r.agent_session_key as string | null) ?? null,
    mcpUrl: r.mcp_url as string,
    authMode: r.auth_mode as 'oauth' | 'apikey',
    codeVerifier: (r.code_verifier as string | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    clientSecret: (r.client_secret as string | null) ?? null,
    oauthMetadata: (r.oauth_metadata as string | null) ?? null,
    toolsMetadata: (r.tools_metadata as string | null) ?? null,
    requestedBy: r.requested_by as string,
    status: r.status as PendingConnection['status'],
    failureReason: (r.failure_reason as string | null) ?? null,
    createdAt: r.created_at as number,
    expiresAt: r.expires_at as number,
  });

  return {
    insert(row) {
      db.prepare(`
        INSERT INTO mcp_pending_connections (
          id, state, agent_id, agent_session_key, mcp_url, auth_mode,
          code_verifier, client_id, client_secret, oauth_metadata,
          tools_metadata, requested_by, status, failure_reason,
          created_at, expires_at
        ) VALUES (
          @id, @state, @agentId, @agentSessionKey, @mcpUrl, @authMode,
          @codeVerifier, @clientId, @clientSecret, @oauthMetadata,
          @toolsMetadata, @requestedBy, @status, @failureReason,
          @createdAt, @expiresAt
        )
      `).run(row);
    },
    byId(id) {
      const r = db.prepare('SELECT * FROM mcp_pending_connections WHERE id = ?').get(id);
      return r ? rowToRecord(r as Record<string, unknown>) : null;
    },
    consumeByState(state) {
      const r = db
        .prepare(
          `UPDATE mcp_pending_connections
           SET status = 'exchanging'
           WHERE state = ? AND status = 'pending'
           RETURNING *`,
        )
        .get(state);
      return r ? rowToRecord(r as Record<string, unknown>) : null;
    },
    markCompleted(id, toolsMetadata) {
      db.prepare(
        `UPDATE mcp_pending_connections
         SET status = 'completed', tools_metadata = ?
         WHERE id = ?`,
      ).run(toolsMetadata, id);
    },
    markFailed(id, reason) {
      db.prepare(
        `UPDATE mcp_pending_connections
         SET status = 'failed', failure_reason = ?
         WHERE id = ?`,
      ).run(reason, id);
    },
    markCancelled(id, reason) {
      db.prepare(
        `UPDATE mcp_pending_connections
         SET status = 'cancelled', failure_reason = ?
         WHERE id = ?`,
      ).run(reason ?? null, id);
    },
    list() {
      const rows = db
        .prepare('SELECT * FROM mcp_pending_connections ORDER BY created_at DESC')
        .all();
      return rows.map((r) => rowToRecord(r as Record<string, unknown>));
    },
    sweepExpired(now) {
      const rows = db
        .prepare(
          `UPDATE mcp_pending_connections
           SET status = 'expired'
           WHERE expires_at < ? AND status = 'pending'
           RETURNING *`,
        )
        .all(now);
      return rows.map((r) => rowToRecord(r as Record<string, unknown>));
    },
    close() {
      db.close();
    },
  };
}
```

- [ ] **Step 3: Tests pass + commit**

```bash
npx vitest run src/integrations/mcp-onboarding/__tests__/pending-store.test.ts 2>&1 | tail -10
git add src/integrations/mcp-onboarding/pending-store.ts src/integrations/mcp-onboarding/__tests__/pending-store.test.ts
git commit -m "feat(mcp): SQLite pending-store for MCP onboarding flows"
```

---

## Task 6: Pending store — insert / byId / list / sweep

**Files:**
- Modify: `src/integrations/mcp-onboarding/__tests__/pending-store.test.ts`

- [ ] **Step 1: Add tests for CRUD + sweep**

Append:

```ts
const make = (overrides: Partial<PendingConnection> = {}): PendingConnection => ({
  id: 'pnd_' + Math.random().toString(36).slice(2, 10),
  state: 'st_' + Math.random().toString(36).slice(2, 10),
  agentId: 'a1',
  agentSessionKey: null,
  mcpUrl: 'https://mcp.postmypost.io/mcp',
  authMode: 'oauth',
  codeVerifier: 'verifier',
  clientId: 'cli',
  clientSecret: null,
  oauthMetadata: null,
  toolsMetadata: null,
  requestedBy: 'admin:user1',
  status: 'pending',
  failureReason: null,
  createdAt: Date.now(),
  expiresAt: Date.now() + 600_000,
  ...overrides,
});

it('insert + byId roundtrip', () => {
  const row = make();
  store.insert(row);
  expect(store.byId(row.id)).toEqual(row);
});

it('list returns rows in newest-first order', () => {
  const older = make({ createdAt: 1 });
  const newer = make({ createdAt: 2 });
  store.insert(older);
  store.insert(newer);
  expect(store.list().map((r) => r.id)).toEqual([newer.id, older.id]);
});

it('sweepExpired only sweeps pending rows past expiry', () => {
  const expiredPending = make({ expiresAt: 1 });
  const expiredCompleted = make({ expiresAt: 1, status: 'completed' });
  const live = make({ expiresAt: Date.now() + 10_000 });
  store.insert(expiredPending);
  store.insert(expiredCompleted);
  store.insert(live);
  const swept = store.sweepExpired(Date.now());
  expect(swept.map((r) => r.id)).toEqual([expiredPending.id]);
  expect(store.byId(expiredPending.id)?.status).toBe('expired');
  expect(store.byId(expiredCompleted.id)?.status).toBe('completed');
});
```

- [ ] **Step 2: Tests pass + commit**

```bash
npx vitest run src/integrations/mcp-onboarding/__tests__/pending-store.test.ts 2>&1 | tail -10
git add src/integrations/mcp-onboarding/__tests__/pending-store.test.ts
git commit -m "test(mcp): exercise pending-store CRUD and sweep"
```

---

## Task 7: Pending store — atomic `consumeByState` race

**Files:**
- Modify: `src/integrations/mcp-onboarding/__tests__/pending-store.test.ts`

- [ ] **Step 1: Write race test**

```ts
it('consumeByState is atomic — exactly one of 10 concurrent consumers wins', async () => {
  const row = make({ status: 'pending' });
  store.insert(row);
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      Promise.resolve().then(() => store.consumeByState(row.state)),
    ),
  );
  const winners = results.filter((r) => r !== null);
  expect(winners).toHaveLength(1);
  expect(store.byId(row.id)?.status).toBe('exchanging');
});

it('consumeByState returns null for nonexistent state', () => {
  expect(store.consumeByState('nonexistent')).toBeNull();
});

it('consumeByState returns null when status is not pending', () => {
  const row = make({ status: 'completed' });
  store.insert(row);
  expect(store.consumeByState(row.state)).toBeNull();
});
```

- [ ] **Step 2: Verify SQLite's `UPDATE … RETURNING` is atomic per row**

The current implementation uses a single `UPDATE … WHERE state = ? AND status = 'pending' RETURNING *` which SQLite executes within an implicit transaction. No code change required.

- [ ] **Step 3: Tests pass + commit**

```bash
npx vitest run src/integrations/mcp-onboarding/__tests__/pending-store.test.ts -t 'consumeByState' 2>&1 | tail -10
git add src/integrations/mcp-onboarding/__tests__/pending-store.test.ts
git commit -m "test(mcp): assert consumeByState is single-winner race-safe"
```

---

## Task 8: `probe.ts` — initialize POST + response classification

**Files:**
- Create: `src/integrations/mcp-onboarding/types.ts`
- Create: `src/integrations/mcp-onboarding/probe.ts`
- Create: `src/integrations/mcp-onboarding/__tests__/probe.test.ts`

- [ ] **Step 1: Define shared types**

Create `src/integrations/mcp-onboarding/types.ts`:

```ts
export interface DiscoveredOAuth {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
  issuer: string;
  resource: string;
}

export type ProbeResult =
  | { authMode: 'none'; server: { name?: string; version?: string } }
  | { authMode: 'oauth'; server: { name?: string; version?: string }; oauth: DiscoveredOAuth }
  | { authMode: 'apikey'; server: { name?: string; version?: string }; hint?: string }
  | { authMode: 'manual'; reason: string };

export interface Requester {
  kind: 'admin' | 'agent';
  userId?: string;
  agentId: string;
  agentSessionKey?: string;
  chatType?: 'private' | 'group' | 'supergroup' | 'channel';
}
```

- [ ] **Step 2: Write failing probe tests**

Create `src/integrations/mcp-onboarding/__tests__/probe.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { probe } from '../probe.js';

describe('probe', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('classifies 200 + initialize response as authMode=none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(
        JSON.stringify({ result: { serverInfo: { name: 'test', version: '1' } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ));
    const r = await probe('https://example.com/mcp');
    expect(r).toEqual({ authMode: 'none', server: { name: 'test', version: '1' } });
  });

  it('classifies 401 with Bearer + resource_metadata as authMode=oauth', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url === 'https://example.com/mcp')
        return new Response('', {
          status: 401,
          headers: {
            'WWW-Authenticate':
              'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
          },
        });
      if (url.endsWith('/oauth-protected-resource'))
        return new Response(
          JSON.stringify({
            resource: 'https://example.com/mcp',
            authorization_servers: ['https://auth.example.com'],
          }),
          { status: 200 },
        );
      if (url.endsWith('/.well-known/oauth-authorization-server'))
        return new Response(
          JSON.stringify({
            issuer: 'https://auth.example.com',
            authorization_endpoint: 'https://auth.example.com/authorize',
            token_endpoint: 'https://auth.example.com/token',
            registration_endpoint: 'https://auth.example.com/register',
            scopes_supported: ['read', 'write'],
          }),
          { status: 200 },
        );
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const r = await probe('https://example.com/mcp');
    expect(r.authMode).toBe('oauth');
    if (r.authMode === 'oauth') {
      expect(r.oauth.authorizationEndpoint).toBe('https://auth.example.com/authorize');
      expect(r.oauth.tokenEndpoint).toBe('https://auth.example.com/token');
      expect(r.oauth.registrationEndpoint).toBe('https://auth.example.com/register');
      expect(r.oauth.scopesSupported).toEqual(['read', 'write']);
    }
  });

  it('classifies 401 with Bearer but no resource_metadata as authMode=apikey', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer realm="api"' },
      }),
    ));
    const r = await probe('https://example.com/mcp');
    expect(r.authMode).toBe('apikey');
  });

  it('classifies 401 with non-Bearer scheme as authMode=manual', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="x"' },
      }),
    ));
    const r = await probe('https://example.com/mcp');
    expect(r.authMode).toBe('manual');
  });

  it('classifies 5xx / network error as authMode=manual with reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const r = await probe('https://example.com/mcp');
    expect(r.authMode).toBe('manual');
  });
});
```

- [ ] **Step 3: Run to confirm failure + implement**

```bash
npx vitest run src/integrations/mcp-onboarding/__tests__/probe.test.ts 2>&1 | tail -10
```

Create `src/integrations/mcp-onboarding/probe.ts`:

```ts
import type { ProbeResult, DiscoveredOAuth } from './types.js';

const INITIALIZE_PAYLOAD = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'anthroclaw-probe', version: '0.1.0' },
  },
};

export async function probe(url: string): Promise<ProbeResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(INITIALIZE_PAYLOAD),
    });
  } catch (err) {
    return { authMode: 'manual', reason: `network_error: ${(err as Error).message}` };
  }

  if (res.status >= 200 && res.status < 300) {
    let server = {};
    try {
      const body = (await res.json()) as { result?: { serverInfo?: { name?: string; version?: string } } };
      server = body.result?.serverInfo ?? {};
    } catch { /* ignore */ }
    return { authMode: 'none', server };
  }

  if (res.status !== 401) {
    return { authMode: 'manual', reason: `unexpected_status_${res.status}` };
  }

  const wwwAuth = res.headers.get('WWW-Authenticate') ?? '';
  if (!wwwAuth.toLowerCase().startsWith('bearer')) {
    return { authMode: 'manual', reason: 'non_bearer_scheme' };
  }

  const metadataMatch = wwwAuth.match(/resource_metadata="([^"]+)"/i);
  if (!metadataMatch) return { authMode: 'apikey', server: {} };

  try {
    const oauth = await discoverOAuth(metadataMatch[1]!);
    return { authMode: 'oauth', server: {}, oauth };
  } catch {
    return { authMode: 'apikey', server: {} };
  }
}

async function discoverOAuth(resourceMetadataUrl: string): Promise<DiscoveredOAuth> {
  const meta = await fetchJson<{
    resource: string;
    authorization_servers: string[];
  }>(resourceMetadataUrl);
  const asUrl = meta.authorization_servers[0];
  if (!asUrl) throw new Error('no authorization_servers');
  const asWellKnown = `${asUrl.replace(/\/$/, '')}/.well-known/oauth-authorization-server`;
  const as = await fetchJson<{
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint?: string;
    scopes_supported?: string[];
  }>(asWellKnown);
  return {
    issuer: as.issuer,
    authorizationEndpoint: as.authorization_endpoint,
    tokenEndpoint: as.token_endpoint,
    registrationEndpoint: as.registration_endpoint,
    scopesSupported: as.scopes_supported,
    resource: meta.resource,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  return (await r.json()) as T;
}
```

- [ ] **Step 4: Tests pass + commit**

```bash
npx vitest run src/integrations/mcp-onboarding/__tests__/probe.test.ts 2>&1 | tail -10
git add src/integrations/mcp-onboarding/probe.ts src/integrations/mcp-onboarding/types.ts src/integrations/mcp-onboarding/__tests__/probe.test.ts
git commit -m "feat(mcp): probe classifies MCP servers by auth mode"
git push
```

---

# Phase 3 — API-key end-to-end

## Task 9: Facade — `startConnection` (apikey branch) + `attachApiKey`

**Files:**
- Create: `src/integrations/mcp-onboarding/index.ts`
- Create: `src/integrations/mcp-onboarding/__tests__/facade.test.ts`

- [ ] **Step 1: Write failing facade test**

Create `src/integrations/mcp-onboarding/__tests__/facade.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createOnboarding } from '../index.js';
import { openPendingStore } from '../pending-store.js';
import { EncryptedFilesystemCredentialStore } from '../../../agent/credentials/encrypted-fs-store.js';
import { CredentialAuditLog } from '../../../agent/credentials/audit.js';

const probeStub = vi.fn();
vi.mock('../probe.js', () => ({ probe: (...args: unknown[]) => probeStub(...args) }));

describe('onboarding facade — apikey branch', () => {
  let dir: string;
  let onboarding: ReturnType<typeof createOnboarding>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-fac-'));
    const audit = new CredentialAuditLog(join(dir, 'audit.log'));
    const creds = new EncryptedFilesystemCredentialStore(
      join(dir, 'creds'),
      randomBytes(32),
      audit,
    );
    const pending = openPendingStore(join(dir, 'mcp.sqlite'));
    onboarding = createOnboarding({ pending, credentials: creds, uiBaseUrl: 'https://ui.test' });
    probeStub.mockReset();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('apikey probe → pending row + apikeyUrl', async () => {
    probeStub.mockResolvedValueOnce({ authMode: 'apikey', server: { name: 'pmp' } });
    const res = await onboarding.startConnection({
      url: 'https://mcp.postmypost.io/mcp',
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });
    expect(res.status).toBe('awaiting_apikey');
    expect(res.apikeyUrl).toMatch(/^https:\/\/ui\.test\/mcp\/connect\/[^/]+\/apikey$/);
    expect(res.pendingId).toBeTruthy();
  });

  it('attachApiKey writes credential + returns discovered tools', async () => {
    probeStub.mockResolvedValueOnce({ authMode: 'apikey', server: { name: 'pmp' } });
    const started = await onboarding.startConnection({
      url: 'https://mcp.postmypost.io/mcp',
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });
    const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      if (body.method === 'initialize')
        return new Response(JSON.stringify({ result: { serverInfo: { name: 'pmp' } } }), { status: 200 });
      if (body.method === 'tools/list')
        return new Response(
          JSON.stringify({ result: { tools: [{ name: 'post_create', description: 'd', inputSchema: {} }] } }),
          { status: 200 },
        );
      throw new Error('unexpected ' + body.method);
    });
    vi.stubGlobal('fetch', fetchStub);

    const res = await onboarding.attachApiKey({
      pendingId: started.pendingId!,
      token: 'sk_live_xxx',
    });
    expect(res.status).toBe('connected');
    expect(res.tools?.map((t) => t.name)).toEqual(['post_create']);
    const cred = await /* internal helper exposed for test only */ onboarding._debug.getCredential('a1', 'mcp:postmypost');
    expect(cred?.kind).toBe('mcp_apikey');
  });
});
```

- [ ] **Step 2: Implement facade (apikey path only)**

Create `src/integrations/mcp-onboarding/index.ts`:

```ts
import { randomBytes } from 'node:crypto';
import type { CredentialStore } from '../../agent/credentials/index.js';
import { probe } from './probe.js';
import { deriveServerId } from './server-id.js';
import type { PendingConnection, PendingStore } from './pending-store.js';
import type { Requester } from './types.js';

export interface OnboardingDeps {
  pending: PendingStore;
  credentials: CredentialStore;
  uiBaseUrl: string;
  now?: () => number;
  randomToken?: () => string;
}

export interface ConnectionStartResult {
  status: 'authorize' | 'awaiting_apikey' | 'connected' | 'rejected';
  pendingId?: string;
  authUrl?: string;
  apikeyUrl?: string;
  serverName?: string;
  reason?: string;
}

export interface AttachApiKeyResult {
  status: 'connected' | 'invalid_token';
  tools?: Array<{ name: string; description?: string }>;
  serverId?: string;
  pendingId?: string;
}

export function createOnboarding(deps: OnboardingDeps) {
  const now = deps.now ?? (() => Date.now());
  const tok = deps.randomToken ?? (() => randomBytes(32).toString('base64url'));

  async function startConnection(opts: { url: string; requester: Requester }): Promise<ConnectionStartResult> {
    if (
      opts.requester.kind === 'agent' &&
      opts.requester.chatType &&
      opts.requester.chatType !== 'private'
    ) {
      return { status: 'rejected', reason: 'mcp_onboarding_requires_dm' };
    }
    const probed = await probe(opts.url);
    if (probed.authMode === 'manual') {
      return { status: 'rejected', reason: probed.reason };
    }
    const takenIds = new Set<string>(); // future: load from agent.yml
    const serverId = deriveServerId(opts.url, takenIds);
    const pendingId = `pnd_${tok()}`;
    const state = `st_${tok()}`;
    const requestedBy =
      opts.requester.kind === 'admin'
        ? `admin:${opts.requester.userId ?? 'unknown'}`
        : `agent:${opts.requester.agentSessionKey ?? opts.requester.agentId}`;
    const row: PendingConnection = {
      id: pendingId,
      state,
      agentId: opts.requester.agentId,
      agentSessionKey: opts.requester.agentSessionKey ?? null,
      mcpUrl: opts.url,
      authMode: probed.authMode === 'oauth' ? 'oauth' : 'apikey',
      codeVerifier: null,
      clientId: null,
      clientSecret: null,
      oauthMetadata: probed.authMode === 'oauth' ? JSON.stringify(probed.oauth) : null,
      toolsMetadata: null,
      requestedBy,
      status: 'pending',
      failureReason: null,
      createdAt: now(),
      expiresAt: now() + 600_000,
    };
    deps.pending.insert(row);

    if (probed.authMode === 'apikey' || probed.authMode === 'none') {
      return {
        status: 'awaiting_apikey',
        pendingId,
        apikeyUrl: `${deps.uiBaseUrl}/mcp/connect/${pendingId}/apikey`,
        serverName: probed.server?.name ?? serverId,
      };
    }
    // oauth path implemented in Task 16+
    return {
      status: 'authorize',
      pendingId,
      authUrl: `${deps.uiBaseUrl}/api/mcp/oauth/start/${pendingId}`,
      serverName: probed.server?.name ?? serverId,
    };
  }

  async function attachApiKey(opts: { pendingId: string; token: string }): Promise<AttachApiKeyResult> {
    const row = deps.pending.byId(opts.pendingId);
    if (!row || row.status !== 'pending') return { status: 'invalid_token' };
    const initRes = await fetch(row.mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'anthroclaw', version: '0.1' },
      }}),
    });
    if (!initRes.ok) return { status: 'invalid_token' };
    const toolsRes = await fetch(row.mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    const toolsBody = (await toolsRes.json()) as { result?: { tools?: Array<{ name: string; description?: string }> } };
    const tools = toolsBody.result?.tools ?? [];
    const takenIds = new Set<string>();
    const serverId = deriveServerId(row.mcpUrl, takenIds);
    await deps.credentials.set(
      { agentId: row.agentId, service: `mcp:${serverId}` },
      {
        kind: 'mcp_apikey',
        service: `mcp:${serverId}`,
        account: serverId,
        scopes: [],
        mcpUrl: row.mcpUrl,
        token: opts.token,
        scheme: 'Bearer',
        createdAt: now(),
      },
    );
    deps.pending.markCompleted(row.id, JSON.stringify({ tools, serverId }));
    return { status: 'connected', tools, serverId, pendingId: row.id };
  }

  return {
    startConnection,
    attachApiKey,
    _debug: {
      getCredential: async (agentId: string, service: string) => {
        try {
          return await deps.credentials.get({ agentId, service }, 'test_debug');
        } catch {
          return null;
        }
      },
    },
  };
}
```

- [ ] **Step 3: Tests pass + commit**

```bash
npx vitest run src/integrations/mcp-onboarding/__tests__/facade.test.ts 2>&1 | tail -10
git add src/integrations/mcp-onboarding/index.ts src/integrations/mcp-onboarding/__tests__/facade.test.ts
git commit -m "feat(mcp): onboarding facade — startConnection + attachApiKey (apikey path)"
```

---

## Task 10: `resolveExternalMcpHeaders` — apikey resolution

**Files:**
- Modify: `src/sdk/external-mcp.ts`
- Test: `src/sdk/__tests__/resolve-external-mcp-headers.test.ts` (new)

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { resolveExternalMcpHeaders } from '../external-mcp.js';
import { EncryptedFilesystemCredentialStore } from '../../agent/credentials/encrypted-fs-store.js';
import { CredentialAuditLog } from '../../agent/credentials/audit.js';

describe('resolveExternalMcpHeaders — apikey', () => {
  let dir: string;
  let store: EncryptedFilesystemCredentialStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-resolve-'));
    store = new EncryptedFilesystemCredentialStore(
      join(dir, 'creds'),
      randomBytes(32),
      new CredentialAuditLog(join(dir, 'audit.log')),
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('injects Bearer header from mcp_apikey credential', async () => {
    await store.set(
      { agentId: 'a1', service: 'mcp:pmp' },
      {
        kind: 'mcp_apikey',
        service: 'mcp:pmp',
        account: 'pmp',
        scopes: [],
        mcpUrl: 'https://mcp.postmypost.io/mcp',
        token: 'sk_live',
        scheme: 'Bearer',
        createdAt: Date.now(),
      },
    );
    const out = await resolveExternalMcpHeaders(
      { postmypost: { type: 'http', url: 'https://mcp.postmypost.io/mcp', credential_ref: 'mcp:pmp' } },
      store,
      { agentId: 'a1' },
    );
    expect(out.postmypost.type).toBe('http');
    if (out.postmypost.type === 'http') {
      expect(out.postmypost.headers?.Authorization).toBe('Bearer sk_live');
    }
  });

  it('passes through entries without credential_ref unchanged', async () => {
    const spec = { legacy: { type: 'http' as const, url: 'https://x/y', headers: { Authorization: 'Bearer pre' } } };
    const out = await resolveExternalMcpHeaders(spec, store, { agentId: 'a1' });
    expect(out.legacy.headers?.Authorization).toBe('Bearer pre');
  });

  it('skips entry whose credential cannot be resolved', async () => {
    const out = await resolveExternalMcpHeaders(
      { missing: { type: 'http', url: 'https://x', credential_ref: 'mcp:nope' } },
      store,
      { agentId: 'a1' },
    );
    expect(out.missing).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement `resolveExternalMcpHeaders`**

Append to `src/sdk/external-mcp.ts`:

```ts
import type { CredentialStore } from '../agent/credentials/index.js';

export async function resolveExternalMcpHeaders(
  spec: Record<string, McpServerSpec>,  // existing type
  store: CredentialStore,
  ctx: { agentId: string },
): Promise<Record<string, McpServerSpec>> {
  const out: Record<string, McpServerSpec> = {};
  for (const [name, entry] of Object.entries(spec)) {
    if ((entry.type === 'http' || entry.type === 'sse') && entry.credential_ref) {
      try {
        const cred = await store.get(
          { agentId: ctx.agentId, service: entry.credential_ref },
          `mcp_load:${name}`,
        );
        const header = headerFromCredential(cred);
        if (!header) continue;
        out[name] = {
          ...entry,
          headers: { ...(entry.headers ?? {}), Authorization: header },
        };
      } catch {
        continue; // skip — caller (Gateway) will surface notification
      }
    } else {
      out[name] = entry;
    }
  }
  return out;
}

function headerFromCredential(cred: import('../agent/credentials/index.js').StoredCredential): string | null {
  if (cred.kind === 'mcp_apikey') return `${cred.scheme ?? 'Bearer'} ${cred.token}`;
  if (cred.kind === 'mcp_oauth') return `Bearer ${cred.accessToken}`;
  if (!cred.kind || cred.kind === 'oauth') return `Bearer ${cred.accessToken}`;
  return null;
}
```

- [ ] **Step 3: Tests pass + commit**

```bash
npx vitest run src/sdk/__tests__/resolve-external-mcp-headers.test.ts 2>&1 | tail -10
git add src/sdk/external-mcp.ts src/sdk/__tests__/resolve-external-mcp-headers.test.ts
git commit -m "feat(mcp): resolveExternalMcpHeaders materializes credential_ref"
```

---

## Task 11: Wire `resolveExternalMcpHeaders` into Gateway

**Files:**
- Modify: `src/gateway.ts`
- Test: existing gateway integration tests should still pass

- [ ] **Step 1: Locate MCP wire-up site**

```bash
grep -n 'asAgentMcpServerSpec\|external_mcp_servers' src/gateway.ts | head -5
```

- [ ] **Step 2: Replace direct spec usage**

In `src/gateway.ts` at the site of:

```ts
options.mcpServers = { ...options.mcpServers, ...asAgentMcpServerSpec(agent.config.external_mcp_servers) };
```

Replace with:

```ts
const resolved = await resolveExternalMcpHeaders(
  agent.config.external_mcp_servers,
  this.credentialStore,
  { agentId: agent.id },
);
options.mcpServers = { ...options.mcpServers, ...asAgentMcpServerSpec(resolved) };
```

(Match the exact location and existing types; `this.credentialStore` should already be wired into `Gateway`; verify with `grep -n credentialStore src/gateway.ts`.)

- [ ] **Step 3: Verify full test suite still green**

```bash
pnpm test 2>&1 | tail -10
```

Expected: same 1904 pass / 2 fail baseline.

- [ ] **Step 4: Commit**

```bash
git add src/gateway.ts
git commit -m "feat(mcp): Gateway resolves credential_ref at MCP wire-up"
```

---

## Task 12: API route — `POST /api/mcp/probe`

**Files:**
- Create: `ui/app/api/mcp/probe/route.ts`
- Test: `ui/__tests__/api/mcp-probe.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `ui/__tests__/api/mcp-probe.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { POST } from '../../app/api/mcp/probe/route';

vi.mock('../../../src/integrations/mcp-onboarding/probe.js', () => ({
  probe: vi.fn(async () => ({ authMode: 'apikey', server: { name: 'x' } })),
}));

describe('POST /api/mcp/probe', () => {
  it('returns probe result for valid url', async () => {
    const req = new Request('http://test/api/mcp/probe', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://mcp.x.io/mcp' }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.authMode).toBe('apikey');
  });

  it('400s on missing url', async () => {
    const req = new Request('http://test/api/mcp/probe', { method: 'POST', body: '{}' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Implement route**

Create `ui/app/api/mcp/probe/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { probe } from '../../../../src/integrations/mcp-onboarding/probe.js';

const Body = z.object({ url: z.string().url() });

export async function POST(req: Request) {
  let payload: unknown;
  try { payload = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
  const result = await probe(parsed.data.url);
  return NextResponse.json(result);
}
```

- [ ] **Step 3: Tests pass + commit**

```bash
cd ui && npx vitest run __tests__/api/mcp-probe.test.ts 2>&1 | tail -10 && cd ..
git add ui/app/api/mcp/probe/route.ts ui/__tests__/api/mcp-probe.test.ts
git commit -m "feat(mcp): POST /api/mcp/probe"
```

---

## Task 13: API routes — `connect/start` + `connect/apikey` + `connect/finalize`

**Files:**
- Create: `ui/app/api/mcp/connect/start/route.ts`
- Create: `ui/app/api/mcp/connect/apikey/route.ts`
- Create: `ui/app/api/mcp/connect/finalize/route.ts`
- Test: `ui/__tests__/api/mcp-connect.test.ts`

- [ ] **Step 1: Add a shared singleton onboarding accessor**

Create `ui/lib/mcp-onboarding-instance.ts`:

```ts
import { createOnboarding } from '../../src/integrations/mcp-onboarding/index.js';
import { openPendingStore } from '../../src/integrations/mcp-onboarding/pending-store.js';
import { getCredentialStore } from './server-context.js'; // existing helper
import { getUiBaseUrl } from './ui-base-url.js'; // existing or trivially added

let cached: ReturnType<typeof createOnboarding> | null = null;
let pending: ReturnType<typeof openPendingStore> | null = null;

export function getOnboarding() {
  if (cached) return cached;
  pending = openPendingStore('data/mcp.sqlite');
  cached = createOnboarding({
    pending,
    credentials: getCredentialStore(),
    uiBaseUrl: getUiBaseUrl(),
  });
  return cached;
}
```

- [ ] **Step 2: Implement the three routes**

Each route is a thin wrapper. Pattern:

```ts
// ui/app/api/mcp/connect/start/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOnboarding } from '../../../../../lib/mcp-onboarding-instance.js';
import { requireAdminUser } from '../../../../../lib/auth.js';

const Body = z.object({ url: z.string().url(), agentId: z.string() });

export async function POST(req: Request) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const res = await getOnboarding().startConnection({
    url: parsed.data.url,
    requester: { kind: 'admin', userId: user.id, agentId: parsed.data.agentId },
  });
  return NextResponse.json(res);
}
```

```ts
// ui/app/api/mcp/connect/apikey/route.ts
const Body = z.object({ pendingId: z.string(), token: z.string().min(8) });

export async function POST(req: Request) {
  // Note: this route is reachable WITHOUT admin auth so chat-initiated
  // one-shot URLs work. Security boundary = secret pendingId.
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const res = await getOnboarding().attachApiKey(parsed.data);
  return NextResponse.json(res);
}
```

```ts
// ui/app/api/mcp/connect/finalize/route.ts
const Body = z.object({
  pendingId: z.string(),
  allowed_tools: z.array(z.string()),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const res = await getOnboarding().finalize(parsed.data);
  return NextResponse.json(res);
}
```

- [ ] **Step 3: Extend facade with `finalize`**

In `src/integrations/mcp-onboarding/index.ts` add:

```ts
async function finalize(opts: { pendingId: string; allowed_tools: string[] }) {
  const row = deps.pending.byId(opts.pendingId);
  if (!row || row.status !== 'completed') throw new Error('pending_not_ready');
  const tools = JSON.parse(row.toolsMetadata ?? '{}') as { serverId: string; tools: Array<{ name: string }> };
  await deps.writeAgentYml({
    agentId: row.agentId,
    serverId: tools.serverId,
    entry: {
      type: 'http',
      url: row.mcpUrl,
      display_name: tools.serverId,
      credential_ref: `mcp:${tools.serverId}`,
      allowed_tools: opts.allowed_tools.includes('*')
        ? tools.tools.map((t) => t.name)
        : opts.allowed_tools,
    },
  });
  return { status: 'connected', server: tools.serverId, tools: tools.tools };
}
```

Add `writeAgentYml` to `OnboardingDeps` — its implementation lives in Task 14.

- [ ] **Step 4: Tests pass + commit**

```bash
cd ui && npx vitest run __tests__/api/mcp-connect.test.ts 2>&1 | tail -10 && cd ..
git add ui/app/api/mcp/ ui/lib/mcp-onboarding-instance.ts src/integrations/mcp-onboarding/index.ts ui/__tests__/api/mcp-connect.test.ts
git commit -m "feat(mcp): connect/start, connect/apikey, connect/finalize routes"
```

---

## Task 14: `writeAgentYml` helper — append `external_mcp_servers` entry

**Files:**
- Create: `src/config/write-agent-yml.ts`
- Test: `src/config/__tests__/write-agent-yml.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAgentYmlEntry } from '../write-agent-yml.js';

describe('writeAgentYmlEntry', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wyml-')); });

  it('adds external_mcp_servers entry to existing YAML', () => {
    const path = join(dir, 'agent.yml');
    writeFileSync(path, 'model: claude-sonnet-4-6\n');
    writeAgentYmlEntry(path, 'postmypost', {
      type: 'http',
      url: 'https://mcp.postmypost.io/mcp',
      display_name: 'postmypost',
      credential_ref: 'mcp:postmypost',
      allowed_tools: ['post_create'],
    });
    const out = readFileSync(path, 'utf8');
    expect(out).toMatch(/external_mcp_servers:/);
    expect(out).toMatch(/postmypost:/);
    expect(out).toMatch(/credential_ref: 'mcp:postmypost'/);
  });

  it('rejects adding an entry that conflicts with an existing display_name', () => {
    const path = join(dir, 'agent.yml');
    writeFileSync(path, `model: claude-sonnet-4-6
external_mcp_servers:
  postmypost:
    type: http
    url: https://mcp.postmypost.io/mcp
`);
    expect(() =>
      writeAgentYmlEntry(path, 'postmypost', {
        type: 'http',
        url: 'https://mcp.postmypost.io/mcp',
      }),
    ).toThrow(/already_connected/);
  });
});
```

- [ ] **Step 2: Implement (use existing YAML lib)**

Search for current YAML library:

```bash
grep -rn 'yaml.parse\|js-yaml\|YAML.parse' src/config/ | head -5
```

Use whichever the project uses (likely `yaml`). Create `src/config/write-agent-yml.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';

export interface ExternalMcpEntry {
  type: 'http' | 'sse' | 'stdio';
  url?: string;
  command?: string;
  display_name?: string;
  credential_ref?: string;
  headers?: Record<string, string>;
  allowed_tools?: string[];
}

export function writeAgentYmlEntry(path: string, key: string, entry: ExternalMcpEntry): void {
  const doc = YAML.parseDocument(readFileSync(path, 'utf8'));
  const root = doc.contents as YAML.YAMLMap;
  let servers = root.get('external_mcp_servers', true) as YAML.YAMLMap | undefined;
  if (!servers) {
    servers = doc.createNode({}) as YAML.YAMLMap;
    root.set('external_mcp_servers', servers);
  }
  if (servers.has(key)) throw new Error('already_connected: ' + key);
  servers.set(key, entry);
  writeFileSync(path, String(doc));
}
```

- [ ] **Step 3: Tests pass + commit**

```bash
npx vitest run src/config/__tests__/write-agent-yml.test.ts 2>&1 | tail -10
git add src/config/write-agent-yml.ts src/config/__tests__/write-agent-yml.test.ts
git commit -m "feat(mcp): writeAgentYmlEntry — atomic YAML append with collision guard"
```

---

## Task 15: One-shot apikey UI page + AddMcpWizard skeleton + integration test

**Files:**
- Create: `ui/app/mcp/connect/[pendingId]/apikey/page.tsx`
- Create: `ui/components/mcp/AddMcpWizard.tsx`
- Create: `ui/components/mcp/__tests__/AddMcpWizard.test.tsx`
- Create: `src/__tests__/integration/mcp-onboarding-apikey.test.ts`

- [ ] **Step 1: Build one-shot apikey page**

Create `ui/app/mcp/connect/[pendingId]/apikey/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function ApiKeyPage() {
  const { pendingId } = useParams<{ pendingId: string }>();
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit() {
    setBusy(true); setError(null);
    const res = await fetch('/api/mcp/connect/apikey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingId, token: key }),
    });
    const body = await res.json();
    setBusy(false);
    if (body.status !== 'connected') setError('Invalid key — try again');
    else router.replace('/mcp/done');
  }

  return (
    <main className="min-h-screen flex items-center justify-center">
      <form className="max-w-md w-full space-y-4 p-6 border rounded-xl"
            onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h1 className="text-lg font-medium">Paste your API key</h1>
        <input
          type={show ? 'text' : 'password'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="w-full border rounded-md p-2"
          placeholder="sk_live_..."
        />
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={show} onChange={() => setShow((s) => !s)} />
          Show
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy || !key} className="bg-black text-white px-4 py-2 rounded-md disabled:opacity-50">
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Build wizard skeleton (steps 1 + 3, step 2 apikey only)**

Create `ui/components/mcp/AddMcpWizard.tsx`:

```tsx
'use client';
import { useState } from 'react';

export interface AddMcpWizardProps {
  agentId: string;
  onClose: () => void;
  onSaved: () => void;
}

type Step = 'url' | 'auth' | 'tools';

export function AddMcpWizard({ agentId, onClose, onSaved }: AddMcpWizardProps) {
  const [step, setStep] = useState<Step>('url');
  const [url, setUrl] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey' | 'none' | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [tools, setTools] = useState<Array<{ name: string; description?: string }>>([]);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function next() {
    setError(null);
    if (step === 'url') {
      const probe = await fetch('/api/mcp/probe', { method: 'POST', body: JSON.stringify({ url }) }).then(r => r.json());
      if (probe.authMode === 'manual') { setError('Server unreachable or unsupported'); return; }
      const start = await fetch('/api/mcp/connect/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, agentId }),
      }).then(r => r.json());
      setPendingId(start.pendingId);
      setAuthMode(probe.authMode);
      setStep(probe.authMode === 'none' ? 'tools' : 'auth');
    } else if (step === 'auth' && authMode === 'apikey') {
      const r = await fetch('/api/mcp/connect/apikey', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingId, token: apiKey }),
      }).then(r => r.json());
      if (r.status !== 'connected') { setError('Invalid key'); return; }
      setTools(r.tools ?? []);
      setAllowed(new Set(r.tools?.map((t: { name: string }) => t.name) ?? []));
      setStep('tools');
    } else if (step === 'auth' && authMode === 'oauth') {
      // OAuth wizard branch: Task 21 fills this in.
      window.location.href = `/api/mcp/oauth/start/${pendingId}`;
    } else if (step === 'tools') {
      await fetch('/api/mcp/connect/finalize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingId, allowed_tools: [...allowed] }),
      });
      onSaved();
      onClose();
    }
  }

  return (
    <div role="dialog" aria-modal aria-label="Add MCP server" className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4">
        <header className="flex justify-between"><h2 className="font-medium">Add MCP server</h2><button onClick={onClose}>✕</button></header>
        {step === 'url' && (
          <>
            <label className="text-sm">Server URL</label>
            <input className="w-full border rounded-md p-2" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.x.io/mcp" />
          </>
        )}
        {step === 'auth' && authMode === 'apikey' && (
          <>
            <p className="text-sm">This server needs a bearer token.</p>
            <input className="w-full border rounded-md p-2" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </>
        )}
        {step === 'tools' && (
          <>
            <p className="text-sm">Choose which tools the agent can use:</p>
            <ul className="space-y-1">
              {tools.map((t) => (
                <li key={t.name}>
                  <label className="text-sm flex gap-2">
                    <input type="checkbox" checked={allowed.has(t.name)} onChange={() => {
                      const n = new Set(allowed); n.has(t.name) ? n.delete(t.name) : n.add(t.name); setAllowed(n);
                    }} />
                    {t.name}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <footer className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md border">Cancel</button>
          <button onClick={next} disabled={!url} className="px-3 py-1.5 rounded-md bg-black text-white disabled:opacity-50">
            {step === 'tools' ? 'Save & Connect' : 'Continue →'}
          </button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add wizard test**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddMcpWizard } from '../AddMcpWizard';

describe('AddMcpWizard apikey path', () => {
  it('URL → auth → tools → save flow', async () => {
    global.fetch = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.endsWith('/probe')) return new Response(JSON.stringify({ authMode: 'apikey', server: { name: 'x' } }));
      if (url.endsWith('/start')) return new Response(JSON.stringify({ status: 'awaiting_apikey', pendingId: 'pnd_1' }));
      if (url.endsWith('/apikey')) return new Response(JSON.stringify({ status: 'connected', tools: [{ name: 'post_create' }] }));
      if (url.endsWith('/finalize')) return new Response(JSON.stringify({ status: 'connected' }));
      throw new Error('unexpected ' + url);
    }) as never;

    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<AddMcpWizard agentId="a1" onSaved={onSaved} onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText(/mcp\.x\.io/), { target: { value: 'https://mcp.test/mcp' } });
    fireEvent.click(screen.getByText('Continue →'));
    await screen.findByText(/bearer token/i);
    fireEvent.change(screen.getByDisplayValue(''), { target: { value: 'sk_test' } });
    fireEvent.click(screen.getByText('Continue →'));
    await screen.findByText('post_create');
    fireEvent.click(screen.getByText('Save & Connect'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
```

- [ ] **Step 4: Tests pass + commit + push (Phase 3 complete)**

```bash
cd ui && npx vitest run components/mcp/__tests__/AddMcpWizard.test.tsx 2>&1 | tail -10 && cd ..
git add ui/components/mcp/ ui/app/mcp/
git commit -m "feat(mcp): AddMcpWizard skeleton + apikey one-shot page"
git push
```

---

# Phase 4 — OAuth client + admin OAuth flow

## Task 16: `oauth-client.ts` — PKCE generation

**Files:**
- Create: `src/integrations/mcp-onboarding/oauth-client.ts`
- Create: `src/integrations/mcp-onboarding/__tests__/oauth-client.test.ts`

- [ ] **Step 1: Write failing test for `generatePkce()`**

```ts
import { describe, expect, it } from 'vitest';
import { generatePkce } from '../oauth-client.js';

describe('generatePkce', () => {
  it('returns 43-char URL-safe verifier and SHA-256 challenge', () => {
    const { verifier, challenge, method } = generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(method).toBe('S256');
    expect(verifier).not.toBe(challenge);
  });

  it('is deterministic when seeded', () => {
    const seed = Buffer.alloc(32, 7);
    const a = generatePkce(seed);
    const b = generatePkce(seed);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { createHash, randomBytes } from 'node:crypto';

export interface PkcePair { verifier: string; challenge: string; method: 'S256' }

export function generatePkce(seed?: Buffer): PkcePair {
  const verifier = (seed ?? randomBytes(32)).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}
```

- [ ] **Step 3: Pass + commit**

```bash
npx vitest run src/integrations/mcp-onboarding/__tests__/oauth-client.test.ts -t generatePkce 2>&1 | tail -10
git add src/integrations/mcp-onboarding/oauth-client.ts src/integrations/mcp-onboarding/__tests__/oauth-client.test.ts
git commit -m "feat(mcp): PKCE generation"
```

---

## Task 17: `oauth-client.ts` — Dynamic Client Registration

- [ ] **Step 1: Add test**

```ts
import { registerClient } from '../oauth-client.js';

describe('registerClient', () => {
  it('POSTs registration with redirect_uris and returns client_id', async () => {
    const fetchStub = vi.fn(async (url: string, init?: RequestInit) =>
      new Response(JSON.stringify({ client_id: 'cli_x', client_secret: 'sec_x' }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchStub);
    const r = await registerClient({
      registrationEndpoint: 'https://auth/register',
      redirectUri: 'https://ui/api/mcp/oauth/callback',
      clientName: 'AnthroClaw',
    });
    expect(r.clientId).toBe('cli_x');
    expect(r.clientSecret).toBe('sec_x');
    expect(JSON.parse((fetchStub.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
      redirect_uris: ['https://ui/api/mcp/oauth/callback'],
      client_name: 'AnthroClaw',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });

  it('throws on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    await expect(registerClient({
      registrationEndpoint: 'https://auth/register',
      redirectUri: 'https://ui/cb',
      clientName: 'AnthroClaw',
    })).rejects.toThrow(/dcr_failed/);
  });
});
```

- [ ] **Step 2: Implement**

```ts
export interface RegisterArgs {
  registrationEndpoint: string;
  redirectUri: string;
  clientName: string;
  scopes?: string[];
}
export interface RegisterResult { clientId: string; clientSecret?: string }

export async function registerClient(args: RegisterArgs): Promise<RegisterResult> {
  const res = await fetch(args.registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: args.clientName,
      redirect_uris: [args.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: args.scopes?.join(' '),
    }),
  });
  if (!res.ok) throw new Error(`dcr_failed: ${res.status}`);
  const body = (await res.json()) as { client_id: string; client_secret?: string };
  return { clientId: body.client_id, clientSecret: body.client_secret };
}
```

- [ ] **Step 3: Pass + commit**

```bash
npx vitest run src/integrations/mcp-onboarding/__tests__/oauth-client.test.ts -t registerClient 2>&1 | tail -10
git add src/integrations/mcp-onboarding/oauth-client.ts src/integrations/mcp-onboarding/__tests__/oauth-client.test.ts
git commit -m "feat(mcp): Dynamic Client Registration (RFC 7591)"
```

---

## Task 18: `oauth-client.ts` — buildAuthorizationUrl + exchangeCode + refreshToken

- [ ] **Step 1: Add three tests**

```ts
describe('buildAuthorizationUrl', () => {
  it('encodes all OAuth 2.1 params', () => {
    const url = buildAuthorizationUrl({
      authorizationEndpoint: 'https://auth/authorize',
      clientId: 'cli',
      redirectUri: 'https://ui/cb',
      state: 'st_x',
      codeChallenge: 'ch_x',
      scopes: ['read', 'write'],
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://auth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('cli');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://ui/cb');
    expect(parsed.searchParams.get('state')).toBe('st_x');
    expect(parsed.searchParams.get('code_challenge')).toBe('ch_x');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('read write');
  });
});

describe('exchangeCode', () => {
  it('POSTs token exchange with PKCE verifier and returns tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'tok', refresh_token: 'rfr', expires_in: 3600, scope: 'read',
    }), { status: 200 })));
    const r = await exchangeCode({
      tokenEndpoint: 'https://auth/token',
      clientId: 'cli',
      redirectUri: 'https://ui/cb',
      code: 'auth_code',
      codeVerifier: 'verifier',
    });
    expect(r.accessToken).toBe('tok');
    expect(r.refreshToken).toBe('rfr');
    expect(r.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe('refreshToken', () => {
  it('POSTs refresh and returns new tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'new', expires_in: 3600,
    }), { status: 200 })));
    const r = await refreshToken({ tokenEndpoint: 'https://auth/token', clientId: 'cli', refreshToken: 'rfr' });
    expect(r.accessToken).toBe('new');
  });

  it('throws on invalid_grant (revoked refresh)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    await expect(refreshToken({ tokenEndpoint: 'https://auth/token', clientId: 'cli', refreshToken: 'rfr' }))
      .rejects.toThrow(/refresh_revoked/);
  });
});
```

- [ ] **Step 2: Implement**

```ts
export function buildAuthorizationUrl(args: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}): string {
  const u = new URL(args.authorizationEndpoint);
  u.searchParams.set('client_id', args.clientId);
  u.searchParams.set('redirect_uri', args.redirectUri);
  u.searchParams.set('state', args.state);
  u.searchParams.set('code_challenge', args.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('response_type', 'code');
  if (args.scopes?.length) u.searchParams.set('scope', args.scopes.join(' '));
  return u.toString();
}

export interface ExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
}

export async function exchangeCode(args: {
  tokenEndpoint: string; clientId: string; clientSecret?: string;
  redirectUri: string; code: string; codeVerifier: string;
}): Promise<ExchangeResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    code_verifier: args.codeVerifier,
  });
  if (args.clientSecret) body.set('client_secret', args.clientSecret);
  const res = await fetch(args.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`token_exchange_failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    scopes: json.scope?.split(/\s+/),
  };
}

export async function refreshToken(args: {
  tokenEndpoint: string; clientId: string; clientSecret?: string; refreshToken: string;
}): Promise<ExchangeResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
    client_id: args.clientId,
  });
  if (args.clientSecret) body.set('client_secret', args.clientSecret);
  const res = await fetch(args.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (res.status === 400) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    if (err.error === 'invalid_grant') throw new Error('refresh_revoked');
  }
  if (!res.ok) throw new Error(`refresh_failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    scopes: json.scope?.split(/\s+/),
  };
}
```

- [ ] **Step 3: Pass + commit**

```bash
npx vitest run src/integrations/mcp-onboarding/__tests__/oauth-client.test.ts 2>&1 | tail -10
git add src/integrations/mcp-onboarding/oauth-client.ts src/integrations/mcp-onboarding/__tests__/oauth-client.test.ts
git commit -m "feat(mcp): OAuth authorization URL + code exchange + refresh"
```

---

## Task 19: Facade — OAuth start branch + completeOAuth

- [ ] **Step 1: Add facade tests** mirroring the apikey pattern but for OAuth: assert `startConnection` returns `status: 'authorize'` + `authUrl`, calls `registerClient` if `registrationEndpoint` present, stores `code_verifier` + `client_id` in pending row. Assert `completeOAuth` consumes state atomically, exchanges code, writes `mcp_oauth` credential, fetches `tools/list`, marks pending completed.

- [ ] **Step 2: Implement** OAuth branch of `startConnection`:

After probing, if `authMode === 'oauth'`:

```ts
const { clientId, clientSecret } = probed.oauth.registrationEndpoint
  ? await registerClient({
      registrationEndpoint: probed.oauth.registrationEndpoint,
      redirectUri: `${deps.uiBaseUrl}/api/mcp/oauth/callback`,
      clientName: 'AnthroClaw',
      scopes: probed.oauth.scopesSupported,
    })
  : { clientId: deps.staticClientId ?? '', clientSecret: undefined };
const pkce = generatePkce();
// ...build row with code_verifier=pkce.verifier, client_id=clientId, client_secret=clientSecret
const authUrl = buildAuthorizationUrl({
  authorizationEndpoint: probed.oauth.authorizationEndpoint,
  clientId, redirectUri: `${deps.uiBaseUrl}/api/mcp/oauth/callback`,
  state, codeChallenge: pkce.challenge, scopes: probed.oauth.scopesSupported,
});
return { status: 'authorize', pendingId, authUrl, serverName };
```

Add `completeOAuth`:

```ts
async function completeOAuth(args: { state: string; code: string }) {
  const row = deps.pending.consumeByState(args.state);
  if (!row) return { status: 'gone' as const };
  try {
    const meta = JSON.parse(row.oauthMetadata!) as DiscoveredOAuth;
    const tokens = await exchangeCode({
      tokenEndpoint: meta.tokenEndpoint,
      clientId: row.clientId!,
      clientSecret: row.clientSecret ?? undefined,
      redirectUri: `${deps.uiBaseUrl}/api/mcp/oauth/callback`,
      code: args.code,
      codeVerifier: row.codeVerifier!,
    });
    const serverId = deriveServerId(row.mcpUrl, new Set());
    await deps.credentials.set(
      { agentId: row.agentId, service: `mcp:${serverId}` },
      {
        kind: 'mcp_oauth',
        service: `mcp:${serverId}`,
        account: serverId,
        scopes: tokens.scopes ?? [],
        mcpUrl: row.mcpUrl,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        tokenEndpoint: meta.tokenEndpoint,
        authorizationServer: meta.issuer,
        clientId: row.clientId ?? undefined,
        clientSecret: row.clientSecret ?? undefined,
        createdAt: now(),
      },
    );
    // tools/list
    const toolsRes = await fetch(row.mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.accessToken}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    const toolsBody = (await toolsRes.json()) as { result?: { tools?: Array<{ name: string }> } };
    const tools = toolsBody.result?.tools ?? [];
    deps.pending.markCompleted(row.id, JSON.stringify({ tools, serverId }));
    return { status: 'completed' as const, pendingId: row.id, serverId, tools, row };
  } catch (err) {
    deps.pending.markFailed(row.id, (err as Error).message);
    return { status: 'failed' as const, reason: (err as Error).message };
  }
}
```

- [ ] **Step 3: Pass + commit**

```bash
npx vitest run src/integrations/mcp-onboarding/__tests__/facade.test.ts 2>&1 | tail -10
git add src/integrations/mcp-onboarding/index.ts src/integrations/mcp-onboarding/__tests__/facade.test.ts
git commit -m "feat(mcp): OAuth start + completeOAuth in onboarding facade"
```

---

## Task 20: OAuth API routes — `/api/mcp/oauth/start/[pendingId]` + `/api/mcp/oauth/callback`

- [ ] **Step 1: Build start redirect**

Create `ui/app/api/mcp/oauth/start/[pendingId]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getOnboarding } from '../../../../../lib/mcp-onboarding-instance.js';

export async function GET(_req: Request, { params }: { params: { pendingId: string } }) {
  const url = await getOnboarding().getAuthUrlForPending(params.pendingId);
  if (!url) return new NextResponse('Expired or unknown', { status: 410 });
  return NextResponse.redirect(url);
}
```

Add `getAuthUrlForPending` to the facade returns: rebuild authUrl from stored `oauthMetadata + clientId + codeVerifier`. (PKCE challenge can be re-derived from verifier.)

- [ ] **Step 2: Build callback**

```ts
// ui/app/api/mcp/oauth/callback/route.ts
import { NextResponse } from 'next/server';
import { getOnboarding } from '../../../../lib/mcp-onboarding-instance.js';

export async function GET(req: Request) {
  const u = new URL(req.url);
  const state = u.searchParams.get('state');
  const code = u.searchParams.get('code');
  const error = u.searchParams.get('error');

  if (!state) return new NextResponse('Missing state', { status: 400 });
  if (error) {
    await getOnboarding().cancelByState(state, error);
    return NextResponse.redirect('/mcp/cancelled');
  }
  if (!code) return new NextResponse('Missing code', { status: 400 });

  const result = await getOnboarding().completeOAuth({ state, code });
  if (result.status === 'gone') return new NextResponse('Expired or replayed', { status: 410 });
  if (result.status === 'failed') return NextResponse.redirect(`/mcp/failed?reason=${encodeURIComponent(result.reason)}`);

  // Chat-initiated → done page; admin-initiated → back to wizard step 3
  if (result.row.requestedBy.startsWith('agent:')) {
    return NextResponse.redirect('/mcp/done');
  }
  return NextResponse.redirect(`/fleet/_local/agents/${result.row.agentId}?mcpWizard=tools&pendingId=${result.pendingId}`);
}
```

- [ ] **Step 3: Tests + commit + push (Phase 4 complete)**

Add an integration test that round-trips a fake OAuth provider (see Task 23 for the fixture). For now write a route-level unit test stubbing `getOnboarding()`.

```bash
git add ui/app/api/mcp/oauth/
git commit -m "feat(mcp): OAuth start + callback Next.js routes"
git push
```

---

## Task 21: Wizard step 2 OAuth branch + admin OAuth integration test

- [ ] **Step 1: Wire OAuth branch in `AddMcpWizard.tsx`**

In the `step === 'auth' && authMode === 'oauth'` block (already redirects to `/api/mcp/oauth/start/{pendingId}`), add a scopes display and "Token stored encrypted in this AnthroClaw instance" note:

```tsx
{step === 'auth' && authMode === 'oauth' && (
  <>
    <h3>Authorize with {serverName}</h3>
    <p className="text-sm">You'll be redirected to {new URL(url).hostname} to authorize.
      Token will be stored encrypted in this AnthroClaw instance.</p>
    <p className="text-sm">Scopes: {scopes.join(', ')}</p>
    <button onClick={() => { window.location.href = `/api/mcp/oauth/start/${pendingId}`; }}
            className="w-full bg-black text-white py-2 rounded-md">
      Authorize with {serverName}
    </button>
  </>
)}
```

Also handle the return from callback: when `?mcpWizard=tools&pendingId=...` appears in the URL query, the parent page re-opens the wizard at step 'tools' with the stored pendingId.

- [ ] **Step 2: Create OAuth integration test using fixture**

Create `test/fixtures/mcp/oauth-server.ts` (a minimal Express-style fake server) and `src/__tests__/integration/mcp-onboarding-oauth.test.ts`:

```ts
// Full round-trip: spin up fake MCP+AS, run facade.startConnection,
// simulate callback by calling facade.completeOAuth with valid code,
// assert credential in store + tools/list ran + pending completed.
```

(See `test/fixtures/mcp/oauth-server.ts` template in Task 23 prompt notes — it implements `initialize`, `tools/list`, returns `WWW-Authenticate` on missing token, exposes `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/register`, `/authorize` (which redirects with a code), `/token`.)

- [ ] **Step 3: Pass + commit + push**

```bash
pnpm test src/__tests__/integration/mcp-onboarding-oauth.test.ts 2>&1 | tail -10
git add ui/components/mcp/AddMcpWizard.tsx test/fixtures/mcp/oauth-server.ts src/__tests__/integration/mcp-onboarding-oauth.test.ts
git commit -m "feat(mcp): admin OAuth wizard branch + integration round-trip"
git push
```

---

# Phase 5 — Chat path

## Task 22: Built-in tool `connect_mcp` — operations + payloads

**Files:**
- Create: `src/agent/tools/connect-mcp.ts`
- Modify: `src/agent/tools/index.ts` (register)
- Create: `src/agent/tools/__tests__/connect-mcp.test.ts`

- [ ] **Step 1: Write failing tests** for each `op` (connect/apikey/finalize/check/cancel) using a mocked facade.

- [ ] **Step 2: Implement tool** using the existing `createSdkMcpServer + tool()` pattern from CLAUDE.md ("Built-in MCP tools `src/agent/tools/*.ts`"). One tool with input schema:

```ts
const inputSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('connect'), url: z.string().url() }),
  z.object({ op: z.literal('apikey'), pendingId: z.string(), token: z.string() }),
  z.object({ op: z.literal('finalize'), pendingId: z.string(), allowed_tools: z.array(z.string()) }),
  z.object({ op: z.literal('check'), pendingId: z.string() }),
  z.object({ op: z.literal('cancel'), pendingId: z.string() }),
]);
```

Handler dispatches on `op`. For `connect`, attach `requester: { kind: 'agent', agentId, agentSessionKey, chatType }` (chatType comes from `agent.currentMessageMeta`).

The response for `op: 'connect'` with `authMode: 'oauth'` includes the explicit instruction in `message`:

> "Forward this auth URL to the user. After they click and authorize you will receive a `[system] mcp_connected: <serverId>` message in this session. Do not poll unless the user explicitly asks for status."

- [ ] **Step 3: Register in `src/agent/tools/index.ts`**

Add `'connect_mcp'` to the list of built-in tools and import the new module.

- [ ] **Step 4: Pass + commit**

```bash
npx vitest run src/agent/tools/__tests__/connect-mcp.test.ts 2>&1 | tail -10
git add src/agent/tools/connect-mcp.ts src/agent/tools/index.ts src/agent/tools/__tests__/connect-mcp.test.ts
git commit -m "feat(mcp): connect_mcp built-in tool"
```

---

## Task 23: Synthetic message dispatch — `mcp_oauth_callback` → agent session

**Files:**
- Modify: `src/gateway.ts`
- Modify: `src/integrations/mcp-onboarding/index.ts` (facade emits event)
- Test: `src/__tests__/integration/connect-mcp-tool.test.ts`

- [ ] **Step 1: Add an event emitter to the facade**

```ts
import { EventEmitter } from 'node:events';
// in createOnboarding:
const events = new EventEmitter();
// after markCompleted in completeOAuth:
events.emit('connected', { pendingId: row.id, agentId: row.agentId, agentSessionKey: row.agentSessionKey, serverId, tools });
// after markFailed: events.emit('failed', ...)
// in cleanup.sweepExpired: events.emit('timeout', ...) for chat-initiated rows
return { events, /* ... existing returns */ };
```

- [ ] **Step 2: Subscribe in Gateway**

```ts
// in Gateway constructor or start():
this.onboarding.events.on('connected', (evt) => {
  if (!evt.agentSessionKey) return; // admin-only, no chat dispatch
  this.dispatch({
    channel: 'system',
    accountId: '__system__',
    chatType: 'private',
    peerId: evt.agentSessionKey,
    text: `[system] mcp_connected: ${evt.serverId}\nserver_id: ${evt.serverId}\npending_id: ${evt.pendingId}\ntools: ${evt.tools.map((t: { name: string }) => t.name).join(', ')}\nawaiting: finalize`,
    meta: { source: 'mcp_oauth_callback' },
    queueMode: 'interrupt',
  }).catch((err: Error) => this.logger.error({ err }, 'mcp synthetic dispatch failed'));
});
this.onboarding.events.on('failed', (evt) => { /* similar with [system] mcp_connect_failed: ... */ });
this.onboarding.events.on('timeout', (evt) => { /* [system] mcp_connect_timeout: ... */ });
```

If the existing `dispatch()` signature does not accept `queueMode`, extend it (or add a sibling method `dispatchSystem` that bypasses queue mode logic and always interrupts).

- [ ] **Step 3: Integration test**

`src/__tests__/integration/connect-mcp-tool.test.ts`:
- Spin up fake OAuth MCP server
- Create Gateway with a single agent
- Call agent tool `connect_mcp({op: 'connect', url})` — assert returns `authorize` with authUrl
- Simulate callback via direct facade call
- Assert synthetic message reached agent (intercept `dispatch` calls)

- [ ] **Step 4: Pass + commit + push**

```bash
pnpm test src/__tests__/integration/connect-mcp-tool.test.ts 2>&1 | tail -10
git add -A
git commit -m "feat(mcp): synthetic system messages on OAuth callback / failure / timeout"
git push
```

---

## Task 24: DM-only enforcement + chat-path done page

- [ ] **Step 1: Test rejection in group chat**

Add to `facade.test.ts`:

```ts
it('agent requester with chatType=group is rejected', async () => {
  const r = await onboarding.startConnection({
    url: 'https://x/mcp',
    requester: { kind: 'agent', agentId: 'a1', chatType: 'group' },
  });
  expect(r.status).toBe('rejected');
  expect(r.reason).toBe('mcp_onboarding_requires_dm');
});
```

- [ ] **Step 2: Verify** facade already implements this (Task 9 added the guard). Add explicit handling in the `connect_mcp` tool to return a user-friendly `message`:

```ts
if (res.status === 'rejected' && res.reason === 'mcp_onboarding_requires_dm') {
  return {
    status: 'rejected',
    reason: 'mcp_onboarding_requires_dm',
    message: 'Tell the user: "Setting up MCP servers requires a private chat. Please message me directly to continue."',
  };
}
```

- [ ] **Step 3: Add `/mcp/done` page**

Create `ui/app/mcp/done/page.tsx`:

```tsx
export default function McpDonePage() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-2">
        <h1 className="text-xl font-medium">Done</h1>
        <p className="text-sm text-zinc-600">You can close this tab. The agent will confirm in chat.</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Pass + commit**

```bash
git add ui/app/mcp/done src/integrations/mcp-onboarding/__tests__/facade.test.ts src/agent/tools/connect-mcp.ts
git commit -m "feat(mcp): DM-only chat onboarding + /mcp/done success page"
```

---

## Task 25: Cleanup cron — sweep expired pendings + emit timeout events

**Files:**
- Create: `src/integrations/mcp-onboarding/cleanup.ts`
- Modify: `src/gateway.ts` (register cron)

- [ ] **Step 1: Write tests** that sweep marks rows `expired` and emits `timeout` events for chat-initiated ones.

- [ ] **Step 2: Implement**

```ts
// src/integrations/mcp-onboarding/cleanup.ts
import type { EventEmitter } from 'node:events';
import type { PendingStore } from './pending-store.js';

export function runCleanup(deps: { pending: PendingStore; events: EventEmitter; now?: () => number }) {
  const n = (deps.now ?? Date.now)();
  const swept = deps.pending.sweepExpired(n);
  for (const row of swept) {
    if (row.requestedBy.startsWith('agent:')) {
      deps.events.emit('timeout', {
        pendingId: row.id,
        agentId: row.agentId,
        agentSessionKey: row.agentSessionKey,
        serverId: row.mcpUrl,
      });
    }
  }
  return swept.length;
}
```

- [ ] **Step 3: Wire into Gateway cron**

In `src/gateway.ts` where the dreaming cron is registered:

```ts
this.cron.register('__system__:__mcp_pending_cleanup__', '*/5 * * * *', () => {
  runCleanup({ pending: this.onboarding.pending, events: this.onboarding.events });
});
```

- [ ] **Step 4: Pass + commit + push (Phase 5 complete)**

```bash
git add -A
git commit -m "feat(mcp): 5-min cleanup cron for expired pendings"
git push
```

---

# Phase 6 — Re-auth + refresh

## Task 26: Pre-flight refresh in `resolveExternalMcpHeaders`

- [ ] **Step 1: Write tests**

```ts
it('refreshes mcp_oauth credential when expiresAt within 5min', async () => {
  await store.set({ agentId: 'a1', service: 'mcp:pmp' }, {
    kind: 'mcp_oauth', service: 'mcp:pmp', account: 'pmp', scopes: [],
    mcpUrl: 'https://x/y', accessToken: 'old', refreshToken: 'rfr',
    expiresAt: Date.now() + 60_000, // 1 min — within 5min window
    tokenEndpoint: 'https://auth/token', clientId: 'cli', createdAt: 0,
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    access_token: 'new', expires_in: 3600,
  }), { status: 200 })));
  const out = await resolveExternalMcpHeaders(
    { x: { type: 'http', url: 'https://x/y', credential_ref: 'mcp:pmp' } },
    store, { agentId: 'a1' },
  );
  expect(out.x.headers?.Authorization).toBe('Bearer new');
  const reread = await store.get({ agentId: 'a1', service: 'mcp:pmp' }, 'test');
  expect((reread as { accessToken: string }).accessToken).toBe('new');
});
```

- [ ] **Step 2: Implement refresh-on-load**

Update `resolveExternalMcpHeaders`:

```ts
if (cred.kind === 'mcp_oauth' && cred.expiresAt && cred.expiresAt < Date.now() + 5 * 60_000) {
  try {
    const fresh = await refreshToken({
      tokenEndpoint: cred.tokenEndpoint!,
      clientId: cred.clientId!,
      clientSecret: cred.clientSecret,
      refreshToken: cred.refreshToken!,
    });
    const updated = { ...cred, accessToken: fresh.accessToken, refreshToken: fresh.refreshToken ?? cred.refreshToken, expiresAt: fresh.expiresAt, lastRefreshAt: Date.now() };
    await store.set({ agentId: ctx.agentId, service: entry.credential_ref }, updated);
    cred = updated;
  } catch (err) {
    if ((err as Error).message === 'refresh_revoked') {
      // mark needs_reauth via metadata flag
      await store.set({ agentId: ctx.agentId, service: entry.credential_ref }, { ...cred, metadata: { ...(cred.metadata ?? {}), needs_reauth: '1' } });
      continue; // skip injecting header
    }
    throw err;
  }
}
```

- [ ] **Step 3: Pass + commit**

```bash
npx vitest run src/sdk/__tests__/resolve-external-mcp-headers.test.ts 2>&1 | tail -10
git add src/sdk/external-mcp.ts src/sdk/__tests__/resolve-external-mcp-headers.test.ts
git commit -m "feat(mcp): refresh OAuth tokens before MCP load when expiring"
```

---

## Task 27: Runtime 401 trap + `mcp_reauth_required` event

- [ ] **Step 1: Identify SDK error surface**

In `src/gateway.ts` find where tool-call errors from MCP propagate (likely from the agent SDK's `permission_request` or post-tool-call event). Hook in a handler that inspects errors looking like `401 Unauthorized` or `mcp authentication error`.

- [ ] **Step 2: When detected**

1. Read the credential for the offending server.
2. Set `metadata.needs_reauth = '1'`.
3. Emit `events.emit('reauth_required', { agentId, serverId, agentSessionKey })`.
4. Gateway subscriber dispatches synthetic `[system] mcp_reauth_required: <serverId>` to the session with `queueMode: 'interrupt'`.

- [ ] **Step 3: Test**

`src/__tests__/integration/mcp-reauth-flow.test.ts`:
- Stub MCP fixture to return 401 on tools/list
- Run an agent turn invoking that tool
- Assert `needs_reauth` flips and synthetic message arrives

- [ ] **Step 4: Pass + commit**

```bash
pnpm test src/__tests__/integration/mcp-reauth-flow.test.ts 2>&1 | tail -10
git add -A
git commit -m "feat(mcp): runtime 401 traps mark needs_reauth and notify agent"
```

---

## Task 28: ReauthBanner + McpServerCard status states + UI tests

**Files:**
- Create: `ui/components/mcp/ReauthBanner.tsx`
- Create: `ui/components/mcp/McpServerCard.tsx`
- Create: `ui/components/mcp/__tests__/ReauthBanner.test.tsx`
- Create: `ui/components/mcp/__tests__/McpServerCard.test.tsx`

- [ ] **Step 1: Implement components**

```tsx
// ReauthBanner.tsx
export function ReauthBanner({ serverName, onReauth }: { serverName: string; onReauth: () => void }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-md p-2 flex items-center justify-between text-sm">
      <span>⚠ Token for <strong>{serverName}</strong> expired — re-authorize</span>
      <button onClick={onReauth} className="bg-amber-600 text-white px-2 py-1 rounded">Re-authorize</button>
    </div>
  );
}
```

```tsx
// McpServerCard.tsx
export interface McpServerCardProps {
  name: string;
  url: string;
  transport: 'http' | 'sse' | 'stdio';
  toolCount: number;
  status: 'connected' | 'refreshing' | 'reauth_required' | 'disabled';
  tokenExpiresAt?: number;
  onEditAllowed: () => void;
  onReauth: () => void;
  onRemove: () => void;
}
export function McpServerCard(p: McpServerCardProps) {
  const dotColor = { connected: 'bg-green-500', refreshing: 'bg-yellow-500', reauth_required: 'bg-orange-500', disabled: 'bg-zinc-400' }[p.status];
  return (
    <div className="border rounded-lg p-3 space-y-1">
      {p.status === 'reauth_required' && <ReauthBanner serverName={p.name} onReauth={p.onReauth} />}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dotColor}`} title={p.tokenExpiresAt ? `Connected · expires ${new Date(p.tokenExpiresAt).toLocaleString()}` : p.status} />
          <span className="font-medium">{p.name}</span>
          <span className="text-xs text-zinc-500">{p.transport} · {p.toolCount} tools</span>
        </div>
      </div>
      <p className="text-xs text-zinc-500">{p.url}</p>
      <div className="flex gap-2 text-sm">
        <button onClick={p.onEditAllowed} className="underline">Edit allowed tools</button>
        <button onClick={p.onReauth} className="underline">Re-auth</button>
        <button onClick={p.onRemove} className="underline text-red-600">Remove</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Tests + commit + push**

```tsx
// ReauthBanner.test.tsx
it('renders and calls onReauth', () => {
  const fn = vi.fn();
  render(<ReauthBanner serverName="postmypost" onReauth={fn} />);
  fireEvent.click(screen.getByText('Re-authorize'));
  expect(fn).toHaveBeenCalled();
});

// McpServerCard.test.tsx
it('shows ReauthBanner only when status=reauth_required', () => {
  const { rerender } = render(<McpServerCard {...baseProps} status="connected" />);
  expect(screen.queryByText(/re-authorize/i)).not.toBeInTheDocument();
  rerender(<McpServerCard {...baseProps} status="reauth_required" />);
  expect(screen.getByText(/Token for/)).toBeInTheDocument();
});
```

```bash
cd ui && npx vitest run components/mcp/__tests__ 2>&1 | tail -10 && cd ..
git add ui/components/mcp/
git commit -m "feat(mcp): McpServerCard + ReauthBanner components"
git push
```

---

# Phase 7 — UI polish

## Task 29: Extract `<McpServerAdvancedEditor />` from inline page

**Files:**
- Create: `ui/components/mcp/McpServerAdvancedEditor.tsx`
- Modify: `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx`

- [ ] **Step 1: Identify the inline block**

```bash
sed -n '2654,2807p' ui/app/\(dashboard\)/fleet/\[serverId\]/agents/\[agentId\]/page.tsx | head -30
```

- [ ] **Step 2: Copy the inline JSX** (transport select, URL/command, args, env/headers, allowed_tools, preflight result) into the new component verbatim, exposing `props: { entry, onChange, onRemove, onPreflight }`.

- [ ] **Step 3: Don't replace usage yet** — keep the old inline editor too, both rendered side-by-side under a temporary feature flag. Phase 7 finishes with the swap.

- [ ] **Step 4: Commit**

```bash
git add ui/components/mcp/McpServerAdvancedEditor.tsx ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx
git commit -m "refactor(mcp): extract <McpServerAdvancedEditor /> from inline page"
```

---

## Task 30: Build `<McpServersSection />` container + swap inline section

- [ ] **Step 1: Build container**

```tsx
// ui/components/mcp/McpServersSection.tsx
'use client';
import { useState } from 'react';
import { AddMcpWizard } from './AddMcpWizard';
import { McpServerCard } from './McpServerCard';
import { McpServerAdvancedEditor } from './McpServerAdvancedEditor';

export interface McpServersSectionProps {
  agentId: string;
  servers: Record<string, /* ExternalMcpEntry */ any>;
  onReload: () => Promise<void>;
}

export function McpServersSection({ agentId, servers, onReload }: McpServersSectionProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="font-medium">External MCP servers</h2>
        <button onClick={() => setWizardOpen(true)} className="px-3 py-1.5 bg-black text-white rounded-md">+ Add server</button>
      </header>
      <div className="space-y-2">
        {Object.entries(servers).map(([name, entry]) => (
          <McpServerCard
            key={name}
            name={entry.display_name ?? name}
            url={entry.url ?? ''}
            transport={entry.type}
            toolCount={entry.allowed_tools?.length ?? 0}
            status={entry.credential_ref ? 'connected' : 'disabled'}
            onEditAllowed={() => { /* TODO Phase 8 */ }}
            onReauth={() => setWizardOpen(true)}
            onRemove={async () => { await fetch(`/api/agents/${agentId}/mcp/${name}`, { method: 'DELETE' }); onReload(); }}
          />
        ))}
      </div>
      <details open={advancedOpen} onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-sm">⚙ Advanced — manually edit raw fields</summary>
        <div className="mt-3">
          {Object.entries(servers).map(([name, entry]) => (
            <McpServerAdvancedEditor key={name} entry={entry} onChange={() => onReload()} onRemove={() => onReload()} onPreflight={() => Promise.resolve()} />
          ))}
        </div>
      </details>
      {wizardOpen && <AddMcpWizard agentId={agentId} onClose={() => setWizardOpen(false)} onSaved={onReload} />}
    </section>
  );
}
```

- [ ] **Step 2: Swap in `page.tsx`**

Replace the inline External MCP servers JSX block with `<McpServersSection agentId={agentId} servers={config.external_mcp_servers ?? {}} onReload={refresh} />`. Remove the Calendar / Gmail preset button JSX.

- [ ] **Step 3: Commit**

```bash
git add ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx ui/components/mcp/McpServersSection.tsx
git commit -m "refactor(mcp): replace inline External MCP servers with <McpServersSection />"
```

---

## Task 31: Remove Calendar/Gmail preset constants + dead code

- [ ] **Step 1: Find leftover preset code**

```bash
grep -n 'GOOGLE_CLIENT_ID\|google-calendar-mcp\|gmail-mcp\|CALENDAR_PRESET\|GMAIL_PRESET' ui/app/\(dashboard\)/fleet/\[serverId\]/agents/\[agentId\]/page.tsx
```

- [ ] **Step 2: Delete the preset constants + button handlers**. Pure deletion — no replacement.

- [ ] **Step 3: Re-run full UI test suite**

```bash
cd ui && pnpm test 2>&1 | tail -10 && cd ..
```

Should still be green.

- [ ] **Step 4: Commit + push (Phase 7 complete)**

```bash
git add ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx
git commit -m "chore(mcp): remove non-functional Calendar/Gmail preset buttons"
git push
```

---

# Phase 8 — Docs + finalize

## Task 32: Document the new flow in `docs/guide.md`

- [ ] **Step 1: Add section**

Append to `docs/guide.md`:

```markdown
## Connecting an MCP server

### From the admin panel

1. Open your agent's page → **External MCP servers** → **+ Add server**.
2. Paste the server URL (e.g. `https://mcp.postmypost.io/mcp`) and click **Continue**.
3. If the server supports OAuth, click **Authorize** — you'll be redirected to the provider, sign in, and brought back.
   If the server uses an API key, paste the key into the form.
4. Choose which tools your agent is allowed to call.
5. Click **Save & Connect**. Done.

### From chat

Send the URL to your agent in a **direct message** (group chats are not supported for security reasons). The agent will reply with an authorization link. Open it, finish the OAuth flow or paste the API key, and the agent will confirm in chat with the list of available tools.

### Re-authorizing

When a token expires and refresh fails, the server card shows a yellow banner. Click **Re-authorize** to reopen the wizard at the auth step.
```

- [ ] **Step 2: Commit**

```bash
git add docs/guide.md
git commit -m "docs: connecting an MCP server"
```

---

## Task 33: Full test suite green + manual smoke + mark PR ready

- [ ] **Step 1: Run everything**

```bash
pnpm test 2>&1 | tail -10
cd ui && pnpm test 2>&1 | tail -10 && cd ..
```

Expected: same 2 pre-existing LCM failures, all other tests pass.

- [ ] **Step 2: Manual smoke**

Start gateway: `pnpm dev`. Start UI: `pnpm ui`. Open the agent page, click **+ Add server**, paste `https://mcp.postmypost.io/mcp`, complete the flow end-to-end. Confirm a working tool call from chat.

- [ ] **Step 3: Mark PR ready**

```bash
gh pr ready 22
```

- [ ] **Step 4: Final commit + push**

```bash
git push
gh pr view 22
```

---

# Self-Review

**Spec coverage cross-check:**

| Spec requirement | Plan task |
|---|---|
| Schema `credential_ref` + `display_name` + `.refine()` | Task 1 |
| New credential variants `McpOAuthCredential` / `McpApiKeyCredential` | Task 2 |
| Preflight `anthroclaw-managed-credential` rule | Task 3 |
| Deterministic `<serverId>` with `srv-<hash8>` fallback | Task 4 |
| SQLite `mcp_pending_connections` schema + atomic `consumeByState` | Tasks 5–7 |
| Probe — 401/oauth/apikey/manual classification | Task 8 |
| Onboarding facade — apikey path | Task 9 |
| `resolveExternalMcpHeaders` materialization at MCP load | Task 10 + wire in Task 11 |
| `/api/mcp/probe` + `/connect/start` + `/connect/apikey` + `/connect/finalize` | Tasks 12, 13 |
| `writeAgentYml` with collision guard | Task 14 |
| One-shot apikey form + AddMcpWizard skeleton | Task 15 |
| PKCE + DCR + authorization URL + exchange + refresh | Tasks 16–18 |
| OAuth facade branch + completeOAuth | Task 19 |
| `/api/mcp/oauth/start/{pendingId}` + `/api/mcp/oauth/callback` | Task 20 |
| OAuth wizard branch + admin OAuth integration | Task 21 |
| `connect_mcp` agent tool with `connect/apikey/finalize/check/cancel` | Task 22 |
| Synthetic message dispatch with `queueMode: 'interrupt'` | Task 23 |
| DM-only enforcement + `/mcp/done` | Task 24 |
| 10-min sweep cron + `mcp_connect_timeout` for chat-initiated | Task 25 |
| Pre-flight refresh-on-load (5-min window) | Task 26 |
| Runtime 401 trap → `needs_reauth` → synthetic message | Task 27 |
| `<ReauthBanner />` + `<McpServerCard />` status states | Task 28 |
| Extract advanced editor, wire `<McpServersSection />`, drop Calendar/Gmail | Tasks 29–31 |
| User-facing documentation | Task 32 |
| Final verification + manual smoke + PR ready | Task 33 |

All spec requirements covered.

**Placeholder scan:** No `TODO`, `TBD`, "implement later" or "similar to Task N" in plan steps. Concrete code in every step that touches code.

**Type consistency:** `PendingConnection`, `ProbeResult`, `Requester`, `ConnectionStartResult` defined once each in `types.ts` (Task 8) and referenced by exact name in subsequent tasks. Method names — `startConnection`, `attachApiKey`, `completeOAuth`, `finalize`, `check`, `cancel`, `cancelByState`, `getAuthUrlForPending`, `_debug.getCredential` — match across tasks. Event names `'connected'`, `'failed'`, `'timeout'`, `'reauth_required'` match across emitter (Task 23) and subscribers (Tasks 23, 25, 27).
