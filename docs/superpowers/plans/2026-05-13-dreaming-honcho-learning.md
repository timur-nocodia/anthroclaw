# Dreaming, Honcho, And Learning Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-party Dreaming as an opt-in background consolidation plugin that complements Honcho and feeds higher-quality candidates into the existing Learning/Decision flow.

**Architecture:** Keep governance primitives in core and implement the Dreaming engine as a bundled plugin. Core exposes stable plugin contracts for scheduled background jobs, continuous-learning signal sources, and learning proposal creation. Honcho stays a separate memory/context plugin and optionally registers a low-trust signal source; Dreaming consumes those signals, writes reviewable artifacts, and creates Learning actions instead of directly applying risky durable changes.

**Tech Stack:** TypeScript, `@anthropic-ai/claude-agent-sdk` through existing SDK wrappers only, better-sqlite3, Zod, Vitest, AnthroClaw plugin API, Next.js dashboard APIs.

---

## Target Boundary

Dreaming must not become a second Learning system.

- **Honcho:** external memory provider, peer/session representation, bounded context injection, `honcho_*` tools.
- **Dreaming:** background consolidation, dedupe, scoring, summaries, pattern extraction, candidate generation.
- **Learning/Decision Center:** approval, application, rejection, undo, audit, admin/user routing.

The first implementation should keep all durable writes policy-safe:

- Dreaming may write `DREAMS.md`, `memory/summaries/**`, plugin-owned SQLite state, and report artifacts.
- Dreaming may create `learning_actions` with `action_type = 'memory_candidate' | 'skill_patch' | 'skill_create' | 'skill_update_full'`.
- Dreaming must not write `MEMORY.md`, skills, agent prompts, routing, or Honcho conclusions directly in v1.
- Dreaming-generated reports must be excluded from future Dreaming evidence.

## File Structure

- Create `src/continuous/signals.ts` for source-neutral signal/candidate types shared by core and plugins.
- Modify `src/plugins/types.ts` to expose optional `registerSignalSource`, `registerSystemCronJob`, and `createLearningProposal` handles.
- Modify `src/gateway.ts` to wire those handles into plugin contexts and dispatch plugin-owned system cron events.
- Modify `src/learning/types.ts` minimally to document the `dreaming_cycle` trigger and support source metadata without adding new action types.
- Create `plugins/dreaming/` as a first-party plugin with config, store, source collection, scoring, reporting, and tests.
- Modify `plugins/honcho/src/index.ts` and `plugins/honcho/src/config.ts` so Honcho can opt into registering a bounded Dreaming signal source without changing its context/tool behavior.
- Add dashboard API surface under `ui/app/api/agents/[agentId]/dreaming/route.ts`.
- Add an agent detail tab/panel in `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx` only after backend status APIs are stable.

---

## Task 1: Add Core Continuous Signal Contracts

**Files:**
- Create: `src/continuous/signals.ts`
- Test: `src/continuous/__tests__/signals.test.ts`

- [ ] **Step 1: Write the signal contract tests**

Create `src/continuous/__tests__/signals.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  normalizeContinuousSignal,
  shouldExcludeDreamingArtifactPath,
  type ContinuousSignal,
} from '../signals.js';

describe('continuous signals', () => {
  it('normalizes text, caps confidence, and preserves provenance', () => {
    const signal = normalizeContinuousSignal({
      id: 'sig-1',
      source: 'honcho',
      agentId: 'amina',
      scope: 'user',
      text: '  User prefers short answers.  ',
      confidence: 3,
      createdAt: 1710000000000,
      provenance: {
        kind: 'honcho_context',
        ref: 'workspace/session',
        metadata: { sessionKey: 'amina:telegram:dm:user' },
      },
    });

    expect(signal).toEqual({
      id: 'sig-1',
      source: 'honcho',
      agentId: 'amina',
      scope: 'user',
      text: 'User prefers short answers.',
      confidence: 1,
      createdAt: 1710000000000,
      provenance: {
        kind: 'honcho_context',
        ref: 'workspace/session',
        metadata: { sessionKey: 'amina:telegram:dm:user' },
      },
      tags: [],
    } satisfies ContinuousSignal);
  });

  it('drops empty signal text', () => {
    expect(normalizeContinuousSignal({
      id: 'sig-2',
      source: 'local_memory',
      agentId: 'amina',
      scope: 'agent',
      text: '   ',
      confidence: 0.5,
      createdAt: 1710000000000,
      provenance: { kind: 'memory_file', ref: 'memory/2026/05/13.md' },
    })).toBeNull();
  });

  it('recognizes generated dreaming artifacts', () => {
    expect(shouldExcludeDreamingArtifactPath('DREAMS.md')).toBe(true);
    expect(shouldExcludeDreamingArtifactPath('memory/dreaming/rem/2026-05-13.md')).toBe(true);
    expect(shouldExcludeDreamingArtifactPath('memory/.dreams/session-corpus/2026-05-13.txt')).toBe(true);
    expect(shouldExcludeDreamingArtifactPath('memory/2026/05/13.md')).toBe(false);
    expect(shouldExcludeDreamingArtifactPath('MEMORY.md')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run src/continuous/__tests__/signals.test.ts
```

Expected: FAIL because `src/continuous/signals.ts` does not exist.

- [ ] **Step 3: Implement shared signal types**

Create `src/continuous/signals.ts`:

```ts
export type ContinuousSignalSource =
  | 'local_memory'
  | 'session_transcript'
  | 'honcho'
  | 'learning'
  | 'dreaming'
  | (string & {});

export type ContinuousSignalScope = 'user' | 'agent' | 'system' | 'session';

export type ContinuousSignalProvenanceKind =
  | 'memory_file'
  | 'memory_entry'
  | 'session_transcript'
  | 'honcho_context'
  | 'learning_action'
  | 'manual'
  | (string & {});

export interface ContinuousSignalProvenance {
  kind: ContinuousSignalProvenanceKind;
  ref: string;
  metadata?: Record<string, unknown>;
}

export interface ContinuousSignal {
  id: string;
  source: ContinuousSignalSource;
  agentId: string;
  scope: ContinuousSignalScope;
  text: string;
  confidence: number;
  createdAt: number;
  provenance: ContinuousSignalProvenance;
  tags: string[];
}

export interface ContinuousSignalQuery {
  agentId: string;
  sessionKey?: string;
  since?: number;
  limit?: number;
}

export interface ContinuousSignalSourceRegistration {
  name: string;
  collect(input: ContinuousSignalQuery): Promise<ContinuousSignal[]>;
}

export function normalizeContinuousSignal(input: {
  id: string;
  source: ContinuousSignalSource;
  agentId: string;
  scope: ContinuousSignalScope;
  text: string;
  confidence: number;
  createdAt: number;
  provenance: ContinuousSignalProvenance;
  tags?: string[];
}): ContinuousSignal | null {
  const text = input.text.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const confidence = Number.isFinite(input.confidence)
    ? Math.max(0, Math.min(1, input.confidence))
    : 0;
  return {
    id: input.id,
    source: input.source,
    agentId: input.agentId,
    scope: input.scope,
    text,
    confidence,
    createdAt: input.createdAt,
    provenance: input.provenance,
    tags: [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))],
  };
}

export function shouldExcludeDreamingArtifactPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.?\//, '');
  if (/^dreams\.md$/i.test(normalized)) return true;
  if (/^memory\/dreaming\//i.test(normalized)) return true;
  if (/^memory\/\.dreams\//i.test(normalized)) return true;
  if (/^memory\/summaries\//i.test(normalized)) return true;
  return false;
}
```

- [ ] **Step 4: Run the contract test**

Run:

```bash
npx vitest run src/continuous/__tests__/signals.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/continuous/signals.ts src/continuous/__tests__/signals.test.ts
git commit -m "feat(continuous): add shared signal contracts"
```

---

## Task 2: Expose Plugin Handles For Signals, Cron, And Learning Proposals

