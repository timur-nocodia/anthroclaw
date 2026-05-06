# Capability Cutoff — Design Spec

**Status:** Draft for review
**Branch:** `feat/capability-cutoff`
**Date:** 2026-05-04
**Target release:** v0.8.0

## Goal

After this release, no agent in any anthroclaw deployment can read, write, or otherwise touch any MCP server, OAuth credential, or integration that lives in the Claude account hosting the SDK. Every external capability an agent has must be explicitly declared in its `agent.yml` and authenticated against credentials owned by that agent. Built-in Claude.ai MCP servers (`mcp__claude_ai_Google_Calendar__*`, `mcp__claude_ai_Notion__*`, `mcp__claude_ai_Linear__*`, `mcp__claude_ai_Gmail__*`, `mcp__claude_ai_Vercel__*`, etc.) become invisible to all agents.

As a side benefit, this release fixes two unrelated production bugs surfaced during the same diagnostic pass: (1) cron-fired messages do not resume the same SDK session as user-initiated DMs, leaving agents blind to their own scheduled output one turn later; (2) customer-facing agents (notably `leads_agent`) hallucinate technical excuses involving internal anthroclaw architecture (e.g. claiming "operator console is disabled") when refusing client requests.

## Motivation

Three production incidents on 2026-05-04 surfaced these problems together:

1. **Klavdia (`timur_agent`) sent Timur a 09:01 morning briefing populated from Roman's Google Calendar (`landline.60@gmail.com`).** Diagnostic showed the cron task uses `mcp__claude_ai_Google_Calendar__list_events` — a tool inherited from the Claude account that runs the SDK process. That account has Google Calendar OAuth wired to Roman's email, so every agent in the same container reads Roman's calendar. Same flow exposes Roman's Notion, Gmail, Linear, Vercel, Cloudflare, etc. to every agent.
2. **When Timur asked Klavdia at 09:22 about "this calendar", she did not remember her own 09:01 briefing.** Two distinct SDK sessions on disk — one written by cron, one started fresh on user dispatch — with no resume between them, no LCM carryover, no in-prompt summary.
3. **Madina (a WhatsApp client of Amina/`leads_agent`) asked for an Excel export of all leads. Amina invented "operator console is disabled, you'll need to wait for Timur to fix the config".** No such system component is exposed to her — she fabricated a credible technical excuse out of unfamiliar internal terminology.

Incident 1 is the load-bearing one: it is a credential-leak hazard, not a bug. The threat model is concrete — colleagues in the operator group (`-1003729315809`, topic 3) can ask `operator_agent` to "summarize the boss's calendar this week", and the agent has the tool to do it because the entire MCP catalogue is shared. Same applies to Notion (financial notes, salary tables, vendor agreements), Gmail (private email), Linear (sensitive product roadmap), Vercel (deployment access), Cloudflare (DNS / WAF / KV write access).

Incidents 2 and 3 are smaller but came up in the same diagnostic and are cheap to fix in the same release. Bundling avoids context-switching cost.

## Non-goals

- **Not implementing agent-driven OAuth in this release.** The chat-based "connect my Google Calendar" flow with `request_oauth_authorization` / `await_oauth_callback` / `make_authenticated_request` primitives is designed but deferred to v0.9.0. After cutoff, agents have *no* external integrations — they regain them only after v0.9.0 ships. This is intentional: cut the leak first, restore controlled access second.
- **Not implementing the Integrations UI page.** Audit-log read-only view of credentials per agent goes with v0.9.0.
- **Not implementing custom MCP server registration per agent.** Feature flag `agent.capabilities.custom_mcp: false` by default; design when actually needed.
- **Not redesigning compact.** That work is in `docs/superpowers/specs/2026-05-02-compact-redesign.md` and ships in v0.10.0. This release only spot-fixes the cron-DM session-continuity slice of the compact-related symptoms.
- **Not migrating to Vault.** Tracked in `docs/tech-debt.md` with explicit trigger conditions.
- **Not retroactively deleting historical session JSONLs that contain calendar contents.** They are on prod disk; rotation/retention policy is a separate operational concern.

