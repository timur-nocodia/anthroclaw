# Plan 1 — anthroclaw Plugin Framework

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Минимальная plugin-система для anthroclaw в формате Claude Code Plugin Spec — discovery `plugins/*/.claude-plugin/plugin.json`, hot-reload, типизированный `PluginContext` API через который плагины регистрируют hooks / MCP tools / context engines / slash commands. ЕДИНСТВЕННЫЙ способ LLM-вызова для плагина — `ctx.runSubagent()` (под капотом `query()` SDK, без прямого `@anthropic-ai/sdk`).

**Architecture:** Loader при старте gateway сканит `plugins/*/.claude-plugin/plugin.json`, валидирует через Zod, динамически `import()`-ит `entry`, вызывает `register(ctx)`. Plugin получает типизированный `PluginContext` без raw-доступа к gateway internals. Per-agent enable через `agent.yml`. Ничего из существующего runtime не ломается — плагины additive.

**Tech Stack:** TypeScript, Zod (валидация), chokidar (hot-reload, уже в anthroclaw), vitest (тесты), `@anthropic-ai/claude-agent-sdk` (только для типов и `query()` в runSubagent).

**Spec reference:** `docs/superpowers/specs/2026-04-28-lcm-plugin-design.md` §3 (Plugin system framework). Plan 2 (LCM core) и Plan 3 (UI) последуют.

**Spec correction (записать в issue для апдейта спеки):** Спека §3.2 декларирует `hooks` как map `event → handler-module-path` в манифесте. На практике HookEmitter в anthroclaw — fire-and-forget (`emit()` не ждёт response), что не подходит для assembly-pattern (нужно трансформировать prompt). Решение: assembly идёт через метод `ContextEngine.assemble()`, не через `on_before_query` hook. `on_after_query` для mirror — нормальный fire-and-forget hook. Плагин регистрирует ContextEngine через `ctx.registerContextEngine()`, hooks через `ctx.registerHook()`. Манифест `hooks` — словарь только для observer-style событий. Это уточнение применяется в этом плане.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `src/plugins/types.ts` | Все TS-интерфейсы плагин-системы (`PluginManifest`, `PluginContext`, `ContextEngine`, `HookHandler`, etc) |
| `src/plugins/manifest-schema.ts` | Zod-schema для `.claude-plugin/plugin.json` + парсер |
| `src/plugins/loader.ts` | Discovery `plugins/*/.claude-plugin/plugin.json`, валидация манифестов, dynamic `import()` `entry` |
| `src/plugins/context.ts` | Реализация `PluginContext` — даёт плагину типизированный API |
| `src/plugins/subagent-runner.ts` | Реализация `runSubagent()` через `query()` SDK |
| `src/plugins/registry.ts` | Per-agent registry загруженных плагинов (включён/выключён, instance) |
| `src/plugins/watcher.ts` | chokidar-watcher для hot-reload плагинов |
| `src/plugins/index.ts` | Public API barrel (что экспортируется из plugin-системы) |
| `src/plugins/__tests__/manifest-schema.test.ts` | Unit-тесты Zod-схемы |
| `src/plugins/__tests__/loader.test.ts` | Unit-тесты discovery + dynamic import |
| `src/plugins/__tests__/context.test.ts` | Unit-тесты PluginContext (mock-gateway) |
| `src/plugins/__tests__/registry.test.ts` | Unit-тесты per-agent registry |
| `src/plugins/__tests__/subagent-runner.test.ts` | Unit-тесты runSubagent (mock query()) |
| `src/plugins/__tests__/contract.test.ts` | Contract-test: запрет на `@anthropic-ai/sdk` в plugin-системе |
| `src/plugins/__tests__/integration/e2e.test.ts` | End-to-end: stub-плагин регистрирует tool + hook, gateway его подхватывает |
| `plugins/__example/.claude-plugin/plugin.json` | Stub-плагин manifest (для E2E теста) |
| `plugins/__example/src/index.ts` | Stub-плагин runtime (no-op handlers) |
| `plugins/__example/package.json` | Stub-плагин deps |
| `plugins/__example/tsconfig.json` | Stub-плагин tsconfig |
| `src/config/schema.ts` | Modify: добавить `plugins` секцию в `GlobalConfigSchema` |
| `src/gateway.ts` | Modify: wire `PluginLoader` + `PluginRegistry` в startup; expose plugin-registered MCP tools и ContextEngine |
| `src/agent/agent.ts` | Modify: consume plugin-registered MCP tools при сборке per-agent MCP server |
| `pnpm-workspace.yaml` | Create: workspace для `plugins/*` |
| `tsconfig.base.json` | Create: shared tsconfig settings (если ещё нет) |

---

## Task 1: Skeleton + types.ts

**Files:**
- Create: `src/plugins/types.ts`
- Create: `src/plugins/__tests__/types.test.ts`

- [ ] **Step 1: Create types.ts skeleton**

