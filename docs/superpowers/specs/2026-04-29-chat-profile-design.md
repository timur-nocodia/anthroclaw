# `chat_like_openclaw` Profile — Design

**Date:** 2026-04-29
**Status:** Draft (ожидает ревью)
**Author:** Claude + Timur (brainstorming session)
**Scope:** Новый safety profile `chat_like_openclaw` для личных single-user мессенджер-ботов. Заодно фиксит deadlock'и валидации (bypass+wildcard) и делает default scaffold рабочим.
**Builds on:** [`2026-04-29-safety-profiles-design.md`](./2026-04-29-safety-profiles-design.md)

---

## 1. Контекст и цели

### 1.1 Проблема

После внедрения safety_profile системы (PR #2) агенты, использующие `claude_code` preset (`trusted`/`private`), получают в systemPrompt инструкции типа "be concise", "no preamble", "minimize tokens", "professional tone". Результат: тот же Opus, который в OpenClaw общался тепло, проактивно, многословно ("ой, попробую так… о, заработало"), у нас отвечает сухими рапортами.

Klavdia (single-user TG-бот, `agents/example`) — это не CLI-помощник. Ей не нужны ни Read/Write/Edit/Bash, которые preset подтягивает, ни инструкции про сжатость. Preset — налог без выгоды.

Дополнительно обнаружены два side-issue:

1. **Validation deadlock.** У существующих агентов в overrides встречаются `permission_mode: bypass` + `allowlist.telegram: ['*']`. Это не помещается ни в один профиль: bypass требует `private`, wildcard — только `public`. Klavdia с такими настройками даёт error на UI.
2. **Сломанный scaffold.** `ui/lib/agents.ts::createAgent` не пишет `safety_profile` в новый `agent.yml`. После PR #2 этот файл валится на hard-fail валидации — UI кнопка "New agent" фактически создаёт нерабочего агента.

### 1.2 Решение

Ввести четвёртый профиль — `chat_like_openclaw`:

- system prompt = чистая строка (без preset claude_code), с baseline-персонажем + per-agent CLAUDE.md
- все built-in и MCP тулы открыты без approval flow
- wildcard в allowlist разрешён, permission_mode bypass подразумевается
- editable `personality` поле в agent.yml + textarea в дашборде
- сделать его дефолтом для нового агента (UI scaffold)
- мигрировать `agents/example` (Klavdia) на этот профиль; переписать её CLAUDE.md под живой тон

### 1.3 Жёсткое ограничение — нативность Agent SDK

Все правки через стандартные `Options` поля (`systemPrompt`, `settingSources`, `disallowedTools`, `canUseTool`, `permissionMode`). Никакого обхода `query()`, никаких прямых вызовов Messages API. Нарушение этого правила = риск блокировки подписки Anthropic.

### 1.4 Не-цели (out of scope)

- **Peer-isolated memory.** Если на chat-профиле два разных юзера дойдут до бота — они увидят память друг друга. Это ожидаемо: chat предназначен для single-user сценария. Хочешь multi-tenant — переключайся на public.
- **Интерактивный wizard для personality.** Просто textarea, без шаблонов "выбери из 5 готовых характеров".
- **Авто-миграция остальных агентов.** `content_sm_building`, `leads_agent` остаются на `public` — они публичные. Только `example` мигрируется.
- **Ретроактивный фикс существующих agent.yml без safety_profile.** Hard-fail на отсутствующий `safety_profile` остаётся (по решению PR #2). Старые клонированные агенты должны явно прописать профиль.
- **Переименование/удаление существующих профилей** (public/trusted/private остаются нетронутыми).

---

## 2. Дизайн

### 2.1 Профиль `chat_like_openclaw`

Файл: `src/security/profiles/chat-like-openclaw.ts`.

Сравнение поведения по поверхностям:

| Поверхность | public | trusted | private | **chat_like_openclaw** |
|---|---|---|---|---|
| `systemPrompt.mode` | string | preset claude_code | preset claude_code | **string** (с baseline) |
| `settingSources` | `[]` | `['project']` | `['project']` | **`[]`** |
| Built-in tools allowed | safe-only (Read/Glob/Grep/LS/NotebookRead) | most | all | **all** (Read/Write/Edit/MultiEdit/Glob/Grep/LS/Bash/WebFetch/NotebookEdit/TodoWrite) |
| MCP tools allowed | by META `safe_in_public` | by META `safe_in_trusted` | by META `safe_in_private` | **all** (`allowedByMeta = () => true`) |
| Plugin tools (`mcp__*` без META) | блокированы (override required) | auto-allow | auto-allow | **auto-allow** |
| `hardBlacklist` | `Bash`, `manage_skills`, `access_control` | `∅` | `∅` | **`∅`** |
| `permissionFlow` | `approval` | `approval` | `optional` (allows bypass) | **`bypass`** (default; override-able) |
| `canUseTool` | gating per profile | gating per profile | gating per profile | **auto-allow всегда** |
| `sandboxDefaults.exec` | strict | strict | optional | **unsandboxed** |
| `rateLimitFloor` | 30/h | 100/h | none | **none** |
| `validateAllowlist` (`*`) | OK | reject | reject | **OK** |

Эффективно: chat = "private + bypass + wildcard + custom system prompt + persona baseline".

### 2.2 System prompt структура

Резолвер в `src/sdk/options.ts::buildSdkOptions`:

```ts
function resolveChatSystemPrompt(agent: AgentDef, claudeMd: string): string {
  const baseline = agent.config.personality?.trim()
    ? agent.config.personality
    : CHAT_PERSONALITY_BASELINE;
  return `${baseline}\n\n─────────\n\n${claudeMd}`;
}
```

`CHAT_PERSONALITY_BASELINE` живёт константой в `src/security/profiles/chat-personality-baseline.ts`. Черновик (финальный текст утверждается на ревью спека):

```
You are an autonomous Telegram/WhatsApp messaging agent — not a CLI helper.
Communicate like a person, not a tool. Be warm, conversational, curious.
It's fine to ask clarifying questions, share reasoning out loud, use emoji
where natural. Don't robot-rapport ("done.", "confirmed."). When something
fails — narrate, propose alternatives, don't just dump the error. The user
is here for a relationship with you, not a function call.
```

Per-agent override: `agent.yml::personality` (optional string). Если пусто/отсутствует → используется baseline.

Hot-reload: ConfigWatcher уже отслеживает изменения `agent.yml`; нового prompt с обновлённой `personality` подхватится на следующем dispatch'е без рестарта контейнера.

### 2.3 Schema (Zod)

`src/config/schema.ts`:

- `safetyProfileEnum`: добавить `'chat_like_openclaw'` к существующим трём
- `AgentYmlSchema`: добавить `personality: z.string().optional()` на верхнем уровне

Поле `personality` валидно на любом профиле, но эффект имеет только на `chat_like_openclaw`. На других профилях — info-warning от валидатора: `"personality field has no effect on safety_profile=<X>"`.

### 2.4 Profile registry & default lookup

`src/security/profiles/index.ts`:

- `getProfile('chat_like_openclaw')` возвращает инстанс
- `ALL_PROFILES` расширяется
- Новая утилита `getDefaultProfile(): ProfileName` возвращает `'chat_like_openclaw'` — единый source-of-truth для scaffold/тестов

### 2.5 Validator (`validateSafetyProfile`)

На chat-профиле:
- wildcard `*` в `allowlist` — OK
- `safety_overrides.permission_mode = bypass` — OK
- любые `safety_overrides.allow_tools` — OK, но info-warning: `"safety_overrides have no effect on chat_like_openclaw — all tools are already allowed"`
- `safety_overrides.deny_tools` — единственный override, который реально что-то делает на chat (агент явно блокирует тул для себя поверх профиль-allow). Не warning.
- `safety_overrides.permission_mode = default` — explicit opt-in в approval flow; не warning, обрабатывается как выраженное намерение пользователя.

### 2.6 Scaffold (UI + API)

`ui/lib/agents.ts::createAgent`:

Оба шаблона (`blank` и `example`) теперь пишут `safety_profile: chat_like_openclaw` в новый `agent.yml`. Используется `getDefaultProfile()` (через `@backend/security/profiles`), не хардкод-строка — так дефолт меняется в одном месте.

```ts
const config = {
  model: agentModel,
  safety_profile: getDefaultProfile(),
  routes: [...],
  // ...
};
```

`example` шаблон дополнительно:
- использует расширенный `mcp_tools` список (memory_search, memory_write, send_message, list_skills, manage_cron)
- `CLAUDE.md` содержит короткий character-абзац как пример

### 2.7 UI dropdown + tooltip

`ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx`:

- `SAFETY_PROFILES` массив: добавить `{ value: 'chat_like_openclaw', label: 'chat — friendly conversational, all tools' }` **первым**
- `SAFETY_PROFILE_TOOLTIP[chat_like_openclaw]`:

```
chat — Personal/single-user mode. Warm conversational tone (not a CLI
helper). All tools allowed without approval. Wildcard allowlist OK.
Best fit when you trust everyone who can reach the bot. Default for
new agents.
```

- `cfg.safety_profile` тип расширяется до 4 значений
- В `useState` инициализатор fallback меняется с `'private'` на `'chat_like_openclaw'`

### 2.8 Personality textarea

Conditional render блок в той же config-странице, **только если** `cfg.safety_profile === 'chat_like_openclaw'`:

```jsx
<Field
  label="Personality"
  tooltip="Custom system-prompt baseline for this agent. Empty = use profile default. Edits hot-reload."
>
  <textarea
    value={cfg.personality ?? ''}
    placeholder={CHAT_PERSONALITY_BASELINE}
    onChange={(e) => update({ personality: e.target.value })}
    rows={10}
    className="..."
  />
</Field>
```

Сохранение: на save страницы поле `personality` уходит в PUT `/api/agents/[id]` вместе с остальным config'ом, попадает в `agent.yml`.

`CHAT_PERSONALITY_BASELINE` в UI берётся через API endpoint `GET /api/security/profiles/chat_like_openclaw/baseline` (новый, простой read endpoint) — чтобы не дублировать строку из backend в UI.

### 2.9 Migration `agents/example` (Klavdia)

`agents/example/agent.yml`:

```diff
-safety_profile: trusted
+safety_profile: chat_like_openclaw

-sdk:
-  disallowedTools:
-    - RemoteTrigger
-    - CronCreate
-    ...
```

(блок `sdk.disallowedTools` удаляется — chat не использует preset, harness primitives не advertised'ятся в принципе.)

`agents/example/CLAUDE.md`:
- удалить любые "be concise / professional / brief" фразы
- добавить character-абзац ~3-5 строк (черновик: "Тебя зовут Клавдия. Ты живая, любопытная, дружелюбная. Любишь шутить, не стесняйся уточнять. Помнишь контекст, советуешь, предлагаешь варианты.")
- оставить операционные инструкции (про cron/memory/tools — что нужно)

### 2.10 Migration utility (`scripts/migrate-safety-profile.ts`)

`inferProfile()` heuristics:

- Если у агента `safety_overrides.permission_mode = bypass` ИЛИ `*` в allowlist ИЛИ нет `safety_profile` поля вовсе → suggest `chat_like_openclaw`
- Иначе — текущая логика (public/trusted/private)

`runMigration()` обновлённый dry-run output показывает chat среди возможных suggestions.

### 2.11 Docs

- `docs/safety-profiles.md`: добавить секцию `## chat_like_openclaw` в начало (после intro). Когда использовать, что включено, чем отличается от private.
- `README.md`: одна строка про chat в перечне профилей; уточнить дефолт для новых агентов.
- `CHANGELOG.md`: запись в `[Unreleased]`.

---

## 3. Тесты

### 3.1 Backend (`src/`)

| Файл | Покрывает |
|---|---|
| `src/security/__tests__/profiles-chat.test.ts` *(new)* | profile loads, builtinTools.allowed contains all, mcpToolPolicy.allowedByMeta = true для всех META, hardBlacklist пуст, validateAllowlist принимает wildcard |
| `src/security/__tests__/profiles-validate-chat.test.ts` *(new)* | validateSafetyProfile с chat: bypass passes, wildcard passes, allow_tools → info-warning, deny_tools → no warning |
| `src/sdk/__tests__/options-chat.test.ts` *(new)* | buildSdkOptions on chat: systemPrompt is string, baseline + CLAUDE.md, settingSources `[]`; with personality override → uses override |
| `src/sdk/__tests__/permissions-chat.test.ts` *(extend)* | canUseTool on chat: Bash/Read/Write/MCP/plugin tools all allow, не дёргает approval flow |
| `src/config/__tests__/schema-chat.test.ts` *(extend existing)* | Zod schema принимает `safety_profile: chat_like_openclaw` и optional `personality` поле |

### 3.2 UI (`ui/`)

| Файл | Покрывает |
|---|---|
| `ui/__tests__/components/agent-config-chat.test.tsx` *(new)* | personality textarea рендерится только при chat profile, плейсхолдер показывает baseline, edit обновляет cfg + dirty flag |
| `ui/__tests__/lib/agents-create-default.test.ts` *(new)* | createAgent('blank') и createAgent('example') пишут safety_profile=chat_like_openclaw |
| `ui/__tests__/api/validate-safety-profile-chat.test.ts` *(extend)* | wildcard + chat → no errors; bypass + chat → no errors; allow_tools + chat → info warning |
| `ui/__tests__/api/profiles-baseline.test.ts` *(new)* | GET /api/security/profiles/chat_like_openclaw/baseline returns expected baseline string |

### 3.3 Migration script

| Файл | Покрывает |
|---|---|
| `scripts/__tests__/migrate-safety-profile-chat.test.ts` *(new)* | inferProfile detects bypass+wildcard → suggests chat_like_openclaw; minimal config → suggests chat_like_openclaw |

### 3.4 E2E sanity (`src/__tests__/`)

| Файл | Покрывает |
|---|---|
| `src/__tests__/chat-profile-e2e.test.ts` *(new)* | Загрузка `agents/example` (после миграции) — профиль = chat, systemPrompt не содержит "be concise"/"claude_code", personality (если задана) применяется |

---

## 4. План работ (high-level — детальный план будет в отдельном документе)

1. Backend: `chat_like_openclaw` profile + baseline const
2. Schema: расширение enum'а + `personality` поле
3. Profile registry: regstration + `getDefaultProfile()` helper
4. SDK: `buildSdkOptions` resolver для chat → string systemPrompt
5. Permissions: `canUseTool` short-circuit для chat
6. Validator updates (wildcard/bypass acceptance)
7. UI dropdown: новая опция + tooltip + reorder
8. UI textarea: personality editor
9. UI scaffold default: `createAgent` пишет safety_profile
10. API endpoint: `/api/security/profiles/<name>/baseline` (read-only)
11. Migration utility: inferProfile updates
12. Migrate `agents/example` (Klavdia) yml + CLAUDE.md
13. Docs: safety-profiles.md, README, CHANGELOG
14. Tests (по списку выше)
15. Final review + spec compliance check

Каждый пункт = отдельная задача в плане для subagent-driven workflow. Каждая задача проходит implementer → spec reviewer → quality reviewer.

---

## 5. Открытые вопросы

(на момент написания спека — нет открытых, все решено в brainstorming. Если возникнут на этапе implementation — добавляются сюда + в плане)

---

## 6. Связанные документы

- [Safety Profiles Design (PR #2)](./2026-04-29-safety-profiles-design.md) — базовая система профилей
- [Safety Profiles Plan](../plans/2026-04-29-safety-profiles.md) — детализация PR #2
- `docs/safety-profiles.md` — user-facing документация