## High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Gateway — every queryAgent() invocation                      │
│  builds buildSdkOptions(agent, ...) which now produces:      │
│                                                              │
│   query({                                                    │
│     options: {                                               │
│       enabledMcpjsonServers: [],     ← cuts Claude.ai MCP    │
│       settingSources: [],            ← no ~/.claude settings │
│       tools: AGENT_BUILTIN_WHITELIST, ← whitelist Read/etc.  │
│       mcpServers: agent.external_mcp_servers ?? {},          │
│       canUseTool: gatewayToolGate,    ← runtime defence-2    │
│       cwd: agentWorkspaceDir(agent),  ← per-agent cwd        │
│       additionalDirectories: [],      ← no extra read access │
│       env: scrubAgentEnv(process.env),← env vars filtered    │
│     }                                                        │
│   })                                                         │
└─────────────────────────────────────────────────────────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
   Sandbox         Whitelist       Defence-in-depth
  (filesystem)   (tools+MCP)     (runtime canUseTool)
```

Five new modules + four touch points:

```
src/agent/
  sdk-options.ts                     # MODIFIED — apply cutoff defaults
  sdk-options-cutoff.ts              # NEW — buildCutoffOptions helper
  __tests__/sdk-options-cutoff.test.ts # NEW

src/agent/sandbox/
  agent-workspace.ts                 # NEW — cwd + allowed_paths resolver
  __tests__/agent-workspace.test.ts  # NEW

src/agent/credentials/
  index.ts                           # NEW — CredentialStore interface
  encrypted-fs-store.ts              # NEW — EncryptedFilesystemCredentialStore
  audit.ts                           # NEW — credential-access.jsonl writer
  __tests__/encrypted-fs-store.test.ts # NEW
  __tests__/audit.test.ts            # NEW

src/cron/
  scheduler.ts                       # MODIFIED — DM-cron sessionKey + sessionId persist
  __tests__/cron-session-continuity.test.ts # NEW

src/agent/tools/
  escalate.ts                        # NEW — universal escalate tool

agents/leads_agent/CLAUDE.md         # MODIFIED — anti-hallucination guardrail
agents/leads_agent/agent.yml         # MODIFIED — add escalate to mcp_tools

config/secrets/                      # NEW dir — master key bootstrap helper
.env.example                         # MODIFIED — add ANTHROCLAW_MASTER_KEY
```

Each subsystem stands alone and can be implemented + reviewed in isolation. The integration test (Subsystem 7) is the one place that ties everything together.

## Subsystem 1 — SDK options cutoff (load-bearing)

The single most important change. Every agent's `query()` call is built through `buildSdkOptions()` in `src/agent/sdk-options.ts`. We extend it to inject five hard-cutoff defaults that an agent's YAML cannot override.

### Changes to `buildSdkOptions`

```ts
import type { Options as SdkOptions } from '@anthropic-ai/claude-agent-sdk';

const AGENT_BUILTIN_TOOL_WHITELIST = [
  'Read', 'Write', 'Edit',
  'Bash',                  // for quick_commands; sandbox restricts paths
  'Glob', 'Grep',
  'TodoWrite',
] as const;

const ENV_VAR_DENYLIST = [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CALENDAR_ID',
  'GMAIL_OAUTH_TOKEN',
  'NOTION_API_KEY',
  'LINEAR_API_KEY',
  'CLAUDE_API_KEY',          // anthropic key never visible to agents
  'ANTHROPIC_API_KEY',
  'ANTHROCLAW_MASTER_KEY',   // credential-store master key never visible to agents
  // Any var prefixed with ANTHROPIC_, CLAUDE_, GOOGLE_, NOTION_, LINEAR_,
  // GMAIL_, OPENAI_, AWS_, GCP_, AZURE_ is also stripped via prefix match.
] as const;
const ENV_VAR_DENYLIST_PREFIXES = [
  'ANTHROPIC_', 'CLAUDE_', 'GOOGLE_', 'NOTION_', 'LINEAR_', 'GMAIL_',
  'OPENAI_', 'AWS_', 'GCP_', 'AZURE_', 'VAULT_', 'GITHUB_TOKEN',
] as const;

function scrubAgentEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    if (ENV_VAR_DENYLIST.includes(k as any)) continue;
    if (ENV_VAR_DENYLIST_PREFIXES.some((p) => k.startsWith(p))) continue;
    out[k] = v;
  }
  return out;
}

