# LCM Plugin Design — Lossless Context Management для anthroclaw

**Date:** 2026-04-28
**Status:** Draft (ожидает ревью пользователя)
**Author:** Claude + Timur (brainstorming session)
**Scope:** Архитектурный дизайн plugin-системы anthroclaw и первого плагина (LCM) — порт hermes-lcm на TypeScript

---

## 1. Контекст и цели

### 1.1 Проблема

anthroclaw — gateway на `@anthropic-ai/claude-agent-sdk`. Текущий context-management построен вокруг встроенного `src/session/compressor.ts`, который при превышении токенового порога делает плоскую lossy-сводку и **теряет старые turn-ы безвозвратно**. Когда агент через несколько часов диалога не может вспомнить решение, принятое в начале — единственный путь это `memory_search` (cross-session wiki), но туда попадает только то, что агент явно записал.

### 1.2 Решение

Внедрить **Lossless Context Management** по схеме [hermes-lcm](https://github.com/stephenschoettler/hermes-lcm) (Voltropy paper, Ehrlich & Blackman, Feb 2026): иммутабельный per-agent SQLite-store + иерархический DAG саммаризаций (D0 → D1 → D2+) + 3-level escalation L1→L2→L3 с гарантированной сходимостью + 6 retrieval-тулзов агенту для drill-down по сжатой истории.

### 1.3 Жёсткое ограничение — нативность Agent SDK

Все LLM-вызовы (включая суммаризатор LCM) должны идти **только через `query()` SDK**. Никаких прямых импортов `@anthropic-ai/sdk`, никаких самописных Messages-API tool-loop, никаких кастомных orchestration-loop-ов. Нарушение этого ограничения может расцениться Anthropic как abuse подписки и привести к её блокировке.

### 1.4 Не-цели (out of scope)

- Замена существующих `memory_search`/`memory_write`/`memory_wiki` тулзов. LCM additive, параллельный.
- Автоматический backfill старой истории при включении плагина (см. §10 — Rollout, Phase 2).
- Marketplace-готовый plugin-package (workspace-package оставляем как опцию, но публикация — после v1.0.0).
- Frontend для plugin-marketplace (плагин ставится разработчиком, не end-user-ом).

---

## 2. Решения, принятые в brainstorming-сессии

| # | Вопрос | Решение | Обоснование |
|---|---|---|---|
| 1 | Plugin format | Стандартный Claude Code Plugin Spec (`.claude-plugin/plugin.json` + `mcp.json` + `skills/` + `hooks/`) с минимальным расширением для anthroclaw-нужд | Не изобретать формат; reuse существующего стандарта; будущая совместимость с Claude Code marketplace |
| 2 | Scope MVP | Полный порт hermes-lcm (~5-6 недель, все 6 тулзов, full DAG, 3-level escalation, lifecycle с debt, externalization, doctor) | Пользовательский выбор — целимся в production-feature-parity, не в proof-of-concept |
| 3 | Сосуществование с memory_* | Полностью отдельный, additive | Hermes-pattern; ноль ломки прода; opt-in |
| 4 | Уровень конфигурации | Глобальные defaults в `config.yml` + per-agent override в `agent.yml` | Существующий anthroclaw pattern для `defaults.model`, `debounce_ms`; UI-форма автоматом из Zod-schema |
| 5 | Compressor integration | Вариант C — LCM как fallback delegation point в `compressor.ts` | Минимальная инвазивность; silent-fallback на legacy при любых ошибках |
| 6 | Физическое расположение | Self-contained в `plugins/lcm/` с собственным `package.json` и `tsconfig.json` | Переносимость; spec соблюдается 1:1; легко вынести в отдельное репо позже |
| 7 | Drill-down testing | Обязательный lossless-тест от D2 узлов до байт-в-байт исходных messages | Это invariant отличия LCM от обычного компрессора |

---

## 3. Plugin system в anthroclaw (фреймворк-часть)

LCM — первый плагин. Перед ним нужен минимальный plugin-loader, на который потом будут опираться другие плагины.

### 3.1 Discovery

При старте gateway сканит `plugins/*/.claude-plugin/plugin.json`. Hot-reload через тот же `chokidar`-watcher что уже следит за `agents/`.

### 3.2 Manifest schema

Надмножество стандарта Claude Code Plugin Spec:

```json
{
  "name": "lcm",
  "version": "0.1.0",
  "description": "Lossless Context Management",
  "entry": "dist/index.js",
  "configSchema": "dist/config-schema.js",
  "mcpServers": "mcp.json",
  "skills": "skills/",
  "commands": "commands/",
  "hooks": {
    "onAfterQuery": "dist/hooks/mirror.js",
    "onBeforeQuery": "dist/hooks/assembly.js"
  },
  "requires": {
    "anthroclaw": ">=0.5.0"
  }
}
```

**Расширения относительно стандарта Claude Code Plugin Spec:**
- `entry` — TS-runtime entry-point. Экспортирует `register(ctx: PluginContext): PluginInstance`.
- `configSchema` — путь к Zod-schema, которую UI рендерит автоматически.
- `hooks` как map `event → handler-module-path`. В Claude Code Plugin Spec hooks — shell-команды; здесь — TS-модули, потому что нативная интеграция в hook-emitter gateway-а.
- `requires.anthroclaw` — semver-constraint на версию ядра. При несовпадении плагин не загружается.

### 3.3 PluginContext API

`PluginContext`, передаваемый в `register(ctx)`, даёт типизированный доступ к gateway-internals **без raw-доступа к Anthropic SDK**:

```ts
interface PluginContext {
  pluginName: string;
  pluginVersion: string;
  dataDir: string;                                  // data/<plugin-name>/

  registerHook(event: HookEvent, handler: HookHandler): void;
  registerMcpTool(tool: ToolDefinition): void;
  registerContextEngine(engine: ContextEngine): void;  // делает плагин участником compressor.ts (см. §7)
  registerSlashCommand(cmd: SlashCommandDefinition): void;

  runSubagent(opts: RunSubagentOpts): Promise<string>;  // ЕДИНСТВЕННЫЙ способ LLM-вызова
  logger: Logger;                                       // pino child
  getAgentConfig(agentId: string): AgentYml;
  getGlobalConfig(): GlobalConfig;
}
```

`runSubagent()` под капотом зовёт `query()` SDK с `maxTurns:1`, `tools:[]`, `canUseTool: deny`, заданным `systemPrompt`. Никакого прямого `@anthropic-ai/sdk`. Это барьер, через который плагин **не может** обойти Agent SDK.

### 3.4 Lifecycle

- Plugin регистрируется при старте gateway (1 раз на инсталляцию).
- Per-agent enabled/disabled — через `agent.yml`. Watcher ловит изменения, переинициализирует engine плагина для конкретного агента.
- Изменение файлов плагина (`plugins/lcm/dist/`) — full reload плагина для всех агентов где включён.

### 3.5 Объём кода в anthroclaw

Новые модули:
- `src/plugins/loader.ts` — manifest discovery, build-check, registration
- `src/plugins/context.ts` — `PluginContext` implementation
- `src/plugins/types.ts` — TypeScript-интерфейсы плагина
- `src/plugins/registry.ts` — runtime-registry загруженных плагинов
- `src/plugins/__tests__/` — unit-тесты loader-а, context-implementations, registry

Суммарный объём: ~400-500 строк TS + ~200 строк тестов.

---

## 4. LCM plugin layout

```
plugins/lcm/
├── .claude-plugin/
│   └── plugin.json              # manifest
├── mcp.json                     # стандарт Claude Code (хост MCP-сервера)
├── skills/
│   └── lcm-usage.md             # инструкция агенту: когда какой тул звать
├── commands/
│   └── lcm.md                   # опциональный slash-command (status/doctor)
├── src/
│   ├── index.ts                 # register(ctx) — главная точка входа
│   ├── config.ts                # LCMConfig + Zod schema
│   ├── engine.ts                # LCMEngine — оркестратор
│   ├── store.ts                 # MessageStore (immutable + FTS5)
│   ├── dag.ts                   # SummaryDAG (граф свёрток)
│   ├── escalation.ts            # L1 → L2 → L3
│   ├── extraction.ts            # pre-compaction extraction (opt-in)
│   ├── externalize.ts           # большие tool-output → файлы (opt-in)
│   ├── lifecycle.ts             # frontier + debt
│   ├── tokens.ts                # tiktoken-обёртка с char-fallback
│   ├── search-query.ts          # FTS5 + LIKE-fallback для CJK/emoji
│   ├── hooks/
│   │   ├── mirror.ts            # on_after_query: пишем в store
│   │   └── assembly.ts          # on_before_query: собираем prompt
│   ├── tools/
│   │   ├── grep.ts              # lcm_grep
│   │   ├── describe.ts          # lcm_describe
│   │   ├── expand.ts            # lcm_expand
│   │   ├── expand-query.ts      # lcm_expand_query (RAG-стайл)
│   │   ├── status.ts            # lcm_status
│   │   └── doctor.ts            # lcm_doctor
│   └── db/
│       ├── bootstrap.ts         # versioned migrations
│       └── schema.sql           # CREATE TABLEs + FTS5 + триггеры
├── tests/
│   ├── store.test.ts
│   ├── dag.test.ts
│   ├── engine.test.ts
│   ├── escalation.test.ts
│   ├── tools.test.ts
│   ├── contract.test.ts         # запрет на @anthropic-ai/sdk-импорты
│   └── integration/
│       ├── compress-cycle.test.ts
│       └── lossless.test.ts     # обязательный drill-down тест
├── package.json                 # better-sqlite3, zod, @anthropic-ai/claude-agent-sdk (типы)
├── tsconfig.json                # extends ../../tsconfig.base.json
└── README.md
```

**Принципы:**

- Зависимости плагина — подмножество gateway. Никаких новых тяжёлых deps.
- Один файл — одна ответственность. `engine.ts` целимся в <1000 строк, остальные <700.
- Тесты внутри плагина (`pnpm --filter ./plugins/lcm test`).
- Self-contained: можно скопировать `plugins/lcm/` на другую инсталляцию или вынести в отдельное репо.

**Оценка размера:** ~3500-4500 строк TS-рантайма + ~6000-8000 строк тестов (по примеру hermes — ~2x от рантайма).

---

## 5. Data flow

LCM встраивается в anthroclaw turn-цикл в три точки, все через хуки/делегирование. Ноль модификаций SDK runtime.

### 5.1 Точка (1) — `on_before_query`: assembly

`hooks/assembly.ts` вызывается gateway-ом перед `queryAgent()`:

1. Принимает текущий список `messages[]` (system + история + новый turn).
2. Если у LCM-engine есть DAG-узлы для этого `session_key` — собирает assembly:
   ```
   [system]
   [d2 Durable: aggregated long-term context]
   [d1 Session Arc: medium-term arc]
   [d0 Recent Summary: last few hours condensed]
   [fresh tail (последние fresh_tail_count сообщений)]
   ```
   с учётом `assembly_cap_tokens` (выбирает сколько summary-блоков влезет).
3. Возвращает обновлённый `messages[]`. Gateway передаёт его в `query()` SDK.
4. Если у LCM нет данных (первый turn агента) — возвращает unchanged. Pass-through.

### 5.2 Точка (2) — `on_after_query`: mirror

`hooks/mirror.ts` вызывается gateway-ом после успешного `query()`:

1. Принимает все новые messages (user + assistant + tool_use + tool_result), возникшие в этом turn-е.
2. Делает append в `messages` SQLite-таблице. `store_id` инкрементируется. Обновляет `lifecycle_state.current_frontier_store_id`.
3. Иммутабельность: единственное исключение из append-only — `gc_externalized_tool_result(store_id, placeholder)` (если включён `transcript_gc.enabled`), переписывает `content` уже-экстернализованной tool-row на placeholder.
4. Не влияет на текущий turn — только на следующие.

### 5.3 Точка (3) — `compressor.ts`: compress

См. §7 — Integration with `compressor.ts`. Краткое содержание: когда anthroclaw `compressor.ts` детектит overflow, он делегирует в `lcm.compress()`. LCM делает leaf pass + condensation, возвращает assembled `messages[]`. При ошибке — silent fallback на legacy compressor.

### 5.4 Subagent-суммаризатор

Каждый L1/L2-вызов внутри `escalation.ts` использует `ctx.runSubagent()` с system-prompt-ом «суммаризируй decisions/files/commands/values, preserve specifics».

- L1: prompt «detailed summary, preserve key facts», budget ~20% от source.
- L2: prompt «aggressive bullets only, decisions/files/errors/state», budget = L1 × 0.5.
- L3: **никакого LLM**. Детерминированная склейка `head[40%]+«[truncation]»+tail[40%]` до `l3_truncate_tokens` (default 512). Гарантия сходимости.

Все вызовы `runSubagent` под капотом — `query()` SDK с `maxTurns:1`, `tools:[]`, `canUseTool: deny`. Никакого прямого Messages API.

### 5.5 Инварианты

- **Сообщения никогда не теряются.** Mirror в (2) — append-only. Когда (3) "удаляет" turn-ы из активного prompt-а — они остаются в store, доступны через `lcm_grep`/`lcm_expand`.
- **Graceful degradation.** Если LCM падает в любой из трёх точек — anthroclaw продолжает работать. (1) → unchanged prompt. (2) → drop new messages, mirror восстановится. (3) → fallback на legacy compressor.
- **No SDK-runtime modification.** Мы не вызываем `query()` с `resume`-аргументом для редактирования истории SDK. Anthroclaw уже сам собирает prompt перед каждым turn-ом — мы просто подставляем туда наш assembled-payload через хук.

---

## 6. Tools surface (6 MCP-тулзов)

Регистрируются через `createSdkMcpServer()` + `tool()`. Идут только агентам где LCM включён в `agent.yml`.

### 6.1 `lcm_grep`

Поиск по сообщениям + свёрткам в текущем `session_key`. Параллельный FTS5 поверх двух таблиц.

```ts
{
  query: string,
  scope?: "messages" | "summaries" | "both",  // default both
  source?: "telegram" | "whatsapp" | "cli" | "unknown" | "all",
  sort?: "relevance" | "recency" | "hybrid",  // hybrid = bm25/(1+age*1e-3)
  limit?: number  // default 20, max 100
} → { results: [{ kind, store_id?, node_id?, depth?, snippet, ts }] }
```

**Семантика `source`:**
- `"telegram"` / `"whatsapp"` / `"cli"` — только сообщения с этой платформой в predecessor-цепочке (через source-lineage CTE).
- `"unknown"` — только сообщения с `source='unknown'` или legacy blank (для back-compat).
- `"all"` (default) — без фильтрации.
- Mixed-source узлы (свёрнутый чат с сообщениями из нескольких платформ) матчатся на каждый non-`"all"` фильтр, в чьей цепочке есть хотя бы одно сообщение этой платформы.

CJK/emoji/несбалансированные кавычки → LIKE-fallback с escape_like (бэкслеш-экранирование `%_\`).

### 6.2 `lcm_describe`

Метаданные subtree без загрузки контента.

```ts
{ node_id?: string, externalized_ref?: string }
// без аргументов → overview сессии (распределение по depth, total tokens)
// с node_id → tokens, source_count, source_type, expand_hint, children
// с externalized_ref → preview JSON-payload экстернализованного output-а
```

### 6.3 `lcm_expand`

Достать сырые сообщения / дочерние узлы.

```ts
{ node_id: string, max_tokens?: number /* default 4000 */ } |
{ externalized_ref: string }
→ { type: "messages"|"nodes", items: [...], truncated: boolean }
```

### 6.4 `lcm_expand_query`

RAG-стайл: prompt + (query | node_ids), expand узлы, склеить, отдать subagent-у с system-prompt-ом «ground in context».

```ts
{ prompt: string, query?: string, node_ids?: string[],
  max_context_tokens?: number /* default 8000 */ }
→ { answer: string, sources: [{ node_id, snippet }] }
```

Использует `ctx.runSubagent()` — отдельный `query()` без тулзов.

### 6.5 `lcm_status`

Диагностика (агент сам решает, нужен ли drill-down).

```ts
{} → { current_session, store, dag, lifecycle, compression_count, last_compressed_at }
```

### 6.6 `lcm_doctor`

Health-check. 6 проверок: SQLite integrity, FTS sync, orphaned DAG nodes, config validation, source-lineage hygiene, context pressure.

```ts
{ scope?: "session" | "agent" | "all", apply?: boolean }
→ { checks: [...], can_clean: boolean }
```

`apply: true` под двойным gate: config `doctor.clean_apply.enabled: true` (per-agent в `agent.yml` или глобально в `config.yml`) **И** slash-command `/lcm` активен (`slash_command.enabled: true`). Оба должны быть включены явно. Перед чисткой — backup в `data/lcm-db/backups/{agentId}-{ts}.sqlite` через `db.backup()`.

### 6.7 Skill-инструкция

`skills/lcm-usage.md` — агенту объясняет когда какой тул:

> При запросах "что мы решили вчера / месяц назад", "найди где обсуждали X" → `lcm_grep`. Чтобы не загружать сырьё — сначала `lcm_describe`, потом точечно `lcm_expand`. Когда нужно ответить на NL-вопрос с автоматическим RAG → `lcm_expand_query`. Для cross-session фактов и долгой памяти → старый `memory_search`, не `lcm_grep`. `lcm_status` / `lcm_doctor` — для самодиагностики или по запросу оператора.

### 6.8 Per-turn rate-limit

Каждый `lcm_*` тул имеет внутренний rate-limit per-turn (default: 10 вызовов одного тула в одном turn-е). При превышении — возвращает ошибку «rate limit, this turn». Защита от runaway-loops.

---

## 7. Integration with `compressor.ts`

Вариант C из brainstorming. Изменения в существующем `src/session/compressor.ts` минимальны.

### 7.1 Делегирование

```ts
async function compressSession(
  agent: Agent, sessionKey: string, messages: SDKMessage[], currentTokens: number
): Promise<SDKMessage[]> {
  const lcm = pluginRegistry.getContextEngine(agent.id);
  if (lcm) {
    try {
      const result = await lcm.compress({ sessionKey, messages, currentTokens });
      if (result) return result.assembled;
      // result === null → плагин решил пропустить
    } catch (err) {
      logger.warn({ err, agentId: agent.id }, 'lcm compress failed, falling back');
    }
  }
  return legacyCompressSession(agent, sessionKey, messages, currentTokens);
}
```

### 7.2 ContextEngine interface

Плагин регистрирует через `ctx.registerContextEngine()`:

```ts
interface ContextEngine {
  compress(input: CompressInput): Promise<CompressResult | null>;
  shouldCompress?(input: ShouldCompressInput): boolean;  // optional override
}
```

`shouldCompress`-override позволяет плагину иметь свою логику триггера (по умолчанию anthroclaw использует `agent.yml.auto_compress`).

### 7.3 Граничные случаи

| Сценарий | Поведение |
|---|---|
| LCM включён, store пустой (первый turn) | `compress()` обрабатывает messages как backlog → создаёт D0-узлы → возвращает assembled |
| LLM-timeout в L1-вызове суммаризатора | escalation.ts ловит timeout → пробует L2 → L3 (без LLM, всегда сходится) |
| L3 тоже упал (SQLite-error) | `compress()` возвращает `null` через try/catch → compressor.ts откатывается на legacy |
| Включение LCM на агенте с длинной историей | Первый компакт обрабатывает всю историю как один backlog. `dynamic_leaf_chunk.enabled` (если включён) разрулит, иначе несколько turn-ов будет повышенный latency. UI показывает баннер. |
| Агент в `ignore_session_patterns` | `compress()` сразу возвращает `null` без записи. Сессия как у анонима. |

### 7.4 Изменения в anthroclaw

- `src/session/compressor.ts` — добавить delegation-блок (~25 строк).
- `src/gateway.ts` — при сборке prompt-payload в момент `on_before_query` вызывать хук плагина (если есть). ~15 строк.
- `src/agent/agent.ts` — передавать `pluginRegistry` в context компонентов через DI. Несколько строк.
- **Никаких изменений в `query()`-вызове, в `createSdkMcpServer()`-настройках, в session-store SDK.**

---

## 8. UI / Config surface

### 8.1 Навигация

- **`/settings/plugins/lcm`** — глобальные defaults (читается из `config.yml > plugins.lcm.defaults`).
- **`/agents/{id}` → таб «Plugins» → секция «LCM»** — per-agent override. Чекбокс «Use global defaults» (default ON). При снятии раскрывается полная форма.

### 8.2 Группы полей

UI рендерит автоматически из Zod-schema плагина (`configSchema`).

| Группа | Поля | Defaults |
|---|---|---|
| **Toggle** | `enabled`, `tools.{grep,describe,expand,expand_query,status,doctor}` | enabled: false. Все тулы on. |
| **Triggers** | `compress_threshold_tokens`, `fresh_tail_count`, `assembly_cap_tokens`, `reserve_tokens_floor` | hermes-defaults (64 / 80% от context_length / 4096) |
| **Summarizer** | `summary_model`, `expansion_model`, `summary_timeout_ms`, `expansion_timeout_ms`, `dynamic_leaf_chunk.{enabled,max}` | Same as agent model. Timeouts 60s/120s. dynamic_leaf_chunk off. |
| **Escalation** | `l1_budget_pct`, `l1_budget_min`, `l1_budget_max`, `l2_budget_ratio`, `l3_truncate_tokens` | 20% / 2k / 12k / 0.5 / 512 |
| **DAG** | `condensation_fanin`, `incremental_max_depth`, `cache_friendly_condensation.{enabled,min_debt_groups}` | 4 / 1 / off / 2 |
| **Lifecycle** | `carry_over_on_session_reset`, `carry_over_retain_depth`, `deferred_maintenance.max_passes` | true / 2 / 4 |
| **Sessions** | `ignore_session_patterns: string[]`, `stateless_session_patterns: string[]` | `[]` |
| **Pre-extraction** | `pre_compaction_extraction.enabled`, `extraction_dir` | off |
| **Externalization** | `large_output.{enabled,threshold_chars}`, `transcript_gc.enabled` | all off (opt-in) |
| **Operator** | `slash_command.enabled`, `doctor.clean_apply.enabled` | false / false (двойной gate) |

### 8.3 UX-правила

- **Безопасные дефолты сразу.** `enabled: true` без других правок → корректная работа. Все «опасные» фичи (transcript GC, doctor clean apply, externalization) — opt-in.
- **Tooltips из Zod `.describe()`** — каждое поле имеет описание.
- **Numeric range hints** — `.min(N).max(M)` показывается в UI.
- **Per-agent override visualization** — overridden-поле с кнопкой «reset to global default».
- **Live-validation через Zod** — inline-ошибки, save-кнопка disabled при невалидном вводе.
- **«Apply now» vs «Apply on next turn»** — toggle plugin master-switch и triggers/summarizer/dag меняются с следующего turn-а (без рестарта). Hot-reload через chokidar. Бейджи `✓ live` / `⟳ next turn` у соответствующих полей.

### 8.4 Что НЕ в UI

- DDL миграции — автоматически на старте.
- Внутренние эвристики (`directness_score` коэффициенты) — захардкожены.
- SQLite path — derived из `data_dir`.

---

## 9. Storage layout

Один SQLite-файл на агент: **`data/lcm-db/{agentId}.sqlite`**. Параллельно `data/memory-db/{agentId}.sqlite` — изолированы.

### 9.1 Таблицы

```sql
-- 1) Иммутабельный лог сообщений (append-only)
CREATE TABLE messages (
  store_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT NOT NULL,
  source          TEXT NOT NULL,        -- 'telegram'|'whatsapp'|'cli'|'unknown'
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  tool_call_id    TEXT,
  tool_calls_json TEXT,
  tool_name       TEXT,
  ts              INTEGER NOT NULL,
  token_estimate  INTEGER NOT NULL,
  pinned          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_messages_session ON messages(session_id, store_id);
CREATE INDEX idx_messages_source ON messages(source);

-- FTS5 в режиме external content
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content, content='messages', content_rowid='store_id', tokenize='porter unicode61'
);
-- + триггеры insert/delete/update

-- 2) DAG свёрток
CREATE TABLE summary_nodes (
  node_id              TEXT PRIMARY KEY,
  session_id           TEXT NOT NULL,
  depth                INTEGER NOT NULL,
  summary              TEXT NOT NULL,
  token_count          INTEGER NOT NULL,
  source_token_count   INTEGER NOT NULL,
  source_ids_json      TEXT NOT NULL,
  source_type          TEXT NOT NULL,
  earliest_at          INTEGER NOT NULL,
  latest_at            INTEGER NOT NULL,
  created_at           INTEGER NOT NULL,
  expand_hint          TEXT
);
CREATE INDEX idx_nodes_session_depth ON summary_nodes(session_id, depth, created_at);

