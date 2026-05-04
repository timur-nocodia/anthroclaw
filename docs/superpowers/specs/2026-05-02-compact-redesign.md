# Compact Redesign — Design Spec

**Status:** Draft for review
**Branch:** `feat/compact-redesign`
**Date:** 2026-05-02

## Goal

Replace the current message-count-triggered, save-summary-to-file compact path with a token-triggered, in-context summary-injection compact path modelled on Claude Code's `compactConversation` flow. After a compact event, the agent must continue the conversation with full awareness of what was discussed — no "тупит после компакта" effect, no reliance on the model proactively calling `memory_search` to recover its own context.

LCM stays in the system as an opt-in **retrieval layer** (long-history grep, hierarchical recall) layered on top of the new core compact — not as an alternate compact engine.

## Motivation

Three independent problems in the current implementation, captured here so that any future engineer can see what we are escaping:

### Problem 1 — The summary is on disk, not in the next prompt

`gateway.ts:4781` (`summarizeAndSaveSession`) runs a synthetic prompt asking the agent to write 2-5 bullets and call `memory_write`. Then `agent.clearSession(sessionKey)` deletes the SDK session-id mapping, so the next inbound message starts a fresh SDK session.

The fresh session sees:

- The full system prompt (`CLAUDE.md`)
- A `<memory-context>` block containing **only paths**: `Today's memory: agents/<id>/memory/2026/05/02.md` and yesterday's
- The current user message

It does **not** see the just-written summary. The agent has to actively call `memory_search` for the right keywords to recover any of it. Until that happens, it answers from a near-empty context — re-asks things, loses tone, drops pending tasks. This is the "тупит после компакта" symptom users report.

### Problem 2 — Trigger is by message count, not tokens

`gateway.ts:3774-3782`:

```ts
const compressor = new SessionCompressor({
  enabled: true,
  thresholdMessages: compressConfig?.threshold_messages ?? 30,
});
const msgCount = agent.getMessageCount(sessionKey) * 2;
if (compressor.shouldCompress(msgCount) && agent.getSessionId(sessionKey)) { ... }
```

`incrementMessageCount` increments by 1 per dispatched user message. The `* 2` simulates "user + agent". So default `threshold_messages: 30` fires after **15 user turns**, regardless of message length. 15 short "ok"-replies trigger compact at the same point as 15 dense paragraphs that already filled the context window.

Worse: the only knob in the schema is `auto_compress.threshold_messages` (`src/config/schema.ts:428-431`), but the UI input is labelled "Auto-compress (tokens)" and writes a bare number — see Problem 3.

### Problem 3 — The "Auto-compress (tokens)" UI field is silently broken

`ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx:1661-1674` renders a number input bound to `cfg.auto_compress: number`. On save (`page.tsx:1482-1535`), `auto_compress` is **not** destructured separately — it stays in the `rest` payload as a bare number, which the PUT handler stringifies into YAML as `auto_compress: 40000`. Schema validation in `updateAgentConfig` rejects this (it expects an object `{enabled, threshold_messages}`). The error is swallowed by `catch { /* silently fail */ }` at `page.tsx:1531-1533`. No agent on disk has ever been successfully saved with this field — all three existing `auto_compress` blocks (`leads_agent`, `content_sm_building`, `example`) were hand-written.

### Why a redesign rather than three separate fixes

The three problems share a root: the compact path was built around "save to memory file, hope the agent re-reads it." Replacing the inject mechanism (Problem 1) requires a richer summary, which requires a token-based trigger to know *when* the prompt is actually approaching the model's window (Problem 2). The UI field needs a coherent semantic model to map onto (Problem 3). Each fix on its own would still leave the other two broken or inconsistent.

## Non-goals