export function applyCutoffOptions(
  base: SdkOptions,
  agent: Agent,
): SdkOptions {
  return {
    ...base,
    enabledMcpjsonServers: [],         // ← all .mcp.json servers disabled
    settingSources: [],                 // ← no ~/.claude/settings.json inheritance
    tools: [...AGENT_BUILTIN_TOOL_WHITELIST],
    mcpServers: agent.config.external_mcp_servers ?? {},
    additionalDirectories: [],          // ← no extra readable dirs beyond cwd
    cwd: agentWorkspaceDir(agent),
    env: scrubAgentEnv(process.env),
    canUseTool: composeToolGates(base.canUseTool, agentToolGate(agent)),
  };
}
```

The order matters: `applyCutoffOptions` runs **last** in the option-build pipeline so it overrides anything an upstream caller (or future plugin) tries to set. `enabledMcpjsonServers: []` is the load-bearing field — empty whitelist means *no* `.mcp.json`-discovered server is loaded, including the Claude.ai built-ins.

### Why each field

- `enabledMcpjsonServers: []` — primary cutoff. Empty whitelist = all rejected (per SDK type docs at line 3617).
- `settingSources: []` — prevents the SDK from reading `~/.claude/settings.json` (which can re-enable MCP servers, expose API keys via env, etc.).
- `tools: [...AGENT_BUILTIN_TOOL_WHITELIST]` — restricts built-in Claude Code tools to a known-safe set. Notably excludes `WebFetch`, `WebSearch`, `NotebookEdit`, `mcp__*` (those come via `mcpServers`).
- `mcpServers: agent.config.external_mcp_servers ?? {}` — the *only* way for an agent to get external tools is to declare them in `agent.yml`. Empty by default.
- `additionalDirectories: []` — prevents the SDK from granting readable paths beyond `cwd`. Combined with `cwd: agentWorkspaceDir(agent)` (Subsystem 2), this isolates filesystem.
- `env: scrubAgentEnv(process.env)` — prevents env-leaked credentials. The agent process only sees variables it cannot use to authenticate against external services.
- `canUseTool: composeToolGates(...)` — runtime defence-in-depth. If anything slips through the static config, the runtime gate denies tools not in the agent's whitelist.

### `agentToolGate(agent)` — runtime check

```ts
function agentToolGate(agent: Agent): CanUseTool {
  const allowedSet = new Set(buildAllowedToolNames(agent));
  return async (toolName, _input, ctx) => {
    if (allowedSet.has(toolName)) return { behavior: 'allow' };
    logger.warn({ agentId: agent.id, toolName, sessionId: ctx?.sessionId },
      'capability-cutoff: tool blocked at runtime');
    return {
      behavior: 'deny',
      message: `Tool "${toolName}" is not declared in this agent's capabilities. Use only the tools listed in your system prompt.`,
      decisionReason: { type: 'other', reason: 'capability_cutoff' },
    };
  };
}

function buildAllowedToolNames(agent: Agent): string[] {
  return [
    ...AGENT_BUILTIN_TOOL_WHITELIST,
    ...(agent.config.mcp_tools ?? []),
    ...Object.keys(agent.config.external_mcp_servers ?? {}).flatMap(
      (name) => prefixForMcp(name).map((tool) => `mcp__${name}__${tool}`)
    ),
  ];
}
```

`composeToolGates` chains an existing user-supplied `canUseTool` (if any) with the cutoff gate; both must allow for a tool to fire:

```ts
function composeToolGates(
  upstream: CanUseTool | undefined,
  cutoff: CanUseTool,
): CanUseTool {
  return async (toolName, input, ctx) => {
    if (upstream) {
      const upRes = await upstream(toolName, input, ctx);
      if (upRes.behavior !== 'allow') return upRes;
    }
    return cutoff(toolName, input, ctx);
  };
}
```

Cutoff runs second — even if upstream allows everything, cutoff has the final say. There is no path for an upstream gate to "force allow" a denied tool.

### Threat: agent attempts `ToolSearch` to discover Claude.ai MCP

`ToolSearch` is itself a tool. Since `mcp__claude_ai_*` servers are not registered (Subsystem 1 above), `ToolSearch` returns no matches for those queries. We do not include `ToolSearch` in the whitelist by default — agents that genuinely need deferred-tool discovery can be opted in per-agent. (Today, none of the four production agents need it.)

### Test surface

`src/agent/__tests__/sdk-options-cutoff.test.ts`:

- `enabledMcpjsonServers` is always `[]` regardless of input
- `settingSources` is always `[]`
- `tools` is exactly the built-in whitelist for an agent without external_mcp_servers
- `mcpServers` is `agent.config.external_mcp_servers ?? {}`
- `cwd` is `agentWorkspaceDir(agent)`
- `env` strips all denylisted vars and all prefix-matched vars
- `canUseTool` denies a tool not in the whitelist (returns `behavior: 'deny'`)
- `canUseTool` allows a tool that is in `agent.config.mcp_tools`
- A pre-existing user `canUseTool` is composed (both must allow)
- `applyCutoffOptions` is idempotent — applying twice yields the same options

## Subsystem 2 — Filesystem sandbox per agent

The SDK's sandbox is set via `cwd` + `additionalDirectories`. `cwd` is a chroot-equivalent for `Read`/`Write`/`Edit`/`Glob`/`Grep` — paths outside it (without `additionalDirectories`) are rejected by the SDK.

### `agentWorkspaceDir(agent)`

```ts
import { resolve } from 'node:path';