CREATE VIRTUAL TABLE nodes_fts USING fts5(
  summary, content='summary_nodes', content_rowid='rowid', tokenize='porter unicode61'
);

-- 3) Lifecycle state
CREATE TABLE lcm_lifecycle_state (
  conversation_id              TEXT PRIMARY KEY,
  current_session_id           TEXT,
  last_finalized_session_id    TEXT,
  current_frontier_store_id    INTEGER,
  last_finalized_frontier_id   INTEGER,
  debt_kind                    TEXT,
  debt_size_estimate           INTEGER,
  updated_at                   INTEGER,
  reset_at                     INTEGER,
  finalized_at                 INTEGER
);

-- 4) Метаданные миграций
CREATE TABLE schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### 9.2 Особенности (порт hermes)

- **Source lineage через рекурсивный CTE** в `dag.ts`: для фильтра по `source` обход `summary_nodes.source_ids_json` через `json_each` до `messages` и проверка `messages.source = ?`. Mixed-source узлы матчатся на оба фильтра.
- **FTS-triggers** держат `messages_fts` в синхроне с `messages`.
- **Detection битого FTS** + free-disk-check (минимум 50MB) перед `INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`. При нехватке — degrade в LIKE-поиск.
- **Versioned migrations**: `SCHEMA_VERSION` константа, мигратор v1→v2→...→vN.
- **Externalized payloads** — `data/lcm-large-outputs/{agentId}/{ts}_{tool}_{sha256_prefix}_{nanos}.json`. Не в SQLite.
- **Backups** для `lcm doctor clean apply` — `data/lcm-db/backups/{agentId}-{YYYYMMDD_HHMMSS}.sqlite`.