- **No file/skill/plan re-injection.** Claude Code's `createPostCompactFileAttachments`, `createSkillAttachmentIfNeeded`, `createPlanAttachmentIfNeeded` are coding-assistant primitives. Our agents converse with users — there are no atomic "files" to re-read, no "skills" to re-announce, no "plan mode" to preserve. We omit these whole subsystems.
- **No tool-catalog delta announcements.** `getDeferredToolsDeltaAttachment` etc. exist because Claude Code dynamically loads tools mid-session. Our MCP toolset is static per agent — already in the system prompt.
- **No native message-graph manipulation.** Claude Code owns its message list; we hand prompts to Agent SDK. We achieve the same semantics by packing the boundary marker, summary, and verbatim recent turns into a single first-prompt of a new SDK session.
- **No per-agent custom summary instructions in v1.** The spec leaves room for `pre_compact` hook to inject custom instructions (parity with CC), but we don't expose them in the YAML schema yet.
- **No partial-compact "up_to" mode.** CC's `partialCompactConversation` lets users summarize *up to* a chosen pivot, keeping later messages intact. We only implement the simpler "summarize everything before the fresh tail" direction. Adding "up_to" is a possible v2.
- **No PTL retry from forked-cache-sharing path.** CC has a sophisticated retry that drops oldest groups when the compact request itself hits prompt-too-long. We implement a single retry with a simpler "drop oldest 30%" heuristic. Sufficient for our turn lengths; revisit if we hit it in production.
- **No replacement of LCM's DAG.** LCM keeps its hierarchical condensation graph for retrieval. Only its role as a *compact engine* (`ContextEngine.compress`) is removed.

## High-level architecture

```
                    ┌─────────────────────────────────────────────┐
                    │   Gateway — message dispatch loop           │
                    │   (src/gateway.ts queryAgent)               │
                    └───────┬─────────────────────────┬───────────┘
                            │                         │
              ┌─────────────▼──────────┐   ┌──────────▼──────────┐
              │  CoreCompactor          │   │  Plugin assemble()  │
              │  (src/session/compact/) │   │  (LCM, others)      │
              │                         │   │                     │
              │  • Token-trigger (3a)   │   │  • Inject retrieval │
              │  • Summary prompt       │   │    block at every   │
              │  • Boundary marker      │   │    query()          │
              │  • Recent-turns extract │   │  • Read-only        │
              │  • Pre/post hooks       │   │  • Optional         │
              └────────────┬────────────┘   └─────────────────────┘
                           │
                ┌──────────▼─────────────────────┐
                │  Agent SDK query()             │
                │   - new SDK session            │
                │   - first prompt = summary     │
                │     + recent turns + new msg   │
                └────────────────────────────────┘
```

Two layers:

1. **Core compact** — first-class in the gateway. Always available, on by default. Responsible for trigger, summarization, post-compact prompt assembly.
2. **Plugin retrieval layer** — opt-in. Plugins (currently LCM) can still register `ContextEngine.assemble` to add context to every query. The `ContextEngine.compress` hook is **removed** from the contract — LCM no longer overrides compaction.

A user with LCM enabled gets: core compact (always) + LCM retrieval block prepended to every query (looks up DAG-condensed history). A user without LCM gets: just core compact.

## Subsystem 1 — `CoreCompactor` (`src/session/compact/`)

New module, replaces `src/session/compressor.ts`. Lives at `src/session/compact/index.ts` plus supporting files:

```
src/session/compact/
├── index.ts                # public CoreCompactor class
├── trigger.ts              # token-budget logic
├── summary-prompt.ts       # 7-section summary template
├── boundary.ts             # boundary-id generation + extraction
├── recent-turns.ts         # extract last N turns verbatim from stored sessions
├── post-compact-prompt.ts  # assemble first-prompt of new session
└── __tests__/              # unit tests
```

### Public interface

```ts
class CoreCompactor {
  constructor(opts: {
    config: CompactConfig;
    storedSessions: SessionStore; // existing
    hookEmitter: HookEmitter;     // existing
  });

  shouldCompactPreQuery(args: {
    sessionKey: string;
    incomingPromptText: string;
    model: string;
  }): boolean;

  shouldCompactPostQuery(args: {
    sessionKey: string;
    lastUsage: StoredAgentRunUsage;
    model: string;
  }): boolean;

  async compact(args: {
    agent: Agent;
    sessionKey: string;
    trigger: 'auto-pre' | 'auto-post' | 'manual';
    customInstructions?: string;   // from pre_compact hook
  }): Promise<CompactResult>;

  /**
   * Called by gateway from inside the result-event handler. Records the
   * usage for the just-completed query so the next pre-query check has
   * an accurate baseline. Cleared by compact() automatically — callers
   * never invalidate manually.
   */
  recordUsage(sessionKey: string, usage: StoredAgentRunUsage): void;
}

interface CompactResult {
  boundaryId: string;
  summary: string;
  recentTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
  preCompactTokens: number;
  postCompactPrompt: (args: {
    newUserMessage: string;
    senderLabel: string;
    sessionContextHeader: string;
  }) => string;
}
```