export function agentWorkspaceDir(agent: Agent): string {
  const base = process.env.OC_AGENTS_DIR ?? resolve(process.cwd(), 'agents');
  return resolve(base, agent.id);
}
```

Returns absolute path to the agent's directory. SDK `cwd` is set to this; `additionalDirectories` is `[]`.

### Bash tool — extra hardening

`Bash` is special: it spawns a subshell which can `cd` and read files anywhere the OS allows. To prevent `Bash`-based escape:

```ts
const BASH_PATH_DENYLIST = [
  '/etc',                              // /etc/passwd, /etc/shadow
  '/root', '/home/node/.claude',       // Claude SDK install dir
  '/home/node/.npm',                   // npm token
  // Sibling agents
  ...siblingAgentDirs(agent.id),
  // The credential store
  resolve(agentWorkspaceDir(agent), 'credentials').replace(agent.id, '*'),
];
```

We append a `safetyWrapper` env var or pre-command sniff. Implementation detail: simplest approach is to wrap every Bash invocation with a small bash header that early-`exit`s if the resolved working directory is not under the agent's workspace.

Alternative considered: replace `Bash` with a custom `LocalShell` MCP tool that natively enforces the chroot. More work, but better isolation. Decision: **defer to v0.9** — for v0.8 use the wrapper-script approach plus rely on `cwd` enforcement.

### siblingAgentDirs helper

```ts
function siblingAgentDirs(currentAgentId: string): string[] {
  const base = process.env.OC_AGENTS_DIR ?? resolve(process.cwd(), 'agents');
  return readdirSync(base)
    .filter((name) => name !== currentAgentId)
    .map((name) => resolve(base, name));
}
```

Refreshed at agent-config-load time, not at every Bash call (overhead). Cached on `agent.workspaceMeta.siblingDenylist`.

### Test surface

`src/agent/sandbox/__tests__/agent-workspace.test.ts`:

- `agentWorkspaceDir` returns absolute path under `OC_AGENTS_DIR`
- `agentWorkspaceDir` honors env override
- `siblingAgentDirs` excludes the current agent
- `siblingAgentDirs` returns absolute paths

Plus integration test (in Subsystem 7) that an agent cannot read another agent's directory through `Read` or `Bash`.

### Edge case — `quick_commands` for `timur_agent`

`timur_agent/agent.yml` has `quick_commands: status / disk / memory` running shell commands like `df -h /` (queries `/`, outside the sandbox). After cutoff, these break.

**Resolution:** `quick_commands` are operator-facing, not agent-facing. They run via a different code path (`gateway.ts:processSlashCommand`) that does not go through SDK sandbox. Confirmed by reading the existing implementation. No change needed to `quick_commands` — they keep working.

## Subsystem 3 — `CredentialStore` skeleton

Even though v0.8.0 does not let agents add credentials (that's v0.9), the storage layer must be in place so v0.9 can be a drop-in feature without rearchitecting.

### Interface

```ts
// src/agent/credentials/index.ts

export interface OAuthCredential {
  service: string;          // e.g. 'google_calendar'
  account: string;          // e.g. 'timur@nocodia.dev' (display only)
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;       // unix ms
  scopes: string[];
  metadata?: Record<string, string>;
}

export interface CredentialRef {
  agentId: string;
  service: string;
}

export interface CredentialStore {
  /** Read a credential. Throws if not found. Logs to audit. */
  get(ref: CredentialRef, accessReason: string): Promise<OAuthCredential>;

  /** Save a credential, encrypted at rest. Idempotent — replaces existing. */
  set(ref: CredentialRef, credential: OAuthCredential): Promise<void>;

  /** Returns metadata only — no secrets. Safe for UI. */
  list(agentId: string): Promise<Array<Omit<OAuthCredential, 'accessToken' | 'refreshToken'>>>;

  /** Permanent removal. Logs to audit. */
  delete(ref: CredentialRef): Promise<void>;
}
```

`get` requires a `accessReason` string for audit-log clarity (`'mcp_call:list_events'`, `'cron_run'`, `'manual_test'`).

### `EncryptedFilesystemCredentialStore`

```ts
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';