### 9.3 Изоляция conversation_id vs session_id

- `session_id` = anthroclaw session_key (`agentId:channel:chatType:peerId[:groupSuffix]`) — меняется при rotation.
- `conversation_id` (в lifecycle) = тот же ключ без peer-разделения. При ротации сессии lifecycle сохраняется (frontier, debt).

### 9.4 Размеры на проде

Оценка ~1KB на сообщение в среднем (content + tokenization + FTS). 100k turns ≈ 100MB на агента. Терпимо (anthroclaw уже хранит media и memory).

---

## 10. Rollout / migration path

Три фазы. Гарантия zero-downtime.

### 10.1 Фаза 1 — Установка плагина

1. `pnpm install` подтянул workspace-пакет `plugins/lcm/`.
2. `pnpm --filter ./plugins/lcm build` собрал TS → `dist/`.
3. Plugin-loader через chokidar обнаружил `plugins/lcm/.claude-plugin/plugin.json`. Зарегистрировал в registry с `enabled=false` для всех агентов.
4. SQLite-миграции применяются lazy — только при первом обращении.

В этой фазе на проде ничего не меняется. Все агенты работают через legacy compressor.

### 10.2 Фаза 2 — Опт-ин включение на тестовом агенте

1. UI `/agents/{id}` → Plugins → LCM → toggle `enabled: true`. Записывается в `agent.yml`.
2. Watcher ловит изменение → `pluginRegistry` лениво создаёт `LCMEngine` для этого агента → bootstrap создаёт `data/lcm-db/{agentId}.sqlite` со схемой v1.
3. На следующем turn-е:
   - `on_after_query` мирорит сообщения.
   - `on_before_query` пока pass-through (нет DAG-узлов).
   - При первом overflow `compressor.ts` вызывает `lcm.compress()` → создаются D0-узлы. Может занять 20-40s на длинной истории. UI баннер «первый компакт LCM может занять до 60s».