The gateway calls:

1. `shouldCompactPreQuery` *before* running `queryAgent`. If true → `compact()` first, then build prompt via `result.postCompactPrompt(newUserMsg, senderLabel)`.
2. `shouldCompactPostQuery` after `queryAgent` finishes (using `usage` from the SDK result event). If true → defer compact to *next* dispatch (don't compact retroactively — there's no inbound user message to attach to). Mark session as "needs-compact-on-next-turn" via a flag; clear flag after compaction.

## Subsystem 2 — Trigger logic (`trigger.ts`)

Hybrid model: precise post-query measurement + cheap pre-query estimation.

### Per-model effective context window

```ts
const MODEL_WINDOWS: Record<string, number> = {
  'claude-opus-4-7':    1_000_000,
  'claude-opus-4-6':    1_000_000,
  'claude-sonnet-4-6':  1_000_000,
  'claude-haiku-4-5':     200_000,
};

const RESERVE_TOKENS = 13_000; // matches Claude Code's AUTOCOMPACT_BUFFER_TOKENS

function effectiveWindow(model: string): number {
  const w = MODEL_WINDOWS[model] ?? 200_000; // safe fallback for unknown
  return w - RESERVE_TOKENS;
}

function thresholdTokens(model: string, percent: number): number {
  return Math.floor(effectiveWindow(model) * (percent / 100));
}
```

Models we don't recognise default to 200K — small enough to compact early, never to overshoot.

### Pre-query check

The gateway calls `shouldCompactPreQuery` after building the user-side prompt body but before invoking SDK `query()`:

```ts
function shouldCompactPreQuery({ sessionKey, incomingPromptText, model }) {
  const last = lastUsageBySessionKey.get(sessionKey);
  if (!last) return false;  // first turn of session — no baseline yet

  const lastTotal = (last.input_tokens ?? 0)
                  + (last.cache_read_input_tokens ?? 0)
                  + (last.cache_creation_input_tokens ?? 0);

  // Rough estimate: ~3.5 chars/token for mixed-language content.
  // Errs slightly high (safer — false positives just compact 1 turn early).
  const incomingEstimate = Math.ceil(incomingPromptText.length / 3.5);

  const projected = lastTotal + incomingEstimate;
  return projected >= thresholdTokens(model, config.threshold_percent);
}
```

`lastUsageBySessionKey` is a new in-memory `Map<string, StoredAgentRunUsage>` populated by `CoreCompactor.recordUsage()`, which the gateway calls from inside the `result` event handler in `queryAgent`. Lost on restart — first turn after restart skips precheck (see post-query check below).

**Important:** `compact()` invalidates the entry for its session before generating the post-compact prompt: `this.lastUsageBySessionKey.delete(sessionKey)`. Reason — after compact, the next query opens a *new* SDK session whose token usage is unrelated to the old one. Without invalidation, the next dispatch's pre-query check would compare the new (small) prompt against the old (huge) baseline and false-positive into another compact. Test coverage required for this case.

### Post-query check

After every successful `queryAgent`, we record `usage` and decide whether to *flag* the session for compact-on-next-dispatch:

```ts
function shouldCompactPostQuery({ sessionKey, lastUsage, model }) {
  const total = (lastUsage.input_tokens ?? 0)
              + (lastUsage.cache_read_input_tokens ?? 0)
              + (lastUsage.cache_creation_input_tokens ?? 0);
  return total >= thresholdTokens(model, config.threshold_percent);
}
```