**Files:**
- Modify: `src/plugins/types.ts`
- Modify: `src/plugins/context.ts`
- Modify: `src/gateway.ts`
- Test: `src/plugins/__tests__/types.test.ts`
- Test: `src/plugins/__tests__/context.test.ts`

- [ ] **Step 1: Extend plugin type tests**

Update `src/plugins/__tests__/types.test.ts` with a compile/runtime smoke test:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '../types.js';

describe('PluginContext continuous learning handles', () => {
  it('allows optional signal, cron, and learning proposal handles', async () => {
    const ctx = {
      pluginName: 'dreaming',
      pluginVersion: '0.1.0',
      dataDir: '/tmp/dreaming',
      registerHook: vi.fn(),
      registerMcpTool: vi.fn(),
      registerContextEngine: vi.fn(),
      registerSlashCommand: vi.fn(),
      runSubagent: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getAgentConfig: vi.fn(),
      getGlobalConfig: vi.fn(),
      registerSignalSource: vi.fn(),
      registerSystemCronJob: vi.fn(),
      createLearningProposal: vi.fn(async () => ({ reviewId: 'review-1', actionIds: ['action-1'] })),
    } satisfies PluginContext;

    ctx.registerSignalSource?.({
      name: 'dreaming-test',
      collect: async () => [],
    });
    ctx.registerSystemCronJob?.({
      id: 'dreaming:sweep',
      schedule: '0 3 * * *',
      enabled: true,
      payload: { kind: 'plugin', pluginName: 'dreaming', event: 'sweep' },
    });
    const result = await ctx.createLearningProposal?.({
      agentId: 'amina',
      trigger: 'dreaming_cycle',
      mode: 'propose',
      input: { source: 'dreaming' },
      actions: [{
        actionType: 'memory_candidate',
        confidence: 0.9,
        title: 'Remember short-answer preference',
        rationale: 'Repeated across recent signals.',
        payload: { text: 'User prefers short answers.' },
      }],
    });

    expect(result).toEqual({ reviewId: 'review-1', actionIds: ['action-1'] });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run src/plugins/__tests__/types.test.ts
```

Expected: FAIL because the new optional handles are not declared.

- [ ] **Step 3: Extend `PluginContext`**

Modify `src/plugins/types.ts` imports:

```ts
import type { ContinuousSignalSourceRegistration } from '../continuous/signals.js';
import type {
  CreateLearningActionParams,
  CreateLearningReviewParams,
  LearningActionType,
} from '../learning/types.js';
```

Add these interfaces near the existing optional cross-plugin handles:

```ts
export interface PluginSystemCronJob {
  id: string;
  schedule: string;
  enabled: boolean;
  payload: {
    kind: 'plugin';
    pluginName: string;
    event: string;
    metadata?: Record<string, unknown>;
  };
}

export interface PluginLearningProposalInput {
  agentId: string;
  trigger: CreateLearningReviewParams['trigger'];
  mode: CreateLearningReviewParams['mode'];
  sessionKey?: string;
  runId?: string;
  traceId?: string;
  sdkSessionId?: string;
  model?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  actions: Array<{
    actionType: LearningActionType;
    confidence?: number;
    title: string;
    rationale: string;
    payload: Record<string, unknown>;
  }>;
}

export interface PluginLearningProposalResult {
  reviewId: string;
  actionIds: string[];
}
```

Then add to `PluginContext`:

```ts
registerSignalSource?(source: ContinuousSignalSourceRegistration): void;
registerSystemCronJob?(job: PluginSystemCronJob): void;
createLearningProposal?(input: PluginLearningProposalInput): Promise<PluginLearningProposalResult>;
```

- [ ] **Step 4: Wire the handles in plugin context construction**

Find the gateway/plugin context construction in `src/plugins/context.ts` and `src/gateway.ts`. Add a `ContinuousSignalRegistry` in gateway state and pass these functions into each plugin context:

```ts
registerSignalSource: (source) => this.continuousSignalRegistry.register(pluginName, source),
registerSystemCronJob: (job) => this.registerPluginSystemCronJob(pluginName, job),
createLearningProposal: (input) => this.createPluginLearningProposal(pluginName, input),
```

Implement `createPluginLearningProposal` in `src/gateway.ts` using the existing `LearningStore`:

```ts
private async createPluginLearningProposal(
  pluginName: string,
  input: PluginLearningProposalInput,
): Promise<PluginLearningProposalResult> {
  const store = this.learningStore;
  if (!store) throw new Error('learning store is not initialized');
  const review = store.createReview({
    agentId: input.agentId,
    sessionKey: input.sessionKey,
    runId: input.runId,
    traceId: input.traceId,
    sdkSessionId: input.sdkSessionId,
    trigger: input.trigger,
    mode: input.mode,
    model: input.model,
    input: input.input ?? {},
    metadata: { ...(input.metadata ?? {}), sourcePlugin: pluginName },
  });
  const actionIds: string[] = [];
  for (const action of input.actions) {
    const record = store.addAction({
      reviewId: review.id,
      agentId: input.agentId,
      actionType: action.actionType,
      status: 'proposed',
      confidence: action.confidence,
      title: action.title,
      rationale: action.rationale,
      payload: {
        ...action.payload,
        sourcePlugin: pluginName,
      },
    });
    actionIds.push(record.id);
  }
  store.completeReview(review.id, {
    status: 'completed',
    output: { actionCount: actionIds.length, sourcePlugin: pluginName },
  });
  return { reviewId: review.id, actionIds };
}
```

- [ ] **Step 5: Wire plugin cron events to existing scheduler**

Add a private gateway helper:

```ts
private registerPluginSystemCronJob(pluginName: string, job: PluginSystemCronJob): void {
  this.scheduler.addJob({
    id: `plugin:${pluginName}:${job.id}`,
    agentId: '__system__',
    schedule: job.schedule,
    prompt: JSON.stringify(job.payload),
    enabled: job.enabled,
  });
}
```

In the existing cron fire handler, before normal agent dispatch, detect `job.id.startsWith('plugin:')` and emit a plugin hook payload:

```ts
if (job.id.startsWith('plugin:')) {
  this.hooks.emit('on_cron_fire', {
    plugin: true,
    jobId: job.id,
    payload: safeJsonParse(job.prompt),
  });
  return;
}
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
npx vitest run src/plugins/__tests__/types.test.ts src/plugins/__tests__/context.test.ts src/learning/__tests__/store.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/types.ts src/plugins/context.ts src/gateway.ts src/plugins/__tests__/types.test.ts src/plugins/__tests__/context.test.ts
git commit -m "feat(plugins): expose continuous signal and learning proposal handles"
```

---

## Task 3: Scaffold The Bundled Dreaming Plugin

**Files:**
- Create: `plugins/dreaming/.claude-plugin/plugin.json`
- Create: `plugins/dreaming/package.json`
- Create: `plugins/dreaming/tsconfig.json`
- Create: `plugins/dreaming/vitest.config.ts`
- Create: `plugins/dreaming/src/types-shim.ts`
- Create: `plugins/dreaming/src/config.ts`
- Create: `plugins/dreaming/src/index.ts`
- Test: `plugins/dreaming/tests/config.test.ts`
- Test: `plugins/dreaming/tests/index-register.test.ts`

- [ ] **Step 1: Write config tests**

Create `plugins/dreaming/tests/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DreamingConfigSchema, resolveConfig } from '../src/config.js';

describe('Dreaming config', () => {
  it('defaults to disabled and propose-only', () => {
    expect(resolveConfig({}, {})).toMatchObject({
      enabled: false,
      mode: 'propose',
      frequency: '0 3 * * *',
      sources: {
        local_memory: true,
        sessions: true,
        honcho: false,
      },
      thresholds: {
        minScore: 0.8,
        minSignalCount: 3,
        minUniqueSources: 2,
      },
      storage: {
        writeDreamsFile: true,
        writeReports: true,
      },
    });
  });

  it('deep merges global defaults and per-agent overrides', () => {
    const config = resolveConfig(
      { enabled: true, sources: { honcho: true }, thresholds: { minScore: 0.7 } },
      { frequency: '0 */6 * * *', thresholds: { minSignalCount: 5 } },
    );
    expect(config.enabled).toBe(true);
    expect(config.frequency).toBe('0 */6 * * *');
    expect(config.sources.honcho).toBe(true);
    expect(config.thresholds).toMatchObject({ minScore: 0.7, minSignalCount: 5 });
  });

  it('rejects invalid modes', () => {
    expect(() => DreamingConfigSchema.parse({ mode: 'apply' })).toThrow();
  });
});
```

- [ ] **Step 2: Write register smoke test**

Create `plugins/dreaming/tests/index-register.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { register } from '../src/index.js';

describe('Dreaming plugin register()', () => {
  it('registers cron and status tool when enabled globally', async () => {
    const ctx = {
      pluginName: 'dreaming',
      pluginVersion: '0.1.0',
      dataDir: '/tmp/dreaming',
      registerHook: vi.fn(),
      registerMcpTool: vi.fn(),
      registerContextEngine: vi.fn(),
      registerSlashCommand: vi.fn(),
      runSubagent: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getAgentConfig: vi.fn(() => ({})),
      getGlobalConfig: vi.fn(() => ({
        plugins: { dreaming: { defaults: { enabled: true } } },
      })),
      registerSystemCronJob: vi.fn(),
      createLearningProposal: vi.fn(),
    };

    const instance = await register(ctx as any);

    expect(ctx.registerSystemCronJob).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sweep',
      schedule: '0 3 * * *',
      enabled: true,
    }));
    expect(ctx.registerMcpTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'dreaming_status',
    }));
    expect(instance.shutdown).toEqual(expect.any(Function));
  });
});
```

- [ ] **Step 3: Add plugin manifest and package files**

Create `plugins/dreaming/.claude-plugin/plugin.json`:

```json
{
  "name": "dreaming",
  "version": "0.1.0",
  "description": "Background memory consolidation and learning candidate generation for AnthroClaw agents.",
  "entry": "dist/index.js",
  "configSchema": "dist/config.js",
  "requires": {
    "anthroclaw": ">=0.10.0"
  }
}
```

Create `plugins/dreaming/package.json`:

```json
{
  "name": "@anthroclaw/plugin-dreaming",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "^12.5.1",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.5"
  }
}
```

Create `plugins/dreaming/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "composite": false,
    "types": ["node", "vitest"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "tests"]
}
```

Create `plugins/dreaming/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Implement config**