4. Оператор гоняет `lcm_doctor` через slash-command. Проверяет DAG-узлы, FTS, lifecycle.

**Откат:** `enabled: false` в UI. Один turn — и legacy возвращается. Store-данные остаются в SQLite.

### 10.3 Фаза 3 — Постепенное включение на проде

1. Один за другим (один день — один агент). Для каждого повтор Фазы 2.
2. Глобальный `config.yml > plugins.lcm.defaults.enabled: true` ставим **в самый последний момент**, когда все per-agent override-ы выставлены явно.

### 10.4 Откат при ЧС

| Сценарий | Действие |
|---|---|
| Latency взлетел | UI → `enabled: false`. Один turn — и легаси. |
| Падение в `lcm.compress()` | `compressor.ts` ловит throw, идёт на legacy. Pino-метрика `lcm.compress.failed`. Оператор смотрит. |
| SQLite повредился | `lcm_doctor apply: true` (под двойным gate) → backup + clean. Или ручная замена SQLite на пустой. |
| Несовместимость с обновлённым SDK | `enabled: false` глобально, либо update LCM до compatible. Плагин версионируется отдельно. |

### 10.5 Совместимость с существующими сессиями

В момент включения LCM на агенте у него уже есть длинная история в anthroclaw session-store. Mirror в (2) пишет только **новые** сообщения. Старая история остаётся в anthroclaw session-store, в LCM-store не попадает. Drill через `lcm_*` для старого недоступен.