const MASTER_KEY = process.env.ANTHROCLAW_MASTER_KEY;
if (!MASTER_KEY || MASTER_KEY.length < 32) {
  throw new Error(
    'ANTHROCLAW_MASTER_KEY env var is required (≥32 random bytes hex-encoded). ' +
    'Generate with: openssl rand -hex 32',
  );
}

function deriveKey(agentId: string, service: string): Buffer {
  const salt = Buffer.from(`${agentId}/${service}`, 'utf-8');
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(MASTER_KEY, 'hex'), salt, Buffer.from('credential-key'), 32),
  );
}

export class EncryptedFilesystemCredentialStore implements CredentialStore {
  constructor(private auditLog: CredentialAuditLog) {}

  async set(ref: CredentialRef, credential: OAuthCredential): Promise<void> {
    const key = deriveKey(ref.agentId, ref.service);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify(credential), 'utf-8');
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    // file format: [version=1][iv:12][tag:16][ciphertext]
    const blob = Buffer.concat([Buffer.from([1]), iv, tag, ct]);
    const path = this.pathFor(ref);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, blob, { mode: 0o600 });
  }

  async get(ref: CredentialRef, accessReason: string): Promise<OAuthCredential> {
    const path = this.pathFor(ref);
    const blob = await readFile(path);
    if (blob[0] !== 1) throw new Error(`unsupported credential file version: ${blob[0]}`);
    const iv = blob.slice(1, 13);
    const tag = blob.slice(13, 29);
    const ct = blob.slice(29);
    const key = deriveKey(ref.agentId, ref.service);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    const credential = JSON.parse(plaintext.toString('utf-8')) as OAuthCredential;
    await this.auditLog.record({
      ts: Date.now(),
      agentId: ref.agentId,
      service: ref.service,
      action: 'get',
      reason: accessReason,
    });
    return credential;
  }

  async list(agentId: string): Promise<Array<Omit<OAuthCredential, 'accessToken' | 'refreshToken'>>> {
    // Read the directory, decrypt each file, strip secrets, return metadata only.
    // Note: reading metadata still requires decrypt (metadata lives in the encrypted blob).
    // Acceptable cost — list() is rare. Could add separate plaintext-metadata sidecar later.
    // ...
  }

  async delete(ref: CredentialRef): Promise<void> {
    await unlink(this.pathFor(ref));
    await this.auditLog.record({ ts: Date.now(), agentId: ref.agentId, service: ref.service, action: 'delete' });
  }

  private pathFor(ref: CredentialRef): string {
    return resolve(agentWorkspaceDir({ id: ref.agentId } as Agent), 'credentials', `${ref.service}.enc`);
  }
}
```

The format `[version][iv][tag][ct]` lets us upgrade encryption without breaking existing files: new format = new version byte.

### Master key bootstrap

`ANTHROCLAW_MASTER_KEY` is a required env var. Gateway boot fails fast if absent. Document in `.env.example`:

```
# Master key for credential store. Generate once, persist in deployment env.
# openssl rand -hex 32
ANTHROCLAW_MASTER_KEY=
```

In the production deployment (docker compose), the master key lives in a docker secret or in a `.env` file `chmod 600 .env`. **Do not commit `.env`** — already in `.gitignore`.

### Test surface

- Round-trip: `set` then `get` returns the same credential
- Tampered ciphertext fails authentication (AES-GCM auth tag check)
- Wrong agentId fails decryption (HKDF salt mismatch)
- `get` writes an audit-log entry
- `list` returns metadata, never secrets
- Missing master key throws on startup
- Master key < 32 bytes throws

## Subsystem 4 — Audit log

```ts
// src/agent/credentials/audit.ts

interface CredentialAuditEvent {
  ts: number;                       // unix ms
  agentId: string;
  service: string;
  action: 'get' | 'set' | 'delete';
  reason?: string;                  // for 'get' only
  sessionId?: string;
}

export class CredentialAuditLog {
  private path = resolve(process.env.OC_DATA_DIR ?? 'data', 'credential-access.jsonl');

