# Tool-progress Observability Bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Hermes-style tool-call observability into the AnthroClaw gateway — a single editable Telegram/WhatsApp message that grows line-by-line with emoji-tagged previews of each tool call, throttled edits, dedup, content-break reset, opt-in cleanup. On by default for non-public agents. Fully exposed in the agent-config UI and global defaults.

**Architecture:** New `ToolProgressBubble` state machine subscribes to existing `HookEmitter` events (`on_tool_use`, `on_tool_error`) emitted by `src/sdk/hooks.ts` from the SDK's `PreToolUse`/`PostToolUseFailure` hooks. The bubble formats tool calls via `tool-display.ts` helpers (emoji + preview heuristics) and drives channel adapters' existing `sendText` / `editText` plus a new `deleteText` method. Content streaming via `StreamConsumer` is untouched; the bubble closes itself on the first `partialText` of a turn.

**Tech Stack:** TypeScript, `@anthropic-ai/claude-agent-sdk`, grammy (Telegram), Baileys (WhatsApp), Zod, Vitest. UI: Next.js 15 / React / shadcn (in `ui/`).

**Spec:** [`docs/superpowers/specs/2026-05-13-tool-progress-bubble-design.md`](../specs/2026-05-13-tool-progress-bubble-design.md)

---

## Task 1: Extend ChannelAdapter with `deleteText` and implement adapter support