**Backfill** — отдельная команда (`lcm doctor backfill --from-session-store`), добавляется в v0.2.0 после v0.1.0 MVP. **В MVP не делаем.**

### 10.6 Версионирование

- `plugins/lcm/package.json` — semver.
  - v0.1.0 = MVP с полным портом, все 6 тулов.
  - v0.2.0 = backfill + perf-тюнинг.
  - v1.0.0 = production-stable после soak в 4-6 недель.
- `SCHEMA_VERSION` в SQLite растёт независимо. Миграции irreversible.
- `manifest.requires.anthroclaw` — semver-constraint на ядро.

### 10.7 Документация

- `plugins/lcm/README.md` — что делает, как включить, тулы, troubleshooting.
- `docs/lcm-architecture.md` — порт hermes-lcm, диаграмма потоков, схема SQLite, глоссарий.
- `CHANGELOG.md` плагина.

---

## 11. Testing strategy

### 11.1 Unit-тесты

`plugins/lcm/tests/*.test.ts`. Гоняются `pnpm --filter ./plugins/lcm test`, под секунду.

| Модуль | Что тестируем |
|---|---|
| `store.ts` | append → store_id монотонно; FTS-триггеры синкают INSERT/DELETE/UPDATE; фильтр по source (включая mixed); pinned-флаг; immutability |
| `dag.ts` | create_node с source_type=messages/nodes; рекурсивный source-lineage CTE; get_uncondensed_at_depth; reassign_session_nodes; orphan-detection |
| `escalation.ts` | L1 → L2 fallback; L2 → L3 fallback; L3 = head[40%]+«[truncation]»+tail[40%]; thinking-block sanitization (`<think>`/`<thinking>`/`<reasoning>`) |
| `tokens.ts` | tiktoken-путь; char-fallback; CJK |
| `search-query.ts` | requires_like_fallback для CJK/emoji/несбалансированных кавычек; escape_like; directness_score |
| `bootstrap.ts` | clean install; v1→v2→v3→v4 миграции; rebuild FTS при corruption; abort при <50MB free |
| `lifecycle.ts` | frontier обновляется на mirror; debt сбрасывается на reset; carry-over depth |
| `tools/*` | каждый из 6 — happy path + edge: пустой store, несуществующий node_id, превышение max_tokens, externalized_ref не найден, rate-limit per-turn |