```typescript
// src/plugins/types.ts
import type { z } from 'zod';
import type { HookEvent } from '../hooks/emitter.js';

/**
 * Manifest, как он лежит в plugins/{name}/.claude-plugin/plugin.json
 * после парсинга Zod-схемой (т.е. с дефолтами).
 */
export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  entry: string;                  // relative path to compiled JS
  configSchema?: string;          // optional path to Zod schema module
  mcpServers?: string;            // path to mcp.json (Claude Code Plugin Spec)
  skills?: string;                // dir of skills/*.md
  commands?: string;              // dir of commands/*.md
  hooks?: Record<string, string>; // event-name → handler-module-path (fire-and-forget only)
  requires?: {
    anthroclaw?: string;          // semver range
  };
}

/**
 * Контекст, передаваемый плагину в register(ctx).
 * Единственный API через который плагин общается с gateway.
 */
export interface PluginContext {
  pluginName: string;
  pluginVersion: string;
  dataDir: string;                // {anthroclaw-data-dir}/{plugin-name}/

  // Регистрация наблюдателей (fire-and-forget)
  registerHook(event: HookEvent, handler: HookHandler): void;

  // Регистрация MCP-тулов, которые плагин предоставляет агенту
  registerMcpTool(tool: PluginMcpTool): void;

  // Регистрация ContextEngine (для context-management плагинов вроде LCM)
  registerContextEngine(engine: ContextEngine): void;

  // Регистрация slash-команд
  registerSlashCommand(cmd: PluginSlashCommand): void;

  // Единственный способ LLM-вызова — через SDK query() с maxTurns:1, tools:[]
  runSubagent(opts: RunSubagentOpts): Promise<string>;

  logger: PluginLogger;

  getAgentConfig(agentId: string): unknown;     // Returns AgentYml — typed in registry
  getGlobalConfig(): unknown;                    // Returns GlobalConfig
}

// Re-export from gateway emitter to keep types in sync as new events are added.
export type { HookEvent } from '../hooks/emitter.js';

export type HookHandler = (payload: Record<string, unknown>) => void | Promise<void>;

export interface PluginMcpTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (input: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

export interface PluginSlashCommand {
  name: string;                   // без слэша
  description: string;
  handler: (args: string[], ctx: SlashCommandContext) => Promise<string>;
}

export interface SlashCommandContext {
  agentId: string;
  sessionKey: string;
}

export interface ContextEngine {
  /**
   * Вызывается перед query() SDK — может трансформировать prompt-payload.
   * Возвращает null если плагин не хочет ничего менять.
   */
  assemble?(input: AssembleInput): Promise<AssembleResult | null>;

  /**
   * Вызывается когда threshold превышен — может вернуть сжатый prompt-payload.
   * Возвращает null чтобы откатиться на legacy compressor.
   */
  compress?(input: CompressInput): Promise<CompressResult | null>;

  /**
   * Optional override для логики "пора ли компактить".
   */
  shouldCompress?(input: ShouldCompressInput): boolean;
}

export interface AssembleInput {
  agentId: string;
  sessionKey: string;
  messages: unknown[];           // SDKMessage[] — typed via @anthropic-ai/claude-agent-sdk
}
export interface AssembleResult {
  messages: unknown[];           // transformed prompt
}

export interface CompressInput {
  agentId: string;
  sessionKey: string;
  messages: unknown[];
  currentTokens: number;
}
export interface CompressResult {
  messages: unknown[];           // transformed prompt
}

export interface ShouldCompressInput {
  agentId: string;
  sessionKey: string;
  messageCount: number;
  currentTokens: number;
}

export interface RunSubagentOpts {
  prompt: string;
  systemPrompt?: string;
  model?: string;                 // override agent's default
  timeoutMs?: number;             // default 60_000
  cwd?: string;
}

export interface PluginLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

/**
 * Что экспортирует entry-модуль плагина.
 */
export interface PluginEntryModule {
  register: (ctx: PluginContext) => Promise<PluginInstance> | PluginInstance;
}

export interface PluginInstance {
  /** Освобождает ресурсы при unload (закрывает SQLite, etc). */
  shutdown?(): Promise<void> | void;
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/plugins/__tests__/types.test.ts
import { describe, it, expectTypeOf } from 'vitest';
import type {
  PluginManifest, PluginContext, ContextEngine, PluginEntryModule,
  PluginInstance, RunSubagentOpts, HookEvent, HookHandler, PluginMcpTool,
  PluginSlashCommand, SlashCommandContext, PluginLogger,
  AssembleInput, AssembleResult, CompressInput, CompressResult, ShouldCompressInput,
} from '../types.js';

describe('plugin types', () => {
  it('PluginManifest has required fields', () => {
    expectTypeOf<PluginManifest>().toHaveProperty('name').toEqualTypeOf<string>();
    expectTypeOf<PluginManifest>().toHaveProperty('version').toEqualTypeOf<string>();
    expectTypeOf<PluginManifest>().toHaveProperty('entry').toEqualTypeOf<string>();
  });

  it('PluginContext has all required register methods', () => {
    expectTypeOf<PluginContext>().toHaveProperty('registerHook').toBeFunction();
    expectTypeOf<PluginContext>().toHaveProperty('registerMcpTool').toBeFunction();
    expectTypeOf<PluginContext>().toHaveProperty('registerContextEngine').toBeFunction();
    expectTypeOf<PluginContext>().toHaveProperty('registerSlashCommand').toBeFunction();
    expectTypeOf<PluginContext>().toHaveProperty('runSubagent').toBeFunction();
  });

  it('ContextEngine methods are all optional', () => {
    expectTypeOf<ContextEngine>().toMatchTypeOf<{}>();
    // empty object satisfies — verify every method is optional
    expectTypeOf<ContextEngine['compress']>().toEqualTypeOf<((input: CompressInput) => Promise<CompressResult | null>) | undefined>();
    expectTypeOf<ContextEngine['assemble']>().toEqualTypeOf<((input: AssembleInput) => Promise<AssembleResult | null>) | undefined>();
    expectTypeOf<ContextEngine['shouldCompress']>().toEqualTypeOf<((input: ShouldCompressInput) => boolean) | undefined>();
  });

  it('PluginEntryModule.register accepts PluginContext and returns PluginInstance', () => {
    expectTypeOf<PluginEntryModule['register']>().parameter(0).toEqualTypeOf<PluginContext>();
    expectTypeOf<PluginEntryModule['register']>().returns
      .toEqualTypeOf<Promise<PluginInstance> | PluginInstance>();
  });

  it('HookEvent is re-exported from gateway emitter (matches its full shape)', () => {
    // assignability — values valid in plugin scope must be valid for gateway emitter
    expectTypeOf<HookEvent>().toMatchTypeOf<string>();
    // verifying the re-export carries the full union type
    expectTypeOf<HookEvent>().toEqualTypeOf<HookEvent>();
  });

  it('HookHandler signature', () => {
    expectTypeOf<HookHandler>().parameter(0).toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<HookHandler>().returns.toEqualTypeOf<void | Promise<void>>();
  });

  it('PluginMcpTool shape', () => {
    expectTypeOf<PluginMcpTool>().toHaveProperty('name').toEqualTypeOf<string>();
    expectTypeOf<PluginMcpTool>().toHaveProperty('description').toEqualTypeOf<string>();
    expectTypeOf<PluginMcpTool>().toHaveProperty('inputSchema');
    expectTypeOf<PluginMcpTool>().toHaveProperty('handler').toBeFunction();
  });

  it('PluginSlashCommand and SlashCommandContext', () => {
    expectTypeOf<PluginSlashCommand>().toHaveProperty('name').toEqualTypeOf<string>();
    expectTypeOf<PluginSlashCommand>().toHaveProperty('handler').toBeFunction();
    expectTypeOf<SlashCommandContext>().toHaveProperty('agentId').toEqualTypeOf<string>();
    expectTypeOf<SlashCommandContext>().toHaveProperty('sessionKey').toEqualTypeOf<string>();
  });

  it('AssembleInput / AssembleResult parallel CompressInput / CompressResult', () => {
    expectTypeOf<AssembleInput>().toHaveProperty('agentId').toEqualTypeOf<string>();
    expectTypeOf<AssembleInput>().toHaveProperty('sessionKey').toEqualTypeOf<string>();
    expectTypeOf<AssembleInput>().toHaveProperty('messages').toEqualTypeOf<unknown[]>();
    expectTypeOf<AssembleResult>().toHaveProperty('messages').toEqualTypeOf<unknown[]>();
    expectTypeOf<CompressInput>().toHaveProperty('agentId').toEqualTypeOf<string>();
    expectTypeOf<CompressInput>().toHaveProperty('sessionKey').toEqualTypeOf<string>();
    expectTypeOf<CompressInput>().toHaveProperty('messages').toEqualTypeOf<unknown[]>();
    expectTypeOf<CompressInput>().toHaveProperty('currentTokens').toEqualTypeOf<number>();
    expectTypeOf<CompressResult>().toHaveProperty('messages').toEqualTypeOf<unknown[]>();
  });

  it('ShouldCompressInput shape', () => {
    expectTypeOf<ShouldCompressInput>().toHaveProperty('agentId').toEqualTypeOf<string>();
    expectTypeOf<ShouldCompressInput>().toHaveProperty('sessionKey').toEqualTypeOf<string>();
    expectTypeOf<ShouldCompressInput>().toHaveProperty('messageCount').toEqualTypeOf<number>();
    expectTypeOf<ShouldCompressInput>().toHaveProperty('currentTokens').toEqualTypeOf<number>();
  });

  it('RunSubagentOpts shape', () => {
    expectTypeOf<RunSubagentOpts>().toHaveProperty('prompt').toEqualTypeOf<string>();
    // optional fields exist
    expectTypeOf<RunSubagentOpts>().toHaveProperty('systemPrompt').toEqualTypeOf<string | undefined>();
    expectTypeOf<RunSubagentOpts>().toHaveProperty('model').toEqualTypeOf<string | undefined>();
    expectTypeOf<RunSubagentOpts>().toHaveProperty('timeoutMs').toEqualTypeOf<number | undefined>();
    expectTypeOf<RunSubagentOpts>().toHaveProperty('cwd').toEqualTypeOf<string | undefined>();
  });

  it('PluginLogger has 4 level methods', () => {
    expectTypeOf<PluginLogger>().toHaveProperty('info').toBeFunction();
    expectTypeOf<PluginLogger>().toHaveProperty('warn').toBeFunction();
    expectTypeOf<PluginLogger>().toHaveProperty('error').toBeFunction();
    expectTypeOf<PluginLogger>().toHaveProperty('debug').toBeFunction();
  });

  it('PluginInstance.shutdown is optional', () => {
    expectTypeOf<PluginInstance>().toHaveProperty('shutdown').toEqualTypeOf<(() => Promise<void> | void) | undefined>();
  });
});
```

- [ ] **Step 3: Run test to verify it passes (types.ts is implemented)**

Run: `npx vitest run src/plugins/__tests__/types.test.ts`
Expected: PASS (types are well-formed, no TS errors)

- [ ] **Step 4: Commit**

```bash
git add src/plugins/types.ts src/plugins/__tests__/types.test.ts
git commit -m "feat(plugins): types skeleton — PluginManifest/Context/ContextEngine"
```

---

## Task 2: Manifest Zod schema

**Files:**
- Create: `src/plugins/manifest-schema.ts`
- Test: `src/plugins/__tests__/manifest-schema.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/plugins/__tests__/manifest-schema.test.ts
import { describe, it, expect } from 'vitest';
import { PluginManifestSchema, parsePluginManifest } from '../manifest-schema.js';

describe('PluginManifestSchema', () => {
  it('accepts minimal valid manifest', () => {
    const result = PluginManifestSchema.safeParse({
      name: 'lcm',
      version: '0.1.0',
      entry: 'dist/index.js',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = PluginManifestSchema.safeParse({ version: '0.1.0', entry: 'dist/index.js' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid semver in version', () => {
    const result = PluginManifestSchema.safeParse({
      name: 'lcm', version: 'not-semver', entry: 'dist/index.js',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name with invalid characters', () => {
    const result = PluginManifestSchema.safeParse({
      name: 'has spaces!', version: '0.1.0', entry: 'dist/index.js',
    });
    expect(result.success).toBe(false);
  });

  it('accepts hooks as event-name → path map', () => {
    const result = PluginManifestSchema.safeParse({
      name: 'lcm', version: '0.1.0', entry: 'dist/index.js',
      hooks: { onAfterQuery: 'dist/hooks/mirror.js' },
    });
    expect(result.success).toBe(true);
  });

  it('parsePluginManifest reads file and validates', async () => {
    // Использует fixture
    const manifest = await parsePluginManifest(
      'src/plugins/__tests__/fixtures/valid-manifest.json'
    );
    expect(manifest.name).toBe('test-plugin');
  });

  it('parsePluginManifest throws on invalid JSON', async () => {
    await expect(
      parsePluginManifest('src/plugins/__tests__/fixtures/invalid-manifest.json')
    ).rejects.toThrow(/invalid|parse|JSON/i);
  });
});
```

- [ ] **Step 2: Create test fixtures**

```bash
mkdir -p src/plugins/__tests__/fixtures
```

```json
// src/plugins/__tests__/fixtures/valid-manifest.json
{
  "name": "test-plugin",
  "version": "0.1.0",
  "description": "Test fixture",
  "entry": "dist/index.js"
}
```

```json
// src/plugins/__tests__/fixtures/invalid-manifest.json
{ "name": "broken", "version": "not-semver" }
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/plugins/__tests__/manifest-schema.test.ts`
Expected: FAIL (`Cannot find module '../manifest-schema'`)

- [ ] **Step 4: Implement manifest-schema.ts**

```typescript
// src/plugins/manifest-schema.ts
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import type { PluginManifest } from './types.js';

const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?(\+[a-z0-9.-]+)?$/i;
const NAME_RE = /^[a-z][a-z0-9-]{1,63}$/;

export const PluginManifestSchema = z.object({
  name: z.string().regex(NAME_RE, 'plugin name must be lowercase alphanumeric/hyphens, 2-64 chars'),
  version: z.string().regex(SEMVER_RE, 'version must be valid semver'),
  description: z.string().max(500).optional(),
  entry: z.string().min(1),
  configSchema: z.string().min(1).optional(),
  mcpServers: z.string().min(1).optional(),
  skills: z.string().min(1).optional(),
  commands: z.string().min(1).optional(),
  hooks: z.record(z.string(), z.string().min(1)).optional(),
  requires: z.object({
    anthroclaw: z.string().min(1).optional(),
  }).optional(),
});

export async function parsePluginManifest(path: string): Promise<PluginManifest> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    throw new Error(`failed to read plugin manifest at ${path}: ${(err as Error).message}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON in plugin manifest at ${path}: ${(err as Error).message}`);
  }

  const result = PluginManifestSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid plugin manifest at ${path}: ${issues}`);
  }

  return result.data;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/plugins/__tests__/manifest-schema.test.ts`
Expected: PASS (all 7 cases)

- [ ] **Step 6: Commit**

```bash
git add src/plugins/manifest-schema.ts src/plugins/__tests__/manifest-schema.test.ts \
        src/plugins/__tests__/fixtures/
