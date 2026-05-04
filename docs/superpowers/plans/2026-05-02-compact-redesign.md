# Compact Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the message-count-triggered, save-summary-to-file compact path with a token-triggered, in-context summary-injection compact path. After compact, the agent must continue conversation with full awareness — no "тупит после компакта", no reliance on `memory_search` to recover its own context.

**Architecture:** New `CoreCompactor` first-class in gateway under `src/session/compact/`. Token-budget trigger (hybrid pre+post-query). 7-section summary injected as the first user message of a fresh SDK session, alongside last 4 turns verbatim, wrapped in `<post-compact-summary boundary-id="UUIDv7">` and `<recent-turns>` tags. LCM stays as opt-in retrieval layer (its `compress` hook removed; `assemble` extended). UI replaces broken "Auto-compress (tokens)" field with `% of model window` slider.

**Tech Stack:** TypeScript (Node ≥22), Zod, vitest, `@anthropic-ai/claude-agent-sdk` (only allowed LLM runtime), `yaml` (parseDocument for comment-preserving writes), Next.js 15 App Router for UI.

**Spec:** [`docs/superpowers/specs/2026-05-02-compact-redesign.md`](../specs/2026-05-02-compact-redesign.md). Read it before any task — every algorithm, schema field, edge case, and migration rule is defined there.

---

## Conventions

- ESM `.js` import suffixes throughout (TS source uses `.js` extension that resolves to `.ts`)
- Tests live under `<dir>/__tests__/<name>.test.ts`
- Vitest 4 — `npx vitest run <path>` for single-test invocations
- Conventional commits — `feat(compact): ...`, `fix(...)`, `refactor(...)`
- No `// removed` markers, no backwards-compat shims for unused code
- All LLM calls go through `query()` from `@anthropic-ai/claude-agent-sdk` — never `@anthropic-ai/sdk` directly

## File structure (target)

```
src/session/compact/
├── index.ts              # CoreCompactor class, public surface
├── trigger.ts            # token-budget logic
├── boundary.ts           # UUIDv7 marker + extraction
├── recent-turns.ts       # SDK JSONL → last N turns
├── summary-prompt.ts     # 7-section template + parse
├── post-compact-prompt.ts# assemble first prompt of new session
└── __tests__/
    ├── trigger.test.ts
    ├── boundary.test.ts
    ├── recent-turns.test.ts
    ├── summary-prompt.test.ts
    ├── post-compact-prompt.test.ts
    └── index.test.ts     # CoreCompactor integration with stubs
```

`src/session/compressor.ts` — kept temporarily, marked as legacy fallback, removed in Phase 12.

---

## Phase 0 — Branch setup

### Task 0: Create worktree and branch

**Files:** none — branch and worktree only

- [ ] **Step 1: Create worktree off main**

```bash
cd /Users/tyess/dev/openclaw-agents-sdk-clone
git worktree add -b feat/compact-redesign ../anthroclaw-compact-redesign main
cd ../anthroclaw-compact-redesign
pnpm install
```

- [ ] **Step 2: Verify baseline tests pass**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all green. If anything is red on `main`, escalate — don't start until baseline is clean.

- [ ] **Step 3: Verify the spec is readable from this worktree**

```bash
test -f docs/superpowers/specs/2026-05-02-compact-redesign.md && echo OK
```

---

## Phase 1 — Schema and legacy migration

### Task 1: Add `compact` block to `AgentYmlSchema`

**Files:**
- Modify: `src/config/schema.ts`
- Test: `src/config/__tests__/schema.test.ts`

- [ ] **Step 1: Write failing test**

In `src/config/__tests__/schema.test.ts` add:

```ts
import { describe, expect, it } from 'vitest';
import { AgentYmlSchema } from '../schema.js';

describe('compact block', () => {
  it('parses a full compact block with percent trigger', () => {
    const result = AgentYmlSchema.safeParse({
      model: 'claude-sonnet-4-6',
      compact: {
        enabled: true,
        trigger: 'percent',
        threshold_percent: 70,
        fresh_tail: 4,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.compact?.threshold_percent).toBe(70);
    }
  });

  it('parses a tokens-trigger block', () => {
    const result = AgentYmlSchema.safeParse({
      model: 'claude-sonnet-4-6',
      compact: {
        enabled: true,
        trigger: 'tokens',
        threshold_tokens: 100_000,
        fresh_tail: 6,
      },
    });
    expect(result.success).toBe(true);
  });

  it('applies defaults when compact is omitted', () => {
    const result = AgentYmlSchema.safeParse({ model: 'claude-sonnet-4-6' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.compact).toBeUndefined();
  });

  it('rejects threshold_percent outside 20-95', () => {
    expect(
      AgentYmlSchema.safeParse({
        model: 'claude-sonnet-4-6',
        compact: { trigger: 'percent', threshold_percent: 10 },
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/config/__tests__/schema.test.ts
```