Create `plugins/dreaming/src/config.ts`:

```ts
import { z } from 'zod';

export const DreamingModeSchema = z.enum(['off', 'observe', 'propose']);

export const DreamingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: DreamingModeSchema.default('propose'),
  frequency: z.string().min(1).default('0 3 * * *'),
  timezone: z.string().min(1).optional(),
  sources: z.object({
    local_memory: z.boolean().default(true),
    sessions: z.boolean().default(true),
    honcho: z.boolean().default(false),
    learning: z.boolean().default(true),
  }).default({
    local_memory: true,
    sessions: true,
    honcho: false,
    learning: true,
  }),
  thresholds: z.object({
    minScore: z.number().min(0).max(1).default(0.8),
    minSignalCount: z.number().int().min(1).default(3),
    minUniqueSources: z.number().int().min(1).default(2),
    maxCandidates: z.number().int().min(1).max(100).default(10),
  }).default({
    minScore: 0.8,
    minSignalCount: 3,
    minUniqueSources: 2,
    maxCandidates: 10,
  }),
  storage: z.object({
    writeDreamsFile: z.boolean().default(true),
    writeReports: z.boolean().default(true),
  }).default({
    writeDreamsFile: true,
    writeReports: true,
  }),
  privacy: z.object({
    redactSecrets: z.boolean().default(true),
    excludePromptContextBlocks: z.boolean().default(true),
    excludeDreamingArtifacts: z.boolean().default(true),
  }).default({
    redactSecrets: true,
    excludePromptContextBlocks: true,
    excludeDreamingArtifacts: true,
  }),
});

export type DreamingConfig = z.infer<typeof DreamingConfigSchema>;

export function resolveConfig(globalDefaults?: unknown, perAgent?: unknown): DreamingConfig {
  const merged = deepMerge(isRecord(globalDefaults) ? globalDefaults : {}, isRecord(perAgent) ? perAgent : {});
  return DreamingConfigSchema.parse(merged);
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    if (isRecord(existing) && isRecord(value)) {
      out[key] = deepMerge(existing, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
```

- [ ] **Step 5: Add plugin API type shim**

Create `plugins/dreaming/src/types-shim.ts`:

```ts
import type { z } from 'zod';

export interface PluginContext {
  pluginName: string;
  pluginVersion: string;
  dataDir: string;
  registerHook(event: string, handler: (payload: Record<string, unknown>) => void | Promise<void>): void;
  registerMcpTool(tool: PluginMcpTool): void;
  registerContextEngine(engine: unknown): void;
  registerSlashCommand(cmd: unknown): void;
  runSubagent(opts: {
    prompt: string;
    systemPrompt?: string;
    model?: string;
    timeoutMs?: number;
    cwd?: string;
  }): Promise<string>;
  logger: {
    info(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
    debug?(obj: unknown, msg?: string): void;
  };
  getAgentConfig(agentId: string): unknown;
  getGlobalConfig(): unknown;
  registerSystemCronJob?(job: {
    id: string;
    schedule: string;
    enabled: boolean;
    payload: {
      kind: 'plugin';
      pluginName: string;
      event: string;
      metadata?: Record<string, unknown>;
    };
  }): void;
  createLearningProposal?(input: {
    agentId: string;
    trigger: string;
    mode: 'off' | 'propose' | 'auto_private';
    sessionKey?: string;
    runId?: string;
    traceId?: string;
    sdkSessionId?: string;
    model?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    actions: Array<{
      actionType: 'memory_candidate' | 'skill_patch' | 'skill_create' | 'skill_update_full' | 'none';
      confidence?: number;
      title: string;
      rationale: string;
      payload: Record<string, unknown>;
    }>;
  }): Promise<{ reviewId: string; actionIds: string[] }>;
}

export interface PluginInstance {
  shutdown?(): void;
  onAgentConfigChanged?(agentId: string): void;
}

export interface PluginMcpTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler(input: unknown, ctx: { agentId: string; sessionKey?: string }): Promise<{
    content: Array<{ type: 'text'; text: string }>;
  }>;
}
```

- [ ] **Step 6: Implement register stub**

Create `plugins/dreaming/src/index.ts`:

```ts
import { z } from 'zod';
import type { PluginContext, PluginInstance } from './types-shim.js';
import { resolveConfig } from './config.js';

export async function register(ctx: PluginContext): Promise<PluginInstance> {
  const globalDefaults = readGlobalDefaults(ctx);
  const config = resolveConfig(globalDefaults, {});

  if (config.enabled && config.mode !== 'off') {
    ctx.registerSystemCronJob?.({
      id: 'sweep',
      schedule: config.frequency,
      enabled: true,
      payload: {
        kind: 'plugin',
        pluginName: ctx.pluginName,
        event: 'sweep',
      },
    });
  }

  ctx.registerHook('on_cron_fire', async (payload) => {
    if (!isDreamingSweepPayload(payload, ctx.pluginName)) return;
    ctx.logger.info({ payload }, 'dreaming sweep placeholder fired');
  });

  ctx.registerMcpTool({
    name: 'dreaming_status',
    description: 'Report Dreaming plugin status for the current agent.',
    inputSchema: z.object({}),
    async handler(_input, toolCtx) {
      const agentConfig = ctx.getAgentConfig(toolCtx.agentId) as { plugins?: { dreaming?: unknown } } | undefined;
      const current = resolveConfig(globalDefaults, agentConfig?.plugins?.dreaming ?? {});
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            enabled: current.enabled,
            mode: current.mode,
            frequency: current.frequency,
            sources: current.sources,
          }, null, 2),
        }],
      };
    },
  });

  ctx.logger.info({ enabled: config.enabled, mode: config.mode }, 'dreaming plugin loaded');
  return {
    shutdown() {
      ctx.logger.info({}, 'dreaming plugin shutting down');
    },
    onAgentConfigChanged(agentId: string) {
      ctx.logger.debug?.({ agentId }, 'dreaming per-agent config changed');
    },
  };
}

function readGlobalDefaults(ctx: PluginContext): unknown {
  const raw = ctx.getGlobalConfig() as { plugins?: { dreaming?: { defaults?: unknown } } } | undefined;
  return raw?.plugins?.dreaming?.defaults ?? {};
}

function isDreamingSweepPayload(payload: Record<string, unknown>, pluginName: string): boolean {
  const inner = payload.payload as { pluginName?: unknown; event?: unknown } | undefined;
  return inner?.pluginName === pluginName && inner.event === 'sweep';
}
```

