# Self-Configuration Tools — Design Spec

**Status:** Draft for review
**Branch:** `feat/self-config-tools`
**Date:** 2026-05-01
**Predecessor:** PR #6 (Operator Control Plane) — must merge first; this spec depends on its schemas (`notifications`, `human_takeover`, `operator_console`).

## Goal

Add MCP tools that let an agent configure the three Operator Control Plane subsystems (`notifications`, `human_takeover`, `operator_console`) for itself or for another managed agent — entirely via natural-language conversation in any channel (Telegram, WhatsApp, web chat). No more YAML edits or UI clicks for routine configuration changes.

## Motivation

PR #6 ships the operator control plane with three configurable subsystems. To activate any of them today, the operator must:

- Edit `agents/{id}/agent.yml` directly, or
- Open the Handoff tab in the web UI and click through forms.

For a chat-first workflow this is friction. The desired pattern: tell the agent "send me a notification when you auto-pause" and have it actually wire up the notification config. The codebase already has precedent — `manage_cron` lets agents schedule their own cron jobs at runtime. This spec extends that pattern to subsystem configuration.

## Non-goals

- Editing config sections OUTSIDE the three OCP subsystems (no schema-wide mutation tool — too risky; pre-existing fields like `model`, `routes`, `mcp_tools` stay UI-only).
- Persona switching configuration (deferred to its own follow-up; orthogonal concern).
- Bulk migrations across multiple agents (single-agent operations only — operators can repeat the call).
- Concurrent multi-writer reconciliation strategies beyond simple file locking (single-process gateway assumed).
- Replacing the UI Handoff tab — both surfaces stay supported, with audit trail noting which one made each change.

## High-level architecture

```
              ┌───────────────────────────────────────────┐
              │  Calling agent (e.g. Klavdia in Telegram) │
              │   model decides to call manage_*           │
              └─────────────────┬─────────────────────────┘
                                │ MCP tool call
                                ▼
              ┌───────────────────────────────────────────┐
              │  manage_notifications / manage_human_     │
              │  takeover / manage_operator_console /     │
              │  show_config                              │
              │  ├ permission check (self vs target)       │
              │  ├ build patch payload                     │
              │  └ delegate to AgentConfigWriter           │
              └─────────────────┬─────────────────────────┘
                                │
                                ▼
              ┌───────────────────────────────────────────┐
              │  AgentConfigWriter (new core service)      │
              │  ├ acquire per-agent file lock             │
              │  ├ parseDocument(yaml)  (preserves comments)│
              │  ├ apply patch to target section           │
              │  ├ validate full doc against AgentYmlSchema│
              │  ├ atomic rename: write .tmp + rename      │
              │  ├ append audit entry                      │
              │  └ release lock                            │
              └─────────────────┬─────────────────────────┘
                                │ chokidar fires
                                ▼
              ┌───────────────────────────────────────────┐
              │  ConfigWatcher.reload                      │
              │   reloads agent, RouteTable, hooks, etc.   │
              └───────────────────────────────────────────┘
```

## Subsystem 1 — `AgentConfigWriter` (core service)

New module `src/config/writer.ts`. Single source of truth for any safe mutation of `agent.yml`.

### API

```ts
export type ConfigSection = 'notifications' | 'human_takeover' | 'operator_console';

export interface ConfigWriteResult {
  agentId: string;
  section: ConfigSection;
  prevValue: unknown;
  newValue: unknown;
  writtenAt: string;
  backupPath: string;
}

export interface AgentConfigWriter {
  /** Read-modify-write the given section. Patch fn returns the new section value (or null to remove the section). */
  patchSection(
    agentId: string,
    section: ConfigSection,
    patch: (current: unknown) => unknown | null,
  ): Promise<ConfigWriteResult>;

  /** Read-only view; used by show_config and tests. */
  readSection(agentId: string, section: ConfigSection): unknown;

  /** Read raw doc structure (for diagnostics / UI). */
  readFullConfig(agentId: string): unknown;
}
```

### Write algorithm

1. **Acquire lock** — per-agent in-memory mutex (`Map<string, Promise<void>>`); enqueues writes if one is in flight.
2. **Read current YAML** — `parseDocument(readFileSync(path), { keepSourceTokens: true })`. Preserves comments + key order.
3. **Apply patch** — call `patch(currentSection)`. Replace the section node in the document tree (or remove if patch returned `null`).
4. **Validate** — serialize doc to JS object via `doc.toJS()`, run `AgentYmlSchema.safeParse(...)`. If invalid, throw with the Zod error path; do not write.
5. **Backup** — copy `agent.yml` → `agent.yml.bak-{ISO-timestamp}`. Keep last 10 backups; delete older.
6. **Atomic write** — write to `agent.yml.tmp`, then `rename` (atomic on POSIX). Chokidar's debounce (already configured) coalesces the temp + rename into a single reload event.
7. **Audit** — append JSONL entry to `data/config-audit/{agentId}.jsonl`:

```jsonl
{"ts":"2026-05-01T14:00:00Z","caller":"klavdia","callerSession":"telegram:control:dm:48705953","target":"amina","section":"notifications","action":"add_subscription","prev":{...},"new":{...}}
```

8. **Release lock**.

### Failure modes

- **Schema invalid after patch** → throw `ConfigValidationError` with field-level errors; tool surfaces this back to the caller; no write.
- **Lock contention** → next caller waits (no deadlock — lock is per-agent).
- **fs error (rename failed)** → backup remains intact; throw `ConfigIoError`; no audit entry.
- **Hot reload picks up partial write** → impossible due to atomic rename; chokidar sees only the final file.
- **Concurrent UI write** — UI writes go through the same `AgentConfigWriter` (refactor existing UI save endpoints to use it). Single writer interface eliminates the race.

## Subsystem 2 — Cross-agent permission

Self-config tools accept an optional `target_agent_id` parameter. If absent → operate on the calling agent ("self"). If present → require the calling agent to have `operator-console` plugin enabled with `target_agent_id` in its `manages` list (same check as Stage 3 tools).

### Permission helper

Extract from `plugins/operator-console/src/permissions.ts` into `src/security/cross-agent-perm.ts` so self-config tools can reuse it without depending on the plugin package directly. Tool factories receive a `canManage(callerAgentId, targetAgentId)` callback.

### Defaults

Self-config tools shipped as built-in MCP (under `src/agent/tools/`), opt-in via `mcp_tools:` array. Default disallowed in `public` safety profile (HARD_BLACKLIST). Allowed in `trusted`, `private`, `chat_like_openclaw`.

## Subsystem 3 — Tools

### Tool 1: `manage_notifications`

```ts
input: {
  target_agent_id?: string;  // omitted = self
  action:
    | { kind: 'set_enabled'; enabled: boolean }
    | { kind: 'add_route'; name: string; route: { channel; account_id; peer_id } }
    | { kind: 'remove_route'; name: string }
    | { kind: 'list_routes' }
    | { kind: 'add_subscription'; subscription: { event; route; schedule?; throttle?; filter? } }
    | { kind: 'remove_subscription'; index: number }    // by position
    | { kind: 'list_subscriptions' }
    | { kind: 'test'; route_name: string };             // sends a test notification through that route
}

output: {
  ok: boolean;
  result?: unknown;     // for list_* actions
  changed?: boolean;    // false if action was a no-op
  validation_error?: string;
}
```

Behavior:
- `set_enabled: true` on a section that doesn't exist → seeds the block with empty routes/subscriptions.
- `add_route` with a name that already exists → overwrite with new value (audit logs both prev and new).
- `add_subscription` → append to array; later `list_subscriptions` shows index used by `remove_subscription`.
- `test` → fires a synthetic `notifications.test_dispatch` event through the named route; useful for verifying connectivity.

### Tool 2: `manage_human_takeover`

```ts
input: {
  target_agent_id?: string;
  enabled?: boolean;
  pause_ttl_minutes?: number;
  channels?: ('whatsapp' | 'telegram')[];
  ignore?: ('reactions' | 'receipts' | 'typing' | 'protocol')[];
  notification_throttle_minutes?: number;
  // null on any of these removes the field; undefined = keep current
}

output: {
  ok: boolean;
  applied: { [field]: { prev, new } };
  validation_error?: string;
}
```

Patch-style: omit fields you don't want to change. Pass `null` to reset to schema default. Setting `enabled: true` on missing block seeds with defaults.

### Tool 3: `manage_operator_console`

```ts
input: {
  target_agent_id?: string;
  enabled?: boolean;
  manages?: string[] | '*';                              // full replacement
  manages_action?: { kind: 'add' | 'remove'; agent_id: string };  // incremental
  capabilities?: ('peer_pause' | 'delegate' | 'list_peers' | 'peer_summary' | 'escalate')[];
  // mutually exclusive: pass either `manages` OR `manages_action`, not both
}

output: { ok, applied, validation_error? }
```

The `manages_action` form lets natural conversation say "also let me manage Larry" without re-listing the existing managed agents. Tool factory enforces mutual exclusion.

### Tool 4: `show_config`