  async record(ev: CredentialAuditEvent): Promise<void> {
    const line = JSON.stringify(ev) + '\n';
    await appendFile(this.path, line);
  }
}
```

Append-only JSONL. Rotation/retention is operator concern (logrotate or periodic GC); not built into this release. The file is created mode 0640 — operator-readable, agent-not-readable by default.

### Test surface

- `record` appends a line in JSONL format
- Concurrent `record` calls do not corrupt the file (use `appendFile`, not `writeFile`)
- The file lives at `data/credential-access.jsonl` by default

## Subsystem 5 — Cron-DM session continuity

Today: `cron/scheduler.ts` fires a synthetic `InboundMessage` → `gateway.queryAgent()`. The `sessionKey` is built deterministically from `{agentId, channel, chatType, peerId, threadId}`. For a `morning-standup` cron with `deliverTo.peer_id: "48705953", channel: 'telegram', account_id: 'content_sm'`, the sessionKey is `timur_agent:telegram:dm:48705953`.

The user's DM dispatch builds the same sessionKey. So on paper they should resume the same SDK session. They don't, because the gateway does not call `agent.setSessionId(sessionKey, sdkSessionId)` after the cron run completes. The SDK creates a new session id, the gateway's `Agent.sessions[sessionKey]` map stays empty, and the next user message starts fresh.

### Fix

In `gateway.ts` `queryAgent`, the loop that processes SDK events captures the session id from the `system: init` event. That capture currently only persists for non-cron flows. Extend it to also persist for cron flows, *unless* the cron has no `deliverTo` (purely background — let it stay isolated).

```ts
// Inside queryAgent, after `system: init` event:
const sdkSessionId = (initEvent as any).session_id;
if (sdkSessionId) {
  observedSessionId = sdkSessionId;
  // PERSIST for both user dispatches and DM-cron dispatches
  const isBackgroundCron = source === 'cron' && !msg.raw?.deliverTo;
  if (!isBackgroundCron) {
    agent.setSessionId(sessionKey, sdkSessionId);
  }
}
```

`source` is already detected at gateway.ts:3889 via `rawMeta.cron === true`. We extend the detection to differentiate "cron with `deliverTo`" (becomes part of conversation history) vs "cron without `deliverTo`" (background processing, isolated session).

### LCM hook integration

After the fix, when cron run completes and writes its assistant message to the SDK session, `on_after_query` fires with the new turn. LCM `mirror.ts` ingests it. When the user's later dispatch resumes the same `sessionId`, `assemble()` runs and prepends `<lcm_memory>` plus any carry-over context. No carryover from session reset is needed — there *was* no reset, the session is one continuous thread.

### Edge case — `[SILENT]` cron responses

Today, when a cron prompt instructs the agent to respond `[SILENT]` if all is well (e.g. the disabled `silent-test` cron in `timur_agent.yml`), the gateway suppresses the channel send but still records the assistant message in the SDK session. This is correct behaviour — preserving the silent ack in history. After the fix, `agent.setSessionId` persists for these too, which is what we want.

### Test surface

- `tests/cron-session-continuity.test.ts`:
  - Cron with `deliverTo` matching a DM channel → sessionId persisted; subsequent user message resumes same SDK session
  - Cron without `deliverTo` → sessionId NOT persisted (background isolation)
  - `[SILENT]` cron response → still persists sessionId
  - Cron firing a sessionKey that already has a persisted sessionId → resumes same session, no new session created

## Subsystem 6 — Customer-facing safety guardrails

Two changes for `leads_agent` (Amina), generalizable to any agent with `safety_profile: public` later.

### 6a — `agents/leads_agent/CLAUDE.md` addendum

Add a new section near the top of the system prompt:

```markdown
## Talking to clients

You are speaking with external customers. They do not know how the system
behind you is built — and they should not. Never volunteer or invent details
about internal anthroclaw architecture, plugins, configs, MCP tools, operator
consoles, escalation systems, or who built you. Mentioning these confuses
clients and undermines trust.