### 11.2 Integration-тесты с моком LLM

`plugins/lcm/tests/integration/`. Подменяем `ctx.runSubagent` на мок.

Сценарии: 50 messages → leaf pass; 100 messages → leaf + condensation; L1 timeout → fallback L2; все три уровня падают → graceful return; rotation сессии при `carry_over_retain_depth=2`; cold-start на 200 messages.

### 11.3 Lossless drill-down test (обязательный)

`plugins/lcm/tests/integration/lossless.test.ts`. Главный invariant.

```ts
it('preserves exact source messages through full DAG drill-down', async () => {
  // 1. SETUP: 200 сообщений с уникальными маркерами
  const original = generateMessages(200);  // `MARKER-${i}: ${content}`
  for (const msg of original) await store.append(msg);

  // 2. ACT: вынуждаем многоуровневую компакцию
  await engine.compress({ ... });          // → D0-узлы
  await engine.compress({ ... });          // → D1
  await engine.compress({ ... });          // → D2

  // 3. ASSERT-структура: D2 существует
  const d2Nodes = await dag.getNodesAtDepth(sessionId, 2);
  expect(d2Nodes.length).toBeGreaterThan(0);

  // 4. ACT-drill: D2 → D1 → D0 → messages
  const d2 = d2Nodes[0];
  const d1Children = await tools.lcm_expand({ node_id: d2.node_id, max_tokens: 999999 });
  expect(d1Children.type).toBe('nodes');
  const d0Children = [];
  for (const d1 of d1Children.items) {
    const r = await tools.lcm_expand({ node_id: d1.node_id, max_tokens: 999999 });
    d0Children.push(...r.items);
  }
  const recoveredMessages = [];
  for (const d0 of d0Children) {
    const r = await tools.lcm_expand({ node_id: d0.node_id, max_tokens: 999999 });
    recoveredMessages.push(...r.items);
  }

  // 5. ASSERT-lossless: байт-в-байт совпадение
  recoveredMessages.sort((a, b) => a.store_id - b.store_id);
  const originalIngested = original.slice(1, -fresh_tail_count);
  expect(recoveredMessages.length).toBe(originalIngested.length);
  for (let i = 0; i < originalIngested.length; i++) {
    expect(recoveredMessages[i].content).toBe(originalIngested[i].content);
    expect(recoveredMessages[i].role).toBe(originalIngested[i].role);
    expect(recoveredMessages[i].ts).toBe(originalIngested[i].ts);
  }

  // 6. ASSERT-через-grep
  const random = originalIngested[Math.floor(originalIngested.length / 2)];
  const marker = random.content.match(/MARKER-(\d+)/)![1];
  const grepResult = await tools.lcm_grep({ query: `MARKER-${marker}` });
  expect(grepResult.results.length).toBeGreaterThan(0);
  const traced = await traceToOriginalMessage(grepResult.results[0]);
  expect(traced.content).toContain(`MARKER-${marker}`);
});
```