```ts
input: {
  target_agent_id?: string;
  sections?: ('notifications' | 'human_takeover' | 'operator_console' | 'all')[];
}

output: {
  agent_id: string;
  sections: { [section]: unknown };  // current values, including defaults applied by Zod
  last_modified?: { at: string; by: string; section: ConfigSection };  // from audit log
}
```

Read-only. No permission required for `target_agent_id === self`. Cross-agent read requires `canManage`. Useful for verification before/after mutations and for the operator agent to "check what's wired up".

## Subsystem 4 — UI integration

### Read-side: "Last modified by chat" indicator

Each Handoff tab card (`HumanTakeoverCard`, `NotificationsCard`) shows the most recent audit entry:

```
Last modified: 3 hours ago via chat (klavdia)
```

API endpoint: `GET /api/agents/[agentId]/config-audit?section=notifications&limit=1`.

### Write-side: refactor UI save to go through `AgentConfigWriter`

Existing UI save endpoints (e.g. `PATCH /api/agents/[id]/config`) are refactored to call `AgentConfigWriter.patchSection`. This makes UI and chat go through the same code path — single source of truth for mutations and audit log.

### New surface: Audit log panel

Optional v1 — `ui/components/handoff/ConfigAuditPanel.tsx` shows a per-agent timeline of config changes. Columns: timestamp | caller | section | action | diff. Filter by section. Useful for debugging "why did my notifications get disabled?" Not a blocker for v1; can ship in PR #8.

## Schema additions

No new fields in `AgentYmlSchema`. The existing `notifications`, `human_takeover`, `operator_console` blocks are mutated; their schemas remain unchanged.

The `mcp_tools:` allowlist gains four new entries that operators must opt into:

```yaml
mcp_tools:
  - manage_notifications
  - manage_human_takeover
  - manage_operator_console
  - show_config
```

In `src/security/builtin-tool-meta.ts` — register all four with `hard_blacklist_in: ['public']` to keep them out of public-facing agents.

## File layout

```
src/
  config/
    writer.ts                     # AgentConfigWriter implementation
    __tests__/writer.test.ts
  security/
    cross-agent-perm.ts           # extracted permission helper
    builtin-tool-meta.ts          # add 4 new entries
  agent/tools/
    manage-notifications.ts
    manage-human-takeover.ts
    manage-operator-console.ts
    show-config.ts
    __tests__/manage-*.test.ts
  __tests__/integration/self-config-tools.test.ts

ui/
  app/api/agents/[agentId]/config-audit/route.ts        # GET audit entries
  components/handoff/
    HumanTakeoverCard.tsx          # add "Last modified" line
    NotificationsCard.tsx          # add "Last modified" line
    ConfigAuditPanel.tsx           # optional v1 timeline view

data/                              # runtime — created on first write
  config-audit/{agentId}.jsonl
  agents/{agentId}/agent.yml.bak-*  # last 10 backups per agent
```

## Permission model

| Caller | Target | Result |
|--------|--------|--------|
| Self | Self | Allowed if `mcp_tools` includes the manage tool |
| Self | Other | Allowed only if caller's `operator_console.manages` includes target |
| Self | `*` (super) | Allowed if caller's `operator_console.manages === '*'` |

`public` profile blocks all four tools at safety-validation time (HARD_BLACKLIST). Migration script does NOT need updating — these tools are new, no existing agents reference them.

## Audit format

`data/config-audit/{agentId}.jsonl` — one line per write, append-only:

```jsonl
{"ts":"...","caller_agent":"klavdia","caller_session":"telegram:control:dm:48705953","target_agent":"amina","section":"notifications","action":"add_subscription","prev":{...},"new":{...},"source":"chat"|"ui"}
```

Source tags distinguish chat-driven from UI-driven changes. UI saves get `source: "ui"`; tools get `source: "chat"`. Useful for the "Last modified by" indicator.

Rotation: file capped at 10 MB; on rollover, rename to `{agentId}.jsonl.{N}` (keep last 5).

## Hot reload

Existing `src/config/watcher.ts` already debounces and reloads agents on YAML changes. After `AgentConfigWriter` writes, chokidar fires, watcher reloads. The reloaded `Agent` instance picks up the new config; `RouteTable` rebuilds; cron and notifications re-subscribe.

Verification: write a fresh `notifications.subscriptions` entry via `manage_notifications` → trigger a `peer_pause_started` event → assert the new subscription delivers.

## Testing strategy

### Unit tests

- `writer.ts` — patch each section; lock contention serializes writes; backup file created; rename atomic; schema validation rejects malformed patches; null patch removes section.
- Each tool's permission branch (self / managed target / unauthorized target).
- `manage_human_takeover` patch semantics (omit = keep, null = reset to default).
- `manage_operator_console` mutual exclusion of `manages` and `manages_action`.
- `show_config` read-only; cross-agent permission check for cross-agent reads.