- [ ] **Step 7: Run plugin tests**

Run:

```bash
pnpm --dir plugins/dreaming test
pnpm --dir plugins/dreaming build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add plugins/dreaming
git commit -m "feat(dreaming): scaffold first-party plugin"
```

---

## Task 4: Add Dreaming Store

**Files:**
- Create: `plugins/dreaming/src/store.ts`
- Test: `plugins/dreaming/tests/store.test.ts`

- [ ] **Step 1: Write store tests**

Create `plugins/dreaming/tests/store.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DreamingStore } from '../src/store.js';

describe('DreamingStore', () => {
  let dir: string;
  let store: DreamingStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dreaming-store-'));
    store = new DreamingStore(join(dir, 'dreaming.sqlite'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates and completes runs', () => {
    const run = store.createRun({ agentId: 'amina', trigger: 'cron', startedAt: 100 });
    expect(run.status).toBe('running');

    const completed = store.completeRun(run.id, {
      status: 'completed',
      completedAt: 200,
      summary: 'Ranked 2 candidates.',
      stats: { signalCount: 5, candidateCount: 2 },
    });

    expect(completed?.status).toBe('completed');
    expect(completed?.completedAt).toBe(200);
    expect(completed?.stats).toEqual({ signalCount: 5, candidateCount: 2 });
  });

  it('dedupes signals by stable key', () => {
    const first = store.upsertSignal({
      key: 'local:memory/2026/05/13.md:1:short',
      agentId: 'amina',
      source: 'local_memory',
      scope: 'user',
      text: 'User prefers short answers.',
      confidence: 0.7,
      createdAt: 100,
      provenance: { kind: 'memory_file', ref: 'memory/2026/05/13.md#L1' },
      tags: ['preference'],
    });
    const second = store.upsertSignal({
      key: first.key,
      agentId: 'amina',
      source: 'local_memory',
      scope: 'user',
      text: 'User prefers short answers.',
      confidence: 0.9,
      createdAt: 200,
      provenance: { kind: 'memory_file', ref: 'memory/2026/05/13.md#L1' },
      tags: ['preference'],
    });

    expect(second.signalCount).toBe(2);
    expect(second.maxConfidence).toBe(0.9);
    expect(store.listSignals({ agentId: 'amina' })).toHaveLength(1);
  });

  it('records candidates with source signal keys', () => {
    const candidate = store.addCandidate({
      runId: 'run-1',
      agentId: 'amina',
      kind: 'memory_candidate',
      title: 'Remember short-answer preference',
      text: 'User prefers short answers.',
      score: 0.91,
      sourceSignalKeys: ['a', 'b'],
      payload: { text: 'User prefers short answers.' },
      createdAt: 300,
    });

    expect(candidate.sourceSignalKeys).toEqual(['a', 'b']);
    expect(store.listCandidates({ agentId: 'amina' })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --dir plugins/dreaming test -- tests/store.test.ts
```

Expected: FAIL because `store.ts` does not exist.

- [ ] **Step 3: Implement SQLite store**

Create `plugins/dreaming/src/store.ts` with these public methods:

```ts
export class DreamingStore {
  constructor(dbPath: string);
  createRun(input: CreateDreamRunInput): DreamRunRecord;
  completeRun(runId: string, input: CompleteDreamRunInput): DreamRunRecord | null;
  getRun(runId: string): DreamRunRecord | null;
  listRuns(input?: { agentId?: string; status?: DreamRunStatus; limit?: number }): DreamRunRecord[];
  upsertSignal(input: UpsertDreamSignalInput): DreamSignalRecord;
  listSignals(input: { agentId: string; since?: number; limit?: number }): DreamSignalRecord[];
  addCandidate(input: AddDreamCandidateInput): DreamCandidateRecord;
  listCandidates(input: { agentId: string; runId?: string; status?: DreamCandidateStatus; limit?: number }): DreamCandidateRecord[];
  updateCandidateStatus(candidateId: string, status: DreamCandidateStatus, metadata?: Record<string, unknown>): DreamCandidateRecord | null;
  close(): void;
}
```

Use tables:

```sql
CREATE TABLE IF NOT EXISTS dream_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  summary TEXT,
  stats_json TEXT NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS dream_signals (
  key TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  source TEXT NOT NULL,
  scope TEXT NOT NULL,
  text TEXT NOT NULL,
  signal_count INTEGER NOT NULL,
  max_confidence REAL NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  provenance_json TEXT NOT NULL,
  tags_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dream_candidates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  score REAL NOT NULL,
  source_signal_keys_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL
);
```

- [ ] **Step 4: Run store tests**

Run:

```bash
pnpm --dir plugins/dreaming test -- tests/store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/dreaming/src/store.ts plugins/dreaming/tests/store.test.ts
git commit -m "feat(dreaming): add durable run signal and candidate store"
```

---

## Task 5: Implement Local Memory And Session Signal Collection

**Files:**
- Create: `plugins/dreaming/src/local-sources.ts`
- Modify: `src/plugins/types.ts`
- Modify: `src/gateway.ts`
- Test: `plugins/dreaming/tests/local-sources.test.ts`

- [ ] **Step 1: Write local source tests**

Create `plugins/dreaming/tests/local-sources.test.ts`:

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectLocalMemorySignals } from '../src/local-sources.js';

describe('collectLocalMemorySignals', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'dreaming-local-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('collects daily memory lines and excludes dreaming artifacts', async () => {
    mkdirSync(join(workspace, 'memory', '2026', '05'), { recursive: true });
    mkdirSync(join(workspace, 'memory', 'dreaming', 'rem'), { recursive: true });
    writeFileSync(join(workspace, 'memory', '2026', '05', '2026-05-13.md'), [
      '# 2026-05-13',
      '- User prefers short answers.',
      '- Deploys should go through the remote repository.',
    ].join('\n'));
    writeFileSync(join(workspace, 'memory', 'dreaming', 'rem', '2026-05-13.md'), 'generated reflection');

    const signals = await collectLocalMemorySignals({
      workspacePath: workspace,
      agentId: 'amina',
      now: 1778630400000,
      limit: 20,
    });

    expect(signals.map((signal) => signal.text)).toEqual([
      'User prefers short answers.',
      'Deploys should go through the remote repository.',
    ]);
    expect(signals[0].provenance.ref).toContain('memory/2026/05/2026-05-13.md#L2');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --dir plugins/dreaming test -- tests/local-sources.test.ts
```

Expected: FAIL because `local-sources.ts` does not exist.

- [ ] **Step 3: Implement local memory scanner**

Create `plugins/dreaming/src/local-sources.ts`:

```ts
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import {
  normalizeContinuousSignal,
  shouldExcludeDreamingArtifactPath,
  type ContinuousSignal,
} from '../../../src/continuous/signals.js';

export async function collectLocalMemorySignals(input: {
  workspacePath: string;
  agentId: string;
  now: number;
  limit: number;
}): Promise<ContinuousSignal[]> {
  const memoryRoot = join(input.workspacePath, 'memory');
  const files = await listMarkdownFiles(memoryRoot);
  const signals: ContinuousSignal[] = [];
  for (const filePath of files) {
    const rel = relative(input.workspacePath, filePath).replace(/\\/g, '/');
    if (shouldExcludeDreamingArtifactPath(rel)) continue;
    const raw = await readFile(filePath, 'utf8').catch(() => '');
    if (!raw) continue;
    const lines = raw.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const text = normalizeMemoryLine(lines[index]);
      if (!text) continue;
      const signal = normalizeContinuousSignal({
        id: hashKey(`${rel}:${index + 1}:${text}`),
        source: 'local_memory',
        agentId: input.agentId,
        scope: inferScope(text),
        text,
        confidence: 0.65,
        createdAt: input.now,
        provenance: {
          kind: 'memory_file',
          ref: `${rel}#L${index + 1}`,
        },
        tags: inferTags(text),
      });
      if (signal) signals.push(signal);
      if (signals.length >= input.limit) return signals;
    }
  }
  return signals;
}

function normalizeMemoryLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('<!--')) return null;
  const withoutMarker = trimmed.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').trim();
  if (withoutMarker.length < 8) return null;
  return withoutMarker.slice(0, 500);
}

function inferScope(text: string): 'user' | 'agent' {
  return /\buser\b|\bprefers\b|\blikes\b|\bwants\b/i.test(text) ? 'user' : 'agent';
}

function inferTags(text: string): string[] {
  const tags: string[] = [];
  if (/\bprefers\b|\blikes\b|\bwants\b/i.test(text)) tags.push('preference');
  if (/\bdeploy\b|\brelease\b|\bproduction\b/i.test(text)) tags.push('operations');
  if (/\berror\b|\bfail\b|\bbug\b/i.test(text)) tags.push('failure');
  return tags;
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && /\.md$/i.test(basename(full))) {
        const s = await stat(full).catch(() => null);
        if (s?.isFile()) out.push(full);
      }
    }
  }
  await walk(root);
  return out.sort();
}

function hashKey(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}
```

- [ ] **Step 4: Add session transcript source handle**

Modify `src/plugins/types.ts` with an optional handle:

```ts
searchSessionTranscripts?(input: {
  agentId: string;
  query: string;
  limitSessions?: number;
  limitSnippetsPerSession?: number;
}): Promise<Array<{
  sessionId: string;
  lastModified: number;
  snippets: Array<{ role: string; timestamp: string; text: string; score: number }>;
}>>;
```

Wire this in `src/gateway.ts` to the existing `TranscriptIndex` search path. If the index is unavailable, return `[]`.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --dir plugins/dreaming test -- tests/local-sources.test.ts
npx vitest run src/plugins/__tests__/types.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/dreaming/src/local-sources.ts plugins/dreaming/tests/local-sources.test.ts src/plugins/types.ts src/gateway.ts
git commit -m "feat(dreaming): collect local memory and expose transcript search"
```

---

## Task 6: Register Honcho As An Optional Dreaming Signal Source

**Files:**
- Modify: `plugins/honcho/src/config.ts`
- Modify: `plugins/honcho/src/index.ts`
- Create: `plugins/honcho/src/dreaming-source.ts`
- Test: `plugins/honcho/tests/dreaming-source.test.ts`
- Test: `plugins/honcho/tests/config.test.ts`

- [ ] **Step 1: Add Honcho source tests**

Create `plugins/honcho/tests/dreaming-source.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderHonchoDreamingSignals } from '../src/dreaming-source.js';
import { resolveConfig } from '../src/config.js';

describe('renderHonchoDreamingSignals', () => {
  it('turns structured Honcho context into low-trust signals', () => {
    const config = resolveConfig({}, {
      enabled: true,
      dreaming_source: { enabled: true },
    });
    const signals = renderHonchoDreamingSignals({
      config,
      agentId: 'amina',
      sessionKey: 'session-1',
      now: 1000,
      context: {
        summary: { content: 'User repeatedly asks for concise replies.' },
        peerCard: ['Prefers short answers', 'Uses Telegram DMs'],
      },
    });

    expect(signals.map((signal) => signal.text)).toEqual([
      'User repeatedly asks for concise replies.',
      'Prefers short answers',
      'Uses Telegram DMs',
    ]);
    expect(signals.every((signal) => signal.source === 'honcho')).toBe(true);
    expect(signals.every((signal) => signal.confidence <= 0.55)).toBe(true);
  });
});
```

- [ ] **Step 2: Extend Honcho config**

Modify `plugins/honcho/src/config.ts` schema:

```ts
dreaming_source: z.object({
  enabled: z.boolean().default(false),
  max_chars: z.number().int().min(500).max(20_000).default(4000),
  confidence: z.number().min(0).max(1).default(0.5),
}).default({
  enabled: false,
  max_chars: 4000,
  confidence: 0.5,
}),
```

Add a config test asserting the default is disabled:

```ts
expect(resolveConfig({}, {}).dreaming_source.enabled).toBe(false);
```

- [ ] **Step 3: Implement Honcho Dreaming signal renderer**

Create `plugins/honcho/src/dreaming-source.ts`:

```ts
import { createHash } from 'node:crypto';
import {
  normalizeContinuousSignal,
  type ContinuousSignal,
} from '../../../src/continuous/signals.js';
import type { HonchoConfig } from './config.js';

export function renderHonchoDreamingSignals(input: {
  config: HonchoConfig;
  agentId: string;
  sessionKey: string;
  now: number;
  context: unknown;
}): ContinuousSignal[] {
  if (!input.config.enabled || !input.config.dreaming_source.enabled) return [];
  const lines = extractContextLines(input.context).join('\n').slice(0, input.config.dreaming_source.max_chars).split('\n');
  return lines.flatMap((line, index) => {
    const signal = normalizeContinuousSignal({
      id: hashKey(`${input.agentId}:${input.sessionKey}:${index}:${line}`),
      source: 'honcho',
      agentId: input.agentId,
      scope: 'user',
      text: line,
      confidence: input.config.dreaming_source.confidence,
      createdAt: input.now,
      provenance: {
        kind: 'honcho_context',
        ref: input.sessionKey,
        metadata: { provider: 'honcho' },
      },
      tags: ['honcho'],
    });
    return signal ? [signal] : [];
  });
}

function extractContextLines(context: unknown): string[] {
  if (!context || typeof context !== 'object') return [];
  const value = context as {
    summary?: { content?: unknown };
    peerRepresentation?: unknown;
    peerCard?: unknown;
  };
  const out: string[] = [];
  if (typeof value.summary?.content === 'string') out.push(value.summary.content.trim());
  if (typeof value.peerRepresentation === 'string') out.push(value.peerRepresentation.trim());
  if (Array.isArray(value.peerCard)) {
    for (const item of value.peerCard) {
      if (typeof item === 'string' && item.trim()) out.push(item.trim());
    }
  }
  return out
    .map((line) => line.replace(/<\/?honcho-context[^>]*>/gi, '').trim())
    .filter((line) => line.length >= 8);
}

function hashKey(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}
```

- [ ] **Step 4: Register Honcho signal source**

In `plugins/honcho/src/index.ts`, after context engine registration, add:

```ts
ctx.registerSignalSource?.({
  name: 'honcho',
  async collect(input) {
    const agentConfig = ctx.getAgentConfig(input.agentId) as
      | { plugins?: { honcho?: unknown }; group_sessions?: 'shared' | 'per_user' }
      | undefined;
    const currentConfig = resolveConfig(globalDefaults, agentConfig?.plugins?.honcho ?? {});
    if (!currentConfig.enabled || !currentConfig.dreaming_source.enabled) return [];
    if (!input.sessionKey) return [];
    const client = await createHonchoClient(currentConfig);
    const session = await (client.sdk as HonchoContextSdk).session(buildHonchoSessionId(input.sessionKey));
    const context = await session.context({
      summary: currentConfig.context.include_session_context,
      tokens: currentConfig.context.token_budget,
      peerTarget: `agent_${input.agentId}`,
      peerPerspective: `agent_${input.agentId}`,
      limitToSession: true,
    });
    return renderHonchoDreamingSignals({
      config: currentConfig,
      agentId: input.agentId,
      sessionKey: input.sessionKey,
      now: Date.now(),
      context,
    });
  },
});
```

