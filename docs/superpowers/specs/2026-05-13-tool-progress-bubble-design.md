# Tool-progress observability bubble

**Status:** Draft
**Author:** AnthroClaw team
**Date:** 2026-05-13

## Problem

AnthroClaw agents go silent during long turns. The model can run a dozen tools — `memory_search`, `Bash`, `Read`, MCP calls — and the user sees only the final response (or worse, a stale typing indicator if the turn hangs). There is no in-chat signal that the agent is doing anything.

Hermes (reference project, `reference-projects/hermes-agent`) solves this with a "tool-progress bubble": one message in the chat that grows line by line as the agent calls tools. Each line is a short, emoji-tagged summary: `📚 skill_view: "twitter-autopilot"`, `🐍 execute_code: from pathlib import Path…`, `🔎 search_files: "*.py"`. The result is full observability without flooding the chat — one editable message per tool batch, closed when the model starts writing the answer.

We already expose `display.toolProgress: all|new|off` (`src/gateway.ts:5059`), but it ships **off** everywhere and posts each call as a separate permanent message. The goal of this spec is to upgrade that surface to Hermes parity, on by default for non-public agents, exposed end-to-end in the UI.

## Goals

- Operators can watch agents work in real time on any platform (Telegram and WhatsApp today; same logic carries forward to future channels).
- On by default for every agent **except** customer-facing ones (`safety_profile: public`).
- Implementation stays 100 % native to `@anthropic-ai/claude-agent-sdk` — no `@anthropic-ai/sdk` imports, no custom orchestration loop, no Messages-API tool loop. Built on `options.hooks` (`PreToolUse` / `PostToolUseFailure`) which AnthroClaw already wires through `src/sdk/hooks.ts`.
- All settings surface in the dashboard agent-config UI, not just in `agent.yml`.

## Non-goals