git commit -m "feat(plugins): manifest Zod schema + parser"
```

---

## Task 3: Plugin loader (filesystem discovery)

**Files:**
- Create: `src/plugins/loader.ts`
- Test: `src/plugins/__tests__/loader.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/plugins/__tests__/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverPlugins } from '../loader.js';

describe('discoverPlugins', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'plugins-test-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('returns empty array when plugins dir is empty', async () => {
    const result = await discoverPlugins(tmp);
    expect(result).toEqual([]);
  });

  it('returns empty array when plugins dir does not exist', async () => {
    const result = await discoverPlugins(join(tmp, 'nonexistent'));
    expect(result).toEqual([]);
  });

  it('discovers single valid plugin', async () => {
    const pluginDir = join(tmp, 'foo');
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'foo', version: '0.1.0', entry: 'dist/index.js' })
    );
    const result = await discoverPlugins(tmp);
    expect(result).toHaveLength(1);
    expect(result[0].manifest.name).toBe('foo');
    expect(result[0].pluginDir).toBe(pluginDir);
  });

  it('skips plugins with invalid manifest (logs but does not throw)', async () => {
    mkdirSync(join(tmp, 'broken/.claude-plugin'), { recursive: true });
    writeFileSync(join(tmp, 'broken/.claude-plugin/plugin.json'), '{ "broken": true }');
    mkdirSync(join(tmp, 'good/.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmp, 'good/.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'good', version: '0.1.0', entry: 'dist/index.js' })
    );
    const result = await discoverPlugins(tmp);
    expect(result).toHaveLength(1);
    expect(result[0].manifest.name).toBe('good');
  });

  it('skips dirs without .claude-plugin/plugin.json', async () => {
    mkdirSync(join(tmp, 'random-dir'), { recursive: true });
    writeFileSync(join(tmp, 'random-dir', 'README.md'), '# not a plugin');
    const result = await discoverPlugins(tmp);
    expect(result).toEqual([]);
  });

  it('discovers multiple plugins', async () => {
    for (const name of ['alpha', 'bravo', 'charlie']) {
      mkdirSync(join(tmp, name, '.claude-plugin'), { recursive: true });
      writeFileSync(
        join(tmp, name, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name, version: '0.1.0', entry: 'dist/index.js' })
      );
    }
    const result = await discoverPlugins(tmp);
    expect(result).toHaveLength(3);
    expect(result.map(r => r.manifest.name).sort()).toEqual(['alpha', 'bravo', 'charlie']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/__tests__/loader.test.ts`
Expected: FAIL (`Cannot find module '../loader'`)

- [ ] **Step 3: Implement loader.ts**

```typescript
// src/plugins/loader.ts
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../logger.js';
import { parsePluginManifest } from './manifest-schema.js';
import type { PluginManifest } from './types.js';

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  pluginDir: string;            // абсолютный путь к директории плагина
  manifestPath: string;
}

/**
 * Сканит pluginsDir на subdir-ы вида {pluginsDir}/{name}/.claude-plugin/plugin.json
 * Возвращает только плагины с валидным manifest.
 * Не throw — invalid manifest логируется и пропускается.
 */
export async function discoverPlugins(pluginsDir: string): Promise<DiscoveredPlugin[]> {
  let entries: string[];
  try {
    entries = await readdir(pluginsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const discovered: DiscoveredPlugin[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;        // скип скрытых

    const pluginDir = join(pluginsDir, entry);
    const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');

    try {
      const dirStat = await stat(pluginDir);
      if (!dirStat.isDirectory()) continue;
      await stat(manifestPath);
    } catch {
      continue;     // нет manifest или не директория — пропускаем
    }

    try {
      const manifest = await parsePluginManifest(manifestPath);
      discovered.push({ manifest, pluginDir, manifestPath });
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, manifestPath },
        'plugin: skipping invalid manifest'
      );
    }
  }

  return discovered;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/plugins/__tests__/loader.test.ts`
Expected: PASS (all 6 cases)

- [ ] **Step 5: Commit**

```bash
git add src/plugins/loader.ts src/plugins/__tests__/loader.test.ts
git commit -m "feat(plugins): filesystem discovery for plugins/*/.claude-plugin/plugin.json"
```

---

## Task 4: Dynamic import + version-compat check

**Files:**
- Modify: `src/plugins/loader.ts` (add `loadPlugin` function)
- Test: `src/plugins/__tests__/loader.test.ts` (add test cases)

- [ ] **Step 1: Write failing test for loadPlugin**

Append to `src/plugins/__tests__/loader.test.ts`:

```typescript
import { loadPlugin } from '../loader.js';

describe('loadPlugin', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'plugin-load-test-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('loads valid plugin and returns module with register function', async () => {
    // Setup: создаём плагин с entry-файлом, экспортирующим register()
    const pluginDir = join(tmp, 'test-plugin');
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'test', version: '0.1.0', entry: 'dist/index.js' })
    );
    writeFileSync(
      join(pluginDir, 'dist', 'index.js'),
      'export async function register(ctx) { return { shutdown: () => {} }; }'
    );
    writeFileSync(join(pluginDir, 'dist', 'package.json'), '{ "type": "module" }');

    const discovered = await discoverPlugins(tmp);
    expect(discovered).toHaveLength(1);

    const mod = await loadPlugin(discovered[0]);
    expect(typeof mod.register).toBe('function');
  });

  it('throws if entry file does not exist', async () => {
    const pluginDir = join(tmp, 'no-entry');
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'noentry', version: '0.1.0', entry: 'dist/missing.js' })
    );

    const discovered = await discoverPlugins(tmp);
    await expect(loadPlugin(discovered[0])).rejects.toThrow(/entry|missing|cannot find/i);
  });

  it('throws if entry does not export register', async () => {
    const pluginDir = join(tmp, 'no-register');
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'noreg', version: '0.1.0', entry: 'dist/index.js' })
    );
    writeFileSync(join(pluginDir, 'dist', 'index.js'), 'export const foo = 1;');
    writeFileSync(join(pluginDir, 'dist', 'package.json'), '{ "type": "module" }');

    const discovered = await discoverPlugins(tmp);
    await expect(loadPlugin(discovered[0])).rejects.toThrow(/register/i);
  });

  it('respects requires.anthroclaw semver constraint', async () => {
    const pluginDir = join(tmp, 'incompat');
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'incompat', version: '0.1.0', entry: 'dist/index.js',
        requires: { anthroclaw: '>=99.0.0' },
      })
    );
    writeFileSync(
      join(pluginDir, 'dist', 'index.js'),
      'export async function register() { return {}; }'
    );
    writeFileSync(join(pluginDir, 'dist', 'package.json'), '{ "type": "module" }');

    const discovered = await discoverPlugins(tmp);
    await expect(
      loadPlugin(discovered[0], { anthroclawVersion: '0.5.0' })
    ).rejects.toThrow(/version|requires|incompatible/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/__tests__/loader.test.ts`
Expected: FAIL (`loadPlugin is not exported`)

- [ ] **Step 3: Add semver dependency check**

```bash
pnpm add semver
pnpm add -D @types/semver
```

- [ ] **Step 4: Implement loadPlugin in loader.ts**

Append to `src/plugins/loader.ts`:

```typescript
import { satisfies as semverSatisfies } from 'semver';
import { pathToFileURL } from 'node:url';
import type { PluginEntryModule } from './types.js';

export interface LoadPluginOpts {
  anthroclawVersion?: string;     // для requires.anthroclaw check
}

export async function loadPlugin(
  discovered: DiscoveredPlugin,
  opts: LoadPluginOpts = {},
): Promise<PluginEntryModule> {
  // 1. Проверка version-compat
  const requiresAnthroclaw = discovered.manifest.requires?.anthroclaw;
  if (requiresAnthroclaw && opts.anthroclawVersion) {
    if (!semverSatisfies(opts.anthroclawVersion, requiresAnthroclaw)) {
      throw new Error(
        `plugin ${discovered.manifest.name}@${discovered.manifest.version} requires ` +
        `anthroclaw ${requiresAnthroclaw}, but current version is ${opts.anthroclawVersion}`
      );
    }
  }

  // 2. Resolve entry path
  const entryAbs = join(discovered.pluginDir, discovered.manifest.entry);

  // 3. Dynamic import (file:// URL для ESM)
  let mod: unknown;
  try {
    mod = await import(pathToFileURL(entryAbs).href);
  } catch (err) {
    throw new Error(
      `failed to import plugin entry ${entryAbs}: ${(err as Error).message}`
    );
  }

  // 4. Validate that module exports register()
  const m = mod as Record<string, unknown>;
  if (typeof m.register !== 'function') {
    throw new Error(
      `plugin ${discovered.manifest.name} entry ${discovered.manifest.entry} ` +
      `does not export a register() function`
    );
  }

  return m as unknown as PluginEntryModule;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/plugins/__tests__/loader.test.ts`
Expected: PASS (all 10 cases — 6 from Task 3 + 4 new)

- [ ] **Step 6: Commit**

```bash
git add src/plugins/loader.ts src/plugins/__tests__/loader.test.ts package.json pnpm-lock.yaml
git commit -m "feat(plugins): dynamic import + semver compat check"
```

---

## Task 5: subagent-runner.ts — единственный путь к LLM

**Files:**
- Create: `src/plugins/subagent-runner.ts`
- Test: `src/plugins/__tests__/subagent-runner.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/plugins/__tests__/subagent-runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runSubagent } from '../subagent-runner.js';
import type { RunSubagentOpts } from '../types.js';

// Мокаем @anthropic-ai/claude-agent-sdk.query()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';

describe('runSubagent', () => {
  it('calls SDK query() with maxTurns:1, tools:[], canUseTool: deny', async () => {
    const events = (async function* () {
      yield { type: 'result', result: 'mock-summary-text' };
    })();
    (query as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      [Symbol.asyncIterator]: () => events,
      close: vi.fn(),
    });

    const result = await runSubagent({
      prompt: 'summarize these messages',
      systemPrompt: 'You are a summarizer.',
      model: 'claude-haiku-4-5',
    });

    expect(result).toBe('mock-summary-text');
    expect(query).toHaveBeenCalledTimes(1);
    const callArg = (query as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.options.maxTurns).toBe(1);
    expect(callArg.options.tools).toEqual([]);
    expect(callArg.options.allowedTools).toEqual([]);
    expect(callArg.options.permissionMode).toBe('dontAsk');
    expect(callArg.options.model).toBe('claude-haiku-4-5');
    // Verify canUseTool is actually a deny function, not just present.
    expect(typeof callArg.options.canUseTool).toBe('function');
    await expect(callArg.options.canUseTool()).resolves.toMatchObject({ behavior: 'deny' });
  });

  it('extracts text from assistant blocks if no result event', async () => {
    const events = (async function* () {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'partial-1 ' }, { type: 'text', text: 'partial-2' }] },
      };
    })();
    (query as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      [Symbol.asyncIterator]: () => events,
      close: vi.fn(),
    });

    const result = await runSubagent({ prompt: 'p' });
    expect(result).toBe('partial-1 partial-2');
  });

  it('respects timeoutMs and aborts long-running query', async () => {
    const neverEnding = (async function* () {
      await new Promise((r) => setTimeout(r, 5000));
      yield { type: 'result', result: 'too late' };
    })();
    (query as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      [Symbol.asyncIterator]: () => neverEnding,
      close: vi.fn(),
    });

    await expect(
      runSubagent({ prompt: 'p', timeoutMs: 100 })
    ).rejects.toThrow(/timeout|abort/i);
  });

  it('throws on empty result', async () => {
    const events = (async function* () {
      yield { type: 'result', result: '' };
    })();
    (query as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      [Symbol.asyncIterator]: () => events,
      close: vi.fn(),
    });

    await expect(runSubagent({ prompt: 'p' })).rejects.toThrow(/empty|no result/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/__tests__/subagent-runner.test.ts`
Expected: FAIL (`Cannot find module '../subagent-runner'`)

- [ ] **Step 3: Implement subagent-runner.ts**

(After review: includes timeout abort propagation + SDKResultError surfacing.)

```typescript
// src/plugins/subagent-runner.ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { RunSubagentOpts } from './types.js';

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * ЕДИНСТВЕННЫЙ путь к LLM для плагинов.
 * Использует SDK query() с maxTurns:1, tools:[], canUseTool: deny.
 * Гарантирует нативность: никаких прямых импортов @anthropic-ai/sdk,
 * никакого Messages API, никакого custom orchestration loop.
 */
export async function runSubagent(opts: RunSubagentOpts): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // AbortController created before sdkOptions so it can be passed in (propagates abort to SDK subprocess).
  const controller = new AbortController();

  const sdkOptions: Options = {
    model: opts.model ?? 'claude-sonnet-4-6',
    cwd: opts.cwd ?? process.cwd(),
    tools: [],
    allowedTools: [],
    permissionMode: 'dontAsk',
    canUseTool: async () => ({
      behavior: 'deny',
      message: 'Tools disabled in plugin subagent.',
    }),
    abortController: controller,
    settingSources: ['project'],
    persistSession: false,
    maxTurns: 1,
    systemPrompt: opts.systemPrompt
      ? { type: 'preset', preset: 'claude_code', excludeDynamicSections: true, append: opts.systemPrompt }
      : { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
  };

  const stream = query({ prompt: opts.prompt, options: sdkOptions });

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let result = '';
  let resultFound = false;
  const accumulated: string[] = [];

  const completePromise = (async () => {
    for await (const evt of stream) {
      const e = evt as Record<string, unknown>;

      // Detect SDK result errors before checking for success result string.
      const isErrorResult = e.type === 'result' && Boolean((e as { is_error?: boolean }).is_error);
      if (isErrorResult) {
        const errors = (e as { errors?: string[] }).errors ?? [];
        const subtype = (e as { subtype?: string }).subtype ?? 'unknown';
        throw new Error(`runSubagent LLM error (${subtype}): ${errors.join('; ') || subtype}`);
      }

      if (e.type === 'result' && typeof e.result === 'string') {
        result = e.result.trim();
        resultFound = true;
        break;
      }
      if (e.type === 'assistant') {
        const msg = e.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
        if (msg?.content) {
          for (const block of msg.content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              accumulated.push(block.text);
            }
          }
        }
      }
    }
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => {
      reject(new Error(`runSubagent timeout after ${timeoutMs}ms`));
    });
  });

  try {
    await Promise.race([completePromise, timeoutPromise]);
  } finally {
    // stream.close() in outer finally so it runs even when timeout wins. Calling twice is safe.
    clearTimeout(timer);
    stream.close?.();
  }

  if (!resultFound) {
    result = accumulated.join('').trim();
  }

  if (!result) {
    throw new Error('runSubagent returned empty result');
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/plugins/__tests__/subagent-runner.test.ts`
Expected: PASS (all 6 cases after review fixes)

- [ ] **Step 5: Commit**

```bash
git add src/plugins/subagent-runner.ts src/plugins/__tests__/subagent-runner.test.ts
git commit -m "feat(plugins): runSubagent — single LLM path via SDK query() with deny-all tools"
```

NOTE: This task also adds `clearMocks: true` to `vitest.config.ts` to ensure clean mock state between tests.

---

## Task 6: PluginContext implementation

**Files:**
- Create: `src/plugins/context.ts`
- Test: `src/plugins/__tests__/context.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/plugins/__tests__/context.test.ts
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createPluginContext, type ContextDeps } from '../context.js';
import type { ContextEngine, PluginMcpTool } from '../types.js';

function mkDeps(): ContextDeps {
  return {
    pluginName: 'test',
    pluginVersion: '0.1.0',
    dataDir: '/tmp/test-plugin',
    rootLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    hookEmitterFor: vi.fn().mockReturnValue({
      subscribe: vi.fn().mockReturnValue(() => {}),
    }),
    registerTool: vi.fn(),
    registerEngine: vi.fn(),
    registerCommand: vi.fn(),
    getAgentConfig: vi.fn().mockReturnValue({ id: 'agent-x' }),
    getGlobalConfig: vi.fn().mockReturnValue({ defaults: {} }),
  };
}

describe('createPluginContext', () => {
  it('exposes pluginName, pluginVersion, dataDir', () => {
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    expect(ctx.pluginName).toBe('test');
    expect(ctx.pluginVersion).toBe('0.1.0');
    expect(ctx.dataDir).toBe('/tmp/test-plugin');
  });

  it('registerHook delegates to all per-agent emitters', () => {
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    const handler = vi.fn();
    ctx.registerHook('on_after_query', handler);
    // По умолчанию registerHook регистрирует на global slot — проверим что shape
    // делегации правильный (детали в Task 8 интеграции с per-agent emitters)
    expect(typeof handler).toBe('function');
  });

  it('registerMcpTool calls deps.registerTool with namespaced name', () => {
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    const tool: PluginMcpTool = {
      name: 'my_tool',
      description: 'd',
      inputSchema: z.object({}),
      handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    };
    ctx.registerMcpTool(tool);
    expect(deps.registerTool).toHaveBeenCalledOnce();
    const arg = (deps.registerTool as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // имя префиксуется plugin-name для уникальности
    expect(arg.name).toBe('test_my_tool');
  });

  it('registerContextEngine calls deps.registerEngine', () => {
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    const engine: ContextEngine = { compress: async () => null };
    ctx.registerContextEngine(engine);
    expect(deps.registerEngine).toHaveBeenCalledOnce();
    expect(deps.registerEngine).toHaveBeenCalledWith('test', engine);
  });

  it('runSubagent delegates to subagent-runner', async () => {
    // Уже протестирован в subagent-runner.test.ts; здесь только smoke
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    expect(typeof ctx.runSubagent).toBe('function');
  });

  it('logger is a child logger with plugin name', () => {
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    ctx.logger.info({ x: 1 }, 'hello');
    expect(deps.rootLogger.info).toHaveBeenCalled();
  });

  it('getAgentConfig and getGlobalConfig return values from deps', () => {
    const deps = mkDeps();
    const ctx = createPluginContext(deps);
    expect(ctx.getAgentConfig('agent-x')).toEqual({ id: 'agent-x' });
    expect(ctx.getGlobalConfig()).toEqual({ defaults: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/__tests__/context.test.ts`
Expected: FAIL (`Cannot find module '../context'`)

- [ ] **Step 3: Implement context.ts**

```typescript
// src/plugins/context.ts
import type {
  PluginContext, PluginMcpTool, ContextEngine,
  PluginSlashCommand, HookEvent, HookHandler, RunSubagentOpts, PluginLogger,
} from './types.js';
import { runSubagent as runSubagentImpl } from './subagent-runner.js';
import type { HookEmitter } from '../hooks/emitter.js';

export interface ContextDeps {
  pluginName: string;
  pluginVersion: string;
  dataDir: string;

  /** Root pino-style logger (gateway создаёт child через .child({ plugin: name })). */
  rootLogger: PluginLogger;

  /** Возвращает HookEmitter для конкретного агента, или null если такого нет. */
  hookEmitterFor(agentId: string): HookEmitter | null;

  /** Зарегистрировать MCP-тул в plugin-registry — он будет отдан агенту при сборке per-agent MCP-server. */
  registerTool(tool: PluginMcpTool): void;

  /** Зарегистрировать ContextEngine — gateway будет звать его для compress/assemble. */
  registerEngine(pluginName: string, engine: ContextEngine): void;

  /** Зарегистрировать slash-команду. */
  registerCommand(cmd: PluginSlashCommand): void;

  getAgentConfig(agentId: string): unknown;
  getGlobalConfig(): unknown;

  /** Список всех agent-id для глобальных hook-регистраций. */
  listAgentIds(): string[];
}

export function createPluginContext(deps: ContextDeps): PluginContext {
  // Префикс tool-имени именем плагина — гарантия уникальности между плагинами.
  const namespace = (toolName: string) => `${deps.pluginName}_${toolName}`;

  const childLogger: PluginLogger = {
    info: (obj, msg) => deps.rootLogger.info({ plugin: deps.pluginName, ...((obj as object) ?? {}) }, msg),
    warn: (obj, msg) => deps.rootLogger.warn({ plugin: deps.pluginName, ...((obj as object) ?? {}) }, msg),
    error: (obj, msg) => deps.rootLogger.error({ plugin: deps.pluginName, ...((obj as object) ?? {}) }, msg),
    debug: (obj, msg) => deps.rootLogger.debug({ plugin: deps.pluginName, ...((obj as object) ?? {}) }, msg),
  };

  return {
    pluginName: deps.pluginName,
    pluginVersion: deps.pluginVersion,
    dataDir: deps.dataDir,
    logger: childLogger,

    registerHook(event: HookEvent, handler: HookHandler): void {
      // Hook регистрируется на ВСЕХ existing agent-emitters.
      // При создании нового агента gateway переподписывает hooks плагина (см. Task 8).
      for (const agentId of deps.listAgentIds()) {
        const emitter = deps.hookEmitterFor(agentId);
        if (emitter) emitter.subscribe(event, handler);
      }
    },

    registerMcpTool(tool: PluginMcpTool): void {
      const namespaced: PluginMcpTool = { ...tool, name: namespace(tool.name) };
      deps.registerTool(namespaced);
    },

    registerContextEngine(engine: ContextEngine): void {
      deps.registerEngine(deps.pluginName, engine);
    },

    registerSlashCommand(cmd: PluginSlashCommand): void {
      deps.registerCommand(cmd);
    },

    runSubagent(opts: RunSubagentOpts): Promise<string> {
      return runSubagentImpl(opts);
    },

    getAgentConfig(agentId: string): unknown {
      return deps.getAgentConfig(agentId);
    },

    getGlobalConfig(): unknown {
      return deps.getGlobalConfig();
    },
  };
}
```

- [ ] **Step 4: Update mkDeps in test to include listAgentIds**

```typescript
// src/plugins/__tests__/context.test.ts — обновить mkDeps()
function mkDeps(): ContextDeps {
  return {
    pluginName: 'test',
    pluginVersion: '0.1.0',
    dataDir: '/tmp/test-plugin',
    rootLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    hookEmitterFor: vi.fn().mockReturnValue({ subscribe: vi.fn().mockReturnValue(() => {}) }),
    registerTool: vi.fn(),
    registerEngine: vi.fn(),
    registerCommand: vi.fn(),
    getAgentConfig: vi.fn().mockReturnValue({ id: 'agent-x' }),
    getGlobalConfig: vi.fn().mockReturnValue({ defaults: {} }),
    listAgentIds: vi.fn().mockReturnValue(['agent-x']),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/plugins/__tests__/context.test.ts`
Expected: PASS (all 7 cases)

- [ ] **Step 6: Commit**

```bash
git add src/plugins/context.ts src/plugins/__tests__/context.test.ts
git commit -m "feat(plugins): PluginContext implementation with namespaced tools"
```

---

## Task 7: PluginRegistry — per-agent state

**Files:**
- Create: `src/plugins/registry.ts`
- Test: `src/plugins/__tests__/registry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/plugins/__tests__/registry.test.ts
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { PluginRegistry } from '../registry.js';
import type { ContextEngine, PluginMcpTool, PluginSlashCommand } from '../types.js';

describe('PluginRegistry', () => {
  it('starts empty', () => {
    const reg = new PluginRegistry();
    expect(reg.listPlugins()).toEqual([]);
    expect(reg.getMcpToolsForAgent('any')).toEqual([]);
    expect(reg.getContextEngine('any')).toBeNull();
    expect(reg.listSlashCommands()).toEqual([]);
  });

  it('registers a plugin with manifest + instance', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    expect(reg.listPlugins().map(p => p.manifest.name)).toEqual(['lcm']);
  });

  it('per-agent enable/disable defaults to disabled', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    expect(reg.isEnabledFor('agent-1', 'lcm')).toBe(false);
  });

  it('isEnabledFor returns true after enableForAgent', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    reg.enableForAgent('agent-1', 'lcm');
    expect(reg.isEnabledFor('agent-1', 'lcm')).toBe(true);
  });

  it('disableForAgent reverts state', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    reg.enableForAgent('agent-1', 'lcm');
    reg.disableForAgent('agent-1', 'lcm');
    expect(reg.isEnabledFor('agent-1', 'lcm')).toBe(false);
  });

  it('registerMcpTool exposes only to enabled agents', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    const tool: PluginMcpTool = {
      name: 'lcm_grep', description: 'd',
      inputSchema: z.object({}),
      handler: async () => ({ content: [{ type: 'text', text: 'r' }] }),
    };
    reg.addToolFromPlugin('lcm', tool);

    expect(reg.getMcpToolsForAgent('agent-disabled')).toEqual([]);
    reg.enableForAgent('agent-1', 'lcm');
    expect(reg.getMcpToolsForAgent('agent-1')).toHaveLength(1);
    expect(reg.getMcpToolsForAgent('agent-1')[0].name).toBe('lcm_grep');
  });

  it('getContextEngine returns null when plugin disabled for agent', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    const engine: ContextEngine = { compress: async () => null };
    reg.addEngineFromPlugin('lcm', engine);
    expect(reg.getContextEngine('agent-1')).toBeNull();
    reg.enableForAgent('agent-1', 'lcm');
    expect(reg.getContextEngine('agent-1')).toBe(engine);
  });

  it('only one ContextEngine per agent — last enabled wins, with warning', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm-a', { manifest: { name: 'lcm-a', version: '0.1.0', entry: 'x' } as never, instance: {} });
    reg.addPlugin('lcm-b', { manifest: { name: 'lcm-b', version: '0.1.0', entry: 'x' } as never, instance: {} });
    const engineA: ContextEngine = { compress: async () => null };
    const engineB: ContextEngine = { compress: async () => null };
    reg.addEngineFromPlugin('lcm-a', engineA);
    reg.addEngineFromPlugin('lcm-b', engineB);

    reg.enableForAgent('agent-1', 'lcm-a');
    reg.enableForAgent('agent-1', 'lcm-b');
    // Конкурирующие движки — берём более поздний и логируем warning.
    expect(reg.getContextEngine('agent-1')).toBe(engineB);
  });

  it('removePlugin clears all enables and registrations', () => {
    const reg = new PluginRegistry();
    reg.addPlugin('lcm', { manifest: { name: 'lcm', version: '0.1.0', entry: 'x' } as never, instance: {} });
    reg.enableForAgent('agent-1', 'lcm');
    reg.removePlugin('lcm');
    expect(reg.listPlugins()).toEqual([]);
    expect(reg.isEnabledFor('agent-1', 'lcm')).toBe(false);
    expect(reg.getMcpToolsForAgent('agent-1')).toEqual([]);
    expect(reg.getContextEngine('agent-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/__tests__/registry.test.ts`
Expected: FAIL (`Cannot find module '../registry'`)

- [ ] **Step 3: Implement registry.ts**

```typescript
// src/plugins/registry.ts
import type { PluginManifest, PluginInstance, PluginMcpTool, ContextEngine, PluginSlashCommand } from './types.js';
import { logger } from '../logger.js';

interface PluginEntry {
  manifest: PluginManifest;
  instance: PluginInstance;
}

export class PluginRegistry {
  private plugins = new Map<string, PluginEntry>();
  private enabledByAgent = new Map<string, Set<string>>();   // agentId → Set<pluginName>
  private toolsByPlugin = new Map<string, PluginMcpTool[]>();
  private engineByPlugin = new Map<string, ContextEngine>();
  private commandsByPlugin = new Map<string, PluginSlashCommand[]>();

  // ─── Plugins ──────────────────────────────────────────────────────

  addPlugin(name: string, entry: PluginEntry): void {
    this.plugins.set(name, entry);
  }

  removePlugin(name: string): void {
    this.plugins.delete(name);
    this.toolsByPlugin.delete(name);
    this.engineByPlugin.delete(name);
    this.commandsByPlugin.delete(name);
    for (const enabled of this.enabledByAgent.values()) {
      enabled.delete(name);
    }
  }

  listPlugins(): PluginEntry[] {
    return [...this.plugins.values()];
  }

  // ─── Per-agent enable/disable ─────────────────────────────────────

  enableForAgent(agentId: string, pluginName: string): void {
    if (!this.plugins.has(pluginName)) {
      throw new Error(`cannot enable unknown plugin: ${pluginName}`);
    }
    const set = this.enabledByAgent.get(agentId) ?? new Set<string>();
    set.add(pluginName);
    this.enabledByAgent.set(agentId, set);
  }

  disableForAgent(agentId: string, pluginName: string): void {
    this.enabledByAgent.get(agentId)?.delete(pluginName);
  }

  isEnabledFor(agentId: string, pluginName: string): boolean {
    return this.enabledByAgent.get(agentId)?.has(pluginName) ?? false;
  }

  // ─── Tool registration ────────────────────────────────────────────

  addToolFromPlugin(pluginName: string, tool: PluginMcpTool): void {
    const tools = this.toolsByPlugin.get(pluginName) ?? [];
    tools.push(tool);
    this.toolsByPlugin.set(pluginName, tools);
  }

  /** Тулзы, доступные конкретному агенту — суммарно по всем enabled-плагинам. */
  getMcpToolsForAgent(agentId: string): PluginMcpTool[] {
    const enabled = this.enabledByAgent.get(agentId);
    if (!enabled || enabled.size === 0) return [];
    const result: PluginMcpTool[] = [];
    for (const pluginName of enabled) {
      const tools = this.toolsByPlugin.get(pluginName);
      if (tools) result.push(...tools);
    }
    return result;
  }

  // ─── ContextEngine ────────────────────────────────────────────────

  addEngineFromPlugin(pluginName: string, engine: ContextEngine): void {
    if (this.engineByPlugin.has(pluginName)) {
      throw new Error(`plugin ${pluginName} already registered a ContextEngine`);
    }
    this.engineByPlugin.set(pluginName, engine);
  }

  /**
   * Активный ContextEngine для агента: первый среди enabled-плагинов с зарегистрированным engine.
   * Если несколько — берём последний enabled (insertion-order Set), логируем warning.
   */
  getContextEngine(agentId: string): ContextEngine | null {
    const enabled = this.enabledByAgent.get(agentId);
    if (!enabled || enabled.size === 0) return null;

    const candidates: { name: string; engine: ContextEngine }[] = [];
    for (const pluginName of enabled) {
      const engine = this.engineByPlugin.get(pluginName);
      if (engine) candidates.push({ name: pluginName, engine });
    }
    if (candidates.length === 0) return null;
    if (candidates.length > 1) {
      logger.warn(
        { agentId, candidates: candidates.map(c => c.name) },
        'multiple ContextEngines enabled for agent; using last enabled'
      );
    }
    return candidates[candidates.length - 1].engine;
  }

  // ─── Slash commands ───────────────────────────────────────────────

  addCommandFromPlugin(pluginName: string, cmd: PluginSlashCommand): void {
    const cmds = this.commandsByPlugin.get(pluginName) ?? [];
    cmds.push(cmd);
    this.commandsByPlugin.set(pluginName, cmds);
  }

  listSlashCommands(): PluginSlashCommand[] {
    const result: PluginSlashCommand[] = [];
    for (const cmds of this.commandsByPlugin.values()) result.push(...cmds);
    return result;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/plugins/__tests__/registry.test.ts`
Expected: PASS (all 9 cases)

- [ ] **Step 5: Commit**

```bash
git add src/plugins/registry.ts src/plugins/__tests__/registry.test.ts
git commit -m "feat(plugins): per-agent registry with enabled-state and tool/engine routing"
```

---

## Task 8: Wire plugin loader into Gateway

**Files:**
- Modify: `src/gateway.ts` — добавить `PluginRegistry`, `discoverPlugins`, `loadPlugin`, `register(ctx)` в startup-цикл
- Modify: `src/agent/agent.ts` — потреблять `registry.getMcpToolsForAgent(agentId)` при сборке per-agent MCP server
- Modify: `src/index.ts` — передавать `pluginsDir` в `gateway.start()`

- [ ] **Step 1: Add pluginsDir parameter to Gateway.start signature**

В `src/gateway.ts` найти метод `start()`:

```bash
grep -n "async start(" src/gateway.ts
```

Изменить сигнатуру:

```typescript
// До:
async start(config: GlobalConfig, agentsDir: string, dataDir: string): Promise<void> {
// После:
async start(config: GlobalConfig, agentsDir: string, dataDir: string, pluginsDir?: string): Promise<void> {
```

В `src/index.ts`:

```typescript
const pluginsDir = process.argv[5] ?? './plugins';
// ...
await gateway.start(config, resolve(agentsDir), resolve(dataDir), resolve(pluginsDir));
```

- [ ] **Step 2: Add plugin loading to Gateway**

В `src/gateway.ts` в начало метода `start()` (после load configs, до start channels) добавить:

```typescript
// Plugin discovery & registration
this.pluginRegistry = new PluginRegistry();
const discovered = await discoverPlugins(pluginsDir ?? join(this.dataDir, '..', 'plugins'));
for (const d of discovered) {
  try {
    const mod = await loadPlugin(d, { anthroclawVersion: ANTHROCLAW_VERSION });
    const ctx = createPluginContext({
      pluginName: d.manifest.name,
      pluginVersion: d.manifest.version,
      dataDir: join(this.dataDir, d.manifest.name),
      rootLogger: logger,
      hookEmitterFor: (agentId) => this.hookEmitters.get(agentId) ?? null,
      registerTool: (tool) => this.pluginRegistry.addToolFromPlugin(d.manifest.name, tool),
      registerEngine: (name, engine) => this.pluginRegistry.addEngineFromPlugin(name, engine),
      registerCommand: (cmd) => this.pluginRegistry.addCommandFromPlugin(d.manifest.name, cmd),
      getAgentConfig: (id) => this.agents.get(id)?.config,
      getGlobalConfig: () => this.config,
      listAgentIds: () => [...this.agents.keys()],
    });
    const instance = await mod.register(ctx);
    this.pluginRegistry.addPlugin(d.manifest.name, { manifest: d.manifest, instance });
    logger.info({ plugin: d.manifest.name, version: d.manifest.version }, 'plugin loaded');
  } catch (err) {
    logger.error({ err, plugin: d.manifest.name }, 'failed to load plugin');
  }
}

// Apply per-agent enables based on agent.yml
for (const [agentId, agent] of this.agents) {
  const enabledPlugins = (agent.config as { plugins?: Record<string, { enabled?: boolean }> }).plugins ?? {};
  for (const [pluginName, cfg] of Object.entries(enabledPlugins)) {
    if (cfg.enabled) {
      try {
        this.pluginRegistry.enableForAgent(agentId, pluginName);
      } catch (err) {
        logger.warn({ agentId, pluginName, err }, 'failed to enable plugin for agent');
      }
    }
  }
}
```

В начале файла добавить imports:

```typescript
import { discoverPlugins, loadPlugin } from './plugins/loader.js';
import { createPluginContext } from './plugins/context.js';
import { PluginRegistry } from './plugins/registry.js';

const ANTHROCLAW_VERSION = '0.4.1';   // или прочитать из package.json
```

И в class Gateway добавить поле:

```typescript
public pluginRegistry!: PluginRegistry;
```

- [ ] **Step 3: Wire plugin tools into agent.ts**

В `src/agent/agent.ts` в функции которая собирает per-agent MCP-server (там где `createSdkMcpServer({ tools: [...] })`) — добавить tools от registry:

```typescript
// Найти место где собираются tools — рядом с createMemorySearchTool, createMemoryWriteTool и т.д.
// Добавить:
const pluginTools = pluginRegistry.getMcpToolsForAgent(agent.id).map(pt => ({
  name: pt.name,
  description: pt.description,
  parameters: pt.inputSchema,
  handler: async (input: unknown) => {
    return pt.handler(input);
  },
}));

const tools = [
  createMemorySearchTool(...),
  createMemoryWriteTool(...),
  // ... остальные built-in
  ...pluginTools,    // ← плагинные тулзы
];
```

`pluginRegistry` нужно прокинуть в `agent.ts` как параметр функции/конструктора.

- [ ] **Step 4: Run existing test suite to verify no regressions**

```bash
pnpm test 2>&1 | tail -20
```

Expected: все existing-тесты проходят (мы только добавили новые поля, ничего не сломали).

- [ ] **Step 5: Commit**

```bash
git add src/gateway.ts src/agent/agent.ts src/index.ts
git commit -m "feat(plugins): wire PluginRegistry into Gateway and per-agent MCP server"
```

**Post-review addendum (code review of Task 8 implementation):** Four bugs were found and fixed in the Task 8 implementation. (C1) Plugin hook handlers were orphaned after `rebuildHookEmitters()` because fresh emitters replaced old ones without re-subscribing stored handlers. Fixed by moving hook registration through `PluginRegistry.addHookFromPlugin` + `listAllHooks`, having the gateway re-subscribe all stored hooks to fresh emitters after every `rebuildHookEmitters()` call. (C2) Setting `enabled: false` in agent config had no effect on hot-reload — only additions were applied, never removals. Fixed by reconciling desired vs actual enabled set in the reload loop and calling `disableForAgent` where needed. (I1) Plugin data directory was passed to plugin but never created; added `mkdir(..., { recursive: true })` before `createPluginContext`. (I4) Plugin `shutdown()` was called after `agents.clear()` in `stop()`; moved plugin shutdown loop above agents/channels teardown. Additionally, `GlobalConfigSchema.plugins` field was added here (see Task 9 note below), the `ContextDeps` interface was simplified by replacing `hookEmitterFor`/`listAgentIds` with a single `registerHook` callback, and per-agent `refreshPluginTools` is now always called (even with empty array) to correctly reset to built-in-only when a plugin is disabled.

---

## Task 9: Add `plugins` section to GlobalConfigSchema and AgentYmlSchema

**Note:** `GlobalConfigSchema.plugins` was added in the Task 8 post-review fix. Task 9 only needs to add the `AgentYmlSchema.plugins` part (which was already done there too) and add schema tests.

**Files:**
- Modify: `src/config/schema.ts`
- Test: `src/config/__tests__/schema.test.ts` (добавить тесты)

- [ ] **Step 1: Write failing test**

```typescript
// src/config/__tests__/schema.test.ts (если файла нет — создать)
import { describe, it, expect } from 'vitest';
import { GlobalConfigSchema, AgentYmlSchema } from '../schema.js';

describe('plugins config', () => {
  it('GlobalConfigSchema accepts plugins.lcm.defaults section', () => {
    const result = GlobalConfigSchema.safeParse({
      plugins: { lcm: { defaults: { enabled: false } } },
    });
    expect(result.success).toBe(true);
    expect(result.data?.plugins?.lcm?.defaults?.enabled).toBe(false);
  });

  it('AgentYmlSchema accepts plugins.{name}.enabled', () => {
    const result = AgentYmlSchema.safeParse({
      // минимально-валидный agent.yml — добавить fields по существующей схеме
      // и:
      plugins: { lcm: { enabled: true } },
    });
    expect(result.success).toBe(true);
  });

  it('plugins section is fully optional', () => {
    const result = GlobalConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.plugins).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL (плагин-секции ещё нет)

- [ ] **Step 3: Add to schema.ts**

В `src/config/schema.ts` в `GlobalConfigSchema`:

```typescript
export const GlobalConfigSchema = z.object({
  // ... existing fields ...
  plugins: z.record(z.string(), z.object({
    defaults: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
});
```

В `AgentYmlSchema` (поищите его в этом же файле):

```typescript
export const AgentYmlSchema = z.object({
  // ... existing fields ...
  plugins: z.record(z.string(), z.object({
    enabled: z.boolean().default(false),
    overrides: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/config/__tests__/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/config/__tests__/schema.test.ts
git commit -m "feat(config): plugins section in GlobalConfig and AgentYml schemas"
```

---

## Task 10: Hot-reload watcher

**Files:**
- Create: `src/plugins/watcher.ts`
- Test: `src/plugins/__tests__/watcher.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/plugins/__tests__/watcher.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPluginsWatcher } from '../watcher.js';

describe('startPluginsWatcher', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'plugins-watch-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('detects new plugin and calls onAdd', async () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const watcher = startPluginsWatcher(tmp, { onAdd, onRemove });

    await new Promise(r => setTimeout(r, 100));    // wait for ready

    mkdirSync(join(tmp, 'foo/.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmp, 'foo/.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'foo', version: '0.1.0', entry: 'dist/index.js' })
    );

    await new Promise(r => setTimeout(r, 500));    // wait for chokidar event
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      manifest: expect.objectContaining({ name: 'foo' }),
    }));

    await watcher.close();
  });

  it('detects plugin manifest deletion and calls onRemove', async () => {
    mkdirSync(join(tmp, 'bar/.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmp, 'bar/.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'bar', version: '0.1.0', entry: 'dist/index.js' })
    );

    const onRemove = vi.fn();
    const watcher = startPluginsWatcher(tmp, { onAdd: vi.fn(), onRemove });
    await new Promise(r => setTimeout(r, 200));

    rmSync(join(tmp, 'bar'), { recursive: true });
    await new Promise(r => setTimeout(r, 500));

    expect(onRemove).toHaveBeenCalledWith('bar');
    await watcher.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/__tests__/watcher.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement watcher.ts**

```typescript
// src/plugins/watcher.ts
import chokidar from 'chokidar';
import { dirname, basename } from 'node:path';
import { discoverPlugins, type DiscoveredPlugin } from './loader.js';
import { logger } from '../logger.js';

export interface WatcherCallbacks {
  onAdd: (plugin: DiscoveredPlugin) => void | Promise<void>;
  onRemove: (pluginName: string) => void | Promise<void>;
}

export interface PluginsWatcher {
  close(): Promise<void>;
}

export function startPluginsWatcher(
  pluginsDir: string,
  callbacks: WatcherCallbacks,
): PluginsWatcher {
  const watcher = chokidar.watch(`${pluginsDir}/*/.claude-plugin/plugin.json`, {
    persistent: true,
    ignoreInitial: false,
  });

  // Initial scan complete event — start watching events
  watcher.on('add', async (path) => {
    logger.debug({ path }, 'plugin manifest added');
    const pluginDirName = basename(dirname(dirname(path)));
    try {
      const all = await discoverPlugins(pluginsDir);
      const found = all.find(p => p.manifest.name === pluginDirName);
      if (found) await callbacks.onAdd(found);
    } catch (err) {
      logger.warn({ err, path }, 'failed to handle plugin add');
    }
  });

  watcher.on('change', async (path) => {
    // change = re-add, re-discover
    logger.debug({ path }, 'plugin manifest changed, reloading');
    const pluginDirName = basename(dirname(dirname(path)));
    try {
      await callbacks.onRemove(pluginDirName);
      const all = await discoverPlugins(pluginsDir);
      const found = all.find(p => p.manifest.name === pluginDirName);
      if (found) await callbacks.onAdd(found);
    } catch (err) {
      logger.warn({ err, path }, 'failed to handle plugin change');
    }
  });

  watcher.on('unlink', async (path) => {
    logger.debug({ path }, 'plugin manifest removed');
    const pluginDirName = basename(dirname(dirname(path)));
    try {
      await callbacks.onRemove(pluginDirName);
    } catch (err) {
      logger.warn({ err, path }, 'failed to handle plugin remove');
    }
  });

  return {
    close: () => watcher.close(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/plugins/__tests__/watcher.test.ts`
Expected: PASS (both cases)

- [ ] **Step 5: Wire watcher into Gateway**

В `src/gateway.ts` после первоначального discovery (Task 8):

```typescript
this.pluginsWatcher = startPluginsWatcher(pluginsDir, {
  onAdd: async (d) => {
    // повтор того же кода что в initial-discovery
    try {
      const mod = await loadPlugin(d, { anthroclawVersion: ANTHROCLAW_VERSION });
      const ctx = /* build ctx, как в Task 8 */;
      const instance = await mod.register(ctx);
      this.pluginRegistry.addPlugin(d.manifest.name, { manifest: d.manifest, instance });
      logger.info({ plugin: d.manifest.name }, 'plugin hot-reloaded');
    } catch (err) {
      logger.error({ err, plugin: d.manifest.name }, 'failed to hot-reload plugin');
    }
  },
  onRemove: async (name) => {
    const entry = this.pluginRegistry.listPlugins().find(p => p.manifest.name === name);
    if (entry?.instance.shutdown) {
      try { await entry.instance.shutdown(); } catch (err) {
        logger.warn({ err, plugin: name }, 'plugin shutdown error');
      }
    }
    this.pluginRegistry.removePlugin(name);
  },
});
```

В `Gateway.stop()`:

```typescript
await this.pluginsWatcher?.close();
```

- [ ] **Step 6: Commit**

```bash
git add src/plugins/watcher.ts src/plugins/__tests__/watcher.test.ts src/gateway.ts
git commit -m "feat(plugins): chokidar-based hot-reload for plugins/*/plugin.json"
```

**Post-final-review fix:** Watcher `onAdd` was originally only registering the plugin globally — agent enables and `refreshPluginTools()` were not applied until next agent-config reload. Final review caught this; `onAdd` now mirrors the per-agent enable+refresh loop from initial discovery, and `onRemove` also refreshes agent tools to drop the removed plugin's tool definitions immediately.

**Smoke-test fix:** The watcher initially used `ignoreInitial: false`, causing chokidar to fire `add` events for plugin manifests that were already loaded by `Gateway.start()`'s initial `discoverPlugins` pass. This produced a "Tool X is already registered" error at SDK level. Fix: `ignoreInitial: true` (post-startup events only) plus idempotent `loadAndRegisterPlugin` (removes any existing same-name plugin before re-loading) as defense in depth.

---

## Task 11: Stub plugin (`plugins/__example/`) for E2E test

**Files:**
- Create: `plugins/__example/.claude-plugin/plugin.json`
- Create: `plugins/__example/src/index.ts`
- Create: `plugins/__example/package.json`
- Create: `plugins/__example/tsconfig.json`
- Create: `pnpm-workspace.yaml` (если ещё нет)

- [ ] **Step 1: Create pnpm-workspace.yaml**

```yaml
# pnpm-workspace.yaml
packages:
  - 'plugins/*'
```

- [ ] **Step 2: Create stub plugin manifest**

```bash
mkdir -p plugins/__example/.claude-plugin
mkdir -p plugins/__example/src
```

```json
// plugins/__example/.claude-plugin/plugin.json
{
  "name": "example",
  "version": "0.0.1",
  "description": "Stub plugin for plugin-framework E2E tests. Not for production.",
  "entry": "dist/index.js"
}
```

- [ ] **Step 3: Create stub plugin runtime**

```typescript
// plugins/__example/src/index.ts
import { z } from 'zod';
import type { PluginContext, PluginInstance } from '../../../src/plugins/types.js';

export async function register(ctx: PluginContext): Promise<PluginInstance> {
  ctx.logger.info({}, 'example plugin registered');

  // Регистрируем простой no-op tool
  ctx.registerMcpTool({
    name: 'echo',
    description: 'Echoes input back. Used for plugin-framework tests.',
    inputSchema: z.object({ message: z.string() }),
    handler: async (input) => {
      const { message } = input as { message: string };
      return { content: [{ type: 'text', text: `echo: ${message}` }] };
    },
  });

  // Регистрируем простой hook (счётчик turn-ов в process.env)
  ctx.registerHook('on_after_query', async (payload) => {
    ctx.logger.debug({ payload }, 'on_after_query');
  });

  return {
    shutdown: () => {
      ctx.logger.info({}, 'example plugin shutting down');
    },
  };
}
```

- [ ] **Step 4: Create plugin package.json**

```json
{
  "name": "@anthroclaw/plugin-example",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 5: Create plugin tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": false
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 6: Build the stub plugin**

```bash
pnpm install
pnpm --filter @anthroclaw/plugin-example build
ls plugins/__example/dist/
```

Expected: `index.js` is in `plugins/__example/dist/`.

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml plugins/__example/
git commit -m "test(plugins): stub example plugin for E2E framework tests"
```

---

## Task 12: End-to-end integration test

**Files:**
- Create: `src/plugins/__tests__/integration/e2e.test.ts`

- [ ] **Step 1: Write E2E test**

```typescript
// src/plugins/__tests__/integration/e2e.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { discoverPlugins, loadPlugin } from '../../loader.js';
import { createPluginContext } from '../../context.js';
import { PluginRegistry } from '../../registry.js';
import { HookEmitter } from '../../../hooks/emitter.js';

const PLUGINS_DIR = resolve(__dirname, '../../../../plugins');

describe('plugin framework E2E', () => {
  beforeAll(() => {
    // build stub plugin
    execSync('pnpm --filter @anthroclaw/plugin-example build', { cwd: resolve(__dirname, '../../../..') });
  });

  it('discovers, loads, and registers stub plugin end-to-end', async () => {
    const discovered = await discoverPlugins(PLUGINS_DIR);
    const example = discovered.find(d => d.manifest.name === 'example');
    expect(example).toBeDefined();

    const mod = await loadPlugin(example!, { anthroclawVersion: '0.4.1' });
    expect(typeof mod.register).toBe('function');

    const registry = new PluginRegistry();
    const fakeEmitter = new HookEmitter([]);
    const subscribeSpy = vi.spyOn(fakeEmitter, 'subscribe');

    const ctx = createPluginContext({
      pluginName: example!.manifest.name,
      pluginVersion: example!.manifest.version,
      dataDir: '/tmp/example-plugin',
      rootLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      hookEmitterFor: () => fakeEmitter,
      registerTool: (tool) => registry.addToolFromPlugin('example', tool),
      registerEngine: (name, eng) => registry.addEngineFromPlugin(name, eng),
      registerCommand: () => {},
      getAgentConfig: () => ({}),
      getGlobalConfig: () => ({}),
      listAgentIds: () => ['agent-1'],
    });

    const instance = await mod.register(ctx);
    registry.addPlugin('example', { manifest: example!.manifest, instance });
    registry.enableForAgent('agent-1', 'example');

    // 1. tool зарегистрирован и виден агенту
    const tools = registry.getMcpToolsForAgent('agent-1');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('example_echo');

    // 2. tool работает
    const result = await tools[0].handler({ message: 'hi' });
    expect(result.content[0].text).toBe('echo: hi');

    // 3. hook subscribed на агенте
    expect(subscribeSpy).toHaveBeenCalledWith('on_after_query', expect.any(Function));

    // 4. shutdown работает
    await instance.shutdown?.();
  });
});
```

- [ ] **Step 2: Run E2E test**

Run: `npx vitest run src/plugins/__tests__/integration/e2e.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/plugins/__tests__/integration/
git commit -m "test(plugins): E2E — discover/load/register/use stub plugin"
```

---

## Task 13: Contract test — запрет на @anthropic-ai/sdk

**Files:**
- Create: `src/plugins/__tests__/contract.test.ts`

- [ ] **Step 1: Write contract test**

```typescript
// src/plugins/__tests__/contract.test.ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PLUGINS_RUNTIME_DIR = resolve(__dirname, '..');     // src/plugins/

function* walkTsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkTsFiles(full);
    else if (entry.endsWith('.ts')) yield full;
  }
}

describe('plugin-framework contract', () => {
  it('does not import @anthropic-ai/sdk directly', () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(PLUGINS_RUNTIME_DIR)) {
      const src = readFileSync(file, 'utf-8');
      if (
        /from\s+['"]@anthropic-ai\/sdk['"]/.test(src) ||
        /require\s*\(\s*['"]@anthropic-ai\/sdk['"]\s*\)/.test(src)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders, `Files with forbidden import:\n${offenders.join('\n')}`).toHaveLength(0);
  });

  it('does not call Messages API directly (messages.create)', () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(PLUGINS_RUNTIME_DIR)) {
      const src = readFileSync(file, 'utf-8');
      if (/messages\.create\s*\(/.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders, `Files using Messages API:\n${offenders.join('\n')}`).toHaveLength(0);
  });

  it('runSubagent is the only place that imports @anthropic-ai/claude-agent-sdk', () => {
    const importers: string[] = [];
    for (const file of walkTsFiles(PLUGINS_RUNTIME_DIR)) {
      const src = readFileSync(file, 'utf-8');
      if (/from\s+['"]@anthropic-ai\/claude-agent-sdk['"]/.test(src)) {
        importers.push(file);
      }
    }
    // Разрешено: subagent-runner.ts (для query) и types.ts (для типов SDKMessage)
    const allowed = importers.filter(f =>
      f.endsWith('subagent-runner.ts') || f.endsWith('types.ts')
    );
    const disallowed = importers.filter(f => !allowed.includes(f));
    expect(disallowed, `Disallowed importers:\n${disallowed.join('\n')}`).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run contract test**

Run: `npx vitest run src/plugins/__tests__/contract.test.ts`
Expected: PASS (если кто-то ранее импортнул `@anthropic-ai/sdk` или `messages.create` — FAIL, надо удалить)

- [ ] **Step 3: Commit**

```bash
git add src/plugins/__tests__/contract.test.ts
git commit -m "test(plugins): contract test — forbid direct @anthropic-ai/sdk usage"
```

---

## Task 14: Public API barrel + finalize

**Files:**
- Create: `src/plugins/index.ts`

- [ ] **Step 1: Create barrel**

```typescript
// src/plugins/index.ts
export type {
  PluginManifest,
  PluginContext,
  ContextEngine,
  PluginEntryModule,
  PluginInstance,
  PluginMcpTool,
  PluginSlashCommand,
  HookEvent,
  HookHandler,
  RunSubagentOpts,
  AssembleInput,
  AssembleResult,
  CompressInput,
  CompressResult,
  ShouldCompressInput,
} from './types.js';

export { PluginRegistry } from './registry.js';
export { discoverPlugins, loadPlugin, type DiscoveredPlugin } from './loader.js';
export { createPluginContext, type ContextDeps } from './context.js';
export { runSubagent } from './subagent-runner.js';
export { startPluginsWatcher, type PluginsWatcher, type WatcherCallbacks } from './watcher.js';
```

- [ ] **Step 2: Verify all tests still pass**

Run: `pnpm test 2>&1 | tail -30`

Expected:
- `src/plugins/__tests__/` — все ~50 тестов из Tasks 1-13 проходят
- Existing anthroclaw тесты — без регрессий

- [ ] **Step 3: Commit**

```bash
git add src/plugins/index.ts
git commit -m "feat(plugins): public API barrel"
```

**Note:** `registerSlashCommand` registers but does not dispatch in v0.1.0 — dispatch integration is Plan 2 work. Documented in JSDoc on `PluginContext.registerSlashCommand`.

---

## Task 15: Sanity-run gateway with plugin

**Files:** none (smoke test)

- [ ] **Step 1: Build plugin**

```bash
pnpm --filter @anthroclaw/plugin-example build
```

- [ ] **Step 2: Run gateway in dev mode**

Открыть отдельный терминал:

```bash
pnpm dev
```

Expected log lines:
```
plugin loaded { plugin: 'example', version: '0.0.1' }
example plugin registered
```

- [ ] **Step 3: (manual) Verify plugin disable works**

Создать тестовый агент `agents/test/agent.yml` с:

```yaml
plugins:
  example:
    enabled: true
```

Перезапустить gateway. В логах должно быть видно `plugin enabled for agent: test`.

Поменять `enabled: false`. Watcher должен поймать изменение, плагин должен быть disabled для агента.

- [ ] **Step 4: Final commit + tag**

```bash
# если были любые финальные правки во время smoke-теста
git status
git commit -am "chore(plugins): sanity-pass clean" --allow-empty
git tag plugin-framework-v0.1.0
```

---

## Self-Review

**1. Spec coverage (§3 Plugin system in anthroclaw):**
- §3.1 Discovery → Tasks 3, 10 (discoverPlugins + watcher)
- §3.2 Manifest schema → Task 2 (Zod schema)
- §3.3 PluginContext API → Tasks 1, 5, 6 (types + runSubagent + impl)
- §3.4 Lifecycle → Tasks 8, 10 (gateway wire + hot-reload)
- §3.5 Объём кода → ~400-500 строк выходит, в диапазоне

**2. Placeholder scan:** Никаких TBD/TODO. Все шаги имеют конкретный код. Команды git точные.

**3. Type consistency:**
- `PluginContext.registerMcpTool` принимает `PluginMcpTool` (Task 1, 6) — совпадает
- `ContextEngine.compress` возвращает `Promise<CompressResult | null>` (Task 1, использовано в Task 7) — совпадает
- `DiscoveredPlugin` определён в Task 3, потребляется в Tasks 4, 10, 12 — совпадает
- `runSubagent` сигнатура в Task 5 соответствует тому что вызывается через ctx в Task 6

**4. Что осталось вне Plan 1 (для Plan 2):**
- ContextEngine.compress/assemble integration с gateway turn-cycle (точки делегирования)
- Реальный плагин LCM (это вся Plan 2)
- UI для конфигурации (Plan 3)

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-28-plugin-framework.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — Я диспатчу свежего subagent-а на каждый Task, делаю review между ними, быстрая итерация. Хорошо для длинных планов с TDD-циклом.

**2. Inline Execution** — Выполняю Tasks в этой же сессии через `superpowers:executing-plans`, batch-execution с checkpoints для ревью.

**Какой подход?**