Use the existing peer-id helpers instead of the `agent_` fallback when `sessionContext` is available.

- [ ] **Step 5: Run Honcho tests**

Run:

```bash
pnpm --dir plugins/honcho test
pnpm --dir plugins/honcho build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/honcho/src/config.ts plugins/honcho/src/index.ts plugins/honcho/src/dreaming-source.ts plugins/honcho/tests/config.test.ts plugins/honcho/tests/dreaming-source.test.ts
git commit -m "feat(honcho): expose optional dreaming signal source"
```

---

## Task 7: Implement Dreaming Scoring And Candidate Generation

**Files:**
- Create: `plugins/dreaming/src/scoring.ts`
- Create: `plugins/dreaming/src/engine.ts`
- Test: `plugins/dreaming/tests/scoring.test.ts`
- Test: `plugins/dreaming/tests/engine.test.ts`

- [ ] **Step 1: Write scoring tests**

Create `plugins/dreaming/tests/scoring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { rankDreamCandidates } from '../src/scoring.js';

describe('rankDreamCandidates', () => {
  it('promotes repeated multi-source user memory candidates', () => {
    const candidates = rankDreamCandidates({
      signals: [
        signal('a', 'local_memory', 'User prefers short answers.', 0.8, 100),
        signal('b', 'session_transcript', 'User prefers short answers.', 0.7, 200),
        signal('c', 'honcho', 'Prefers short answers', 0.5, 300),
      ],
      thresholds: {
        minScore: 0.65,
        minSignalCount: 3,
        minUniqueSources: 2,
        maxCandidates: 10,
      },
      now: 400,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: 'memory_candidate',
      title: 'Remember: User prefers short answers.',
      score: expect.any(Number),
    });
    expect(candidates[0].sourceSignalIds).toEqual(['a', 'b', 'c']);
  });

  it('does not promote single-source one-offs', () => {
    const candidates = rankDreamCandidates({
      signals: [
        signal('a', 'local_memory', 'One random note.', 0.9, 100),
        signal('b', 'local_memory', 'One random note.', 0.9, 200),
      ],
      thresholds: {
        minScore: 0.5,
        minSignalCount: 2,
        minUniqueSources: 2,
        maxCandidates: 10,
      },
      now: 400,
    });
    expect(candidates).toEqual([]);
  });
});

function signal(id: string, source: string, text: string, confidence: number, createdAt: number) {
  return {
    id,
    source,
    agentId: 'amina',
    scope: 'user',
    text,
    confidence,
    createdAt,
    provenance: { kind: source, ref: id },
    tags: ['preference'],
  } as any;
}
```

- [ ] **Step 2: Implement deterministic scoring**

Create `plugins/dreaming/src/scoring.ts`:

```ts
import type { ContinuousSignal } from '../../../src/continuous/signals.js';
import type { DreamingConfig } from './config.js';

export interface RankedDreamCandidate {
  kind: 'memory_candidate';
  title: string;
  text: string;
  score: number;
  sourceSignalIds: string[];
  payload: Record<string, unknown>;
}

export function rankDreamCandidates(input: {
  signals: ContinuousSignal[];
  thresholds: DreamingConfig['thresholds'];
  now: number;
}): RankedDreamCandidate[] {
  const grouped = new Map<string, ContinuousSignal[]>();
  for (const signal of input.signals) {
    const key = normalizeClaimKey(signal.text);
    if (!key) continue;
    const bucket = grouped.get(key) ?? [];
    bucket.push(signal);
    grouped.set(key, bucket);
  }

  const ranked: RankedDreamCandidate[] = [];
  for (const signals of grouped.values()) {
    const uniqueSources = new Set(signals.map((signal) => signal.source));
    if (signals.length < input.thresholds.minSignalCount) continue;
    if (uniqueSources.size < input.thresholds.minUniqueSources) continue;
    const avgConfidence = signals.reduce((sum, signal) => sum + signal.confidence, 0) / signals.length;
    const sourceDiversity = Math.min(1, uniqueSources.size / 3);
    const frequency = Math.min(1, Math.log1p(signals.length) / Math.log1p(8));
    const score = roundScore(avgConfidence * 0.5 + sourceDiversity * 0.3 + frequency * 0.2);
    if (score < input.thresholds.minScore) continue;
    const text = chooseCanonicalText(signals);
    ranked.push({
      kind: 'memory_candidate',
      title: `Remember: ${text}`,
      text,
      score,
      sourceSignalIds: signals.map((signal) => signal.id),
      payload: {
        text,
        source: 'dreaming',
        confidence: score,
        provenance: signals.map((signal) => signal.provenance),
      },
    });
  }

  return ranked
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
    .slice(0, input.thresholds.maxCandidates);
}

function normalizeClaimKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, ' ').trim();
}

function chooseCanonicalText(signals: ContinuousSignal[]): string {
  return signals
    .slice()
    .sort((a, b) => b.confidence - a.confidence || b.text.length - a.text.length)[0]
    .text
    .replace(/[.。]+$/, '') + '.';
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
```

- [ ] **Step 3: Write engine test**

Create `plugins/dreaming/tests/engine.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { runDreamingCycle } from '../src/engine.js';
import { DreamingStore } from '../src/store.js';

describe('runDreamingCycle', () => {
  let dir: string;
  let store: DreamingStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dreaming-engine-'));
    store = new DreamingStore(join(dir, 'dreaming.sqlite'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores signals and creates learning proposals for ranked candidates', async () => {
    const createLearningProposal = vi.fn(async () => ({ reviewId: 'review-1', actionIds: ['action-1'] }));
    const result = await runDreamingCycle({
      agentId: 'amina',
      trigger: 'manual',
      store,
      config: resolveConfig({}, {
        enabled: true,
        thresholds: { minScore: 0.5, minSignalCount: 2, minUniqueSources: 2 },
      }),
      collectSignals: async () => [
        signal('a', 'local_memory', 'User prefers short answers.', 0.9),
        signal('b', 'session_transcript', 'User prefers short answers.', 0.8),
      ],
      createLearningProposal,
      now: 1000,
    });

    expect(result.status).toBe('completed');
    expect(result.signalCount).toBe(2);
    expect(result.candidateCount).toBe(1);
    expect(createLearningProposal).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'amina',
      trigger: 'dreaming_cycle',
      actions: [expect.objectContaining({
        actionType: 'memory_candidate',
        title: 'Remember: User prefers short answers.',
      })],
    }));
  });
});

function signal(id: string, source: string, text: string, confidence: number) {
  return {
    id,
    source,
    agentId: 'amina',
    scope: 'user',
    text,
    confidence,
    createdAt: 1000,
    provenance: { kind: source, ref: id },
    tags: [],
  } as any;
}
```

- [ ] **Step 4: Implement engine**

Create `plugins/dreaming/src/engine.ts`:

```ts
import type { ContinuousSignal } from '../../../src/continuous/signals.js';
import type { DreamingConfig } from './config.js';
import { rankDreamCandidates } from './scoring.js';
import type { DreamingStore } from './store.js';

type CreateLearningProposal = (input: {
  agentId: string;
  trigger: string;
  mode: 'off' | 'propose' | 'auto_private';
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  actions: Array<{
    actionType: 'memory_candidate' | 'skill_patch' | 'skill_create' | 'skill_update_full' | 'none';
    confidence?: number;
    title: string;
    rationale: string;
    payload: Record<string, unknown>;
  }>;
}) => Promise<{ reviewId: string; actionIds: string[] }>;

export async function runDreamingCycle(input: {
  agentId: string;
  trigger: 'cron' | 'manual';
  store: DreamingStore;
  config: DreamingConfig;
  collectSignals: () => Promise<ContinuousSignal[]>;
  createLearningProposal?: CreateLearningProposal;
  now?: number;
}): Promise<{
  runId: string;
  status: 'completed' | 'failed';
  signalCount: number;
  candidateCount: number;
  error?: string;
}> {
  const now = input.now ?? Date.now();
  const run = input.store.createRun({ agentId: input.agentId, trigger: input.trigger, startedAt: now });
  try {
    const signals = await input.collectSignals();
    for (const signal of signals) {
      input.store.upsertSignal({
        key: signal.id,
        agentId: signal.agentId,
        source: signal.source,
        scope: signal.scope,
        text: signal.text,
        confidence: signal.confidence,
        createdAt: signal.createdAt,
        provenance: signal.provenance,
        tags: signal.tags,
      });
    }
    const ranked = rankDreamCandidates({
      signals,
      thresholds: input.config.thresholds,
      now,
    });
    for (const candidate of ranked) {
      input.store.addCandidate({
        runId: run.id,
        agentId: input.agentId,
        kind: candidate.kind,
        title: candidate.title,
        text: candidate.text,
        score: candidate.score,
        sourceSignalKeys: candidate.sourceSignalIds,
        payload: candidate.payload,
        createdAt: now,
      });
    }

    if (ranked.length > 0 && input.config.mode === 'propose' && input.createLearningProposal) {
      await input.createLearningProposal({
        agentId: input.agentId,
        trigger: 'dreaming_cycle',
        mode: 'propose',
        input: { runId: run.id, signalCount: signals.length },
        metadata: { source: 'dreaming', runId: run.id },
        actions: ranked.map((candidate) => ({
          actionType: candidate.kind,
          confidence: candidate.score,
          title: candidate.title,
          rationale: `Dreaming found ${candidate.sourceSignalIds.length} reinforcing signal(s) from recent memory/context.`,
          payload: candidate.payload,
        })),
      });
    }

    input.store.completeRun(run.id, {
      status: 'completed',
      completedAt: now,
      summary: `Ranked ${ranked.length} candidate(s) from ${signals.length} signal(s).`,
      stats: { signalCount: signals.length, candidateCount: ranked.length },
    });
    return { runId: run.id, status: 'completed', signalCount: signals.length, candidateCount: ranked.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    input.store.completeRun(run.id, {
      status: 'failed',
      completedAt: now,
      error: message,
      stats: { signalCount: 0, candidateCount: 0 },
    });
    return { runId: run.id, status: 'failed', signalCount: 0, candidateCount: 0, error: message };
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --dir plugins/dreaming test -- tests/scoring.test.ts tests/engine.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/dreaming/src/scoring.ts plugins/dreaming/src/engine.ts plugins/dreaming/tests/scoring.test.ts plugins/dreaming/tests/engine.test.ts
git commit -m "feat(dreaming): rank signals into learning candidates"
```

---

## Task 8: Wire Plugin Runtime Sweep

**Files:**
- Modify: `plugins/dreaming/src/index.ts`
- Test: `plugins/dreaming/tests/index-register.test.ts`

- [ ] **Step 1: Extend register test for sweep execution**

Add to `plugins/dreaming/tests/index-register.test.ts`:

```ts
it('runs a sweep from plugin cron and creates proposals', async () => {
  const cronHandlers: Array<(payload: Record<string, unknown>) => Promise<void> | void> = [];
  const ctx = {
    pluginName: 'dreaming',
    pluginVersion: '0.1.0',
    dataDir: mkdtempSync(join(tmpdir(), 'dreaming-register-')),
    registerHook: vi.fn((event, handler) => {
      if (event === 'on_cron_fire') cronHandlers.push(handler);
    }),
    registerMcpTool: vi.fn(),
    registerContextEngine: vi.fn(),
    registerSlashCommand: vi.fn(),
    runSubagent: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getAgentConfig: vi.fn(() => ({ plugins: { dreaming: { enabled: true } }, workspacePath: ctx.dataDir })),
    getGlobalConfig: vi.fn(() => ({
      plugins: { dreaming: { defaults: { enabled: true } } },
      agents: { list: [{ id: 'amina' }] },
    })),
    registerSystemCronJob: vi.fn(),
    createLearningProposal: vi.fn(async () => ({ reviewId: 'review-1', actionIds: ['action-1'] })),
  };
  await register(ctx as any);

  await cronHandlers[0]({
    payload: {
      pluginName: 'dreaming',
      event: 'sweep',
    },
  });

  expect(ctx.createLearningProposal).toHaveBeenCalled();
  rmSync(ctx.dataDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Implement sweep wiring**

Modify `plugins/dreaming/src/index.ts`:

- Create one `DreamingStore` at `join(ctx.dataDir, 'dreaming.sqlite')`.
- On `on_cron_fire`, enumerate enabled agents from global config `agents.list`.
- For each enabled agent, collect local memory signals and registered external signal sources exposed by core.
- Call `runDreamingCycle`.
- Log per-agent status.
- Close the store in `shutdown`.

Use this helper:

```ts
function listAgentIds(ctx: PluginContext): string[] {
  const cfg = ctx.getGlobalConfig() as { agents?: { list?: Array<{ id?: unknown }> } } | undefined;
  const ids = (cfg?.agents?.list ?? [])
    .map((entry) => typeof entry.id === 'string' ? entry.id.trim() : '')
    .filter(Boolean);
  return [...new Set(ids)];
}
```

- [ ] **Step 3: Run plugin tests**

Run:

```bash
pnpm --dir plugins/dreaming test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/dreaming/src/index.ts plugins/dreaming/tests/index-register.test.ts
git commit -m "feat(dreaming): run scheduled sweeps through plugin runtime"
```

---

## Task 9: Add Dream Reports And `DREAMS.md`

**Files:**
- Create: `plugins/dreaming/src/reports.ts`
- Test: `plugins/dreaming/tests/reports.test.ts`
- Modify: `plugins/dreaming/src/engine.ts`

- [ ] **Step 1: Write report tests**

Create `plugins/dreaming/tests/reports.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendDreamDiaryEntry, writeDreamReport } from '../src/reports.js';

describe('dream reports', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'dreaming-reports-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('writes phase report outside daily memory', async () => {
    const path = await writeDreamReport({
      workspacePath: workspace,
      runId: 'run-1',
      day: '2026-05-13',
      lines: ['# Dreaming Report', '- Ranked 1 candidate.'],
    });
    expect(path).toBe('memory/dreaming/reports/2026-05-13-run-1.md');
    expect(readFileSync(join(workspace, path), 'utf8')).toContain('Ranked 1 candidate');
  });

  it('appends bounded diary entries to DREAMS.md', async () => {
    await appendDreamDiaryEntry({
      workspacePath: workspace,
      day: '2026-05-13',
      text: 'Memory settled around one durable preference.',
    });
    const content = readFileSync(join(workspace, 'DREAMS.md'), 'utf8');
    expect(content).toContain('<!-- anthroclaw:dreaming:diary:start -->');
    expect(content).toContain('## 2026-05-13');
    expect(content).toContain('Memory settled around one durable preference.');
  });
});
```

- [ ] **Step 2: Implement reports**

Create `plugins/dreaming/src/reports.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DIARY_START = '<!-- anthroclaw:dreaming:diary:start -->';
const DIARY_END = '<!-- anthroclaw:dreaming:diary:end -->';

export async function writeDreamReport(input: {
  workspacePath: string;
  runId: string;
  day: string;
  lines: string[];
}): Promise<string> {
  const relPath = `memory/dreaming/reports/${input.day}-${input.runId}.md`;
  const absPath = join(input.workspacePath, relPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, `${input.lines.join('\n')}\n`, 'utf8');
  return relPath;
}