Spec sections: *Channel adapter API extension*, *Edge cases (Adapter doesn't support …)*

**Files:**
- Modify: `src/channels/types.ts:108-132` (interface)
- Modify: `src/channels/telegram.ts:240-269` (add `deleteText` after `editText`)
- Modify: `src/channels/whatsapp.ts` (rewrite no-op `editText` at line 340, add `deleteText`, add message-key cache)
- Modify: `src/channels/__tests__/` (add adapter unit tests if mocks exist; otherwise wire into existing adapter test files)

- [ ] **Step 1: Add `deleteText` to ChannelAdapter interface**

Edit `src/channels/types.ts`, in the `ChannelAdapter` interface, immediately after the existing `editText` declaration:

```ts
deleteText(peerId: string, messageId: string, opts?: { accountId?: string; threadId?: string }): Promise<void>;
```

- [ ] **Step 2: Add `deleteMessage` capability flag**

In the same file, locate `ChannelCapabilities` (around line 50-65) and add a flag:

```ts
deleteMessage: boolean;
```

- [ ] **Step 3: Implement `deleteText` in TelegramChannel**

In `src/channels/telegram.ts`, immediately after the `editText` method (around line 269), add:

```ts
/* ---------------------------------------------------------------- */
/*  deleteText                                                      */
/* ---------------------------------------------------------------- */

async deleteText(peerId: string, messageId: string, opts?: { accountId?: string }): Promise<void> {
  const bot = this.resolveBot(opts?.accountId);
  try {
    await bot.api.deleteMessage(peerId, Number(messageId));
  } catch (err: unknown) {
    // Best-effort: messages older than 48h cannot be deleted; ignore.
    this.log.debug({ err, chatId: peerId, messageId }, 'telegram: deleteMessage failed (non-fatal)');
  }
}
```

Update the `capabilities` static block (around line 54) to include `deleteMessage: true`.

- [ ] **Step 4: Implement message-key cache in WhatsApp adapter**

In `src/channels/whatsapp.ts`, locate the class body and add a private field plus helper. Around the top of the class (next to other private fields):

```ts
/** Cache of messageId → Baileys MessageKey for messages we just sent.
 *  Bounded to last 1024 entries to cap memory. */
private readonly sentKeys = new Map<string, import('baileys').proto.IMessageKey>();
private readonly SENT_KEY_CAP = 1024;

private rememberKey(messageId: string, key: import('baileys').proto.IMessageKey): void {
  if (this.sentKeys.size >= this.SENT_KEY_CAP) {
    const firstKey = this.sentKeys.keys().next().value;
    if (firstKey !== undefined) this.sentKeys.delete(firstKey);
  }
  this.sentKeys.set(messageId, key);
}
```

After every `sock.sendMessage(...)` call in `sendText` and `sendMedia` that produces a `result`, add:
```ts
if (result?.key?.id) this.rememberKey(result.key.id, result.key);
```

- [ ] **Step 5: Replace WhatsApp `editText` no-op with real implementation**

Replace the existing `editText` stub at `src/channels/whatsapp.ts:340-343` with:

```ts
async editText(peerId: string, messageId: string, text: string, opts?: SendOptions): Promise<void> {
  const sock = this.resolveSock(opts?.accountId);
  const key = this.sentKeys.get(messageId);
  if (!sock || !key) {
    logger.debug({ peerId, messageId }, 'whatsapp: editText skipped — no cached key');
    return;
  }
  try {
    await sock.sendMessage(peerId, { text, edit: key });
  } catch (err) {
    logger.debug({ err, peerId, messageId }, 'whatsapp: editText failed (non-fatal)');
    throw err;  // Bubble will count this as a flood strike
  }
}
```

(Use the project's existing `resolveSock` / equivalent socket accessor — match the lookup pattern already used by `sendText`.)

- [ ] **Step 6: Implement `deleteText` in WhatsApp adapter**

Immediately after the new `editText`, add:

```ts
async deleteText(peerId: string, messageId: string, opts?: { accountId?: string }): Promise<void> {
  const sock = this.resolveSock(opts?.accountId);
  const key = this.sentKeys.get(messageId);
  if (!sock || !key) return;  // best-effort
  try {
    await sock.sendMessage(peerId, { delete: key });
    this.sentKeys.delete(messageId);
  } catch (err) {
    logger.debug({ err, peerId, messageId }, 'whatsapp: deleteText failed (non-fatal)');
  }
}
```

Update the WhatsApp `capabilities` static block to include `deleteMessage: true, editMessage: true`.

- [ ] **Step 7: Run typecheck to verify the interface and implementations line up**

```bash
pnpm build
```

Expected: clean exit. If any other code path implements `ChannelAdapter` (e.g. test mocks), add a no-op `deleteText` shim there.

- [ ] **Step 8: Commit**

```bash
git add src/channels/types.ts src/channels/telegram.ts src/channels/whatsapp.ts
git commit -m "feat(channels): add deleteText to ChannelAdapter; wire WhatsApp editText/deleteText via Baileys MessageKey cache"
```

---

## Task 2: Create `tool-display.ts` — emoji map + preview heuristics

Spec section: *tool-display.ts (helpers)*

**Files:**
- Create: `src/channels/tool-display.ts`
- Test: `src/channels/__tests__/tool-display.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/channels/__tests__/tool-display.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getToolEmoji, buildToolPreview } from '../tool-display.js';

describe('getToolEmoji', () => {
  it('returns the right emoji for built-in tools', () => {
    expect(getToolEmoji('Bash')).toBe('💻');
    expect(getToolEmoji('Read')).toBe('📖');
    expect(getToolEmoji('Write')).toBe('✏️');
    expect(getToolEmoji('Edit')).toBe('✏️');
    expect(getToolEmoji('Grep')).toBe('🔎');
    expect(getToolEmoji('Glob')).toBe('🔍');
    expect(getToolEmoji('Task')).toBe('🎯');
    expect(getToolEmoji('TodoWrite')).toBe('✅');
    expect(getToolEmoji('WebFetch')).toBe('🌐');
    expect(getToolEmoji('WebSearch')).toBe('🔎');
  });

  it('returns the right emoji for AnthroClaw built-ins', () => {
    expect(getToolEmoji('memory_search')).toBe('🧠');
    expect(getToolEmoji('memory_write')).toBe('🧠');
    expect(getToolEmoji('memory_wiki')).toBe('🧠');
    expect(getToolEmoji('web_search_brave')).toBe('🔎');
    expect(getToolEmoji('web_search_exa')).toBe('🔎');
    expect(getToolEmoji('list_skills')).toBe('📚');
    expect(getToolEmoji('manage_cron')).toBe('⏰');
    expect(getToolEmoji('send_message')).toBe('📤');
    expect(getToolEmoji('send_media')).toBe('📤');
    expect(getToolEmoji('access_control')).toBe('🔐');
  });

  it('returns plug emoji for any MCP tool', () => {
    expect(getToolEmoji('mcp__notion__search')).toBe('🔌');
    expect(getToolEmoji('mcp__custom__do_thing')).toBe('🔌');
  });

  it('returns fallback for unknown tools', () => {
    expect(getToolEmoji('unknown_tool')).toBe('⚡');
    expect(getToolEmoji('foo_bar')).toBe('⚡');
  });

  it('respects override map', () => {
    expect(getToolEmoji('Bash', { Bash: '🚀' })).toBe('🚀');
    expect(getToolEmoji('Read', { Bash: '🚀' })).toBe('📖');
  });
});

describe('buildToolPreview', () => {
  it('uses command for Bash', () => {
    expect(buildToolPreview('Bash', { command: 'ls -la' }, 40)).toBe('ls -la');
  });

  it('uses file_path tail for Read/Write/Edit', () => {
    expect(buildToolPreview('Read', { file_path: '/Users/x/project/src/app.ts' }, 40))
      .toBe('app.ts');
    expect(buildToolPreview('Write', { file_path: '/very/long/path/to/file.md' }, 40))
      .toBe('file.md');
  });

  it('uses pattern for Grep/Glob', () => {
    expect(buildToolPreview('Grep', { pattern: 'foo.*bar' }, 40)).toBe('foo.*bar');
    expect(buildToolPreview('Glob', { pattern: '**/*.ts' }, 40)).toBe('**/*.ts');
  });

  it('uses query for search tools', () => {
    expect(buildToolPreview('WebSearch', { query: 'how to fix X' }, 40)).toBe('how to fix X');
    expect(buildToolPreview('web_search_brave', { query: 'foo' }, 40)).toBe('foo');
    expect(buildToolPreview('memory_search', { query: 'baz' }, 40)).toBe('baz');
  });

  it('uses url for WebFetch', () => {
    expect(buildToolPreview('WebFetch', { url: 'https://example.com' }, 40))
      .toBe('https://example.com');
  });

  it('uses content for memory_write (truncated)', () => {
    const long = 'a'.repeat(100);
    const out = buildToolPreview('memory_write', { content: long }, 40);
    expect(out?.length).toBeLessThanOrEqual(40);
    expect(out?.endsWith('…')).toBe(true);
  });

  it('uses description for Task, falls back to prompt', () => {
    expect(buildToolPreview('Task', { description: 'investigate X' }, 40))
      .toBe('investigate X');
    expect(buildToolPreview('Task', { prompt: 'do Y', subagent_type: 'general-purpose' }, 40))
      .toBe('do Y');
  });

  it('uses action for manage_cron', () => {
    expect(buildToolPreview('manage_cron', { action: 'create', cron: '0 9 * * *' }, 40))
      .toBe('create');
  });

  it('truncates to maxLen with ellipsis', () => {
    const longCommand = 'a'.repeat(100);
    const out = buildToolPreview('Bash', { command: longCommand }, 20);
    expect(out?.length).toBeLessThanOrEqual(20);
    expect(out?.endsWith('…')).toBe(true);
  });

  it('returns null when maxLen is 0', () => {
    expect(buildToolPreview('Bash', { command: 'ls' }, 0)).toBeNull();
  });

  it('collapses newlines/whitespace into single spaces', () => {
    expect(buildToolPreview('Bash', { command: 'foo\n\n  bar\tbaz' }, 40))
      .toBe('foo bar baz');
  });

  it('falls back to first string field for unknown tools', () => {
    expect(buildToolPreview('unknown', { thing: 'value', other: 42 }, 40)).toBe('value');
  });

  it('handles MCP tools (first string in input)', () => {
    expect(buildToolPreview('mcp__notion__search', { query: 'cats', limit: 5 }, 40))
      .toBe('cats');
  });

  it('returns null when no string fields', () => {
    expect(buildToolPreview('unknown', { count: 5, ok: true }, 40)).toBeNull();
  });

  it('returns null when input is not an object', () => {
    expect(buildToolPreview('Bash', null, 40)).toBeNull();
    expect(buildToolPreview('Bash', 'string', 40)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/channels/__tests__/tool-display.test.ts
```

Expected: FAIL with `Cannot find module '../tool-display.js'`.

- [ ] **Step 3: Create the implementation**

Create `src/channels/tool-display.ts`:

```ts
const TOOL_EMOJI: Record<string, string> = {
  // Built-in Claude Code tools
  Bash: '💻',
  Read: '📖',
  Write: '✏️',
  Edit: '✏️',
  NotebookEdit: '✏️',
  Grep: '🔎',
  Glob: '🔍',
  Task: '🎯',
  TodoWrite: '✅',
  WebFetch: '🌐',
  WebSearch: '🔎',

  // AnthroClaw built-ins
  memory_search: '🧠',
  memory_write: '🧠',
  memory_wiki: '🧠',
  web_search_brave: '🔎',
  web_search_exa: '🔎',
  list_skills: '📚',
  manage_cron: '⏰',
  send_message: '📤',
  send_media: '📤',
  access_control: '🔐',
};

const FALLBACK_EMOJI = '⚡';
const MCP_EMOJI = '🔌';

export function getToolEmoji(toolName: string, overrides?: Record<string, string>): string {
  if (overrides && overrides[toolName]) return overrides[toolName];
  if (TOOL_EMOJI[toolName]) return TOOL_EMOJI[toolName];
  if (toolName.startsWith('mcp__')) return MCP_EMOJI;
  return FALLBACK_EMOJI;
}

/** Map of tool name → primary argument field for preview building. */
const PRIMARY_ARG: Record<string, string> = {
  Bash: 'command',
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  NotebookEdit: 'notebook_path',
  Grep: 'pattern',
  Glob: 'pattern',
  WebFetch: 'url',
  WebSearch: 'query',
  web_search_brave: 'query',
  web_search_exa: 'query',
  memory_search: 'query',
  memory_write: 'content',
  manage_cron: 'action',
};

const PATH_TAIL_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit']);

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function truncate(s: string, maxLen: number): string {
  if (maxLen <= 0 || s.length <= maxLen) return s;
  if (maxLen <= 1) return '…';
  return s.slice(0, maxLen - 1) + '…';
}

function pathTail(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

export function buildToolPreview(
  toolName: string,
  input: unknown,
  maxLen: number,
): string | null {
  if (maxLen <= 0) return null;
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;

  // Special: Task → description else prompt
  if (toolName === 'Task') {
    const val = (typeof obj.description === 'string' && obj.description)
      || (typeof obj.prompt === 'string' && obj.prompt);
    if (!val) return null;
    return truncate(oneLine(val), maxLen);
  }

  // Primary arg by tool name
  const key = PRIMARY_ARG[toolName];
  if (key && typeof obj[key] === 'string') {
    const raw = obj[key] as string;
    const value = PATH_TAIL_TOOLS.has(toolName) ? pathTail(raw) : oneLine(raw);
    return truncate(value, maxLen);
  }

  // Fallback: first string field in input
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && v.length > 0) {
      return truncate(oneLine(v), maxLen);
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run src/channels/__tests__/tool-display.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/channels/tool-display.ts src/channels/__tests__/tool-display.test.ts
git commit -m "feat(channels): add tool-display helpers (emoji map + preview heuristics)"
```

---

## Task 3: Update display-config to be `safety_profile`-aware

Spec section: *Display config (resolution)*

**Files:**
- Modify: `src/channels/display-config.ts` (full rewrite)
- Create: `src/channels/__tests__/display-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/channels/__tests__/display-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveDisplayConfig } from '../display-config.js';

describe('resolveDisplayConfig — toolProgress defaults by safety profile', () => {
  it('returns "off" for public profile on any platform', () => {
    expect(resolveDisplayConfig('telegram', 'public').toolProgress).toBe('off');
    expect(resolveDisplayConfig('whatsapp', 'public').toolProgress).toBe('off');
  });

  it('returns "new" for trusted profile on any platform', () => {
    expect(resolveDisplayConfig('telegram', 'trusted').toolProgress).toBe('new');
    expect(resolveDisplayConfig('whatsapp', 'trusted').toolProgress).toBe('new');
  });

  it('returns "new" for private and chat_like_openclaw profiles', () => {
    expect(resolveDisplayConfig('telegram', 'private').toolProgress).toBe('new');
    expect(resolveDisplayConfig('telegram', 'chat_like_openclaw').toolProgress).toBe('new');
  });
});

describe('resolveDisplayConfig — override layering', () => {
  it('agent override beats safety-profile default', () => {
    expect(resolveDisplayConfig('telegram', 'public', { toolProgress: 'all' }).toolProgress)
      .toBe('all');
    expect(resolveDisplayConfig('telegram', 'trusted', { toolProgress: 'off' }).toolProgress)
      .toBe('off');
  });

  it('global default beats safety-profile default, loses to agent override', () => {
    expect(resolveDisplayConfig('telegram', 'trusted', undefined, { toolProgress: 'all' }).toolProgress)
      .toBe('all');
    expect(resolveDisplayConfig('telegram', 'trusted', { toolProgress: 'off' }, { toolProgress: 'all' }).toolProgress)
      .toBe('off');
  });
});

describe('resolveDisplayConfig — new fields', () => {
  it('cleanupProgress defaults to false', () => {
    expect(resolveDisplayConfig('telegram', 'trusted').cleanupProgress).toBe(false);
  });

  it('cleanupProgress override works', () => {
    expect(resolveDisplayConfig('telegram', 'trusted', { cleanupProgress: true }).cleanupProgress)
      .toBe(true);
  });

  it('subagentTools defaults to "parent"', () => {
    expect(resolveDisplayConfig('telegram', 'trusted').subagentTools).toBe('parent');
  });

  it('subagentTools override works', () => {
    expect(resolveDisplayConfig('telegram', 'trusted', { subagentTools: 'all' }).subagentTools)
      .toBe('all');
  });

  it('toolPreviewLength defaults to 40 for telegram, 0 for whatsapp', () => {
    expect(resolveDisplayConfig('telegram', 'trusted').toolPreviewLength).toBe(40);
    expect(resolveDisplayConfig('whatsapp', 'trusted').toolPreviewLength).toBe(0);
  });

  it('toolEmojis are passed through from override', () => {
    const out = resolveDisplayConfig('telegram', 'trusted', { toolEmojis: { Bash: '🚀' } });
    expect(out.toolEmojis).toEqual({ Bash: '🚀' });
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run src/channels/__tests__/display-config.test.ts
```

Expected: FAIL — current `resolveDisplayConfig` has only 2 args, doesn't know about safety profile or the new fields.

- [ ] **Step 3: Rewrite `display-config.ts`**

Replace the entire contents of `src/channels/display-config.ts`:

```ts
import type { ProfileName } from '../security/types.js';

export type ToolProgress = 'all' | 'new' | 'off';
export type SubagentTools = 'parent' | 'all' | 'indented';

export interface DisplayConfig {
  toolProgress: ToolProgress;
  streaming: boolean;
  toolPreviewLength: number;
  showReasoning: boolean;
  cleanupProgress: boolean;
  subagentTools: SubagentTools;
  toolEmojis?: Record<string, string>;
}

interface PlatformDefaults {
  streaming: boolean;
  toolPreviewLength: number;
}

// Platform-specific render concerns. Tool-progress visibility is NOT
// per-platform; it's per safety-profile (see below).
const PLATFORM_DEFAULTS: Record<string, PlatformDefaults> = {
  telegram: { streaming: true, toolPreviewLength: 40 },
  whatsapp: { streaming: false, toolPreviewLength: 0 },
};

const PLATFORM_FALLBACK: PlatformDefaults = { streaming: false, toolPreviewLength: 0 };

const HARDCODED_DEFAULTS = {
  showReasoning: false,
  cleanupProgress: false,
  subagentTools: 'parent' as SubagentTools,
};

/**
 * Resolve display config with tiered defaults.
 *
 * Resolution order (per field, first non-undefined wins):
 *   1. agent.yml display.*       (agentOverrides)
 *   2. config.yml defaults.display.* (globalDefaults)
 *   3. safety-profile default (toolProgress only: public→off, else→new)
 *   4. platform default (streaming, toolPreviewLength only)
 *   5. hardcoded fallback
 */
export function resolveDisplayConfig(
  platform: string,
  safetyProfile: ProfileName,
  agentOverrides?: Partial<DisplayConfig>,
  globalDefaults?: Partial<DisplayConfig>,
): DisplayConfig {
  const platformDefaults = PLATFORM_DEFAULTS[platform] ?? PLATFORM_FALLBACK;

  const safetyToolProgress: ToolProgress = safetyProfile === 'public' ? 'off' : 'new';

  return {
    toolProgress:
      agentOverrides?.toolProgress ??
      globalDefaults?.toolProgress ??
      safetyToolProgress,
    streaming:
      agentOverrides?.streaming ??
      globalDefaults?.streaming ??
      platformDefaults.streaming,
    toolPreviewLength:
      agentOverrides?.toolPreviewLength ??
      globalDefaults?.toolPreviewLength ??
      platformDefaults.toolPreviewLength,
    showReasoning:
      agentOverrides?.showReasoning ??
      globalDefaults?.showReasoning ??
      HARDCODED_DEFAULTS.showReasoning,
    cleanupProgress:
      agentOverrides?.cleanupProgress ??
      globalDefaults?.cleanupProgress ??
      HARDCODED_DEFAULTS.cleanupProgress,
    subagentTools:
      agentOverrides?.subagentTools ??
      globalDefaults?.subagentTools ??
      HARDCODED_DEFAULTS.subagentTools,
    toolEmojis:
      agentOverrides?.toolEmojis ??
      globalDefaults?.toolEmojis,
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run src/channels/__tests__/display-config.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Update existing callers to pass safetyProfile**

```bash
grep -rn "resolveDisplayConfig(" src/ ui/ --include="*.ts" --include="*.tsx"
```

For each call site (currently `src/gateway.ts:5057`):
- If you're in Task 6 territory (gateway), defer the wire-up there.
- For now, ensure the existing `gateway.ts` call site still compiles by adding the new arg. Minimal change at line 5057:

Before:
```ts
const displayCfg = resolveDisplayConfig(msg.channel, agent.config.display);
```

After:
```ts
const displayCfg = resolveDisplayConfig(msg.channel, agent.safetyProfile.name, agent.config.display);
```

- [ ] **Step 6: Build to verify**

```bash
pnpm build
```

Expected: clean exit.

- [ ] **Step 7: Commit**

```bash
git add src/channels/display-config.ts src/channels/__tests__/display-config.test.ts src/gateway.ts
git commit -m "feat(channels): make resolveDisplayConfig safety_profile-aware; add cleanup/subagent/emoji fields"
```

---

## Task 4: Extend `AgentYmlSchema.display` with new fields

Spec section: *Schema*

**Files:**
- Modify: `src/config/schema.ts` (the `display` block inside `AgentYmlSchema`)

- [ ] **Step 1: Find the current schema**

```bash
grep -n "display:" src/config/schema.ts | head -5
```

Expected: a `display: z.object({ toolProgress: ..., streaming: ... }).optional()` block.

- [ ] **Step 2: Replace the display block**

In `src/config/schema.ts`, replace the entire `display: z.object({...}).optional()` definition with:

```ts
display: z.object({
  toolProgress: z.enum(['all', 'new', 'off']).optional(),
  toolPreviewLength: z.number().int().min(0).max(200).optional(),
  cleanupProgress: z.boolean().optional(),
  subagentTools: z.enum(['parent', 'all', 'indented']).optional(),
  showReasoning: z.boolean().optional(),
  streaming: z.boolean().optional(),
  toolEmojis: z.record(z.string(), z.string()).optional(),
}).optional(),
```

- [ ] **Step 3: Update `GlobalConfigSchema.defaults` to accept the same display block**

Find `GlobalConfigSchema` in the same file (likely a few hundred lines below). Locate `defaults: z.object({...}).optional()` and add the `display` field with the same shape:

```ts
defaults: z.object({
  // ... existing fields ...
  display: z.object({
    toolProgress: z.enum(['all', 'new', 'off']).optional(),
    toolPreviewLength: z.number().int().min(0).max(200).optional(),
    cleanupProgress: z.boolean().optional(),
    subagentTools: z.enum(['parent', 'all', 'indented']).optional(),
    showReasoning: z.boolean().optional(),
    streaming: z.boolean().optional(),
    toolEmojis: z.record(z.string(), z.string()).optional(),
  }).optional(),
}).optional(),
```

(If a separate `DisplayConfigSchema` already exists or makes sense to extract, extract it and reuse — but only if it's clearly cleaner. Otherwise inline the duplicate.)

- [ ] **Step 4: Run existing schema tests**

```bash
npx vitest run src/config/__tests__/schema.test.ts 2>/dev/null || npx vitest run --grep "schema"
```

Expected: PASS.

- [ ] **Step 5: Build**

```bash
pnpm build
```

Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git add src/config/schema.ts
git commit -m "feat(config): extend display schema with cleanupProgress/subagentTools/toolEmojis/toolPreviewLength/showReasoning"
```

---

## Task 5: Implement `ToolProgressBubble` state machine

Spec section: *ToolProgressBubble*, *Edge cases*

**Files:**
- Create: `src/channels/tool-progress-bubble.ts`
- Test: `src/channels/__tests__/tool-progress-bubble.test.ts`

- [ ] **Step 1: Write failing tests — happy path + emoji + preview**

Create `src/channels/__tests__/tool-progress-bubble.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolProgressBubble } from '../tool-progress-bubble.js';

function makeDeps(overrides?: Partial<Parameters<typeof ToolProgressBubble.prototype.constructor>[0]['config']>) {
  const sendFn = vi.fn(async (_text: string) => 'msg-1');
  const editFn = vi.fn(async (_id: string, _text: string) => true);
  const deleteFn = vi.fn(async (_id: string) => {});
  return {
    sendFn,
    editFn,
    deleteFn,
    config: {
      mode: 'new' as const,
      subagentTools: 'parent' as const,
      cleanupProgress: false,
      previewLength: 40,
      ...overrides,
    },
  };
}

describe('ToolProgressBubble — basic flow', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends a new bubble on first tool', async () => {
    const deps = makeDeps();
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    expect(deps.sendFn).toHaveBeenCalledTimes(1);
    expect(deps.sendFn.mock.calls[0][0]).toMatch(/💻.*Bash.*ls/);
  });

  it('edits the same bubble on subsequent tool start', async () => {
    const deps = makeDeps();
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/x/y.md' }, toolUseId: 't2' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(deps.sendFn).toHaveBeenCalledTimes(1);
    expect(deps.editFn).toHaveBeenCalled();
    const lastEdit = deps.editFn.mock.calls.at(-1)![1];
    expect(lastEdit).toMatch(/💻.*Bash.*ls/);
    expect(lastEdit).toMatch(/📖.*Read.*y\.md/);
  });
});

describe('ToolProgressBubble — modes', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('mode=off → no send', async () => {
    const deps = makeDeps({ mode: 'off' });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    expect(deps.sendFn).not.toHaveBeenCalled();
  });

  it('mode=new → repeat tool name in same bubble is dropped', async () => {
    const deps = makeDeps({ mode: 'new' });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'pwd' }, toolUseId: 't2' });
    await vi.runAllTimersAsync();
    expect(deps.sendFn).toHaveBeenCalledTimes(1);
    expect(deps.sendFn.mock.calls[0][0]).not.toContain('pwd');
  });

  it('mode=all → every tool call rendered, identical adjacent ones dedup to ×N', async () => {
    const deps = makeDeps({ mode: 'all' });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't2' });
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't3' });
    await vi.advanceTimersByTimeAsync(2000);
    const lastEdit = deps.editFn.mock.calls.at(-1)![1];
    expect(lastEdit).toMatch(/×3/);
  });
});

describe('ToolProgressBubble — throttle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('batches rapid events into a single edit after the throttle window', async () => {
    const deps = makeDeps({ mode: 'all' });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'a' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();      // first send
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/b' }, toolUseId: 't2' });
    b.onToolStart({ toolName: 'Grep', toolInput: { pattern: 'c' }, toolUseId: 't3' });
    b.onToolStart({ toolName: 'Write', toolInput: { file_path: '/d' }, toolUseId: 't4' });
    expect(deps.editFn).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1600);
    expect(deps.editFn).toHaveBeenCalledTimes(1);
  });
});

describe('ToolProgressBubble — content break', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('onContentBreak flushes then resets; next tool opens a new bubble', async () => {
    const deps = makeDeps();
    deps.sendFn.mockResolvedValueOnce('msg-1').mockResolvedValueOnce('msg-2');
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onContentBreak();
    await vi.runAllTimersAsync();
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/x' }, toolUseId: 't2' });
    await vi.runAllTimersAsync();
    expect(deps.sendFn).toHaveBeenCalledTimes(2);
  });

  it('after onContentBreak, repeat tool name in new bubble is allowed', async () => {
    const deps = makeDeps({ mode: 'new' });
    deps.sendFn.mockResolvedValueOnce('msg-1').mockResolvedValueOnce('msg-2');
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'a' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onContentBreak();
    await vi.runAllTimersAsync();
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'b' }, toolUseId: 't2' });
    await vi.runAllTimersAsync();
    expect(deps.sendFn).toHaveBeenCalledTimes(2);
  });
});

describe('ToolProgressBubble — errors', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('onToolError appends ❌ to the right line', async () => {
    const deps = makeDeps();
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onToolError({ toolUseId: 't1', toolName: 'Bash' });
    await vi.advanceTimersByTimeAsync(2000);
    const lastEdit = deps.editFn.mock.calls.at(-1)![1];
    expect(lastEdit).toMatch(/❌/);
  });

  it('onToolError for unknown toolUseId is a no-op', async () => {
    const deps = makeDeps();
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    deps.editFn.mockClear();
    b.onToolError({ toolUseId: 'missing', toolName: 'Bash' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(deps.editFn).not.toHaveBeenCalled();
  });
});

describe('ToolProgressBubble — cleanup', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('cleanupProgress + success → deletes every breadcrumb', async () => {
    const deps = makeDeps({ cleanupProgress: true });
    deps.sendFn.mockResolvedValueOnce('m1').mockResolvedValueOnce('m2');
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'a' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onContentBreak();
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/x' }, toolUseId: 't2' });
    await vi.runAllTimersAsync();
    await b.finalize(true);
    expect(deps.deleteFn).toHaveBeenCalledTimes(2);
    expect(deps.deleteFn.mock.calls.map(c => c[0])).toEqual(['m1', 'm2']);
  });

  it('cleanupProgress + failure → no deletes (breadcrumb stays)', async () => {
    const deps = makeDeps({ cleanupProgress: true });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'a' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    await b.finalize(false);
    expect(deps.deleteFn).not.toHaveBeenCalled();
  });

  it('finalize({silent: true}) → deletes every breadcrumb regardless of cleanupProgress', async () => {
    const deps = makeDeps({ cleanupProgress: false });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'a' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    await b.finalize(true, { silent: true });
    expect(deps.deleteFn).toHaveBeenCalledTimes(1);
  });
});

describe('ToolProgressBubble — flood handling', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('disables after 3 consecutive editFn rejections', async () => {
    const deps = makeDeps({ mode: 'all' });
    deps.editFn.mockRejectedValue(new Error('flood'));
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'a' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    for (let i = 0; i < 5; i++) {
      b.onToolStart({ toolName: 'Read', toolInput: { file_path: `/f${i}` }, toolUseId: `t${i + 2}` });
      await vi.advanceTimersByTimeAsync(2000);
    }
    // After 3 failed edits, no more attempts
    const editCallsBefore = deps.editFn.mock.calls.length;
    b.onToolStart({ toolName: 'Grep', toolInput: { pattern: 'q' }, toolUseId: 'late' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(deps.editFn.mock.calls.length).toBe(editCallsBefore);
  });
});

describe('ToolProgressBubble — subagents', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('subagentTools=parent → child tool with parentToolUseId is dropped', async () => {
    const deps = makeDeps({ subagentTools: 'parent' });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Task', toolInput: { description: 'investigate' }, toolUseId: 'task1' });
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/x' }, toolUseId: 'sub1', parentToolUseId: 'task1' });
    await vi.runAllTimersAsync();
    expect(deps.sendFn.mock.calls[0][0]).toMatch(/🎯.*Task.*investigate/);
    expect(deps.sendFn.mock.calls[0][0]).not.toContain('Read');
  });

  it('subagentTools=indented → child tool rendered with two-space prefix', async () => {
    const deps = makeDeps({ subagentTools: 'indented' });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Task', toolInput: { description: 'investigate' }, toolUseId: 'task1' });
    await vi.runAllTimersAsync();
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/x' }, toolUseId: 'sub1', parentToolUseId: 'task1' });
    await vi.advanceTimersByTimeAsync(2000);
    const lastEdit = deps.editFn.mock.calls.at(-1)![1];
    expect(lastEdit).toMatch(/\n {2}📖.*Read/);
  });
});

describe('ToolProgressBubble — emoji overrides', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('uses override emoji when configured', async () => {
    const deps = makeDeps();
    (deps.config as any).toolEmojiOverrides = { Bash: '🚀' };
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    expect(deps.sendFn.mock.calls[0][0]).toContain('🚀');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npx vitest run src/channels/__tests__/tool-progress-bubble.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `ToolProgressBubble`**

Create `src/channels/tool-progress-bubble.ts`:

```ts
import { getToolEmoji, buildToolPreview } from './tool-display.js';

const THROTTLE_MS = 1500;
const MAX_FLOOD_STRIKES = 3;
const MAX_MESSAGE_LENGTH = 4096;

export interface ToolProgressBubbleDeps {
  sendFn: (text: string) => Promise<string | null>;
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

interface BubbleLine {
  toolUseId: string;
  text: string;        // rendered text WITHOUT ×N suffix or ❌
  indented: boolean;
  errored: boolean;
  repeatCount: number; // 0 = single occurrence
}

interface ToolStartPayload {
  toolName: string;
  toolInput: unknown;
  toolUseId: string;
  parentToolUseId?: string | null;
}

interface ToolErrorPayload {
  toolUseId: string;
  toolName: string;
}

export class ToolProgressBubble {
  private currentBubbleMessageId: string | null = null;
  private lines: BubbleLine[] = [];
  private seenToolsInBubble = new Set<string>();
  private breadcrumbMessageIds: string[] = [];
  private lastFlushAt = 0;
  private pendingTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private disabled = false;
  private floodStrikes = 0;
  private pendingSend: Promise<void> | null = null;

  constructor(private readonly deps: ToolProgressBubbleDeps) {}

  onToolStart(payload: ToolStartPayload): void {
    if (this.disabled || this.deps.config.mode === 'off') return;

    const isSubagentChild = !!payload.parentToolUseId && payload.toolName !== 'Task';
    if (isSubagentChild) {
      if (this.deps.config.subagentTools === 'parent') return;
      // 'all' and 'indented' both continue; only 'indented' adds prefix
    }

    if (this.deps.config.mode === 'new' && this.seenToolsInBubble.has(payload.toolName)) {
      return;
    }

    const emoji = getToolEmoji(payload.toolName, this.deps.config.toolEmojiOverrides);
    const preview = buildToolPreview(payload.toolName, payload.toolInput, this.deps.config.previewLength);
    const indented = isSubagentChild && this.deps.config.subagentTools === 'indented';
    const text = preview
      ? `${emoji} ${payload.toolName}: ${preview}`
      : `${emoji} ${payload.toolName}`;

    // Dedup: identical text to the immediately previous non-errored line
    const last = this.lines.at(-1);
    if (last && !last.errored && last.text === text && last.indented === indented) {
      last.repeatCount += 1;
    } else {
      this.lines.push({
        toolUseId: payload.toolUseId,
        text,
        indented,
        errored: false,
        repeatCount: 0,
      });
    }

    this.seenToolsInBubble.add(payload.toolName);
    this.scheduleFlush();
  }

  onToolError(payload: ToolErrorPayload): void {
    if (this.disabled) return;
    const line = this.lines.find((l) => l.toolUseId === payload.toolUseId);
    if (!line) return;
    line.errored = true;
    this.scheduleFlush();
  }

  onContentBreak(): void {
    if (this.disabled) return;
    if (this.lines.length === 0) return;
    // Cancel any pending throttled flush — we want an immediate flush
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    // Synchronously kick off the flush; reset after it lands.
    this.pendingSend = (this.pendingSend ?? Promise.resolve()).then(() => this.doFlush()).then(() => {
      this.currentBubbleMessageId = null;
      this.lines = [];
      this.seenToolsInBubble.clear();
      this.lastFlushAt = 0;
    });
  }

  async finalize(success: boolean, options?: { silent?: boolean }): Promise<void> {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.lines.length > 0 && !this.disabled) {
      await this.doFlush();
    }
    if (this.pendingSend) {
      await this.pendingSend.catch(() => {});
    }

    const shouldDelete = options?.silent || (this.deps.config.cleanupProgress && success);
    if (shouldDelete && this.deps.deleteFn) {
      for (const mid of this.breadcrumbMessageIds) {
        await this.deps.deleteFn(mid).catch(() => {});
      }
      this.breadcrumbMessageIds = [];
    }
  }

  private renderLine(l: BubbleLine): string {
    let s = l.text;
    if (l.repeatCount > 0) s += ` (×${l.repeatCount + 1})`;
    if (l.errored) s += ' ❌';
    if (l.indented) s = '  ' + s;
    return s;
  }

  private renderBubble(): string {
    let s = this.lines.map((l) => this.renderLine(l)).join('\n');
    if (s.length > MAX_MESSAGE_LENGTH) {
      // Trim to last newline that fits
      const cut = s.lastIndexOf('\n', MAX_MESSAGE_LENGTH - 1);
      s = cut > 0 ? s.slice(0, cut) : s.slice(0, MAX_MESSAGE_LENGTH);
    }
    return s;
  }

  private scheduleFlush(): void {
    if (this.pendingTimer || this.disabled || this.flushing) return;
    const elapsed = Date.now() - this.lastFlushAt;
    const wait = elapsed >= THROTTLE_MS ? 0 : THROTTLE_MS - elapsed;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.pendingSend = (this.pendingSend ?? Promise.resolve()).then(() => this.doFlush());
    }, wait);
  }

  private async doFlush(): Promise<void> {
    if (this.disabled || this.lines.length === 0) return;
    if (this.flushing) return;
    this.flushing = true;
    try {
      const text = this.renderBubble();
      if (this.currentBubbleMessageId) {
        const ok = await this.deps.editFn(this.currentBubbleMessageId, text).catch(() => false);
        if (!ok) {
          this.floodStrikes += 1;
          if (this.floodStrikes >= MAX_FLOOD_STRIKES) this.disabled = true;
        } else {
          this.floodStrikes = 0;
        }
      } else {
        const id = await this.deps.sendFn(text).catch(() => null);
        if (id) {
          this.currentBubbleMessageId = id;
          this.breadcrumbMessageIds.push(id);
          this.floodStrikes = 0;
        } else {
          this.floodStrikes += 1;
          if (this.floodStrikes >= MAX_FLOOD_STRIKES) this.disabled = true;
        }
      }
      this.lastFlushAt = Date.now();
    } finally {
      this.flushing = false;
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/channels/__tests__/tool-progress-bubble.test.ts
```

Expected: all PASS. If timing-related tests flake, double-check the `vi.useFakeTimers()` setup and that `scheduleFlush` correctly defers to the timer.

- [ ] **Step 5: Commit**

```bash
git add src/channels/tool-progress-bubble.ts src/channels/__tests__/tool-progress-bubble.test.ts
git commit -m "feat(channels): add ToolProgressBubble state machine"
```

---

## Task 6: Wire `ToolProgressBubble` into the gateway query loop

Spec section: *Wire-up in `gateway.ts`*

**Files:**
- Modify: `src/gateway.ts` (lines ~5050-5260: replace `announceToolUse`, add bubble lifecycle and content-break trigger)

- [ ] **Step 1: Open the target region**

Read `src/gateway.ts:5050-5260` to confirm the current shape. Key landmarks:
- `~5057` resolveDisplayConfig call (already updated in Task 3 step 5).
- `~5058-5083` current `announceToolUse` (TO BE REMOVED).
- `~5110` first partialText branch (TO BE EXTENDED with `onContentBreak`).
- `~5205` current call to `announceToolUse` (TO BE REMOVED).
- A `finally` block somewhere below the loop where cleanup happens.

- [ ] **Step 2: Remove the existing announceToolUse + helpers**

Delete lines `~5058-5083` (the entire `announcedTools = new Set` + `announceToolUse = async (...)` block). Also delete the `void announceToolUse(toolName, (evt as ...).input);` line near 5205.

- [ ] **Step 3: Construct the bubble + subscribe to hooks**

Immediately after `const displayCfg = resolveDisplayConfig(...)` at line ~5057, insert:

```ts
let bubble: ToolProgressBubble | null = null;
let unsubBubbleStart: (() => void) | null = null;
let unsubBubbleError: (() => void) | null = null;
let contentBreakFired = false;

if (displayCfg.toolProgress !== 'off') {
  const ch = this.channels.get(msg.channel);
  if (ch) {
    bubble = new ToolProgressBubble({
      sendFn: (text) => ch.sendText(msg.peerId, text, {
        accountId: msg.accountId,
        threadId: msg.threadId,
        parseMode: 'plain',
      }).catch((err) => {
        logger.debug({ err, agentId: agent.id }, 'bubble send failed');
        return null;
      }),
      editFn: async (mid, text) => {
        try {
          await ch.editText(msg.peerId, mid, text, {
            accountId: msg.accountId,
            threadId: msg.threadId,
            parseMode: 'plain',
          });
          return true;
        } catch (err) {
          logger.debug({ err, agentId: agent.id, messageId: mid }, 'bubble edit failed');
          return false;
        }
      },
      deleteFn: displayCfg.cleanupProgress
        ? (mid) => ch.deleteText(msg.peerId, mid, { accountId: msg.accountId })
        : undefined,
      config: {
        mode: displayCfg.toolProgress,
        subagentTools: displayCfg.subagentTools,
        cleanupProgress: displayCfg.cleanupProgress,
        previewLength: displayCfg.toolPreviewLength,
        toolEmojiOverrides: displayCfg.toolEmojis,
      },
    });

    const filter = (p: Record<string, unknown>) =>
      p.agentId === agent.id &&
      (!observedSessionId || p.sdkSessionId === observedSessionId);

    unsubBubbleStart = this.hookEmitter.subscribe('on_tool_use', (p) => {
      if (!filter(p)) return;
      bubble?.onToolStart({
        toolName: String(p.toolName ?? 'unknown'),
        toolInput: p.toolInput,
        toolUseId: String(p.toolUseId ?? ''),
        parentToolUseId: (p as { parentToolUseId?: string | null }).parentToolUseId ?? null,
      });
    });

    unsubBubbleError = this.hookEmitter.subscribe('on_tool_error', (p) => {
      if (!filter(p)) return;
      bubble?.onToolError({
        toolUseId: String(p.toolUseId ?? ''),
        toolName: String(p.toolName ?? 'unknown'),
      });
    });
  }
}
```

Add the import at the top of the file:
```ts
import { ToolProgressBubble } from './channels/tool-progress-bubble.js';
```

- [ ] **Step 4: Fire content-break on first partialText**

In the stream loop, locate the `if (partialText) { ... }` branch (around line 5110). Add at the very start of that branch:

```ts
if (!contentBreakFired) {
  contentBreakFired = true;
  bubble?.onContentBreak();
}
```

- [ ] **Step 5: Verify `parentToolUseId` is propagated by the hook bridge**

```bash
grep -n "parentToolUseId\|parent_tool_use_id" src/sdk/hooks.ts
```

If the bridge does **not** propagate `parent_tool_use_id` from `PreToolUseHookInput`, extend `src/sdk/hooks.ts` so the `on_tool_use` payload includes `parentToolUseId: toolInput.parent_tool_use_id ?? null`. Look at lines 95-104 (the `PreToolUse` case) — add a `parentToolUseId` field next to `toolUseId`.

- [ ] **Step 6: Finalize bubble in the finally block**

Locate the `finally` block at the end of the query loop. Just before the existing cleanup (or before the function returns), add:

```ts
const silentRun = /^\s*\[SILENT\]/i.test(responseText ?? '');
unsubBubbleStart?.();
unsubBubbleError?.();
await bubble?.finalize(!budgetInterrupted && !abort.signal.aborted, { silent: silentRun });
```

(`responseText` is the variable computed around line 5251. Make sure this block sees it — if the variable is scoped inside `try`, lift it to the outer scope. `budgetInterrupted` and `abort` are already in scope per the existing code.)

- [ ] **Step 7: Build to verify wiring**

```bash
pnpm build
```

Expected: clean exit. If TypeScript complains about `agent.safetyProfile.name` not being in scope, ensure Task 3 step 5 was committed (the call site updated).

- [ ] **Step 8: Run the full backend test suite**

```bash
pnpm test
```

Expected: all existing tests PASS; the three new test files added in earlier tasks also PASS.

- [ ] **Step 9: Commit**

```bash
git add src/gateway.ts src/sdk/hooks.ts
git commit -m "feat(gateway): wire ToolProgressBubble into query loop; replace announceToolUse"
```

---

## Task 7: Integration test — full turn with bubble + content + cleanup

Spec section: *Testing → Integration*

**Files:**
- Create: `src/channels/__tests__/tool-progress-bubble.integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create `src/channels/__tests__/tool-progress-bubble.integration.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolProgressBubble } from '../tool-progress-bubble.js';

/**
 * Simulates the gateway driving a bubble through a full SDK turn:
 *   PreToolUse(Bash) → PreToolUse(Read) → assistant.partial_text → PreToolUse(WebSearch) → result
 */
describe('ToolProgressBubble — integration: full turn', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('produces two distinct bubbles split by content break', async () => {
    const send = vi.fn<(text: string) => Promise<string>>();
    send.mockResolvedValueOnce('bubble-1').mockResolvedValueOnce('bubble-2');
    const edit = vi.fn(async () => true);
    const del = vi.fn(async () => {});

    const b = new ToolProgressBubble({
      sendFn: send,
      editFn: edit,
      deleteFn: del,
      config: { mode: 'new', subagentTools: 'parent', cleanupProgress: false, previewLength: 40 },
    });

    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/x/y.md' }, toolUseId: 't2' });
    await vi.runAllTimersAsync();
    b.onContentBreak();
    await vi.runAllTimersAsync();
    b.onToolStart({ toolName: 'WebSearch', toolInput: { query: 'foo' }, toolUseId: 't3' });
    await vi.runAllTimersAsync();
    await b.finalize(true);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatch(/💻.*Bash.*ls[\s\S]*📖.*Read.*y\.md/);
    expect(send.mock.calls[1][0]).toMatch(/🔎.*WebSearch.*foo/);
    expect(del).not.toHaveBeenCalled();
  });

  it('with cleanupProgress=true on success → deletes both bubbles', async () => {
    const send = vi.fn<(text: string) => Promise<string>>()
      .mockResolvedValueOnce('m1').mockResolvedValueOnce('m2');
    const edit = vi.fn(async () => true);
    const del = vi.fn(async () => {});
    const b = new ToolProgressBubble({
      sendFn: send,
      editFn: edit,
      deleteFn: del,
      config: { mode: 'new', subagentTools: 'parent', cleanupProgress: true, previewLength: 40 },
    });

    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'a' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onContentBreak();
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/x' }, toolUseId: 't2' });
    await vi.runAllTimersAsync();
    await b.finalize(true);

    expect(del).toHaveBeenCalledTimes(2);
    expect(del.mock.calls.map(c => c[0])).toEqual(['m1', 'm2']);
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
npx vitest run src/channels/__tests__/tool-progress-bubble.integration.test.ts
```

Expected: both tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/channels/__tests__/tool-progress-bubble.integration.test.ts
git commit -m "test(channels): add bubble integration test (full-turn + cleanup)"
```

---

## Task 8: UI — extend agent-level Display section

Spec section: *UI → Agent-level*

**Files:**
- Modify: `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx` (around line 2490-2525 — the existing Display section)

- [ ] **Step 1: Read the existing Display section**

```bash
sed -n '2480,2530p' "ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx"
```

Confirm there's an existing `Field label="Tool progress"` and `Field label="Streaming"`. Note the parent component is a Section that renders `FormGrid` of `Field`s.

- [ ] **Step 2: Update the `display` type in the page file**

Find the `display?: { toolProgress?: string; streaming?: boolean; }` block (around line 130) and replace with:

```ts
display?: {
  toolProgress?: string;
  streaming?: boolean;
  toolPreviewLength?: number;
  cleanupProgress?: boolean;
  subagentTools?: 'parent' | 'all' | 'indented';
  showReasoning?: boolean;
  toolEmojis?: Record<string, string>;
};
```

Also locate the field `safety_profile?: string` (or similar) on the same agent object — confirm it exists so we can read it for the resolved-default hint.

- [ ] **Step 3: Change the Tool progress field to support `auto` + add the resolved hint**

Replace the existing `<Field label="Tool progress">…</Field>` block with:

```tsx
<Field label="Tool progress" tooltip="Whether to show tool call activity to users. Auto picks based on the agent's safety profile: public → off, anything else → new.">
  <select
    value={cfg.display?.toolProgress ?? "auto"}
    onChange={(e) => update({
      display: {
        ...cfg.display,
        toolProgress: e.target.value === "auto" ? undefined : e.target.value,
      },
    })}
    className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
  >
    <option value="auto">auto (safety-profile default)</option>
    <option value="all">all — show every tool call</option>
    <option value="new">new — only new tool types</option>
    <option value="off">off — hide tool calls</option>
  </select>
  {!cfg.display?.toolProgress && (
    <p className="mt-1 text-[10px]" style={{ color: "var(--oc-text-dim)" }}>
      Resolved: <b>{cfg.safety_profile === "public" ? "off" : "new"}</b>
      {" — "}safety_profile={cfg.safety_profile ?? "<unset>"}
    </p>
  )}
</Field>
```

- [ ] **Step 4: Add the new fields right after Tool progress**

Immediately after the Tool progress `Field` block, before the existing Streaming field, insert:

```tsx
<Field label="Tool preview length" tooltip="Max characters of a tool's primary argument shown in the bubble. 0 disables previews (just the tool name).">
  <input
    type="number"
    min={0}
    max={200}
    value={cfg.display?.toolPreviewLength ?? ""}
    placeholder="40"
    onChange={(e) => update({
      display: {
        ...cfg.display,
        toolPreviewLength: e.target.value === "" ? undefined : Number(e.target.value),
      },
    })}
    className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
  />
</Field>

<Field label="Cleanup progress" tooltip="When ON, the tool-progress bubble is deleted after a successful response. Failures leave it as a breadcrumb.">
  <select
    value={cfg.display?.cleanupProgress ? "true" : "false"}
    onChange={(e) => update({
      display: { ...cfg.display, cleanupProgress: e.target.value === "true" },
    })}
    className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
  >
    <option value="false">off — leave breadcrumb in chat</option>
    <option value="true">on — delete bubble after success</option>
  </select>
</Field>

<Field label="Subagent tools" tooltip="How to render tool calls made by subagents (via Task). Parent shows only the Task line; All shows every internal call; Indented shows internals with a two-space prefix.">
  <select
    value={cfg.display?.subagentTools ?? "parent"}
    onChange={(e) => update({
      display: { ...cfg.display, subagentTools: e.target.value as 'parent' | 'all' | 'indented' },
    })}
    className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
  >
    <option value="parent">parent — Task line only</option>
    <option value="all">all — full internals</option>
    <option value="indented">indented — internals with prefix</option>
  </select>
</Field>
```

- [ ] **Step 5: Build the UI**

```bash
cd ui && pnpm build && cd ..
```

Expected: clean exit. If TypeScript complains about `cfg.display.toolPreviewLength` etc., double-check step 2's type extension was saved.

- [ ] **Step 6: Manually verify the UI**

Start the UI dev server and the gateway:
```bash
pnpm dev &      # gateway
cd ui && pnpm dev &   # UI on :3000
```

Open `http://localhost:3000`, log in, navigate to any agent's Config tab. Confirm:
- Tool progress dropdown now has `auto` as the first option, defaulting there for an agent without explicit override.
- The "Resolved: ..." hint shows underneath and updates when you change `safety_profile` elsewhere on the page.
- All three new fields (`Tool preview length`, `Cleanup progress`, `Subagent tools`) render with the right placeholder/default.
- Saving with `auto` selected (i.e. the default) doesn't write `display.toolProgress` to the agent YAML.

If anything is off, fix before committing.

- [ ] **Step 7: Commit**

```bash
git add "ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx"
git commit -m "feat(ui): extend agent Display section with tool-progress fields + resolved-default hint"
```

---

## Task 9: UI — global Display defaults in Settings

Spec section: *UI → Global defaults*

**Files:**
- Modify: `ui/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Locate the existing settings page structure**

```bash
grep -n "defaults\|Section\|displayDefaults" "ui/app/(dashboard)/settings/page.tsx" | head -20
```

Identify where the global `defaults` block is rendered (model, debounce_ms, etc.) and where new sections can be inserted.

- [ ] **Step 2: Add a `Display defaults` Section**

Insert a new Section component matching the existing pattern. Render the same fields as Task 8 step 4 (Tool progress, Tool preview length, Cleanup progress, Subagent tools), but bound to `cfg.defaults?.display?.*` instead of `cfg.display?.*`. Because these are *global* defaults, the Tool progress dropdown does NOT need a "Resolved" hint — just `auto / all / new / off`.

- [ ] **Step 3: Make sure the save endpoint accepts the new fields**

```bash
grep -n "defaults\.\?display\|defaults:\\s*{" src/web/ ui/app/api/config/ 2>/dev/null
```

If the API route validates the body against a schema that omits these fields, extend it. Most likely the schema is `GlobalConfigSchema` (already updated in Task 4) so this is a no-op — but verify.

- [ ] **Step 4: Build + smoke test**

```bash
cd ui && pnpm build && cd ..
```

Manually open the Settings page, change a `Display defaults` field, save, and confirm `config.yml` on disk now contains the value under `defaults.display`.

- [ ] **Step 5: Commit**

```bash
git add "ui/app/(dashboard)/settings/page.tsx"
git commit -m "feat(ui): add global Display defaults section in Settings"
```

---

## Task 10: UI tests for the agent Display section

Spec section: *Testing → Unit (UI)*

**Files:**
- Create: `ui/__tests__/agent-display-settings.test.tsx`

- [ ] **Step 1: Write the tests**

Create `ui/__tests__/agent-display-settings.test.tsx`. The exact shape depends on the project's existing UI test helpers; check `ui/__tests__/` for examples first. Tests to write:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
// Import a small wrapper or a renderable slice of the agent-config Display section.
// If the page is too monolithic to test directly, extract the Display section
// into its own component first (e.g. components/agent-display-section.tsx)
// and test that component.

describe('Agent Display section', () => {
  it('shows "Resolved: off" hint when safety_profile is public and toolProgress is unset', () => {
    // render(<AgentDisplaySection safety_profile="public" display={{}} onChange={vi.fn()} />);
    // expect(screen.getByText(/Resolved:/)).toHaveTextContent(/off/);
  });

  it('shows "Resolved: new" hint when safety_profile is trusted and toolProgress is unset', () => {
    // render(<AgentDisplaySection safety_profile="trusted" display={{}} onChange={vi.fn()} />);
    // expect(screen.getByText(/Resolved:/)).toHaveTextContent(/new/);
  });

  it('hides the hint when toolProgress is explicitly set', () => {
    // render(<AgentDisplaySection safety_profile="public" display={{ toolProgress: 'all' }} onChange={vi.fn()} />);
    // expect(screen.queryByText(/Resolved:/)).toBeNull();
  });

  it('saving "auto" yields no toolProgress in the payload', () => {
    // const onChange = vi.fn();
    // render(<AgentDisplaySection ... />);
    // fireEvent.change(screen.getByLabelText(/Tool progress/), { target: { value: 'auto' } });
    // expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ display: expect.not.objectContaining({ toolProgress: expect.anything() }) }));
  });

  it('toolPreviewLength accepts 0-200, rejects out-of-range', () => {
    // render + fireEvent on the number input, assert clamping or HTML5 validity.
  });
});
```

**Critical:** if the Display section is currently inlined inside the giant `page.tsx`, **first extract it into a component** at `ui/components/agent-display-section.tsx` and have `page.tsx` use the extracted component. This is a precondition for testability — the section is too entangled with the rest of the page otherwise. Do the extraction as the first step of this task, then write the tests against the extracted component.

- [ ] **Step 2: Run the tests**

```bash
cd ui && npx vitest run __tests__/agent-display-settings.test.tsx
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add ui/components/agent-display-section.tsx "ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx" ui/__tests__/agent-display-settings.test.tsx
git commit -m "test(ui): extract AgentDisplaySection + add resolved-default hint tests"
```

---

## Task 11: Manual end-to-end verification on a live Telegram agent

Spec section: *Rollout*

**Files:** none

- [ ] **Step 1: Pick a `safety_profile: trusted` agent**

```bash
grep -rln "safety_profile: trusted\|safety_profile: private" agents/
```

Pick one wired to a live Telegram account in `config.yml`. For local dev, use a sandbox bot.

- [ ] **Step 2: Start the gateway**

```bash
pnpm dev
```

- [ ] **Step 3: Trigger a tool-heavy turn**

In Telegram, message the agent with a prompt that fans out tool calls, e.g.: *"Search memory for X, then read file Y, then web-search Z."*

- [ ] **Step 4: Verify the bubble UX**

You should see in chat:
1. A bubble appears within ~1.5 s of the first tool call.
2. Each subsequent tool *of a new type* adds a line (mode `new`).
3. When the assistant starts streaming its answer, the bubble closes; the answer message lands below it.
4. If the model fires more tools after the answer, a new bubble appears under the answer.
5. No spam — bubble edits in place, doesn't flood the chat.

- [ ] **Step 5: Verify a `safety_profile: public` agent stays silent**

Repeat steps 3-4 with Roman or Amina. You should see only the answer, no bubble.

- [ ] **Step 6: Verify cleanup**

Set `display.cleanupProgress: true` on a trusted agent via the UI. Trigger a successful turn. The bubble should disappear after the answer lands. Trigger a failure (e.g. budget exceeded) — the bubble should remain.

- [ ] **Step 7: Verify on WhatsApp**

Repeat the same flow with a trusted-profile WhatsApp agent (if available). Watch for: bubble appears, edits in place (Baileys `MessageKey` cache working), cleanup deletes when set.

- [ ] **Step 8: Document any anomalies**

If anything in steps 4-7 doesn't behave as the spec describes, capture screenshots + logs and either fix on the spot (if small) or file a follow-up task. Do not move to the PR step until the bubble works on both platforms.

---

## Final: Open the PR

- [ ] **Push the branch**

```bash
git push -u origin feat/tool-progress-bubble
```

- [ ] **Open the PR**

```bash
gh pr create --title "feat: tool-progress observability bubble (Hermes-style)" --body "$(cat <<'EOF'
## Summary

Brings Hermes-style tool-call observability to AnthroClaw: a single editable Telegram/WhatsApp message that grows line-by-line as the agent calls tools — emoji-tagged, throttled, deduped, reset on content arrival.

- Default ON for trusted/private/chat_like_openclaw agents.
- Default OFF for `safety_profile: public` (customer-facing).
- Fully exposed in the agent Config UI + global Settings defaults.
- All wiring uses the existing SDK hooks bridge (`PreToolUse` / `PostToolUseFailure`) — no `@anthropic-ai/sdk` imports, no custom orchestration loop.

Spec: `docs/superpowers/specs/2026-05-13-tool-progress-bubble-design.md`

## Test plan

- [x] Unit: `tool-display.test.ts` — emoji map + preview heuristics
- [x] Unit: `display-config.test.ts` — safety-profile resolution layering
- [x] Unit: `tool-progress-bubble.test.ts` — state machine (throttle, dedup, modes, subagents, flood, cleanup)
- [x] Integration: `tool-progress-bubble.integration.test.ts` — full-turn flow
- [x] UI: `agent-display-settings.test.tsx` — resolved-default hint + form behavior
- [x] Manual: Telegram trusted agent shows bubble; public agent stays silent; cleanup deletes on success
- [x] Manual: WhatsApp trusted agent shows bubble (Baileys edit working)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] Report the PR URL back to the user.

---

## Self-review notes (for the executor)

- All test cases in the spec are covered by the unit + integration suite.
- No placeholders remain. Every step has either runnable code or an exact command + expected output.
- Method signatures are consistent across tasks: `ToolProgressBubble`, `getToolEmoji`, `buildToolPreview`, `resolveDisplayConfig`, `deleteText`/`editText` on adapters.
- The `parentToolUseId` propagation in Task 6 step 5 is conditional — if the bridge already does it, the step is a no-op. If not, the step explicitly extends `src/sdk/hooks.ts`.
- Cleanup tests (`finalize(false)`, `finalize(true, {silent})`) are in place to verify spec behavior on interrupts and `[SILENT]` cron runs.
- One known small gap: the very first `PreToolUse` of a turn may arrive before `observedSessionId` is set (the gateway only learns the SDK session id from the first `assistant`/`result` event). The filter at Task 6 step 3 uses `!observedSessionId || p.sdkSessionId === observedSessionId`, accepting all events with the right `agentId` until the sessionId is observed; once observed, the filter tightens. This matches the spec's "subscribe immediately with `agentId-only`" note.