Expected: 4 tests fail (schema doesn't have `compact` field yet).

- [ ] **Step 3: Add `compact` to `AgentYmlSchema`**

In `src/config/schema.ts`, near `auto_compress` (~line 428), add:

```ts
compact: z.object({
  enabled: z.boolean().default(true),
  trigger: z.enum(['percent', 'tokens']).default('percent'),
  threshold_percent: z.number().int().min(20).max(95).default(70),
  threshold_tokens: z.number().int().min(1000).optional(),
  fresh_tail: z.number().int().min(0).max(20).default(4),
}).optional(),
```

Keep the existing `auto_compress` block **unchanged** — legacy parser stays for one release.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/config/__tests__/schema.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Run full schema test suite to ensure nothing else broke**

```bash
npx vitest run src/config/__tests__/
```

- [ ] **Step 6: Commit**

```bash
git add src/config/schema.ts src/config/__tests__/schema.test.ts
git commit -m "feat(compact): add compact schema field with percent/tokens triggers"
```

### Task 2: Implement legacy `auto_compress` → `compact` migration on read

**Files:**
- Modify: `src/agent/agent.ts`
- Test: `src/agent/__tests__/agent-config-migration.test.ts` (new file)

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { migrateLegacyCompact } from '../agent.js';

describe('migrateLegacyCompact', () => {
  it('maps auto_compress to compact with percent defaults', () => {
    const result = migrateLegacyCompact({
      model: 'claude-sonnet-4-6',
      auto_compress: { enabled: true, threshold_messages: 30 },
    } as any);
    expect(result.compact).toEqual({
      enabled: true,
      trigger: 'percent',
      threshold_percent: 70,
      fresh_tail: 4,
    });
    // Legacy block preserved (we don't rewrite YAML during migration on read).
    expect(result.auto_compress).toBeDefined();
  });

  it('respects auto_compress.enabled=false', () => {
    const result = migrateLegacyCompact({
      model: 'claude-sonnet-4-6',
      auto_compress: { enabled: false, threshold_messages: 30 },
    } as any);
    expect(result.compact?.enabled).toBe(false);
  });

  it('returns input unchanged when compact is already present', () => {
    const input = {
      model: 'claude-sonnet-4-6',
      compact: { enabled: true, trigger: 'tokens' as const, threshold_tokens: 50_000, fresh_tail: 4, threshold_percent: 70 },
    };
    expect(migrateLegacyCompact(input as any).compact).toBe(input.compact);
  });

  it('synthesizes compact defaults when neither block is present', () => {
    const result = migrateLegacyCompact({ model: 'claude-sonnet-4-6' } as any);
    expect(result.compact?.threshold_percent).toBe(70);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `migrateLegacyCompact` does not exist yet.

- [ ] **Step 3: Implement `migrateLegacyCompact` and call from `Agent` constructor**

In `src/agent/agent.ts`, export the function and call it on the parsed config before storing:

```ts
export function migrateLegacyCompact<T extends AgentConfig>(parsed: T): T {
  if (parsed.compact) return parsed;
  const legacy = parsed.auto_compress;
  parsed.compact = {
    enabled: legacy?.enabled ?? true,
    trigger: 'percent',
    threshold_percent: 70,
    fresh_tail: 4,
  };
  return parsed;
}
```

In the `Agent` class constructor, where `this.config = config`, replace with `this.config = migrateLegacyCompact(config)`.

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Run all agent tests to verify no regression**

```bash
npx vitest run src/agent/
```

- [ ] **Step 6: Commit**

```bash
git add src/agent/agent.ts src/agent/__tests__/agent-config-migration.test.ts
git commit -m "feat(compact): migrate legacy auto_compress to compact block on read"
```

---

## Phase 2 — Trigger module

### Task 3: Implement `trigger.ts` — token budget calculation

**Files:**
- Create: `src/session/compact/trigger.ts`
- Test: `src/session/compact/__tests__/trigger.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  effectiveWindow,
  thresholdTokens,
  shouldCompactPreQuery,
  shouldCompactPostQuery,
  RESERVE_TOKENS,
} from '../trigger.js';

describe('effectiveWindow', () => {
  it('returns model window minus 13K reserve for known models', () => {
    expect(effectiveWindow('claude-sonnet-4-6')).toBe(1_000_000 - RESERVE_TOKENS);
    expect(effectiveWindow('claude-haiku-4-5')).toBe(200_000 - RESERVE_TOKENS);
  });

  it('returns 200K-reserve for unknown models', () => {
    expect(effectiveWindow('unknown-model-xyz')).toBe(200_000 - RESERVE_TOKENS);
  });
});

describe('thresholdTokens', () => {
  it('computes percent of effective window', () => {
    const t = thresholdTokens('claude-haiku-4-5', 70);
    expect(t).toBe(Math.floor((200_000 - RESERVE_TOKENS) * 0.7));
  });
});

describe('shouldCompactPreQuery', () => {
  const cfg = { trigger: 'percent' as const, threshold_percent: 70, threshold_tokens: undefined };

  it('returns false when no baseline usage exists', () => {
    expect(
      shouldCompactPreQuery({
        lastUsage: undefined,
        incomingPromptText: 'short message',
        model: 'claude-haiku-4-5',
        config: cfg,
      }),
    ).toBe(false);
  });

  it('returns false when projected total stays below threshold', () => {
    expect(
      shouldCompactPreQuery({
        lastUsage: { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        incomingPromptText: 'hi',
        model: 'claude-haiku-4-5',
        config: cfg,
      }),
    ).toBe(false);
  });

  it('returns true when projected total reaches threshold', () => {
    const threshold = thresholdTokens('claude-haiku-4-5', 70);
    expect(
      shouldCompactPreQuery({
        lastUsage: { input_tokens: threshold, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        incomingPromptText: 'a',
        model: 'claude-haiku-4-5',
        config: cfg,
      }),
    ).toBe(true);
  });

  it('honors trigger=tokens absolute override', () => {
    const cfgTokens = { trigger: 'tokens' as const, threshold_percent: 70, threshold_tokens: 5000 };
    expect(
      shouldCompactPreQuery({
        lastUsage: { input_tokens: 5000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        incomingPromptText: 'a',
        model: 'claude-haiku-4-5',
        config: cfgTokens,
      }),
    ).toBe(true);
  });
});

describe('shouldCompactPostQuery', () => {
  const cfg = { trigger: 'percent' as const, threshold_percent: 70, threshold_tokens: undefined };

  it('sums all token classes from usage', () => {
    expect(
      shouldCompactPostQuery({
        lastUsage: {
          input_tokens: 1000,
          cache_read_input_tokens: 50_000,
          cache_creation_input_tokens: 0,
        },
        model: 'claude-haiku-4-5',
        config: cfg,
      }),
    ).toBe(false);
  });

  it('returns true when total exceeds threshold', () => {
    expect(
      shouldCompactPostQuery({
        lastUsage: {
          input_tokens: thresholdTokens('claude-haiku-4-5', 70),
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        model: 'claude-haiku-4-5',
        config: cfg,
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — module does not exist.

- [ ] **Step 3: Implement `trigger.ts`**

```ts
export const RESERVE_TOKENS = 13_000;

const MODEL_WINDOWS: Record<string, number> = {
  'claude-opus-4-7':   1_000_000,
  'claude-opus-4-6':   1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-4-5':    200_000,
};
const FALLBACK_WINDOW = 200_000;

export interface CompactTriggerConfig {
  trigger: 'percent' | 'tokens';
  threshold_percent: number;
  threshold_tokens?: number;
}

export interface UsageLike {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function effectiveWindow(model: string): number {
  const w = MODEL_WINDOWS[model] ?? FALLBACK_WINDOW;
  return w - RESERVE_TOKENS;
}

export function thresholdTokens(model: string, percent: number): number {
  return Math.floor(effectiveWindow(model) * (percent / 100));
}

function resolveThreshold(model: string, cfg: CompactTriggerConfig): number {
  if (cfg.trigger === 'tokens' && cfg.threshold_tokens !== undefined) {
    return cfg.threshold_tokens;
  }
  return thresholdTokens(model, cfg.threshold_percent);
}

function totalTokens(usage: UsageLike): number {
  return (usage.input_tokens ?? 0)
       + (usage.cache_read_input_tokens ?? 0)
       + (usage.cache_creation_input_tokens ?? 0);
}

export function shouldCompactPreQuery(args: {
  lastUsage: UsageLike | undefined;
  incomingPromptText: string;
  model: string;
  config: CompactTriggerConfig;
}): boolean {
  if (!args.lastUsage) return false;
  const baseline = totalTokens(args.lastUsage);
  // ~3.5 chars/token estimate, errs slightly high (safer).
  const incomingEstimate = Math.ceil(args.incomingPromptText.length / 3.5);
  const projected = baseline + incomingEstimate;
  return projected >= resolveThreshold(args.model, args.config);
}

export function shouldCompactPostQuery(args: {
  lastUsage: UsageLike;
  model: string;
  config: CompactTriggerConfig;
}): boolean {
  return totalTokens(args.lastUsage) >= resolveThreshold(args.model, args.config);
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/session/compact/trigger.ts src/session/compact/__tests__/trigger.test.ts
git commit -m "feat(compact): add token-budget trigger logic (pre+post-query)"
```

---

## Phase 3 — Boundary marker

### Task 4: UUIDv7 generator and boundary discovery

**Files:**
- Create: `src/session/compact/boundary.ts`
- Test: `src/session/compact/__tests__/boundary.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { generateBoundaryId, findLastBoundaryIndex, BOUNDARY_OPEN_RE } from '../boundary.js';

describe('generateBoundaryId', () => {
  it('returns a UUIDv7 string', () => {
    const id = generateBoundaryId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns sortable IDs (later > earlier)', async () => {
    const a = generateBoundaryId();
    await new Promise((r) => setTimeout(r, 5));
    const b = generateBoundaryId();
    expect(b > a).toBe(true);
  });
});

describe('findLastBoundaryIndex', () => {
  it('returns -1 when no boundary present', () => {
    const messages = [
      { type: 'user', message: { content: [{ type: 'text', text: 'hi' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } },
    ];
    expect(findLastBoundaryIndex(messages as any)).toBe(-1);
  });

  it('finds the most recent boundary marker in user-message content', () => {
    const messages = [
      { type: 'user', message: { content: [{ type: 'text', text: '<post-compact-summary boundary-id="01900000-0000-7000-8000-000000000001">old</post-compact-summary>' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },
      { type: 'user', message: { content: [{ type: 'text', text: 'next' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ok2' }] } },
      { type: 'user', message: { content: [{ type: 'text', text: '<post-compact-summary boundary-id="01900000-0000-7000-8000-000000000002">newer</post-compact-summary>' }] } },
    ];
    expect(findLastBoundaryIndex(messages as any)).toBe(4);
  });

  it('handles string content as well as block-array content', () => {
    const messages = [
      { type: 'user', message: { content: '<post-compact-summary boundary-id="01900000-0000-7000-8000-000000000003">a</post-compact-summary>' } },
    ];
    expect(findLastBoundaryIndex(messages as any)).toBe(0);
  });
});

describe('BOUNDARY_OPEN_RE', () => {
  it('matches the opening tag with id', () => {
    const m = '<post-compact-summary boundary-id="01900000-0000-7000-8000-000000000001">'.match(BOUNDARY_OPEN_RE);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('01900000-0000-7000-8000-000000000001');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**.

- [ ] **Step 3: Implement `boundary.ts`**

```ts
import { randomBytes } from 'node:crypto';

/**
 * UUIDv7 — time-ordered, 48-bit unix ms timestamp + 74-bit randomness.
 * Sortable across compacts, unique.
 */
export function generateBoundaryId(): string {
  const ms = BigInt(Date.now());
  const buf = randomBytes(10);
  // 16 bytes total: 6 bytes timestamp, 10 bytes random.
  const bytes = Buffer.alloc(16);
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  buf.copy(bytes, 6);
  // version 7
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // variant 10
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const BOUNDARY_OPEN_RE = /<post-compact-summary boundary-id="([0-9a-f-]+)">/;

interface MessageBlock {
  type?: string;
  text?: string;
}
interface MessageLike {
  type?: string;
  message?: { content?: string | MessageBlock[] };
}

function extractText(content: string | MessageBlock[] | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('');
}

export function findLastBoundaryIndex(messages: MessageLike[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type !== 'user') continue;
    const text = extractText(m.message?.content);
    if (BOUNDARY_OPEN_RE.test(text)) return i;
  }
  return -1;
}
```

- [ ] **Step 4: Run test to verify it passes**.

- [ ] **Step 5: Commit**

```bash
git add src/session/compact/boundary.ts src/session/compact/__tests__/boundary.test.ts
git commit -m "feat(compact): UUIDv7 boundary marker + extraction"
```

---

## Phase 4 — Recent turns extraction

### Task 5: Read SDK JSONL transcript, return last N turns

**Files:**
- Create: `src/session/compact/recent-turns.ts`
- Test: `src/session/compact/__tests__/recent-turns.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractRecentTurns, MAX_CHARS_PER_TURN } from '../recent-turns.js';

function writeJsonl(dir: string, sessionId: string, lines: object[]): string {
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return path;
}

describe('extractRecentTurns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compact-test-'));

  it('returns empty array when transcript is missing', async () => {
    const turns = await extractRecentTurns({
      transcriptPath: join(dir, 'nonexistent.jsonl'),
      freshTail: 4,
    });
    expect(turns).toEqual([]);
  });

  it('returns last N user/assistant pairs in order', async () => {
    const path = writeJsonl(dir, 'sess1', [
      { type: 'user',      message: { content: [{ type: 'text', text: 'msg1' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'reply1' }] } },
      { type: 'user',      message: { content: [{ type: 'text', text: 'msg2' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'reply2' }] } },
      { type: 'user',      message: { content: [{ type: 'text', text: 'msg3' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'reply3' }] } },
    ]);
    const turns = await extractRecentTurns({ transcriptPath: path, freshTail: 2 });
    expect(turns).toEqual([
      { role: 'user', content: 'msg2' },
      { role: 'assistant', content: 'reply2' },
      { role: 'user', content: 'msg3' },
      { role: 'assistant', content: 'reply3' },
    ]);
  });

  it('truncates per-turn content to MAX_CHARS_PER_TURN', async () => {
    const huge = 'x'.repeat(MAX_CHARS_PER_TURN + 5_000);
    const path = writeJsonl(dir, 'sess2', [
      { type: 'user', message: { content: [{ type: 'text', text: huge }] } },
    ]);
    const turns = await extractRecentTurns({ transcriptPath: path, freshTail: 1 });
    expect(turns[0].content.length).toBeLessThanOrEqual(MAX_CHARS_PER_TURN + 50);
    expect(turns[0].content).toContain('…(truncated)');
  });

  it('skips entries that are neither user nor assistant', async () => {
    const path = writeJsonl(dir, 'sess3', [
      { type: 'system',    message: { content: 'skip' } },
      { type: 'user',      message: { content: [{ type: 'text', text: 'real' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'real-reply' }] } },
    ]);
    const turns = await extractRecentTurns({ transcriptPath: path, freshTail: 4 });
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant']);
  });

  it('respects fresh_tail = 0 (returns empty)', async () => {
    const path = writeJsonl(dir, 'sess4', [
      { type: 'user', message: { content: [{ type: 'text', text: 'hi' }] } },
    ]);
    const turns = await extractRecentTurns({ transcriptPath: path, freshTail: 0 });
    expect(turns).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**.

- [ ] **Step 3: Implement `recent-turns.ts`**

```ts
import { promises as fs } from 'node:fs';

export const MAX_CHARS_PER_TURN = 10_000;
const TRUNCATION_MARKER = '…(truncated)';

export interface RecentTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface MessageBlock {
  type?: string;
  text?: string;
}
interface JsonlEntry {
  type?: string;
  message?: { content?: string | MessageBlock[] };
}

function extractText(content: string | MessageBlock[] | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('');
}

function truncate(s: string): string {
  if (s.length <= MAX_CHARS_PER_TURN) return s;
  return s.slice(0, MAX_CHARS_PER_TURN - TRUNCATION_MARKER.length - 1) + ' ' + TRUNCATION_MARKER;
}

export async function extractRecentTurns(args: {
  transcriptPath: string;
  freshTail: number;
}): Promise<RecentTurn[]> {
  if (args.freshTail <= 0) return [];

  let raw: string;
  try {
    raw = await fs.readFile(args.transcriptPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const entries: JsonlEntry[] = raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as JsonlEntry;
      } catch {
        return {};
      }
    })
    .filter((e) => e.type === 'user' || e.type === 'assistant');

  const want = args.freshTail * 2; // pair = user + assistant
  const tail = entries.slice(-want);

  return tail.map((e) => ({
    role: e.type as 'user' | 'assistant',
    content: truncate(extractText(e.message?.content)),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**.

- [ ] **Step 5: Commit**

```bash
git add src/session/compact/recent-turns.ts src/session/compact/__tests__/recent-turns.test.ts
git commit -m "feat(compact): extract last N turns from SDK JSONL transcript"
```

---

## Phase 5 — Summary prompt

### Task 6: Build summary prompt + parse `<summary>` envelope

**Files:**
- Create: `src/session/compact/summary-prompt.ts`
- Test: `src/session/compact/__tests__/summary-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildCompactPrompt, parseSummaryResponse } from '../summary-prompt.js';

describe('buildCompactPrompt', () => {
  it('contains all 7 named sections', () => {
    const p = buildCompactPrompt();
    expect(p).toContain('1. Primary Request and Intent');
    expect(p).toContain('2. Key Facts About the User and Domain');
    expect(p).toContain('3. Decisions Made and Commitments Given');
    expect(p).toContain('4. Errors and Corrections');
    expect(p).toContain('5. All User Messages');
    expect(p).toContain('6. Pending Tasks and Promises');
    expect(p).toContain('7. Current State');
  });

  it('embeds custom instructions when provided', () => {
    const p = buildCompactPrompt('Always preserve order numbers in section 6.');
    expect(p).toContain('Always preserve order numbers in section 6.');
  });

  it('omits custom-instructions block when empty', () => {
    const p = buildCompactPrompt();
    expect(p).not.toContain('Additional instructions:');
  });
});

describe('parseSummaryResponse', () => {
  it('returns content of <summary> block stripped', () => {
    const raw = '<analysis>thinking…</analysis>\n<summary>\n1. Intent: ...\n</summary>';
    expect(parseSummaryResponse(raw)).toBe('1. Intent: ...');
  });

  it('throws when <summary> tags missing', () => {
    expect(() => parseSummaryResponse('plain text')).toThrow(/missing <summary>/);
  });

  it('handles trailing whitespace', () => {
    const raw = '<summary>\n  body  \n</summary>\n';
    expect(parseSummaryResponse(raw)).toBe('body');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**.

- [ ] **Step 3: Implement `summary-prompt.ts`**

```ts
export function buildCompactPrompt(customInstructions?: string): string {
  const instructionsBlock = customInstructions
    ? `\nAdditional instructions: ${customInstructions}\n`
    : '';

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
${instructionsBlock}
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

export function parseSummaryResponse(raw: string): string {
  const match = raw.match(/<summary>([\s\S]*?)<\/summary>/);
  if (!match) {
    throw new Error('compact: summary response missing <summary> tags');
  }
  return match[1].trim();
}
```

- [ ] **Step 4: Run test to verify it passes**.

- [ ] **Step 5: Commit**

```bash
git add src/session/compact/summary-prompt.ts src/session/compact/__tests__/summary-prompt.test.ts
git commit -m "feat(compact): 7-section summary prompt + response parser"
```

---

## Phase 6 — Post-compact prompt assembly

### Task 7: Assemble first-prompt of new SDK session

**Files:**
- Create: `src/session/compact/post-compact-prompt.ts`
- Test: `src/session/compact/__tests__/post-compact-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildPostCompactPrompt } from '../post-compact-prompt.js';

describe('buildPostCompactPrompt', () => {
  const base = {
    boundaryId: '01900000-0000-7000-8000-000000000001',
    summary: '1. Intent: continue task X.\n2. Facts: ...',
    sessionContextHeader: '[2026-05-02 14:00 Asia/Almaty] ',
  };

  it('wraps summary in boundary tags with id', () => {
    const p = buildPostCompactPrompt({
      ...base,
      recentTurns: [],
      newUserMessage: 'next',
      senderLabel: 'timur',
    });
    expect(p).toContain(`<post-compact-summary boundary-id="${base.boundaryId}">`);
    expect(p).toContain('</post-compact-summary>');
    expect(p).toContain(base.summary);
  });

  it('emits <recent-turns> block when recent turns provided', () => {
    const p = buildPostCompactPrompt({
      ...base,
      recentTurns: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
      newUserMessage: 'next',
      senderLabel: 'timur',
    });
    expect(p).toContain('<recent-turns>');
    expect(p).toContain('[user]: a');
    expect(p).toContain('[assistant]: b');
    expect(p).toContain('</recent-turns>');
  });

  it('omits <recent-turns> block when empty', () => {
    const p = buildPostCompactPrompt({
      ...base,
      recentTurns: [],
      newUserMessage: 'next',
      senderLabel: 'timur',
    });
    expect(p).not.toContain('<recent-turns>');
  });

  it('appends sender label and new message at the end', () => {
    const p = buildPostCompactPrompt({
      ...base,
      recentTurns: [],
      newUserMessage: 'привет',
      senderLabel: 'timur',
    });
    expect(p.endsWith('[timur]: привет')).toBe(true);
  });

  it('preserves session context header verbatim at the start', () => {
    const p = buildPostCompactPrompt({
      ...base,
      recentTurns: [],
      newUserMessage: 'x',
      senderLabel: 'u',
    });
    expect(p.startsWith(base.sessionContextHeader)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**.

- [ ] **Step 3: Implement `post-compact-prompt.ts`**

```ts
import type { RecentTurn } from './recent-turns.js';

export function buildPostCompactPrompt(args: {
  boundaryId: string;
  summary: string;
  recentTurns: RecentTurn[];
  newUserMessage: string;
  senderLabel: string;
  sessionContextHeader: string;
}): string {
  const recentBlock = args.recentTurns.length === 0
    ? ''
    : `<recent-turns>\n${args.recentTurns
        .map((t) => `[${t.role}]: ${t.content}`)
        .join('\n\n')}\n</recent-turns>\n\n`;

  return `${args.sessionContextHeader}<post-compact-summary boundary-id="${args.boundaryId}">
This conversation continues from a previous segment that was compacted to
free context. The summary below covers everything before the recent turns.

${args.summary}

Continue the conversation from where it left off. Do not acknowledge this
summary block. Do not recap. Do not ask the user to repeat themselves.
Pick up the last task as if no break occurred.
</post-compact-summary>

${recentBlock}[${args.senderLabel}]: ${args.newUserMessage}`;
}
```

- [ ] **Step 4: Run test to verify it passes**.

- [ ] **Step 5: Commit**

```bash
git add src/session/compact/post-compact-prompt.ts src/session/compact/__tests__/post-compact-prompt.test.ts
git commit -m "feat(compact): assemble post-compact first prompt"
```

---

## Phase 7 — `CoreCompactor` class

### Task 8: Public surface, usage tracking, summary generation

**Files:**
- Create: `src/session/compact/index.ts`
- Test: `src/session/compact/__tests__/index.test.ts`

- [ ] **Step 1: Write failing tests** (use SDK `query` stub via vitest module mocking)

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the SDK before importing CoreCompactor
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));
import { query } from '@anthropic-ai/claude-agent-sdk';
import { CoreCompactor } from '../index.js';

const cfg = {
  enabled: true,
  trigger: 'percent' as const,
  threshold_percent: 70,
  fresh_tail: 4,
};

function mockSummaryStream(text: string) {
  (query as any).mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield { type: 'assistant', message: { content: [{ type: 'text', text }] } };
      yield { type: 'result' };
    },
  });
}

describe('CoreCompactor.recordUsage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores usage by sessionKey', () => {
    const c = new CoreCompactor({ config: cfg } as any);
    c.recordUsage('sess1', { input_tokens: 1000 });
    expect(c['lastUsageBySessionKey'].get('sess1')).toEqual({ input_tokens: 1000 });
  });

  it('clears usage on compact()', async () => {
    mockSummaryStream('<summary>ok</summary>');
    const c = new CoreCompactor({ config: cfg } as any);
    c.recordUsage('sess1', { input_tokens: 999 });

    await c.compact({
      agent: stubAgent('sess1'),
      sessionKey: 'sess1',
      trigger: 'manual',
    });

    expect(c['lastUsageBySessionKey'].has('sess1')).toBe(false);
  });
});

describe('CoreCompactor.compact', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls SDK query with resume option and trustedBypass', async () => {
    mockSummaryStream('<analysis>x</analysis><summary>SUMMARY</summary>');
    const c = new CoreCompactor({ config: cfg } as any);
    await c.compact({
      agent: stubAgent('sess1', 'sdk-session-abc'),
      sessionKey: 'sess1',
      trigger: 'auto-pre',
    });
    expect(query).toHaveBeenCalledTimes(1);
    const args = (query as any).mock.calls[0][0];
    expect(args.options.resume).toBe('sdk-session-abc');
  });

  it('returns CompactResult with boundaryId, summary, postCompactPrompt fn', async () => {
    mockSummaryStream('<summary>SUMMARY</summary>');
    const c = new CoreCompactor({ config: cfg } as any);
    const result = await c.compact({
      agent: stubAgent('sess1', 'sdk-session-abc'),
      sessionKey: 'sess1',
      trigger: 'manual',
    });
    expect(result.summary).toBe('SUMMARY');
    expect(result.boundaryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof result.postCompactPrompt).toBe('function');
    const p = result.postCompactPrompt({
      newUserMessage: 'hi',
      senderLabel: 'u',
      sessionContextHeader: '',
    });
    expect(p).toContain('SUMMARY');
    expect(p).toContain('[u]: hi');
  });

  it('passes customInstructions into the summary prompt', async () => {
    mockSummaryStream('<summary>x</summary>');
    const c = new CoreCompactor({ config: cfg } as any);
    await c.compact({
      agent: stubAgent('sess1', 'sdk-session-abc'),
      sessionKey: 'sess1',
      trigger: 'manual',
      customInstructions: 'preserve ticket IDs',
    });
    const args = (query as any).mock.calls[0][0];
    expect(args.prompt).toContain('preserve ticket IDs');
  });

  it('throws when summary response is malformed', async () => {
    mockSummaryStream('no tags here');
    const c = new CoreCompactor({ config: cfg } as any);
    await expect(
      c.compact({
        agent: stubAgent('sess1', 'sdk-session-abc'),
        sessionKey: 'sess1',
        trigger: 'manual',
      }),
    ).rejects.toThrow(/missing <summary>/);
  });
});

function stubAgent(sessionKey: string, sessionId: string = 'sdk-1') {
  return {
    id: 'test-agent',
    config: { model: 'claude-haiku-4-5' },
    getSessionId: () => sessionId,
    sessionPath: () => '/tmp/nonexistent.jsonl',
  } as any;
}
```

- [ ] **Step 2: Run test to verify it fails**.

- [ ] **Step 3: Implement `index.ts`**

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { logger } from '../../logger.js';
import { buildSdkOptions } from '../../agent/sdk-options.js';
import type { Agent } from '../../agent/agent.js';
import type { StoredAgentRunUsage } from '../../types/usage.js';
import {
  shouldCompactPreQuery,
  shouldCompactPostQuery,
  type CompactTriggerConfig,
  type UsageLike,
} from './trigger.js';
import { generateBoundaryId } from './boundary.js';
import { extractRecentTurns, type RecentTurn } from './recent-turns.js';
import { buildCompactPrompt, parseSummaryResponse } from './summary-prompt.js';
import { buildPostCompactPrompt } from './post-compact-prompt.js';

export interface CompactConfig extends CompactTriggerConfig {
  enabled: boolean;
  fresh_tail: number;
}

export interface CompactResult {
  boundaryId: string;
  summary: string;
  recentTurns: RecentTurn[];
  preCompactTokens: number;
  postCompactPrompt: (args: {
    newUserMessage: string;
    senderLabel: string;
    sessionContextHeader: string;
  }) => string;
}

export class CoreCompactor {
  private lastUsageBySessionKey = new Map<string, UsageLike>();
  private failureCount = new Map<string, number>();
  private readonly MAX_CONSECUTIVE_FAILURES = 3;

  constructor(private opts: { config: CompactConfig }) {}

  recordUsage(sessionKey: string, usage: UsageLike): void {
    this.lastUsageBySessionKey.set(sessionKey, usage);
  }

  shouldCompactPreQuery(args: {
    sessionKey: string;
    incomingPromptText: string;
    model: string;
  }): boolean {
    if (!this.opts.config.enabled) return false;
    if ((this.failureCount.get(args.sessionKey) ?? 0) >= this.MAX_CONSECUTIVE_FAILURES) return false;
    return shouldCompactPreQuery({
      lastUsage: this.lastUsageBySessionKey.get(args.sessionKey),
      incomingPromptText: args.incomingPromptText,
      model: args.model,
      config: this.opts.config,
    });
  }

  shouldCompactPostQuery(args: {
    sessionKey: string;
    lastUsage: StoredAgentRunUsage;
    model: string;
  }): boolean {
    if (!this.opts.config.enabled) return false;
    if ((this.failureCount.get(args.sessionKey) ?? 0) >= this.MAX_CONSECUTIVE_FAILURES) return false;
    return shouldCompactPostQuery({
      lastUsage: args.lastUsage,
      model: args.model,
      config: this.opts.config,
    });
  }

  async compact(args: {
    agent: Agent;
    sessionKey: string;
    trigger: 'auto-pre' | 'auto-post' | 'manual';
    customInstructions?: string;
  }): Promise<CompactResult> {
    const sessionId = args.agent.getSessionId(args.sessionKey);
    if (!sessionId) {
      throw new Error('compact: cannot compact session without active sessionId');
    }

    let summary: string;
    try {
      summary = await this.generateSummary({
        agent: args.agent,
        sessionId,
        customInstructions: args.customInstructions,
      });
    } catch (err) {
      const next = (this.failureCount.get(args.sessionKey) ?? 0) + 1;
      this.failureCount.set(args.sessionKey, next);
      if (next >= this.MAX_CONSECUTIVE_FAILURES) {
        logger.warn(
          { agentId: args.agent.id, sessionKey: args.sessionKey, failures: next },
          'compact: circuit breaker tripped — disabling compact for this session',
        );
      }
      throw err;
    }

    this.failureCount.delete(args.sessionKey);

    const boundaryId = generateBoundaryId();
    const recentTurns = await extractRecentTurns({
      transcriptPath: args.agent.sessionPath(sessionId),
      freshTail: this.opts.config.fresh_tail,
    });

    // Invalidate usage baseline — next query opens a new SDK session.
    this.lastUsageBySessionKey.delete(args.sessionKey);

    return {
      boundaryId,
      summary,
      recentTurns,
      preCompactTokens: 0,
      postCompactPrompt: ({ newUserMessage, senderLabel, sessionContextHeader }) =>
        buildPostCompactPrompt({
          boundaryId,
          summary,
          recentTurns,
          newUserMessage,
          senderLabel,
          sessionContextHeader,
        }),
    };
  }

  private async generateSummary(args: {
    agent: Agent;
    sessionId: string;
    customInstructions?: string;
  }): Promise<string> {
    const prompt = buildCompactPrompt(args.customInstructions);

    const options = buildSdkOptions({
      agent: args.agent,
      resume: args.sessionId,
      trustedBypass: true,
      canUseTool: async () => ({
        behavior: 'deny' as const,
        message: 'Tool use is not allowed during compaction',
      }),
      maxOutputTokens: 32_000,
    });

    const result = query({ prompt, options: options as any });
    let text = '';
    for await (const ev of result as AsyncIterable<any>) {
      if (ev.type === 'assistant' && ev.message?.content) {
        for (const block of ev.message.content) {
          if (block.type === 'text') text += block.text;
        }
      }
      if (ev.type === 'result') break;
    }
    return parseSummaryResponse(text);
  }
}
```

NOTE: `buildSdkOptions` already exists in `src/agent/sdk-options.ts`. Inspect its signature and pass-through to confirm `canUseTool` and `maxOutputTokens` slots exist; if not, add them in the same task and adjust this code. Tests above use vitest mocking, so they're insulated from SDK behaviour.

- [ ] **Step 4: Run test to verify it passes**.

- [ ] **Step 5: Commit**

```bash
git add src/session/compact/index.ts src/session/compact/__tests__/index.test.ts
git commit -m "feat(compact): CoreCompactor class with usage tracking + summary generation"
```

---

## Phase 8 — Hooks

### Task 9: Add `on_pre_compact` and `on_post_compact` hook events

**Files:**
- Modify: `src/hooks/emitter.ts`
- Modify: `src/hooks/types.ts` (or wherever event types live)
- Test: `src/hooks/__tests__/compact-events.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { HookEmitter } from '../emitter.js';

describe('compact hook events', () => {
  it('emits on_pre_compact and collects customInstructions returned by handlers', async () => {
    const emitter = new HookEmitter();
    emitter.registerHook('on_pre_compact', () => ({ customInstructions: 'preserve order numbers' }));
    const result = await emitter.emitWithReturn('on_pre_compact', {
      agentId: 'a', sessionKey: 's', trigger: 'auto-pre', preCompactTokens: 0,
    });
    expect(result).toEqual([{ customInstructions: 'preserve order numbers' }]);
  });

  it('emits on_post_compact (read-only)', async () => {
    const emitter = new HookEmitter();
    const handler = vi.fn();
    emitter.registerHook('on_post_compact', handler);
    await emitter.emit('on_post_compact', {
      agentId: 'a', sessionKey: 's', summary: 'x', recentTurnsCount: 4, preCompactTokens: 100, postCompactTokens: 20,
    });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'a', summary: 'x' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**.

- [ ] **Step 3: Add the events to emitter type union and (if needed) `emitWithReturn` helper**

In `src/hooks/types.ts` (or equivalent), add to the event-name union:

```ts
| 'on_pre_compact'
| 'on_post_compact'
```

Add payload types:

```ts
export interface PreCompactPayload {
  agentId: string;
  sessionKey: string;
  trigger: 'auto-pre' | 'auto-post' | 'manual';
  preCompactTokens: number;
}

export interface PreCompactReturn {
  customInstructions?: string;
}

export interface PostCompactPayload {
  agentId: string;
  sessionKey: string;
  summary: string;
  recentTurnsCount: number;
  preCompactTokens: number;
  postCompactTokens: number;
}
```

In `src/hooks/emitter.ts`, ensure `emitWithReturn` (returning array of handler results) exists for `on_pre_compact`. If the existing `emit` method already supports return-value collection, reuse it; otherwise add `emitWithReturn`.

- [ ] **Step 4: Run test to verify it passes**.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/
git commit -m "feat(compact): add on_pre_compact and on_post_compact hook events"
```

---

## Phase 9 — Gateway integration

### Task 10: Wire `CoreCompactor` into Gateway lifecycle

**Files:**
- Modify: `src/gateway.ts`
- Test: `src/__tests__/compact-integration.test.ts` (new)

This task is large — split into 5 sub-steps. Subagent should NOT split into multiple commits per sub-step; commit once at the end. Each sub-step is verified by running the integration test.

- [ ] **Step 1: Write failing integration test**

Copy the fixture skeleton from `src/__tests__/routing.test.ts:1-80` (Gateway construction + tmpdir + minimal config.yml + stub channel adapter pattern). Adapt to add **one** agent with `compact: { enabled: true, trigger: 'percent', threshold_percent: 70, fresh_tail: 2 }` and skip `auto_compress`. Mock the SDK module with vitest:

```ts
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  startup: vi.fn().mockResolvedValue(undefined),
}));
```

Then the test body:

```ts
it('flags session for compact when post-query usage crosses threshold, and applies compact on next dispatch', async () => {
  // Arrange: queue two `query()` returns —
  //   call 1 = first user turn, result event with usage at 80% of haiku threshold
  //   call 2 = compact summary stream returning <summary>S</summary>
  //   call 3 = second user turn (consumes the post-compact prompt)
  const calls: any[] = [];
  (query as any).mockImplementation((args) => {
    calls.push(args);
    if (calls.length === 1) {
      return mockStream([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'reply1' }] } },
        { type: 'result', usage: { input_tokens: thresholdTokens('claude-haiku-4-5', 70) + 100,
                                   cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      ]);
    }
    if (calls.length === 2) {
      return mockStream([
        { type: 'assistant', message: { content: [{ type: 'text', text: '<summary>SUMMARY</summary>' }] } },
        { type: 'result' },
      ]);
    }
    return mockStream([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'reply2' }] } },
      { type: 'result', usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    ]);
  });

  // Act
  await gateway.dispatch(buildMsg('msg-1'));
  await gateway.dispatch(buildMsg('msg-2'));

  // Assert
  expect(calls).toHaveLength(3);
  expect(calls[2].prompt).toContain('<post-compact-summary boundary-id="');
  expect(calls[2].prompt).toContain('SUMMARY');
  expect(calls[2].prompt).toContain('[testuser]: msg-2');
});

function mockStream(events: any[]) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e; } };
}
```

Helper `buildMsg` and the gateway/channel fixture should mirror lines 25-65 of `routing.test.ts` exactly.

- [ ] **Step 2: Instantiate `CoreCompactor` per agent (lazy)**

Add to `Gateway` class:

```ts
private compactors = new Map<string, CoreCompactor>();

private compactorFor(agentId: string): CoreCompactor {
  let c = this.compactors.get(agentId);
  if (c) return c;
  const agent = this.agents.get(agentId);
  if (!agent) throw new Error(`compact: unknown agent ${agentId}`);
  c = new CoreCompactor({ config: agent.config.compact ?? defaultCompactConfig() });
  this.compactors.set(agentId, c);
  return c;
}
```

Wire invalidation: in the existing `reloadAgents()` (or wherever agent configs are re-read on hot-reload), also call `this.compactors.delete(agentId)` for each reloaded agent — next access re-instantiates with fresh config.

Add to `src/session/compact/index.ts` (export alongside `CoreCompactor`):

```ts
export function defaultCompactConfig(): CompactConfig {
  return {
    enabled: true,
    trigger: 'percent',
    threshold_percent: 70,
    fresh_tail: 4,
  };
}
```

- [ ] **Step 3: Hook `recordUsage` into `result` event handler**

In `queryAgent`, where SDK `result` event is handled and `runUsage` is set, also call:

```ts
const compactor = this.compactorFor(route.agentId);
compactor.recordUsage(sessionKey, runUsage);
```

- [ ] **Step 4: Replace `auto_compress` block with new pre/post-query check**

At `gateway.ts:3773-3814`, replace the existing message-count block with:

```ts
// Pre-query check: did we flag this session for compact, OR is the projected
// post-query size over the threshold?
const compactor = this.compactorFor(route.agentId);
const flagged = this.compactNeededOnNextDispatch.has(sessionKey);
const projectedOver = compactor.shouldCompactPreQuery({
  sessionKey,
  incomingPromptText: msg.text ?? '',
  model: agent.config.model ?? 'claude-sonnet-4-6',
});

if ((flagged || projectedOver) && agent.getSessionId(sessionKey)) {
  this.compactNeededOnNextDispatch.delete(sessionKey);
  await this.runCompact(agent, route.agentId, sessionKey, msg, channel,
    flagged ? 'auto-post' : 'auto-pre');
  // continue with normal dispatch — runCompact has updated agent.sessions
  // and stashed the post-compact prompt for the upcoming queryAgent call.
}
```

Add `private compactNeededOnNextDispatch = new Set<string>()` to Gateway.

After `queryAgent` returns and we record usage, post-check:

```ts
if (compactor.shouldCompactPostQuery({ sessionKey, lastUsage: runUsage, model })) {
  this.compactNeededOnNextDispatch.add(sessionKey);
}
```

- [ ] **Step 5: Implement `runCompact`**

```ts
private async runCompact(
  agent: Agent,
  agentId: string,
  sessionKey: string,
  msg: InboundMessage,
  channel: ChannelAdapter | undefined,
  trigger: 'auto-pre' | 'auto-post' | 'manual',
): Promise<void> {
  const compactor = this.compactorFor(agentId);

  // Fire pre-compact hook, collect customInstructions
  let customInstructions: string | undefined;
  if (this.hookEmitter) {
    const hookResults = await this.hookEmitter.emitWithReturn('on_pre_compact', {
      agentId, sessionKey, trigger, preCompactTokens: 0,
    });
    customInstructions = hookResults.find((r) => r?.customInstructions)?.customInstructions;
  }

  let result;
  try {
    result = await compactor.compact({ agent, sessionKey, trigger, customInstructions });
  } catch (err) {
    logger.error({ err, agentId, sessionKey }, 'compact: summary generation failed');
    // Fall back to legacy: save what we can, clear session, continue.
    await this.summarizeAndSaveSession(agent, sessionKey);
    agent.clearSession(sessionKey);
    if (this.hookEmitter) {
      void this.hookEmitter.emit('on_session_reset', { agentId, sessionKey, reason: 'compact_failed' });
    }
    return;
  }

  // Reset SDK session — next query() will start a fresh session_id.
  agent.clearSession(sessionKey);

  // Stash the post-compact prompt builder so queryAgent can pick it up.
  this.pendingPostCompactPrompt.set(sessionKey, result.postCompactPrompt);

  if (this.hookEmitter) {
    void this.hookEmitter.emit('on_post_compact', {
      agentId, sessionKey, summary: result.summary,
      recentTurnsCount: result.recentTurns.length,
      preCompactTokens: result.preCompactTokens,
      postCompactTokens: 0,
    });
    void this.hookEmitter.emit('on_session_reset', { agentId, sessionKey, reason: 'compact' });
  }

  if (channel && trigger === 'manual') {
    await channel.sendText(msg.peerId, '💾 Контекст сжат. Продолжаем без потери контекста.', {
      accountId: msg.accountId, threadId: msg.threadId,
    });
  }
}
```

In `queryAgent`, at the point where `prompt` is built (currently `gateway.ts:3899-3954`), check for stashed post-compact prompt:

```ts
const stashed = this.pendingPostCompactPrompt.get(sessionKey);
if (stashed) {
  this.pendingPostCompactPrompt.delete(sessionKey);
  prompt = stashed({
    newUserMessage: msg.text ?? '',
    senderLabel,
    sessionContextHeader: sessionCtx,
  });
} else {
  // existing prompt construction
}
```

Add `private pendingPostCompactPrompt = new Map<string, CompactResult['postCompactPrompt']>()` to Gateway.

- [ ] **Step 6: Replace `/compact` command body**

At `gateway.ts:3572-3597`:

```ts
if (cmd === '/compact') {
  if (channel) {
    await channel.sendText(msg.peerId, 'Сжимаю контекст...', {
      accountId: msg.accountId, threadId: msg.threadId,
    });
  }
  if (this.sdkReady && agent.getSessionId(sessionKey)) {
    await this.runCompact(agent, route.agentId, sessionKey, msg, channel, 'manual');
  }
  recordRouteDecision({ outcome: 'session_reset', candidates: routeCandidates,
    winnerAgentId: route.agentId, accessAllowed: true, sessionKey });
  return;
}
```

- [ ] **Step 7: Run integration test + full test suite**

```bash
npx vitest run src/__tests__/compact-integration.test.ts
pnpm test
```

Both must be green.

- [ ] **Step 8: Commit**

```bash
git add src/gateway.ts src/__tests__/compact-integration.test.ts
git commit -m "feat(compact): wire CoreCompactor into Gateway dispatch loop"
```

---

## Phase 10 — LCM repointing

### Task 11: Remove `compress` from `ContextEngine`, add `ingest`

**Files:**
- Modify: `src/plugins/types.ts`
- Modify: `plugins/lcm/src/index.ts`
- Modify: `src/gateway.ts` (delete `tryPluginCompress` call site, keep helper for backward compat)
- Test: `plugins/lcm/tests/ingest.test.ts` (new)

- [ ] **Step 1: Write failing test for ingest**

Use the `PluginContext` stub pattern from `plugins/lcm/tests/lifecycle.test.ts` (lines 1-50 — `mkdtempSync`, `Database`, fake logger, fake `getAgentConfig` returning `{ plugins: { lcm: { enabled: true } } }`). Then:

```ts
// plugins/lcm/tests/ingest.test.ts
import { describe, expect, it } from 'vitest';
import { register } from '../src/index.js';
import { buildContextStub } from './fixtures.js'; // factor out from lifecycle.test.ts if not already

describe('LCM plugin ingest', () => {
  it('records a turn into MessageStore via engine.ingest()', async () => {
    const ctx = buildContextStub();
    const instance = await register(ctx);
    const engine = ctx.registeredContextEngine!; // captured by registerContextEngine stub

    await engine.ingest!({
      agentId: 'agentA',
      sessionKey: 'sess-1',
      userText: 'hello',
      assistantText: 'hi back',
      usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      timestamp: Date.now(),
    });

    // Inspect the per-agent state — it's not exposed publicly, so probe via
    // the lcm_status MCP tool which the test fixture exposes.
    const statusToolEntry = ctx.registeredMcpTools.find((t) => t.name === 'lcm_status');
    const result = await statusToolEntry!.handler({ session: 'sess-1' }, { agentId: 'agentA' });
    expect(result.totalMessages).toBeGreaterThanOrEqual(1);
  });

  it('ingest is a no-op when plugin is disabled for the agent', async () => {
    const ctx = buildContextStub({ pluginEnabled: false });
    await register(ctx);
    const engine = ctx.registeredContextEngine!;
    await engine.ingest!({ agentId: 'agentA', sessionKey: 's', userText: 'a', assistantText: 'b',
      usage: {}, timestamp: 0 });
    // No throw — and no new rows in DB. Probe via status as above; expect 0.
  });
});
```

If `buildContextStub` does not exist as a shared fixture, factor it out from `lifecycle.test.ts` first (in this same task) and reuse from both files.

- [ ] **Step 2: Run test to verify it fails**.

- [ ] **Step 3: Update `ContextEngine` interface**

In `src/plugins/types.ts`:

```ts
export interface ContextEngine {
  /**
   * Mirror a completed turn into plugin-side state (e.g. LCM DAG).
   * Called once per turn from gateway.queryAgent after the result event.
   */
  ingest?: (input: {
    agentId: string;
    sessionKey: string;
    userText: string;
    assistantText: string;
    usage: StoredAgentRunUsage;
    timestamp: number;
  }) => Promise<void>;

  /**
   * Prepend retrieval blocks to the prompt for the upcoming query.
   * Read-only; cannot mutate the prompt body.
   */
  assemble?: (input: {
    agentId: string;
    sessionKey: string;
    promptText: string;
  }) => Promise<{ contextBlocks: string[] } | null>;
}
```

(`compress` is removed.)

- [ ] **Step 4: Update LCM plugin**

In `plugins/lcm/src/index.ts`:
- Remove the `compress` method from `engineFacade`.
- Add `ingest` method that calls the existing engine's mirror logic (the current `on_after_query` mirror hook can be repointed to call `ingest` directly).
- Update `assemble` to also append a `<lcm-grep-results>` block if the incoming `promptText` matches DAG entries (top 3, char-capped at 1500 each).

- [ ] **Step 5: Update gateway**

In `src/gateway.ts`:
- Delete the `tryPluginCompress` call site at `gateway.ts:3792-3798` (the entire delegation block — `runCompact` now owns the compact path).
- Keep `tryPluginCompress` as a deprecated no-op shim with a `// @deprecated` JSDoc, removable in next phase.
- In the `result` event handler, after `recordUsage`, call:

```ts
const ce = this.pluginRegistry.getContextEngine(route.agentId);
if (ce?.engine?.ingest) {
  void ce.engine.ingest({
    agentId: route.agentId,
    sessionKey,
    userText: msg.text ?? '',
    assistantText: response,
    usage: runUsage,
    timestamp: Date.now(),
  }).catch((err) => logger.warn({ err, agentId: route.agentId }, 'plugin ingest failed'));
}
```

- [ ] **Step 6: Rename `triggers.compress_threshold_tokens` → `dag.condensation_threshold_tokens`**

In `plugins/lcm/src/config.ts`:
- Move the field from `triggers` to `dag`.
- Add migration: in `resolveConfig`, if `triggers.compress_threshold_tokens` is present, copy to `dag.condensation_threshold_tokens` and warn.
- Update `toEngineConfig` references.

In `ui/app/api/agents/[agentId]/lcm/status/route.ts`:
- Read from `dag.condensation_threshold_tokens` instead.
- Keep fallback to legacy `triggers.compress_threshold_tokens` for one release.

- [ ] **Step 7: Run all LCM tests**

```bash
cd plugins/lcm && pnpm test
cd ../..
```

- [ ] **Step 8: Commit**

```bash
git add src/plugins/types.ts plugins/lcm/ src/gateway.ts ui/app/api/agents/
git commit -m "refactor(lcm): repoint as retrieval layer (ingest+assemble), remove compress override"
```

---

## Phase 11 — UI

### Task 12: Replace broken "Auto-compress (tokens)" field with proper compact controls

**Files:**
- Modify: `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx`
- Modify: `ui/components/...` (if existing slider/select components reused)
- Test: `ui/__tests__/api/agent-config-compact.test.ts` (new)

- [ ] **Step 1: Write failing test for save handler payload shape**

Model the fixture after `ui/__tests__/api/plugin-admin-e2e.test.ts:1-50` (tmpdir setup + env override of `OC_AGENTS_DIR` + direct PUT call to the route handler).

```ts
// ui/__tests__/api/agent-config-compact.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PUT } from '@/app/api/agents/[agentId]/route';
import { NextRequest } from 'next/server';

describe('agent config save — compact block', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oc-compact-test-'));
    process.env.OC_AGENTS_DIR = dir;
    const agentDir = join(dir, 'a1');
    require('node:fs').mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'agent.yml'), 'model: claude-sonnet-4-6\n');
    writeFileSync(join(agentDir, 'CLAUDE.md'), '# A1\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('persists compact block in correct shape', async () => {
    const body = {
      model: 'claude-sonnet-4-6',
      compact: { enabled: true, trigger: 'percent', threshold_percent: 80, fresh_tail: 6 },
    };
    const req = new NextRequest('http://x/api/agents/a1', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

    // Bypass withAuth in tests by setting a session cookie or using the test util.
    // (Mirror the auth-bypass pattern used in plugin-admin-e2e.test.ts.)
    const res = await PUT(req, { params: Promise.resolve({ agentId: 'a1' }) });
    expect(res.status).toBe(200);

    const yml = readFileSync(join(dir, 'a1', 'agent.yml'), 'utf-8');
    expect(yml).toMatch(/compact:\s*\n\s+enabled: true\s*\n\s+trigger: percent\s*\n\s+threshold_percent: 80\s*\n\s+fresh_tail: 6/);
    expect(yml).not.toMatch(/^auto_compress:\s*80/m); // confirm broken-form bug stays fixed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**.

- [ ] **Step 3: Update agent-config TypeScript type in page.tsx**

In `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx`:

Replace at line 86:
```ts
auto_compress?: number;
```
With:
```ts
compact?: {
  enabled: boolean;
  trigger: 'percent' | 'tokens';
  threshold_percent: number;
  threshold_tokens?: number;
  fresh_tail: number;
};
```

Replace `auto_compress: agent.auto_compress ?? 0` (line ~1013) with:
```ts
compact: agent.compact ?? {
  enabled: true,
  trigger: 'percent',
  threshold_percent: 70,
  fresh_tail: 4,
},
```

- [ ] **Step 4: Replace the broken Field at line 1661-1674 with new controls**

```tsx
<Field label="Compact enabled" tooltip="Auto-compact when context approaches model window limit.">
  <input type="checkbox"
    checked={cfg.compact.enabled}
    onChange={(e) => update({ compact: { ...cfg.compact, enabled: e.target.checked } })}
  />
</Field>
<Field label={`Compact when context fills to ${cfg.compact.threshold_percent}%`} tooltip="Percent of model's effective context window. Lower = compact more aggressively.">
  <input type="range" min={20} max={95}
    value={cfg.compact.threshold_percent}
    onChange={(e) => update({ compact: { ...cfg.compact, threshold_percent: +e.target.value } })}
    disabled={!cfg.compact.enabled}
  />
</Field>
<Field label="Keep last verbatim turns" tooltip="How many recent user/assistant exchanges to preserve verbatim across compact.">
  <select
    value={cfg.compact.fresh_tail}
    onChange={(e) => update({ compact: { ...cfg.compact, fresh_tail: +e.target.value } })}
    disabled={!cfg.compact.enabled}
  >
    {[0, 2, 4, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
  </select>
</Field>
```

- [ ] **Step 5: Update save handler payload composition**

At `handleSave` (~line 1482), add `compact` to the explicit destructuring/cleaning so it goes through correctly:

```ts
const { compact, ...rest } = cfg;
clean.compact = compact;
```

(The exact spot depends on existing destructure order — preserve patterns of `iteration_budget`.)

- [ ] **Step 6: Run UI test + manual smoke**

```bash
cd ui && pnpm test && cd ..
# Manual smoke: pnpm ui, edit agent config, slider moves, save, verify YAML on disk.
```

- [ ] **Step 7: Commit**

```bash
git add ui/
git commit -m "feat(ui): replace broken Auto-compress field with compact-block controls"
```

---

## Phase 12 — Cleanup, changelog, version

### Task 13: Remove legacy `summarizeAndSaveSession` fallback path

**Files:**
- Modify: `src/gateway.ts`

Only after `runCompact`'s error path's fallback has been confirmed unused for one full release in production. **Defer this task to a follow-up PR** — track via TODO comment in the code.

- [ ] **Step 1: Add `// TODO(compact-v2): remove legacy summarizeAndSaveSession after one stable release` above the function.**

- [ ] **Step 2: Commit (small)**

```bash
git add src/gateway.ts
git commit -m "chore(compact): mark legacy summarizeAndSaveSession for removal"
```

### Task 14: Update CHANGELOG and bump version

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `VERSION`, `package.json`, `ui/package.json`

- [ ] **Step 1: Add a `[Unreleased]` → `[0.8.0]` section to CHANGELOG.md**

```markdown
## [0.8.0] - 2026-XX-XX

### Added
- New `compact` config block — token-budget triggered compact with summary auto-injection.
- `on_pre_compact` and `on_post_compact` hook events.
- UI compact controls: enable toggle, threshold-percent slider, fresh-tail dropdown.

### Changed
- LCM plugin: `ContextEngine.compress` removed in favor of `ingest`. Plugin now serves as opt-in retrieval layer (DAG grep on incoming user message via `assemble`). `triggers.compress_threshold_tokens` renamed to `dag.condensation_threshold_tokens` (legacy field still read for one release).
- `/compact` slash command — now produces in-prompt summary injection rather than save-to-memory.
- Default agent compact behavior: trigger at 70% of effective model window, keep last 4 turns verbatim.

### Deprecated
- `auto_compress` config field — auto-migrated to `compact` block on read; will be removed in 0.9.0.

### Fixed
- UI "Auto-compress (tokens)" field that silently failed validation since v0.5.0.
```

- [ ] **Step 2: Bump version files to 0.8.0**

- [ ] **Step 3: Commit and tag**

```bash
git add CHANGELOG.md VERSION package.json ui/package.json
git commit -m "chore(release): v0.8.0 — compact redesign + retrieval-layer LCM"
```

---

## Final verification

### Task 15: Full-suite green run + manual smoke

- [ ] **Step 1: Run all tests**

```bash
pnpm test
cd ui && pnpm test && cd ..
cd plugins/lcm && pnpm test && cd ../..
```

All must pass.

- [ ] **Step 2: Lint and typecheck**

```bash
pnpm build
cd ui && pnpm lint && pnpm build && cd ..
```

- [ ] **Step 3: Local smoke — start gateway, send 20 long messages to a test agent, verify compact fires**

```bash
pnpm dev
# In another terminal:
# - Send messages until context approaches threshold
# - Observe gateway log for "compact: summary generated" and "compact: post-compact prompt assembled"
# - Verify next response is contextually aware (no "what were we talking about?")
```

- [ ] **Step 4: Verify `/compact` slash command on a live test session**

Send `/compact` in an active chat. Expect: `💾 Контекст сжат. Продолжаем без потери контекста.` Then continue conversation; agent should resume without re-asking context.

- [ ] **Step 5: Verify UI controls round-trip**

In the agent config UI, toggle compact, move slider to 80%, change fresh_tail to 6, save. Reload. Values persist. Open `agents/<id>/agent.yml` — see new `compact:` block, no bare `auto_compress: 80` number.

- [ ] **Step 6: Verify LCM (if enabled on any test agent) still works**

Send 20+ messages to an LCM-enabled agent. Verify `lcm_status` MCP tool reports DAG growth. Verify after compact, `lcm_grep` still returns hits from older messages. Check that `<lcm-grep-results>` block appears in subsequent prompts (gateway log will show assembled prompt size).

---

## Rollback procedure (if production breaks)

1. Revert release commit: `git revert <sha-of-v0.8.0>`
2. Bump version: `0.7.2`
3. Re-deploy.

Legacy `auto_compress` parser stays in 0.8.x, so reverting causes no data loss — old YAML still works.