export async function appendDreamDiaryEntry(input: {
  workspacePath: string;
  day: string;
  text: string;
}): Promise<void> {
  const path = join(input.workspacePath, 'DREAMS.md');
  const existing = await readFile(path, 'utf8').catch(() => `# Dream Diary\n\n${DIARY_START}\n${DIARY_END}\n`);
  const entry = `\n\n## ${input.day}\n\n${input.text.trim()}\n`;
  const next = existing.includes(DIARY_END)
    ? existing.replace(DIARY_END, `${entry}\n${DIARY_END}`)
    : `${existing.trimEnd()}\n\n${DIARY_START}${entry}\n${DIARY_END}\n`;
  await writeFile(path, next, 'utf8');
}
```

- [ ] **Step 3: Call reports from engine**

Modify `plugins/dreaming/src/engine.ts` so completed runs call `writeDreamReport` when `config.storage.writeReports` is true and `appendDreamDiaryEntry` when `config.storage.writeDreamsFile` is true.

Use deterministic diary text in v1:

```ts
const diaryText = ranked.length > 0
  ? `I found ${ranked.length} recurring memory candidate(s) from ${signals.length} grounded signal(s).`
  : `I reviewed ${signals.length} grounded signal(s) and found no durable candidate above threshold.`;
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --dir plugins/dreaming test -- tests/reports.test.ts tests/engine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/dreaming/src/reports.ts plugins/dreaming/src/engine.ts plugins/dreaming/tests/reports.test.ts
git commit -m "feat(dreaming): write reviewable reports and dream diary"
```

---

## Task 10: Add Dashboard/API Status Surface

**Files:**
- Create: `ui/app/api/agents/[agentId]/dreaming/route.ts`
- Modify: `plugins/dreaming/src/index.ts`
- Test: `ui/__tests__/api/dreaming-route.test.ts`

- [ ] **Step 1: Expose plugin MCP/status data through API**

Create `ui/app/api/agents/[agentId]/dreaming/route.ts` using the existing agent API route patterns. The response must be:

```ts
export interface DreamingStatusResponse {
  enabled: boolean;
  mode: 'off' | 'observe' | 'propose';
  lastRun?: {
    id: string;
    status: 'running' | 'completed' | 'failed';
    startedAt: number;
    completedAt?: number;
    summary?: string;
    stats: Record<string, unknown>;
    error?: string;
  };
  recentCandidates: Array<{
    id: string;
    status: string;
    title: string;
    score: number;
    createdAt: number;
  }>;
}
```

The route should fail closed with `404` when the agent does not exist and `200` with `{ enabled: false, mode: 'off', recentCandidates: [] }` when the plugin is unavailable.

- [ ] **Step 2: Add plugin helper for status**

Modify `plugins/dreaming/src/index.ts` so `dreaming_status` returns the same shape as `DreamingStatusResponse`. Keep MCP and API response shape aligned.

- [ ] **Step 3: Write route test**

Create `ui/__tests__/api/dreaming-route.test.ts` following the existing API route test style. Assert:

```ts
expect(await GET(request, { params: { agentId: 'missing' } })).toHaveProperty('status', 404);
expect(await GET(request, { params: { agentId: 'amina' } })).toHaveJsonBody(expect.objectContaining({
  enabled: expect.any(Boolean),
  recentCandidates: expect.any(Array),
}));
```

- [ ] **Step 4: Run UI route tests**

Run:

```bash
pnpm --dir ui test -- dreaming-route
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/app/api/agents/[agentId]/dreaming/route.ts ui/__tests__/api/dreaming-route.test.ts plugins/dreaming/src/index.ts
git commit -m "feat(ui): expose dreaming status API"
```

---

## Task 11: Replace Legacy Core Dreaming With Plugin Lane

**Files:**
- Modify: `src/gateway.ts`
- Modify: `src/memory/dreaming.ts`
- Test: `test/memory/dreaming.test.ts`
- Test: `src/plugins/__tests__/integration/e2e.test.ts`

- [ ] **Step 1: Keep `runDreaming` as archive helper**

Rename docs/comments in `src/memory/dreaming.ts` from broad "Dreaming" to "archive memory consolidation". Keep exported `runDreaming` for backward compatibility in this PR.

Change the header comment to:

```ts
/**
 * Archive consolidation helper.
 *
 * Scans memory/YYYY/MM/YYYY-MM-DD.md files and writes monthly summaries.
 * Full Dreaming lives in the bundled dreaming plugin; this helper remains
 * for compatibility and for the plugin's archive_consolidation lane.
 */
```

- [ ] **Step 2: Disable built-in system cron when plugin is enabled**

In `src/gateway.ts`, before adding the current `__dreaming__` job, check global config:

```ts
const dreamingPluginEnabled = Boolean(
  (config as { plugins?: { dreaming?: { defaults?: { enabled?: boolean } } } })
    .plugins?.dreaming?.defaults?.enabled,
);
if (!dreamingPluginEnabled) {
  this.scheduler.addJob({
    id: '__dreaming__',
    agentId: '__system__',
    schedule: '0 3 * * *',
    prompt: '',
    enabled: true,
  });
}
```

This prevents duplicate background consolidation during the migration.

- [ ] **Step 3: Add migration test**

Add a test asserting:

- when `plugins.dreaming.defaults.enabled` is false or absent, `__dreaming__` is registered;
- when it is true, `__dreaming__` is not registered and `plugin:dreaming:sweep` is registered after plugin load.

- [ ] **Step 4: Run regression tests**

Run:

```bash
npx vitest run test/memory/dreaming.test.ts src/plugins/__tests__/integration/e2e.test.ts
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gateway.ts src/memory/dreaming.ts test/memory/dreaming.test.ts src/plugins/__tests__/integration/e2e.test.ts
git commit -m "feat(dreaming): migrate scheduled consolidation to plugin lane"
```

---

## Task 12: End-To-End Verification

**Files:**
- Modify only files needed to fix failures found by these checks.

- [ ] **Step 1: Run root unit tests**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run root typecheck**

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Run plugin test suites**

```bash
pnpm --dir plugins/dreaming test
pnpm --dir plugins/dreaming build
pnpm --dir plugins/honcho test
pnpm --dir plugins/honcho build
```

Expected: PASS.

- [ ] **Step 4: Run UI build if dashboard files changed**

```bash
pnpm --dir ui build
```

Expected: PASS.

- [ ] **Step 5: Manual smoke scenario**

Create a local test config with:

```yaml
plugins:
  dreaming:
    defaults:
      enabled: true
      mode: propose
  honcho:
    defaults:
      enabled: true
      mode: observe
```

Add two test memory lines under `agents/amina/memory/YYYY/MM/YYYY-MM-DD.md`, start the gateway with `pnpm dev`, trigger the plugin cron or call `dreaming_status`, and verify:

- `data/plugins/dreaming/dreaming.sqlite` exists;
- `DREAMS.md` or `memory/dreaming/reports/**` is written;
- a `learning_actions` row exists with `payload.source = 'dreaming'`;
- no direct write to `MEMORY.md` happens before Learning/Decision approval.

- [ ] **Step 6: Commit verification fixes**

If fixes were needed:

```bash
git add <changed files>
git commit -m "fix(dreaming): address verification findings"
```

Expected: no uncommitted changes after this step.

---

## Acceptance Criteria

- Dreaming is opt-in and can be disabled per deployment and per agent.
- Dreaming runs as a bundled plugin, not as hardwired gateway business logic.
- Core exposes stable plugin primitives instead of letting plugins read private gateway state.
- Honcho remains independent; enabling Dreaming does not require Honcho.
- Honcho can optionally contribute bounded low-trust signals without recursive prompt-context ingestion.
- Dreaming writes reviewable artifacts and plugin-owned state.
- Dreaming-generated artifacts are excluded from future Dreaming evidence.
- Dreaming creates Learning proposals instead of directly applying memory/skill/system changes.
- Existing Learning/Decision approval paths remain the only durable apply mechanism for risky changes.
- `pnpm test`, `pnpm build`, `plugins/dreaming` tests/build, and `plugins/honcho` tests/build pass.

## Residual Risks

- Initial deterministic scoring may under-promote semantically similar multilingual claims. This is acceptable for v1 because it is safer to miss candidates than to over-write durable memory.
- Honcho SDK shape may differ across hosted/self-hosted deployments. The Honcho source must fail open and return `[]` on SDK incompatibility.
- Dashboard integration can become noisy if every Dreaming candidate appears as a top-level proposal. Use existing Learning filters and metadata `sourcePlugin: 'dreaming'` so the UI can group them.
- Plugin cron wiring touches gateway scheduling. Keep the migration compatibility path for `src/memory/dreaming.ts` until one release after plugin Dreaming is stable.