**Дополнительные lossless-инварианты:**
- **Source lineage по платформе.** Mixed-source store, фильтр `source: 'telegram'` через recursive CTE — только узлы с telegram-сообщениями в predecessor-цепочке.
- **Carry-over preserves drill-down.** После `record_reset` с `carry_over_retain_depth=2`, drill через D2 на новом session_id — всё ещё работает.
- **Externalized payload — тоже до исходника.** tool-result >12k символов → externalization → `lcm_expand({ externalized_ref })` возвращает байт-в-байт исходный payload.
- **Restart-survives-drill-down.** Закрыли SQLite, открыли — drill даёт те же ответы.

Эти 5 тестов — теги `@lossless` в vitest. Регрессия = automatic merge-block.

### 11.4 Gateway-integration

`src/__tests__/lcm-integration.test.ts`. Тестируем точку делегирования из `compressor.ts`:

- LCM выкл → legacy путь.
- LCM вкл, успех → возвращается LCM-assembly.
- LCM вкл, throw → fallback на legacy без вылета turn-а.
- LCM возвращает null → fallback на legacy.
- Хук `on_after_query` мирорит сообщения → store растёт.

### 11.5 E2E с реальной LLM

`plugins/lcm/tests/e2e/`. `it.runIf(process.env.E2E)`. Реальный `query()` SDK с claude-haiku для проверки prompt-формата суммаризатора. Не в обычном CI — отдельный workflow.