- Reasoning / extended-thinking bubbles (`showReasoning` stays off; out of scope here).
- Audit-grade tool transcript surface — that already exists in **Sessions** and the **ToolCallCard** in `components/chat-message/`. The bubble is an in-chat ephemeral surface, the Sessions view is the durable record.
- Rich expandable tool cards in chat (Telegram primitives don't allow it).
- Hermes' "first-touch onboarding hint" after a long-running tool — nice-to-have, defer.

---

## Decisions captured during brainstorming

| Decision | Value |
|---|---|
| Default per safety profile | `public` → `off`, everything else → `new` |
| Override | `agent.yml → display.toolProgress` always wins; `config.yml.defaults.display` is the layer below |
| Style | Full Hermes: editable bubble, edit throttle (1.5 s), dedup `×N`, content-break reset |
| Errors | Append `❌` to the existing tool line (no separate error row) |
| Cleanup | Bubble stays as breadcrumb by default; `display.cleanupProgress: true` deletes bubbles after a successful run, keeps them on failure |
| Subagent (`Task`) tools | Only parent-level (`🎯 Task: "<description>"`); internals hidden. Opt-in `display.subagentTools: 'all' \| 'indented'` for debugging |

---

## Architecture

### Components

```
┌───────────────────────────────┐    PreToolUse           ┌─────────────────────┐
│ @anthropic-ai/claude-agent-sdk│ ─── PostToolUseFailure──┤ src/sdk/hooks.ts    │
│  (query() turn)               │                         │ bridge → emitter    │
└──────────────┬────────────────┘                         └──────────┬──────────┘
               │ async iterator (stream events)                       │
               │   assistant.partial_text                             │
               ▼                                                      ▼
   ┌────────────────────────────────────┐               ┌─────────────────────────┐
   │ gateway.queryAgent() stream loop   │               │ HookEmitter             │
   │  - existing tool_use / tool_result │               │  on_tool_use            │
   │  - new: bubble.onContentBreak() on │               │  on_tool_error          │
   │    first partialText               │               └──────────┬──────────────┘
   └────────────────┬───────────────────┘                          │
                    │                                              │
                    │      ┌───────────────────────────────────────┘
                    ▼      ▼
            ┌──────────────────────────┐
            │ ToolProgressBubble       │   ──── sendFn / editFn / deleteFn ───►   ChannelAdapter
            │  src/channels/           │                                          (telegram.ts,
            │  tool-progress-bubble.ts │                                           whatsapp.ts)
            └──────────────────────────┘
```

### Files touched

**New**

- `src/channels/tool-progress-bubble.ts` — state machine, ~250 LOC
- `src/channels/tool-display.ts` — `getToolEmoji()`, `buildToolPreview()`, ~150 LOC
- `src/channels/__tests__/tool-progress-bubble.test.ts`
- `src/channels/__tests__/tool-display.test.ts`
- `src/channels/__tests__/display-config.test.ts`
- `ui/__tests__/agent-display-settings.test.tsx`

**Modified**

- `src/channels/display-config.ts` — new fields, `safety_profile`-aware resolution
- `src/config/schema.ts` — extend `AgentYmlSchema.display`
- `src/gateway.ts` — wire `ToolProgressBubble` into `queryAgent()`, delete current `announceToolUse` (lines ~5058-5083 and the inline call at 5205)
- `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx` — extend the Display section (~line 2504) with the new fields + resolved-default hint
- `ui/app/(dashboard)/settings/page.tsx` — add a `Display defaults` section that writes to `config.yml.defaults.display`

**Untouched**

- `src/channels/stream-consumer.ts` — content streaming is a separate pipeline
- `src/sdk/hooks.ts` — bridge already emits `on_tool_use` and `on_tool_error`; the bubble simply subscribes

**Channel adapter API extension**

`src/channels/types.ts → ChannelAdapter` currently exposes `sendText(...) → messageId` and `editText(peerId, messageId, text, opts)`, but **no `deleteText`**. The cleanup feature needs deletion.

- Add `deleteText(peerId: string, messageId: string, opts?: { accountId?: string }): Promise<void>` to the interface.
- Implement in `src/channels/telegram.ts` via grammy `ctx.api.deleteMessage(chatId, messageId)`.
- Implement in `src/channels/whatsapp.ts` via Baileys `sock.sendMessage(jid, { delete: messageKey })`. Baileys requires the original `MessageKey` (jid + id + fromMe), so the adapter caches a lightweight `messageId → MessageKey` map for messages it has just sent during the run; falls back to a best-effort delete if the key isn't cached.
- Both adapters: silently ignore failures (cleanup is best-effort).

---

## tool-display.ts (helpers)

### Emoji map

| Tool name | Emoji |
|---|---|
| `memory_search`, `memory_write`, `memory_wiki` | 🧠 |
| `web_search_brave`, `web_search_exa`, `WebSearch` | 🔎 |
| `WebFetch` | 🌐 |
| `list_skills` | 📚 |
| `manage_cron` | ⏰ |
| `send_message`, `send_media` | 📤 |
| `access_control` | 🔐 |
| `Read` | 📖 |
| `Glob` | 🔍 |
| `Grep` | 🔎 |
| `Write` | ✏️ |
| `Edit`, `NotebookEdit` | ✏️ |
| `Bash` | 💻 |
| `Task` | 🎯 |
| `TodoWrite` | ✅ |
| `mcp__*` (any MCP) | 🔌 |
| fallback | ⚡ |

Overrides via `agent.yml → display.toolEmojis: { Bash: "🚀", … }`.

### Preview heuristics

Primary argument per tool name (mirrors Hermes `build_tool_preview`):

| Tool | Field |
|---|---|
| `Bash` | `command` |
| `Read`, `Write`, `Edit`, `NotebookEdit` | `file_path` (path tail) |
| `Glob`, `Grep` | `pattern` |
| `WebSearch`, `web_search_*`, `memory_search` | `query` |
| `WebFetch` | `url` |
| `memory_write` | `content` (first ~30 chars) |
| `Task` | `description` (else `prompt`) |
| `manage_cron` | `action` |
| `mcp__*` | first string value in input |
| fallback | first string field in input |

Truncation: `display.toolPreviewLength` (default 40, 0 = no preview).

---

## ToolProgressBubble

```ts
export interface ToolProgressBubbleDeps {
  sendFn: (text: string) => Promise<string | null>;       // returns messageId
  editFn: (messageId: string, text: string) => Promise<boolean>;
  deleteFn?: (messageId: string) => Promise<void>;
  config: {
    mode: 'all' | 'new' | 'off';
    subagentTools: 'parent' | 'all' | 'indented';
    cleanupProgress: boolean;
    previewLength: number;
    toolEmojiOverrides?: Record<string, string>;
  };
}

export class ToolProgressBubble {
  onToolStart(payload: {
    toolName: string;
    toolInput: unknown;
    toolUseId: string;
    parentToolUseId?: string | null;
  }): void;
  onToolError(payload: { toolUseId: string; toolName: string }): void;
  onContentBreak(): void;
  finalize(success: boolean, options?: { silent?: boolean }): Promise<void>;
}
```

### Internal state

- `currentBubbleMessageId: string | null` — id of the currently-editable bubble (null = next start opens a fresh one).
- `lines: { toolUseId: string; text: string; errored: boolean; repeatKey: string; repeatCount: number }[]`
- `lastFlushAt: number` — for throttle (`THROTTLE_MS = 1500`)
- `pendingTimer: NodeJS.Timeout | null`
- `breadcrumbMessageIds: string[]` — collected for cleanup
- `disabled: boolean` — after `MAX_FLOOD_STRIKES = 3`
- `floodStrikes: number`
- `seenToolsInBubble: Set<string>` — for `mode: 'new'`, cleared on `onContentBreak`

### Algorithms

**`onToolStart(payload)`**

1. Drop if `mode === 'off'` or `disabled`.
2. If `payload.parentToolUseId && payload.toolName !== 'Task'`: handle per `subagentTools`:
   - `parent` → drop
   - `all` → render normally
   - `indented` → render with two-space prefix
3. If `mode === 'new'` and `payload.toolName ∈ seenToolsInBubble` → drop.
4. Build `text = emoji + name + ': "' + preview + '"'`.
5. Dedup: if `lines[last].repeatKey === text`, increment `repeatCount`, render last line as `${text} (×${count + 1})`. Otherwise push a new line.
6. `seenToolsInBubble.add(payload.toolName)`.
7. `scheduleFlush()`.

**`onToolError({ toolUseId })`**

1. Find the line whose `toolUseId === ...`. If not found → drop.
2. Append ` ❌` to that line, mark `errored = true`.
3. `scheduleFlush()`.

**`onContentBreak()`**

1. Cancel pending timer; do a final immediate flush so the current bubble lands in its final form.
2. `currentBubbleMessageId = null`; clear `lines`, `seenToolsInBubble`, `lastFlushAt = 0`.
   The next `onToolStart` will open a new bubble below the content.

**`finalize(success, options)`**

1. Cancel pending timer; final flush.
2. If `options?.silent`: delete every breadcrumb regardless of `cleanupProgress`.
3. If `cleanupProgress && success && !options?.silent && deleteFn`: delete every breadcrumb.

**`scheduleFlush()`**

1. If `pendingTimer` already set or `disabled` → return.
2. `elapsed = now - lastFlushAt`.
3. If `elapsed >= THROTTLE_MS` → `doFlush()` immediately.
4. Else `setTimeout(doFlush, THROTTLE_MS - elapsed)`.

**`doFlush()`**

1. Compose `text = lines.map(renderLine).join('\n')`. If > 4096 chars (Telegram limit), trim to last fitting line boundary and stash overflow lines for the next bubble.
2. If `currentBubbleMessageId`: `editFn(id, text)`. On reject → `floodStrikes++`; if ≥ 3 → `disabled = true`.
3. Else: `sendFn(text)`. On success → store messageId, push into `breadcrumbMessageIds`. On reject → strike counter same as above.
4. `lastFlushAt = now`.

### Filtering on `HookEmitter`

`HookEmitter` is process-global and broadcasts to every subscriber. To avoid one user's tools leaking into another user's bubble, each `ToolProgressBubble` subscribes with a filter:

```ts
const matchTurn = (p: { agentId?: string; sdkSessionId?: string }) =>
  p.agentId === agent.id && p.sdkSessionId === sessionId;
```

`sdkSessionId` is the source of truth — it's the value the SDK emits on every hook payload (see `src/sdk/hooks.ts:34`). The bubble subscribes after the first SDK event has set `sessionId`, or — to avoid losing the very first PreToolUse — subscribes immediately with `agentId-only` and once `sdkSessionId` is observed tightens the filter.

---

## Display config (resolution)

```ts
export interface DisplayConfig {
  toolProgress: 'all' | 'new' | 'off';
  streaming: boolean;
  toolPreviewLength: number;
  showReasoning: boolean;
  cleanupProgress: boolean;        // new
  subagentTools: 'parent' | 'all' | 'indented';  // new
  toolEmojis?: Record<string, string>;           // new
}

export function resolveDisplayConfig(
  platform: string,
  safetyProfile: SafetyProfile,
  agentOverrides?: Partial<DisplayConfig>,
  globalDefaults?: Partial<DisplayConfig>,
): DisplayConfig;
```

Resolution order, field by field (first non-`undefined` wins):

1. `agentOverrides` (from `agent.yml.display.*`)
2. `globalDefaults` (from `config.yml.defaults.display.*`)
3. **For `toolProgress` only:** `safetyProfile === 'public' ? 'off' : 'new'`
4. Hardcoded fallback in `GLOBAL_DEFAULTS`

Per-platform defaults (`PLATFORM_DEFAULTS`) keep their role only for `streaming` and `toolPreviewLength`, which are channel-render concerns. They no longer set `toolProgress`.

---

## UI

### Agent-level (Config tab, Display section)

`ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx` around line 2504:

| Field | Control | Default rendering |
|---|---|---|
| Tool progress | `auto` / `all` / `new` / `off` | When `auto`, render hint: `Resolved: new` (or `off` for public). Hint recomputes reactively when `safety_profile` changes. |
| Tool preview length | number input 0–200 | placeholder `40` |
| Cleanup progress | toggle | `off` |
| Subagent tools | `parent` / `all` / `indented` | `parent` |
| Show reasoning | toggle (already specced, kept off) | `off` |
| Streaming (existing) | `auto` / `enabled` / `disabled` | — |
| Tool emoji overrides | key/emoji rows (`+ Add` button) plus collapsible "Defaults" cheat sheet | empty |

`auto` is encoded as the field missing from `agent.yml` (so we don't pollute the config with explicit defaults).

### Global defaults (Settings page)

`ui/app/(dashboard)/settings/page.tsx` gets a new `Display defaults` section with the same fields. Values write to `config.yml.defaults.display.*`.

### Schema

`src/config/schema.ts`:

```ts
display: z.object({
  toolProgress: z.enum(['all', 'new', 'off']).optional(),
  toolPreviewLength: z.number().int().min(0).max(200).optional(),
  cleanupProgress: z.boolean().optional(),
  subagentTools: z.enum(['parent', 'all', 'indented']).optional(),
  showReasoning: z.boolean().optional(),
  streaming: z.boolean().optional(),
  toolEmojis: z.record(z.string(), z.string()).optional(),
}).optional()
```

Same schema is reused for `config.yml.defaults.display` validation.

---

## Wire-up in `gateway.ts`

In `queryAgent()` around line 5057:

```ts
const displayCfg = resolveDisplayConfig(
  msg.channel,
  agent.safetyProfile.name,
  agent.config.display,
  this.globalConfig.defaults?.display,
);

let bubble: ToolProgressBubble | null = null;
let unsubStart: (() => void) | null = null;
let unsubError: (() => void) | null = null;

if (displayCfg.toolProgress !== 'off') {
  const ch = this.channels.get(msg.channel);
  if (ch) {
    bubble = new ToolProgressBubble({
      sendFn: (text) => ch.sendText(msg.peerId, text, { accountId: msg.accountId, threadId: msg.threadId, parseMode: 'plain' }),
      editFn: async (mid, text) => {
        try {
          await ch.editText(msg.peerId, mid, text, { accountId: msg.accountId, threadId: msg.threadId, parseMode: 'plain' });
          return true;
        } catch { return false; }
      },
      deleteFn: displayCfg.cleanupProgress ? (mid) => ch.deleteText(msg.peerId, mid, { accountId: msg.accountId }) : undefined,
      config: {
        mode: displayCfg.toolProgress,
        subagentTools: displayCfg.subagentTools,
        cleanupProgress: displayCfg.cleanupProgress,
        previewLength: displayCfg.toolPreviewLength,
        toolEmojiOverrides: displayCfg.toolEmojis,
      },
    });

    const filter = (p: any) => p.agentId === agent.id && (!observedSessionId || p.sdkSessionId === observedSessionId);
    unsubStart = this.hookEmitter.subscribe('on_tool_use', (p) => { if (filter(p)) bubble!.onToolStart(p); });
    unsubError = this.hookEmitter.subscribe('on_tool_error', (p) => { if (filter(p)) bubble!.onToolError(p); });
  }
}
```

Inside the stream loop, the very first `partialText` for this turn triggers `bubble?.onContentBreak()` (a one-shot boolean tracks whether we've already broken). The existing `tool_use` / `tool_result` branches stay for metrics/learning — they no longer call `announceToolUse`.

In the `finally`-block:

```ts
unsubStart?.();
unsubError?.();
await bubble?.finalize(success, { silent: silentRun });
```

Where `silentRun = responseText.startsWith('[SILENT]')` — already detected upstream for delivery suppression.

---

## Edge cases

| Case | Behavior |
|---|---|
| Telegram 429 / flood control | 3 consecutive `editFn` rejections → bubble disables itself; remaining events are dropped silently; existing bubble stays in chat |
| Adapter doesn't support `editMessage` | First `onToolStart` succeeds via `sendFn`, second tries `editFn`, fails fast → `disabled = true`. Future channels that lack editing degrade to a single first-tool message |
| Budget exceeded / `result.interrupt()` | `finalize(success=false)` — breadcrumb is preserved even if `cleanupProgress: true` |
| Steered/cancelled by follow-up message | `finalize(false)` from finally block; breadcrumb stays |
| `[SILENT]` cron-fire | `finalize(true, { silent: true })` — deletes every breadcrumb regardless of `cleanupProgress` |
| Parallel tool_use in one assistant message | Throttle batches them into one edit |
| Bubble > 4096 chars (Telegram limit) | Trim to last line boundary that fits, start a new bubble for overflow lines |
| MCP 401 reauth trap | Independent path (`maybeTrapMcpReauth`) keeps working; bubble marks the failing line with `❌` via `on_tool_error` |
| Multiple concurrent users on the same agent | Each `queryAgent` has its own bubble; `HookEmitter` filter scopes events by `(agentId, sdkSessionId)` |

---

## Testing

### Unit — `tool-progress-bubble.test.ts`

- `onToolStart` happy path: send + correct emoji/preview
- Dedup: 3× identical → `×3`, 1 edit
- Mode `new`: repeat tool name in same bubble → drop
- Mode `new` after `onContentBreak`: same tool name allowed in new bubble
- Throttle: 5 events in 100 ms → 1 edit, then 1 trailing edit after the throttle window
- Reset: `onContentBreak` flushes, new `onToolStart` creates a new bubble (different messageId)
- Error: `onToolError(toolUseId)` appends `❌` to the right line
- Cleanup: `cleanupProgress: true` + `finalize(true)` → `deleteFn` called for every breadcrumb
- Cleanup off on failure: `finalize(false)` → no deletes
- Silent finalize: `finalize(true, { silent: true })` → all breadcrumbs deleted
- Flood: 3 consecutive `editFn` rejections → `disabled` flag set; further events do not call `sendFn`/`editFn`
- Subagent `parent`: `parentToolUseId` set + tool ≠ `Task` → drop
- Subagent `Task` itself: rendered as `🎯 Task: "<description>"`
- Subagent `indented`: child tool rendered with two-space prefix
- Long output: > 4096 chars → second bubble opened, no truncation mid-line

### Unit — `tool-display.test.ts`

- `getToolEmoji` for every known tool name; fallback `⚡` for unknown; override map wins
- `buildToolPreview` for each tool with correct primary arg; truncation at `maxLen`; non-string input returns `null` or empty

### Unit — `display-config.test.ts`

- `safetyProfile: 'public'` + any channel → `toolProgress = 'off'`
- `safetyProfile: 'trusted' | 'private' | 'chat_like_anthroclaw'` + any channel → `'new'`
- `agentOverrides.toolProgress = 'all'` beats safety-profile default
- `globalDefaults.toolProgress = 'all'` beats safety-profile default, loses to agent override
- All other fields independent of safety profile

### Unit — `agent-display-settings.test.tsx`

- Resolved-default hint changes when `safety_profile` select changes
- Saving emoji overrides yields `display.toolEmojis: {...}` in payload
- `toolPreviewLength` accepts 0–200, rejects negative

### Integration

Single test using a mock SDK stream that produces:

```
PreToolUse(Bash)
PreToolUse(Read)
assistant.partial_text("Here's what I found:")
PreToolUse(WebSearch)
result
```

Assertions:
- Bubble 1 = `💻 Bash …\n📖 Read …` (one send + one or two edits depending on throttle)
- Content message sent separately
- Bubble 2 = `🔎 WebSearch …` (new message under the content)
- `finalize(true)` with default cleanup → no `deleteFn` calls
- With `cleanupProgress: true` + same stream → `deleteFn` called for both bubble message ids, content message untouched

---

## Rollout

Single PR — backend + UI + tests. After merge:

1. Production agents with `safety_profile: public` (a public-profile fixture, customer assistant) automatically get `off` — no UX change.
2. Private / trusted agents (operator-assistant, Buildroom) automatically get `new` — observability turns on.
3. No migration of `agent.yml` files needed: all new fields are optional. Existing agents that explicitly set `display.toolProgress: off` keep that.
4. Operators who want chat-cleanup behaviour set `display.cleanupProgress: true` in the UI per agent — opt-in only.

---

## Open questions

- Subagent depth: spec only handles one-level-deep subagents (`parentToolUseId` set, tool ≠ `Task`). Multi-level (subagent spawns subagent) renders the same way — fine for v1, revisit if it becomes a real pattern.
- Should the bubble strip Markdown / sanitize tool inputs that contain Telegram-formatting characters? Yes — `parseMode: 'plain'` already does that on the adapter side, but the input string itself could break neighbour lines if it contains literal `\n`. Mitigation: in `buildToolPreview`, collapse all whitespace (including newlines) to single spaces. Same as Hermes `_oneline()`.