### Integration tests

- Chat → tool call → file write → chokidar fires → agent reloads with new config (use real chokidar; the existing tests already do this for `agent.yml` changes).
- Concurrent writes serialize via lock (two parallel `patchSection` calls produce sequential audit entries, both writes succeed).
- UI save and chat tool both write through `AgentConfigWriter` → audit log shows both with correct `source` tags.
- Cross-agent: Klavdia (with `operator_console.manages: ['amina']`) calls `manage_notifications({ target_agent_id: 'amina', ... })` → Amina's YAML updated.

### Contract tests

- No `@anthropic-ai/sdk` import added.
- New tools are blocked under `public` safety profile.

## Migration / backward compatibility

- Existing agents without these tools in `mcp_tools` continue to work unchanged. Tools are opt-in.
- UI save endpoints refactored to `AgentConfigWriter` — behavior unchanged from the user's perspective; only code path consolidated.
- `data/config-audit/` directory created lazily on first write.
- Existing `migrate-safety-profile` script unaffected.

## Rollout

Single PR, three commit groups:

1. **Stage 1 — `AgentConfigWriter` + audit infrastructure** (~5 tasks)
   Core service, lock, atomic rename, audit log, schema validation. Standalone — no tools yet, but UI save endpoints can already be migrated to it.

2. **Stage 2 — 4 MCP tools + permission integration** (~7 tasks)
   `manage_notifications`, `manage_human_takeover`, `manage_operator_console`, `show_config`. Cross-agent permission helper extracted. `builtin-tool-meta.ts` registrations.

3. **Stage 3 — UI surface** (~4 tasks)
   "Last modified" indicators on HumanTakeoverCard / NotificationsCard. Audit log API endpoint. Optional ConfigAuditPanel for v1.

Total ~16 tasks. Estimated 2-3 hours of subagent-driven work.

Stage 1 acceptance: UI save through `AgentConfigWriter` works, audit entries are written, rollback via backup file.
Stage 2 acceptance: chat in Telegram with Klavdia → "set up notifications to me" → Amina's `notifications` block populated → subsequent pause triggers a Telegram notification.
Stage 3 acceptance: Handoff tab shows last-modified info; clicking refresh reflects chat-driven changes within 10s.

## Open questions

1. **Test action for notifications**: should `manage_notifications({ kind: 'test' })` use a dedicated synthetic event, or piggy-back on `peer_pause_started`? *Spec: dedicated synthetic event `notifications.test_dispatch` to avoid polluting pause history.*

2. **Backup retention**: 10 backups per agent — too few/many? *Spec: 10 is enough for a working day of edits; pruning policy can be configurable later.*

3. **Lock granularity**: per-agent vs global? *Spec: per-agent. Global would over-serialize unrelated agents.*

4. **Audit log retention**: cap at 10 MB → 5 rolled files = 50 MB per agent over time. *Spec: configurable via global `config_audit.max_file_bytes` and `max_files`. Defaults are fine for v1.*

5. **What if a user hand-edits `agent.yml` while a tool write is in flight?** *Spec: chokidar reloads after each write; user's edit and tool write both pass through the same Zod validation, so neither corrupts state. Audit log will show both as separate entries (with different `source` tags). User confusion possible — document this in the user-facing error message if a write fails because the on-disk file changed since the tool's read.*

6. **Should `show_config` be allowed under `public` safety profile?** *Spec: yes — it's read-only; no risk. Only the three `manage_*` tools are HARD_BLACKLIST'd in public.*

## Self-review

### Spec coverage
- All four tools specified end-to-end (input, output, behavior, validation).
- Persistence approach committed (Option A: mutate YAML directly with comment-preserving library + atomic rename).
- Permission model documented (manager-side via `operator_console.manages` list).
- UI integration covered (read-side "last modified" + write-side refactor + optional audit panel).

### Placeholder scan
None. Every code surface lists specific file path and behavior.

### Internal consistency
- `AgentConfigWriter` API used consistently across tools and UI refactor.
- Schema field names match between tools and existing `notifications` / `human_takeover` / `operator_console` schemas (snake_case throughout).
- Audit format consistent across tool writes and UI writes.
- Permission helper extraction documented (from plugin to `src/security/`) and reused by all four tools.

### Ambiguity check
- Self vs target distinguished clearly.
- "null patch removes field" vs "undefined keeps field" semantic stated explicitly.
- Mutual exclusion of `manages` and `manages_action` enforced at tool factory level.
- Open questions section captures remaining design discretion.