### 11.6 SDK-нативность contract-test

`plugins/lcm/tests/contract.test.ts`:

```ts
it('plugin makes no direct anthropic-sdk imports', () => {
  const sources = readAllTSFiles('plugins/lcm/src/');
  for (const src of sources) {
    expect(src).not.toContain("from '@anthropic-ai/sdk'");
    expect(src).not.toMatch(/messages\.create\s*\(/);
  }
});
```

Гарантирует что плагин **никогда** не дрейфит в сторону прямого Messages API. Обязательный CI-gate.

### 11.7 Coverage-target

Per-package via vitest --coverage:
- ≥90% lines на `engine.ts`/`store.ts`/`dag.ts`/`escalation.ts`
- ≥80% на остальных модулях

CI блокирует merge при падении.

### 11.8 Что НЕ тестируем

- SQLite-производительность (ответственность better-sqlite3).
- Numeric-эвристики типа `directness_score=3e-7` (хардкод-константы).
- Performance benchmarks — отдельный non-CI job.

---

## 12. Open questions

Нет. Все архитектурные вопросы решены в brainstorming-сессии (см. §2).

Тонкие детали реализации (точные значения timeouts, конкретные prompt-шаблоны для L1/L2-суммаризатора, точная структура `expand_hint`) определяются в фазе writing-plans / implementation. Это не блокеры для дизайна.

---

## 13. References

- **hermes-lcm** — `https://github.com/stephenschoettler/hermes-lcm` — реализация-источник, склонированo в `reference-projects/hermes-lcm/` для подсматривания при реализации.
- **LCM paper** — Ehrlich & Blackman, Voltropy PBC, Feb 2026 — `https://papers.voltropy.com/LCM`. Архитектурная статья (Hierarchical DAG, Three-Level Escalation, Guaranteed Convergence, Zero-Cost Continuity, Large File Handling).
- **lossless-claw** — `https://github.com/martian-engineering/lossless-claw` — параллельная реализация для OpenClaw, источник pattern syntax (`*`/`**`).
- **Claude Code Plugin Spec** — стандарт `.claude-plugin/plugin.json` + `mcp.json` + `skills/`/`commands/`/`agents/`/`hooks/`.
- **anthroclaw CLAUDE.md** — `/Users/tyess/dev/openclaw-agents-sdk-clone/CLAUDE.md` — источник архитектурных constraint-ов (LLM runtime rules, gateway lifecycle, hooks, session keys).

---

## 14. Estimated effort

- Plugin-system framework в anthroclaw (§3): ~1 неделя
- LCM core (store + DAG + escalation + lifecycle): ~2 недели
- 6 MCP-тулз + skill-инструкция: ~1 неделя
- UI integration + Zod schema + панель настроек: ~3-4 дня
- Тесты (unit + integration + lossless + contract): ~1 неделя (включая lossless drill-down)
- Документация + rollout: ~3 дня

**Итого: ~5-6 недель** на одного разработчика для v0.1.0 MVP с feature-parity к hermes-lcm.