If true, set `needsCompactOnNextTurn[sessionKey] = true`. The next dispatch checks this flag *before* the pre-query check; if set, compact unconditionally (ignore the precheck — the post-check has already confirmed we're over).

### Why both checks

- Post-query is *truth*: it sees the actual `usage` reported by the API after caching, system prompt, tools — everything.
- Pre-query is *prevention*: catches the rare case where a user pastes a 50K-token document and the *next* turn would PTL before we get a chance to react.

## Subsystem 3 — Summary prompt (`summary-prompt.ts`)

### Adapted 7-section template

Claude Code's 9-section template is heavily code-oriented (sections 3 "Files and Code Sections" and 4 "Errors and fixes" describe code edits). Our agents converse with users — we collapse those into general categories.

```ts
export function buildCompactPrompt(customInstructions?: string): string {
  return `Your task is to create a detailed summary of the conversation so far,
paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough enough that a fresh continuation of the
conversation can pick up exactly where you left off without re-asking the user
anything you already know.

Before providing your final summary, wrap your analysis in <analysis> tags
to organize your thoughts. In your analysis:

1. Walk the conversation chronologically. For each segment identify:
   - What the user actually wanted (often different from what they typed)
   - The decisions made and commitments given
   - Facts learned about the user, their domain, their preferences, their constraints
   - Tool calls made and what they returned
   - User corrections — places where they said "no, like this" or "stop doing X"
2. Pay special attention to user feedback. Anything they corrected is critical.
3. Verify nothing important was missed.

Your summary should include exactly these sections:

1. Primary Request and Intent: capture what the user actually wants from
   this conversation. If their intent shifted mid-conversation, note both
   the original and the current.

2. Key Facts About the User and Domain: list everything you've learned
   about the user, their context, their domain, their constraints, their
   preferences. This is the most important section for resuming naturally.

3. Decisions Made and Commitments Given: list anything you committed to,
   anything decided, anything agreed. Quote the user verbatim when their
   exact words matter.

4. Errors and Corrections: list every place the user corrected you,
   pushed back, or asked you to do things differently. Pay special
   attention here — these are the boundaries of acceptable behavior.

5. All User Messages: list ALL non-tool-result user messages chronologically.
   These are critical for understanding feedback and changing intent. Do not
   summarize — quote them, in order.

6. Pending Tasks and Promises: anything still owed to the user. Quote them
   if specificity matters.

7. Current State: precisely where the conversation was paused. Include the
   last 1-2 verbatim exchanges. If you were mid-task, what the next step is.

${customInstructions ? `\nAdditional instructions: ${customInstructions}\n` : ''}
Output format:

<analysis>
[Your thought process — stripped before injection]
</analysis>

<summary>
1. Primary Request and Intent:
   ...

2. Key Facts About the User and Domain:
   - ...

[etc, all 7 sections]
</summary>

Use the language of the conversation. Be concise but complete — favor
listing facts over flowing prose.`;
}
```

### Calling the summarizer

We do **not** spawn a forked SDK session for the summarizer (Claude Code's `runForkedAgent` pattern). Reason: Agent SDK doesn't expose forked-session prompt-cache sharing the way Anthropic's internal API does, and the simpler path of one extra `query()` call resuming the current session is sufficient for our scale.

```ts
async function generateSummary(args: {
  agent: Agent;
  sessionId: string;          // SDK session id to resume
  customInstructions?: string;
}): Promise<string> {
  const prompt = buildCompactPrompt(args.customInstructions);

  const options = buildSdkOptions({
    agent: args.agent,
    resume: args.sessionId,
    trustedBypass: true,
    // Block tool calls — summary should be text-only.
    canUseTool: async () => ({
      behavior: 'deny',
      message: 'Tool use is not allowed during compaction',
    }),
    // Hard cap output to bound cost. CC uses COMPACT_MAX_OUTPUT_TOKENS = 32K.
    maxOutputTokens: 32_000,
  });

  const result = query({ prompt, options });
  let assistantText = '';
  for await (const ev of result) {
    if (ev.type === 'assistant' && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === 'text') assistantText += block.text;
      }
    }
    if (ev.type === 'result') break;
  }

  // Strip <analysis> wrapper.
  const summaryMatch = assistantText.match(/<summary>([\s\S]*?)<\/summary>/);
  if (!summaryMatch) {
    throw new Error('compact: summary response missing <summary> tags');
  }
  return summaryMatch[1].trim();
}
```

### Failure modes

- **PTL on the summary call itself.** Mirrors `truncateHeadForPTLRetry` simplified: on `prompt_too_long`, we cannot easily drop messages from the SDK session (it owns the message list). Instead, retry once with `appendSystemPrompt: 'Be especially concise — context window is tight.'` If still PTL, fall back to writing a degraded summary to memory (legacy path) and proceed with `clearSession`. Log the event.
- **Empty summary.** If the model returns text without `<summary>` tags, throw — caller catches and falls back to legacy.
- **Circuit breaker.** Track consecutive compact failures per session in memory. After 3 in a row, disable compact for this session for the rest of process lifetime; emit a `pino` warning with sessionKey.

## Subsystem 4 — Recent turns extraction (`recent-turns.ts`)

### Source of truth

The Agent SDK persists each session's message log to disk (`data/agents/<id>/sessions/<sessionId>.jsonl` — see `Agent.sessionPath()`). We read that file to extract the last N user/assistant turns verbatim. This avoids holding a parallel in-memory message log just for compact.

### Algorithm

```ts
async function extractRecentTurns(args: {
  agent: Agent;
  sessionId: string;
  freshTail: number;        // config.fresh_tail — default 4 turns
  boundaryId?: string;      // if previous compact left a marker
}): Promise<RecentTurn[]> {
  const path = agent.sessionPath(sessionId);
  const lines = await fs.promises.readFile(path, 'utf-8').then(t => t.split('\n').filter(Boolean));

  const messages = lines
    .map(l => JSON.parse(l))
    .filter(m => m.type === 'user' || m.type === 'assistant');

  // If the previous compact left a boundary marker in the most-recent
  // <post-compact-summary boundary-id="..."> block, we only consider
  // messages *after* that marker for the new fresh tail.
  let startIdx = 0;
  if (args.boundaryId) {
    const lastBoundaryIdx = findLastBoundaryIndex(messages, args.boundaryId);
    if (lastBoundaryIdx >= 0) startIdx = lastBoundaryIdx + 1;
  }

  // Take the last `freshTail` turns from startIdx onward.
  const tail = messages.slice(Math.max(startIdx, messages.length - args.freshTail * 2));

  return tail.map(m => ({
    role: m.type as 'user' | 'assistant',
    content: extractTextContent(m.message?.content),
  }));
}
```

### Boundary marker discovery

When we generate the post-compact prompt, we tag it:

```
<post-compact-summary boundary-id="01928f5a-c0a4-7423-93b4-1f8d3c4e9a7b">
  ...
</post-compact-summary>
```

`boundary-id` = UUIDv7 (sortable, unique). At the next compact:

```ts
function findLastBoundaryIndex(messages, currentBoundaryId): number {
  // Find the last user message whose content begins with our boundary tag,
  // ignoring boundary-id values older than the current scan target.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type !== 'user') continue;
    const text = extractTextContent(m.message?.content);
    const match = text.match(/^<post-compact-summary boundary-id="([0-9a-f-]+)">/);
    if (match) return i;
  }
  return -1;
}
```

This finds *the most recent* boundary, which is what we want — the new compact summarizes everything since then, plus the previous summary itself (which now becomes part of the older context being condensed). Recursive compact gradually loses fidelity (saммари of саммари), same as Claude Code.

## Subsystem 5 — Post-compact prompt assembly (`post-compact-prompt.ts`)

The new SDK session's first user message:

```ts
function postCompactPrompt(args: {
  boundaryId: string;
  summary: string;
  recentTurns: RecentTurn[];
  newUserMessage: string;
  senderLabel: string;
  sessionContextHeader: string; // existing sessionCtx (datetime, channel, memory paths, etc.)
}): string {
  const recentTurnsBlock = args.recentTurns.length === 0
    ? ''
    : `<recent-turns>\n${args.recentTurns
        .map(t => `[${t.role}]: ${t.content}`)
        .join('\n\n')}\n</recent-turns>\n\n`;

  return `${args.sessionContextHeader}<post-compact-summary boundary-id="${args.boundaryId}">
This conversation continues from a previous segment that was compacted to
free context. The summary below covers everything before the recent turns.

${args.summary}

Continue the conversation from where it left off. Do not acknowledge this
summary block. Do not recap. Do not ask the user to repeat themselves.
Pick up the last task as if no break occurred.
</post-compact-summary>

${recentTurnsBlock}[${args.senderLabel}]: ${args.newUserMessage}`;
}
```

The first SDK query uses `query({ prompt, options: { /* no resume */ } })` — new session, fresh `sessionId`. The SDK persists the entire prompt-text into its first user message; subsequent turns resume it normally and the boundary block stays in the conversation history for the next compact to find.

## Subsystem 6 — Hooks integration

Two new hook events join the existing `HookEmitter`:

- `on_pre_compact` — fires *before* the summary call. Payload: `{ agentId, sessionKey, trigger: 'auto-pre'|'auto-post'|'manual', preCompactTokens }`. Hook handlers can return `{ customInstructions?: string }` to inject text into the summary prompt's `customInstructions` slot.
- `on_post_compact` — fires *after* the summary is generated and the new prompt assembled. Payload: `{ agentId, sessionKey, summary, recentTurnsCount, preCompactTokens, postCompactTokens }`. Read-only — used for telemetry, audit logging, optional UI notifications.

The existing `on_session_reset` continues to fire (with `reason: 'compact'`) for backward compat, but its semantics narrow: it now means "the SDK session was reset" not "the conversation history was wiped." Plugins relying on it (notably LCM's carryover hook) need a small audit — see Subsystem 7.

## Subsystem 7 — LCM integration (retrieval layer)

LCM's `ContextEngine` interface drops `compress` and adds `ingest`:

**Before:**
```ts
interface ContextEngine {
  compress?: (input) => Promise<CompressResult | null>;
  assemble?: (input) => Promise<AssembleResult | null>;
}
```

**After:**
```ts
interface ContextEngine {
  /**
   * Called once per turn after the SDK result event. Plugin mirrors the
   * turn's user/assistant pair into its own store (DAG, etc.).
   * Replaces what compress() used to do for LCM.
   */
  ingest?: (input: {
    agentId: string;
    sessionKey: string;
    userText: string;
    assistantText: string;
    usage: AgentRunUsage;
    timestamp: number;
  }) => Promise<void>;

  /**
   * Called every query() before the prompt goes out. Plugin can prepend
   * retrieval blocks (e.g. LCM grep result on the new user message).
   * Read-only; cannot mutate the prompt body, only prepend a block.
   */
  assemble?: (input: {
    agentId: string;
    sessionKey: string;
    promptText: string;
  }) => Promise<{ contextBlocks: string[] } | null>;
}
```

Gateway changes:

- `tryPluginCompress` is **deleted**.
- A new `runPluginIngest` is called inside the existing `on_after_query` emission path — same place that already gets `newMessages: [user, assistant]`, just routed to the new ContextEngine method.
- `tryPluginAssemble` continues; the existing `flattenAssembledMessages` and tag-randomization logic stay.

LCM-side changes (separate task list):

- The plugin's `compress()` method becomes a no-op shim that returns `null` (preserved for one minor version for safety).
- The plugin's existing mirror hook (`on_after_query` → `createMirrorHook`) is repointed to `ingest` (or kept on the hook seam — implementation detail).
- The plugin's `assemble()` already does the right thing — it just needs to be told to surface DAG-grep results based on the new user message text. Today it injects `<lcm-tool-prompt>` and carry-over snippet only; we add a third optional block: top-3 DAG-search hits relevant to the incoming message text.
- `lcm.triggers.compress_threshold_tokens` is renamed to `lcm.dag.condensation_threshold_tokens` — this is now purely an internal DAG-condensation tuning knob, unrelated to compact.
- `lcm.lifecycle.carry_over_on_session_reset` keeps working — the `on_session_reset` hook still fires with `reason: 'compact'`. The carryover snippet is captured and surfaced via `assemble()` on the *new* SDK session, exactly as today.

## Subsystem 8 — Schema and UI

### YAML schema changes (`src/config/schema.ts`)

New top-level field, replacing `auto_compress`:

```ts
compact: z.object({
  enabled: z.boolean().default(true),
  trigger: z.enum(['percent', 'tokens']).default('percent'),
  threshold_percent: z.number().int().min(20).max(95).default(70),
  threshold_tokens: z.number().int().min(1000).optional(),
  fresh_tail: z.number().int().min(0).max(20).default(4),
}).optional(),
```

`auto_compress` block stays parseable for one release as legacy:

```ts
auto_compress: z.object({
  enabled: z.boolean().default(true),
  threshold_messages: z.number().int().min(5).default(30),
}).optional(),
```

### Migration on read (`src/agent/agent.ts`)

When loading `agent.yml`, after Zod parse:

```ts
function migrateLegacyCompact(parsed: AgentConfig): AgentConfig {
  if (parsed.compact) return parsed; // already migrated

  if (parsed.auto_compress) {
    logger.info(
      { agentId: parsed.id, legacy: parsed.auto_compress },
      'compact: migrating legacy auto_compress to new compact block (in-memory only; rewrite via UI to persist)',
    );
    parsed.compact = {
      enabled: parsed.auto_compress.enabled ?? true,
      trigger: 'percent',
      threshold_percent: 70,
      fresh_tail: 4,
    };
  } else {
    parsed.compact = {
      enabled: true,
      trigger: 'percent',
      threshold_percent: 70,
      fresh_tail: 4,
    };
  }
  return parsed;
}
```

In-memory only — does not rewrite the YAML file. First save through UI persists the new shape; manual edits stay manual.

### UI changes (`ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx`)

The current broken "Auto-compress (tokens)" field is replaced with a slider:

```
┌─ Compact ──────────────────────────────────────┐
│  ☑ Enabled                                       │
│                                                  │
│  Trigger when context fills to:                  │
│  ┌─────────●─────────┐  70% of model window      │
│  20%             95%                              │
│                                                  │
│  Keep last verbatim turns: [4 ▼]                 │
└──────────────────────────────────────────────────┘
```

`cfg.compact: { enabled, trigger, threshold_percent, fresh_tail }` (object, not bare number — fixes Problem 3).

The save handler destructures `compact` correctly into the payload (parallel to existing `iteration_budget` handling).

If the user wants absolute-token control, they edit Raw YAML and set `compact.trigger: tokens` + `compact.threshold_tokens: N`.

### LCM-status UI

The existing `/api/agents/[agentId]/lcm/status` endpoint continues to return `compress_threshold_tokens` for the pressure indicator — internal consumers updated to read `dag.condensation_threshold_tokens` after migration. Indicator semantics unchanged from the user's POV.

## Edge cases

### EC-1 — Compact triggered on the very first turn

If a fresh session's first user message is, e.g., a 200K-character paste, the pre-query check has no `lastUsage` baseline and skips. The query proceeds, possibly PTLs immediately. **Mitigation:** when `lastUsage` is undefined and the rough estimate of the incoming prompt alone exceeds `0.7 * effective_window`, run compact synchronously *before* the first query — but compact has nothing to summarize. So instead: log a warning, truncate the user prompt's body section to fit (with a note "[your message was truncated to fit context]"), and proceed. Edge case; users sending 200K-char messages are rare.

### EC-2 — User sends a message during compact

`QueueManager` (`src/routing/queue-manager.ts`) already serializes per-session. While `compact()` is in progress, `queueManager.isActive(sessionKey)` stays true, so a second inbound message buffers per `queue_mode` (collect/serial/steer/interrupt). After compact returns, the buffered message is dispatched through the new SDK session. Existing semantics — no changes needed here.

### EC-3 — `freshTail = 0`

Valid config. No `<recent-turns>` block in the post-compact prompt. The user gets only the summary + their new message. Slightly more amnesia, less prompt overhead. Default is 4.

### EC-4 — Boundary marker survives across two compacts

After two compacts the conversation looks like:

```
session2:
  user-msg-1: "<post-compact-summary boundary-id="B"> {summary-from-second-compact} ...</post-compact-summary>
              <recent-turns>...</recent-turns>
              [user]: ..."
  ...several turns...
  user-msg-K: third compact triggers
```

The `extractRecentTurns` algorithm's `findLastBoundaryIndex` finds boundary B (the most recent) and bases the new fresh tail on messages *after* user-msg-1. The first summary-of-summary is now *inside* user-msg-1's body, which becomes part of the next summary's input — so we're summarizing summaries. Inevitable lossiness; acceptable.

### EC-5 — Manual `/compact` command

`gateway.ts:3572-3597` already handles `/compact`. Replace its body to call `coreCompactor.compact({ trigger: 'manual' })`. Behaviour: same as auto, but always runs regardless of trigger. The reply text changes to `'💾 Контекст сжат. Саммари в первом сообщении новой сессии.'` (current text claims "Саммари сохранено в память" which is no longer true).

### EC-6 — LCM enabled but `assemble()` fails

`tryPluginAssemble` already catches and falls through with the original prompt. New compact prompt body still goes out without LCM's retrieval block. Logged as warning. Non-blocking.

### EC-7 — Gateway restart mid-compact

If the process dies between `compact()` start and the new SDK session's first query, the agent on disk has:

- The old SDK session id still in `agent.sessions[sessionKey]` (compact didn't get to clear it)
- No persisted summary anywhere
- The pre-compact session's JSONL intact

On next message: behaves as if compact never started — the pre-query check fires again, re-attempts compact. Acceptable.

If the crash happens after the new session's first query started but before completing, the new SDK session id may or may not be persisted depending on SDK internals. Treat as: next message either picks up the partially-written new session (ok), or falls back to the old (also ok — the precheck triggers again). No data loss, possibly a duplicate compact attempt.

## Migration timeline

1. **Phase 1 — Add new path, keep old as fallback.** New `compact` schema field reads. New `CoreCompactor` wired in. `auto_compress` legacy path stays callable but unused if `compact.enabled !== false`. Tested in dev, not deployed yet.
2. **Phase 2 — Cut over.** Three existing agents (`leads_agent`, `content_sm_building`, `example`) keep their `auto_compress` blocks; gateway's read-time migration silently maps them to the new shape. Deployed to production.
3. **Phase 3 — Sunset legacy.** After two stable releases, remove the `auto_compress` legacy parser. Agents still on disk with the old shape get a warning at boot and a `migrateLegacyCompact` rewrite passes through `agent-config-writer` (comment-preserving).

## Open questions to revisit during planning

1. **Recent-turns truncation.** What's the per-turn character cap when assembling `<recent-turns>`? CC has `POST_COMPACT_MAX_TOKENS_PER_FILE = 5000` for files. We need similar for recent-turns content — say 10K chars/turn? Tunable per agent? **Default: 10K chars/turn, not configurable in v1.**
2. **Summary length cap.** CC sets `COMPACT_MAX_OUTPUT_TOKENS = 32K` (from `getMaxOutputTokensForModel`). We do the same. **Decision: 32K.**
3. **Cron-triggered compact?** Currently compact only fires on user-message dispatch. A long-idle session may carry stale context indefinitely. **Decision: out of scope for v1. Could add `compact.cron: '0 3 * * *'` later.**
4. **Telemetry.** What metrics to emit per compact? At minimum: trigger type, pre/post tokens, summary char count, recent turns count, summary call duration, hook timings. **Decision: log via existing `pino` logger as a structured `compact_done` event; no Statsig-equivalent.**
5. **Session-mirror integration.** `src/session/mirror.ts` mirrors session state to disk. After compact, the new SDK session id replaces the old one in `agent.sessions[sessionKey]`. Mirror writes the new mapping. **Decision: no special handling needed — existing flow.**

## What this spec does NOT decide

- The summary prompt's exact wording will inevitably need iteration after first prod usage. Spec specifies the 7 sections and overall structure; subagent implementer follows the template here, we tune from real conversations later.
- Per-agent overrides of summary structure (e.g., a customer-support agent caring about ticket numbers more than user feedback). Possibly via the `pre_compact` hook's `customInstructions` slot. Out of scope for v1.
- A UI surface for "show me the post-compact context that was injected" (audit/debug). Useful but not blocking.