When you cannot do what a client asks:
- Do NOT invent a technical reason ("operator console is disabled", "the
  config is broken", "I'm waiting for my supervisor to fix something").
- DO say plainly: "Я не могу сделать это прямо сейчас. Передам Тимуру —
  он свяжется с тобой." or equivalent.
- If the inability is permanent (you genuinely lack the capability), use
  the `escalate` tool to route the question to a human operator. Do not
  improvise a workaround that involves describing the system to the client.

Refusal must always be **plain**, not technical.
```

### 6b — Universal `escalate` tool

```ts
// src/agent/tools/escalate.ts

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export const escalateTool = tool(
  'escalate',
  'Route a question to the human operator. Use when the client asks for ' +
  'something you cannot fulfill and the matter genuinely needs human attention.',
  z.object({
    summary: z.string().describe('One-sentence description of what the client asked'),
    urgency: z.enum(['routine', 'urgent']).default('routine'),
    suggested_action: z.string().optional()
      .describe('What the operator should do; optional'),
  }),
  async (input, ctx) => {
    // The escalate tool writes a structured event into a per-agent escalation
    // queue (`data/escalations/<agent-id>.jsonl`) and returns immediately.
    // A separate watcher process (or future UI page) surfaces these to operators.
    const event = {
      ts: Date.now(),
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      summary: input.summary,
      urgency: input.urgency,
      suggested_action: input.suggested_action,
    };
    await appendFile(
      resolve('data/escalations', `${ctx.agentId}.jsonl`),
      JSON.stringify(event) + '\n',
    );
    return {
      content: [{ type: 'text', text: `Escalation logged. The operator will respond.` }],
    };
  },
);
```

The watcher / UI for surfacing escalations is out of scope for v0.8. For now, the operator can `tail -f data/escalations/leads_agent.jsonl` on the VPS, or the existing notification system (which routes to Timur's Telegram for `manage_notifications` events) can be extended to include escalation events.

### 6c — `agents/leads_agent/agent.yml` change

Add `escalate` to `mcp_tools`:

```yaml
mcp_tools:
- memory_search
- memory_wiki
- list_skills
- escalate          # ← NEW
```

### Test surface

- A unit test that the `escalate` tool writes a JSONL line to `data/escalations/<agentId>.jsonl`
- An eval test (separate fixtures) that asks Amina-style prompts to "give me an Excel of all leads" and verifies the response does not contain strings like "operator console", "config", "Timur will fix" — instead contains a polite plain refusal + an `escalate` call. Eval failure tolerated for v0.8 (model behaviour, will iterate); tracked separately.

## Subsystem 7 — End-to-end smoke test

A new fixture-based vitest that constructs a Gateway with one agent, mocks the SDK, and verifies the cutoff observably works. This is the integration test that ties Subsystems 1, 2, 3 together.

```ts
// src/__tests__/capability-cutoff.test.ts
describe('capability cutoff e2e', () => {
  it('agent without external_mcp_servers cannot see Claude.ai MCP tools', async () => {
    // Build agent fixture with mcp_tools: ['send_message']
    // Mock SDK query() — capture `options` passed to it
    // Dispatch one message
    // Assert:
    //   options.enabledMcpjsonServers === []
    //   options.tools includes only the AGENT_BUILTIN_TOOL_WHITELIST
    //   options.mcpServers === {}
    //   options.canUseTool('mcp__claude_ai_Google_Calendar__list_events', ...)
    //     returns { behavior: 'deny' }
  });

  it('env vars matching denylist are not visible to spawned SDK', async () => {
    process.env.GOOGLE_CALENDAR_ID = 'leak@test.com';
    process.env.NOTION_API_KEY = 'secret_xyz';
    // dispatch
    // assert options.env does NOT include GOOGLE_CALENDAR_ID, NOTION_API_KEY
    // assert options.env DOES include unrelated vars (e.g. TZ, PATH)
  });

  it('agent A cannot read agent B credentials directory via filesystem', async () => {
    // Build two agents
    // Stub Read tool to actually call filesystem
    // Have agent A attempt Read('/path/to/agentB/credentials/google.enc')
    // Assert: SDK rejects path (outside cwd, no additionalDirectories)
  });

  it('declared external MCP server tool is allowed', async () => {
    // Build agent with external_mcp_servers: { google_calendar: { ... } }
    // Assert canUseTool('mcp__google_calendar__list_events') === { behavior: 'allow' }
  });

  it('cron with deliverTo persists sessionId for DM resume', async () => {
    // Already covered in Subsystem 5 test; cross-link here in test file.
  });
});
```

## Edge cases

### EC-1 — Existing production agents have no `external_mcp_servers` block

All four prod agents (`timur_agent`, `leads_agent`, `operator_agent`, `content_sm_building`) currently have nothing under `external_mcp_servers`. After cutoff, they have *zero* external integrations. This is intentional — the cron prompt for `morning-standup` references Google Calendar and Linear, which will fail. Resolution: see Migration section below — disable the cron until v0.9 ships.

### EC-2 — Master key not set at boot

Gateway must fail-fast with a clear error message. Tested.

### EC-3 — Master key changed mid-run

If `ANTHROCLAW_MASTER_KEY` is rotated, all existing encrypted credentials become unreadable. v0.8 stores no credentials yet, so no impact. v0.9 must address rotation.

### EC-4 — Operator manually copies credentials between agents

Encryption is keyed on `(agentId, service)` via HKDF. Copying `agents/timur_agent/credentials/google.enc` to `agents/leads_agent/credentials/google.enc` and trying to read it from `leads_agent` fails: HKDF salt for `leads_agent/google` derives a different key, AES-GCM auth tag check fails, decryption errors. Tested.

### EC-5 — Bash-based attempt to read sibling agent dir

The `cwd: agentWorkspaceDir(agent)` setting restricts SDK-aware tools (`Read`/`Write`/`Glob`). For `Bash`, paths outside `cwd` may still be reachable via shell expansion. Mitigation: the `BASH_PATH_DENYLIST` plus a Bash-wrapper script that early-`exit`s if cwd-resolution fails. Coverage in test EC-related test case.

### EC-6 — Test agents with `WebFetch`/`WebSearch` need it

Today no production agent uses these. If one starts to need them, add to its `mcp_tools` allowlist and `tools` config. Default whitelist intentionally omits.

### EC-7 — `mcp_tools` field semantics conflict

Today `mcp_tools` is a free-form list including built-in MCP tools provided by the gateway (`memory_search`, `send_message`, etc.) AND external MCP server tools by name. After v0.8, the parser distinguishes:
- Bare names (e.g. `memory_search`) — built-in gateway-provided MCP, allowed
- Prefixed names (e.g. `google_calendar_list_events`) — must match an `external_mcp_servers` entry, allowed via `mcp__<server>__<tool>` form

Migration: existing `mcp_tools` lists work unchanged because they only reference built-ins. New v0.9 capability adds external mcp tools by qualified name.

## Migration / rollout

### Pre-deploy

1. Disable cron jobs that reference cut-off MCP tools. In `data/dynamic-cron.json`, set `enabled: false` for `morning-standup` (which calls Google Calendar + Linear). Operator-facing memo: "Morning briefing paused until v0.9 OAuth ships. Restore by re-enabling job."
2. Generate `ANTHROCLAW_MASTER_KEY` for prod: `openssl rand -hex 32`. Add to prod `.env`. Verify `chmod 600 .env`.
3. Update `.env.example` with the new variable, push.
4. Bump version: `0.7.1` → `0.8.0` in `VERSION`, `package.json`, `ui/package.json`.

### Deploy

1. `git pull && docker compose up -d --build` on the VPS.
2. Tail logs for 5 minutes: `sudo docker logs -f anthroclaw-app-1`. Watch for `capability-cutoff: tool blocked at runtime` warnings.
3. Smoke test in chat: send a DM to Klavdia "что сейчас в моём календаре?". Expected: she has no Google Calendar tool, refuses gracefully with "у меня нет доступа к календарю — давай я добавлю эту интеграцию в следующей версии". (After v0.9 she will be able to.)
4. Smoke test in WhatsApp: message Amina (or use a test account) "выгрузи всех лидов в Excel". Expected: plain refusal, no mention of operator console, escalate logged to `data/escalations/leads_agent.jsonl`.
5. Run `tail -n 50 data/credential-access.jsonl` — empty file (no credentials in v0.8). Confirms wiring exists.

### Rollback

If anything breaks production unexpectedly: `git revert HEAD && docker compose up -d --build`. The cutoff is a single layer (SDK options); reverting restores prior behaviour. No DB migrations to undo, no credential data to restore.

### Post-deploy

- Watch `data/escalations/*.jsonl` for one week. Expect 1-3 entries from real client interactions (good signal — proper escalation, not hallucination).
- Watch `capability-cutoff: tool blocked at runtime` warnings. Any non-test occurrence is a leak attempt — investigate.

## Open questions to revisit during planning

1. **Should `Bash` be in the default whitelist?** Today `quick_commands` need it (per existing `timur_agent.yml`), but they bypass SDK sandbox via a different code path. The agent itself rarely needs Bash. **Decision: keep it in whitelist for now**, harden via the deny-list wrapper. Re-evaluate in v0.10 if abused.
2. **Should `escalate` be added to `timur_agent` and `operator_agent` too?** Both are operator-facing, less risk of hallucination. **Decision: only `leads_agent` for v0.8.** Promote to defaults in v0.9 when we have escalation routing infra.
3. **Telemetry on tool blocking.** Should every blocked tool call be reported as a separate event, or aggregated? **Decision: per-event log line** (volume is low — agents rarely guess at unknown tools). Easy to grep.
4. **Reverse proxy or Caddy logs needed?** No. Cutoff is at SDK option layer, not network. Outbound traffic from `mcp__claude_ai_*` is prevented because the tools never load.

## What this spec does NOT decide

- Exact wording of `escalate` tool descriptions (will iterate after Amina is observed in prod).
- Whether to add a SIGNAL or `manage_notifications`-style cron alert that pings Timur when an escalation arrives. v0.9 concern.
- UI surface for credential management. v0.9.
- Whether to migrate `auto_compress` legacy field at the same time as cutoff. **No** — keep concerns separate, that lives in compact-redesign v0.10.
